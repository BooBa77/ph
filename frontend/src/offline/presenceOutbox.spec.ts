import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  flushPresenceOutboxes,
  presenceOutboxKey,
  presenceOutboxTripIds,
  prunePresenceOutbox,
  pushPresenceOutbox,
  queuePresenceChange,
  readPresenceOutbox,
  writePresenceOutbox,
  type PresenceOutboxEntry,
} from '@/offline/presenceOutbox'

/**
 * Очередь отметок присутствия (17.11.2026).
 *
 * Проверяем то, ради чего она нужна: отметка без связи остаётся на
 * устройстве, уходит при возврате связи, а повторное нажатие заменяет
 * прежнее состояние, а не копит запросы. IndexedDB подменяется картой,
 * как в `diaryOutbox.spec.ts`: в jsdom настоящей базы нет, а проверяем
 * логику, а не браузер.
 */
const mocks = vi.hoisted(() => ({
  setTripPresence: vi.fn(),
  responses: new Map<string, unknown>(),
  state: new Map<string, unknown>(),
}))

vi.mock('@/api/trips', () => ({ setTripPresence: mocks.setTripPresence }))

vi.mock('@/offline/indexedDb', () => ({
  RESPONSES_STORE: 'responses',
  STATE_STORE: 'state',
  getRecord: async (store: string, key: string) => {
    const source = store === 'responses' ? mocks.responses : mocks.state
    return source.get(key) ?? null
  },
  putRecord: async (store: string, value: Record<string, unknown>) => {
    const source = store === 'responses' ? mocks.responses : mocks.state
    const key = store === 'responses' ? String(value.path) : String(value.key)
    source.set(key, value)
    return true
  },
  deleteRecord: async (store: string, key: string) => {
    const source = store === 'responses' ? mocks.responses : mocks.state
    source.delete(key)
  },
  getAllRecords: async (store: string) =>
    [...(store === 'responses' ? mocks.responses : mocks.state).values()],
  deleteByIndex: async () => undefined,
  clearStore: async () => undefined,
}))

function mark(overrides: Partial<PresenceOutboxEntry> = {}): PresenceOutboxEntry {
  return {
    userId: 'u-1',
    status: 'route',
    at: '2026-11-17T03:00:00.000Z',
    ...overrides,
  }
}

describe('очередь присутствия', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.responses.clear()
    mocks.state.clear()
    mocks.setTripPresence.mockResolvedValue({})
  })

  it('ключ очереди — свой у каждого похода', () => {
    expect(presenceOutboxKey('7')).toBe('presenceOutbox:7')
    expect(presenceOutboxKey('8')).not.toBe(presenceOutboxKey('7'))
  })

  it('пустая очередь читается как пустой список', async () => {
    expect(await readPresenceOutbox('7')).toEqual([])
  })

  it('повторное нажатие заменяет прежнюю отметку, а не копится', async () => {
    await queuePresenceChange('7', mark({ status: 'route' }))
    await queuePresenceChange('7', mark({ status: 'returned', at: '2026-11-17T04:00:00.000Z' }))

    const queue = await readPresenceOutbox('7')
    expect(queue).toHaveLength(1)
    expect(queue[0]?.status).toBe('returned')
  })

  it('мусор в хранилище не ломает чтение очереди', async () => {
    await writePresenceOutbox('7', [mark()])
    mocks.state.set(presenceOutboxKey('7'), { key: presenceOutboxKey('7'), value: [{ nope: true }] })

    expect(await readPresenceOutbox('7')).toEqual([])
  })

  it('отправка снимает только принятые версии', async () => {
    await queuePresenceChange('7', mark())
    await queuePresenceChange('7', mark({ userId: 'u-2', at: '2026-11-17T05:00:00.000Z' }))

    mocks.setTripPresence.mockImplementationOnce(async () => {
      // Пока первый уходит, второй отметке прилетает новая версия.
      await queuePresenceChange('7', mark({ userId: 'u-2', status: 'none', at: '2026-11-17T06:00:00.000Z' }))
      return {}
    })

    const result = await pushPresenceOutbox('7')

    // Снимок отправлен целиком: u-1 и старая версия u-2.
    expect(mocks.setTripPresence).toHaveBeenCalledTimes(2)
    expect(mocks.setTripPresence).toHaveBeenCalledWith('7', 'u-1', 'route')
    // Новая версия u-2, поставленная во время отправки, осталась в очереди.
    expect(result?.pending).toEqual([
      mark({ userId: 'u-2', status: 'none', at: '2026-11-17T06:00:00.000Z' }),
    ])
  })

  it('ошибка отправки оставляет отметку в очереди', async () => {
    await queuePresenceChange('7', mark())
    mocks.setTripPresence.mockRejectedValue(new Error('нет связи'))

    const result = await pushPresenceOutbox('7')

    expect(result?.pending).toHaveLength(1)
    expect(await readPresenceOutbox('7')).toHaveLength(1)
  })

  it('отправленные версии снимаются, даже если следующая упала', async () => {
    await queuePresenceChange('7', mark())
    await queuePresenceChange('7', mark({ userId: 'u-2' }))

    mocks.setTripPresence
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('нет связи'))

    await pushPresenceOutbox('7')

    expect(await readPresenceOutbox('7')).toEqual([mark({ userId: 'u-2' })])
  })

  it('находит походы с неотправленными отметками', async () => {
    await queuePresenceChange('7', mark())
    await queuePresenceChange('8', mark())

    expect((await presenceOutboxTripIds()).sort()).toEqual(['7', '8'])
  })

  it('пустая очередь удаляет ключ из хранилища', async () => {
    await queuePresenceChange('7', mark())
    await prunePresenceOutbox('7', [{ userId: 'u-1', at: mark().at }])

    expect(mocks.state.has(presenceOutboxKey('7'))).toBe(false)
  })

  it('при возврате связи уходит всё, что накопилось', async () => {
    await queuePresenceChange('7', mark())
    await queuePresenceChange('8', mark({ userId: 'u-2' }))

    const trips = await flushPresenceOutboxes()

    expect(trips).toBe(2)
    expect(mocks.setTripPresence).toHaveBeenCalledTimes(2)
    expect(await readPresenceOutbox('7')).toEqual([])
  })
})
