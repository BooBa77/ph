import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  diaryOutboxKey,
  diaryOutboxTripIds,
  flushDiaryOutboxes,
  mergeDiaryEntries,
  newDiaryEntryId,
  pruneDiaryOutbox,
  pushDiaryOutbox,
  queueDiaryChange,
  readDiaryOutbox,
  writeDiaryOutbox,
  type DiaryOutboxEntry,
} from '@/offline/diaryOutbox'
import type { TripDiaryEntry } from '@/types/diary'

/**
 * Очередь дневника (16.11.2026).
 *
 * Проверяем то, ради чего она нужна: запись, сделанная без связи, остаётся
 * на устройстве, уходит при возврате связи и не теряет правки, сделанные
 * во время отправки. IndexedDB подменяется картой, как в `cache.spec.ts`:
 * в jsdom настоящей базы нет, а проверяем мы логику, а не браузер.
 */
const mocks = vi.hoisted(() => ({
  syncTripDiary: vi.fn(),
  responses: new Map<string, unknown>(),
  state: new Map<string, unknown>(),
}))

vi.mock('@/api/diary', () => ({
  syncTripDiary: mocks.syncTripDiary,
}))

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

function outboxEntry(overrides: Partial<DiaryOutboxEntry> = {}): DiaryOutboxEntry {
  return {
    id: '4c1f3a84-1111-4111-8111-111111111111',
    body: 'Запись без связи',
    createdAt: '2026-11-16T03:00:00.000Z',
    updatedAt: '2026-11-16T03:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

function serverEntry(overrides: Partial<TripDiaryEntry> = {}): TripDiaryEntry {
  return {
    id: '4c1f3a84-2222-4222-8222-222222222222',
    body: 'Запись с сервера',
    createdAt: '2026-11-15T03:00:00.000Z',
    updatedAt: '2026-11-15T03:00:00.000Z',
    ...overrides,
  }
}

describe('очередь дневника', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.responses.clear()
    mocks.state.clear()
  })

  it('ставит запись в очередь и возвращает очередь целиком', async () => {
    const queued = await queueDiaryChange('679', outboxEntry())

    expect(queued).toHaveLength(1)
    expect(await readDiaryOutbox('679')).toEqual([outboxEntry()])
  })

  it('правка той же записи заменяет её, а не добавляет вторую', async () => {
    await queueDiaryChange('679', outboxEntry())
    const queued = await queueDiaryChange(
      '679',
      outboxEntry({
        body: 'Поправленная запись',
        updatedAt: '2026-11-16T03:30:00.000Z',
      }),
    )

    expect(queued).toHaveLength(1)
    expect(queued[0]?.body).toBe('Поправленная запись')
  })

  it('пустая очередь удаляет ключ из хранилища', async () => {
    await queueDiaryChange('679', outboxEntry())
    await writeDiaryOutbox('679', [])

    expect(mocks.state.has(diaryOutboxKey('679'))).toBe(false)
  })

  it('мусор в хранилище не ломает чтение', async () => {
    mocks.state.set(diaryOutboxKey('679'), {
      key: diaryOutboxKey('679'),
      value: [{ id: 42 }, null, outboxEntry()],
    })

    expect(await readDiaryOutbox('679')).toEqual([outboxEntry()])
  })

  it('собирает походы с неотправленными записями', async () => {
    await queueDiaryChange('679', outboxEntry())
    await queueDiaryChange('680', outboxEntry({ id: newDiaryEntryId() }))
    mocks.state.set('currentTrips', { key: 'currentTrips', value: [] })

    expect((await diaryOutboxTripIds()).sort()).toEqual(['679', '680'])
  })
})

describe('слияние и отправка', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.responses.clear()
    mocks.state.clear()
  })

  it('неотправленная запись показывается поверх серверных', () => {
    const pending = outboxEntry()

    const merged = mergeDiaryEntries([serverEntry()], [pending])

    expect(merged.map((entry) => entry.id)).toEqual([serverEntry().id, pending.id])
  })

  it('серверная версия главнее при равной отметке', () => {
    const pending = outboxEntry({
      id: serverEntry().id,
      body: 'Локальная копия',
      updatedAt: serverEntry().updatedAt,
    })

    const merged = mergeDiaryEntries([serverEntry()], [pending])

    expect(merged).toHaveLength(1)
    expect(merged[0]?.body).toBe('Запись с сервера')
  })

  it('удалённая без связи запись не показывается', () => {
    const pending = outboxEntry({
      id: serverEntry().id,
      updatedAt: '2026-11-16T05:00:00.000Z',
      deletedAt: '2026-11-16T05:00:00.000Z',
    })

    expect(mergeDiaryEntries([serverEntry()], [pending])).toEqual([])
  })

  it('отправка чистит очередь и сохраняет ответ в кеш', async () => {
    const pending = outboxEntry()
    await queueDiaryChange('679', pending)
    mocks.syncTripDiary.mockResolvedValue({ entries: [serverEntry()] })

    const result = await pushDiaryOutbox('679')

    expect(mocks.syncTripDiary).toHaveBeenCalledWith('679', [pending])
    expect(result?.entries).toEqual([serverEntry()])
    expect(await readDiaryOutbox('679')).toEqual([])
    expect(mocks.responses.has('/trips/679/diary')).toBe(true)
  })

  it('правка, сделанная во время отправки, остаётся в очереди', async () => {
    const first = outboxEntry()
    await queueDiaryChange('679', first)

    const duringFlight = outboxEntry({
      body: 'Пока отправлялось, я дописал',
      updatedAt: '2026-11-16T04:00:00.000Z',
    })
    mocks.syncTripDiary.mockImplementation(async () => {
      await queueDiaryChange('679', duringFlight)
      return { entries: [serverEntry()] }
    })

    const result = await pushDiaryOutbox('679')

    expect(result?.pending).toEqual([duringFlight])
    expect(await readDiaryOutbox('679')).toEqual([duringFlight])
  })

  it('пустая очередь на сервер не ходит', async () => {
    expect(await pushDiaryOutbox('679')).toBeNull()
    expect(mocks.syncTripDiary).not.toHaveBeenCalled()
  })

  it('ошибка одного похода не мешает остальным', async () => {
    await queueDiaryChange('679', outboxEntry())
    await queueDiaryChange('680', outboxEntry({ id: newDiaryEntryId() }))

    mocks.syncTripDiary.mockImplementation(async (tripId: string) => {
      if (tripId === '679') throw new Error('нет связи')
      return { entries: [serverEntry()] }
    })

    await flushDiaryOutboxes()

    expect(await readDiaryOutbox('679')).toHaveLength(1)
    expect(await readDiaryOutbox('680')).toHaveLength(0)
  })

  it('prune убирает только отправленные версии', async () => {
    const sent = outboxEntry()
    const newer = outboxEntry({
      body: 'Новее',
      updatedAt: '2026-11-16T05:00:00.000Z',
    })
    await writeDiaryOutbox('679', [sent, newer])

    const rest = await pruneDiaryOutbox('679', [
      { id: sent.id, updatedAt: sent.updatedAt },
    ])

    expect(rest).toEqual([newer])
  })
})

describe('newDiaryEntryId', () => {
  it('выдаёт UUID версии 4', () => {
    expect(newDiaryEntryId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})
