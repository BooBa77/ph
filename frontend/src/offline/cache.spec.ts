import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Кеш ответов API.
 *
 * IndexedDB подменён картой в памяти: проверяется логика кеша (что храним,
 * что отдаём, как чистим), а не браузерное хранилище. Настоящая IndexedDB
 * в jsdom не реализована, да и проверять её из теста компонентов незачем.
 */
const memory = vi.hoisted(() => ({
  responses: new Map<string, unknown>(),
  state: new Map<string, unknown>(),
}))

vi.mock('@/offline/indexedDb', () => {
  const RESPONSES_STORE = 'responses'
  const STATE_STORE = 'state'

  return {
    RESPONSES_STORE,
    STATE_STORE,
    isIndexedDbAvailable: () => true,
    openOfflineDatabase: async () => null,
    getRecord: async (store: string, key: unknown) =>
      (store === RESPONSES_STORE ? memory.responses : memory.state).get(String(key)) ?? null,
    putRecord: async (store: string, value: unknown) => {
      const record = value as { path?: string; key?: string }
      const map = store === RESPONSES_STORE ? memory.responses : memory.state
      map.set(String(record.path ?? record.key), value)
      return true
    },
    deleteRecord: async (store: string, key: unknown) => {
      ;(store === RESPONSES_STORE ? memory.responses : memory.state).delete(String(key))
    },
    getAllRecords: async (store: string) =>
      [...(store === RESPONSES_STORE ? memory.responses : memory.state).values()],
    deleteByIndex: async (store: string, _index: string, value: unknown) => {
      if (store !== RESPONSES_STORE) return
      for (const [key, entry] of memory.responses) {
        if ((entry as { tripId?: string }).tripId === value) memory.responses.delete(key)
      }
    },
    clearStore: async (store: string) => {
      ;(store === RESPONSES_STORE ? memory.responses : memory.state).clear()
    },
  }
})

import {
  clearTripCache,
  isCacheablePath,
  listCachedResponses,
  readCachedResponse,
  readOfflineState,
  setCacheableTrips,
  tripIdFromPath,
  writeCachedResponse,
  writeOfflineState,
} from '@/offline/cache'

describe('isCacheablePath', () => {
  it('кеширует данные похода и словари вкладок', () => {
    expect(isCacheablePath('/trips')).toBe(true)
    expect(isCacheablePath('/trips?mine=true&limit=20&offset=0')).toBe(true)
    expect(isCacheablePath('/trips/types')).toBe(true)
    expect(isCacheablePath('/trips/679')).toBe(true)
    expect(isCacheablePath('/trips/679/meal-plan')).toBe(true)
    expect(isCacheablePath('/dishes')).toBe(true)
    expect(isCacheablePath('/gear-types?tripId=679')).toBe(true)
    expect(isCacheablePath('/objects?ids=1,2')).toBe(true)
  })

  it('не кеширует чужие данные: профили, календарь, админку', () => {
    expect(isCacheablePath('/users/me')).toBe(false)
    expect(isCacheablePath('/users/u-1')).toBe(false)
    expect(isCacheablePath('/admin/activities')).toBe(false)
    expect(isCacheablePath('/gear')).toBe(false)
    expect(isCacheablePath('/trips-extra')).toBe(false)
  })

  it('не кеширует саму отметку свежести', () => {
    // Устаревшая отметка сказала бы «копия свежая» ровно тогда,
    // когда это неправда.
    expect(isCacheablePath('/trips/679/cache-state')).toBe(false)
  })
})

describe('tripIdFromPath', () => {
  it('достаёт id из походных путей и не путает его со словарями', () => {
    expect(tripIdFromPath('/trips/679')).toBe('679')
    expect(tripIdFromPath('/trips/679/meals?x=1')).toBe('679')
    expect(tripIdFromPath('/trips')).toBeNull()
    expect(tripIdFromPath('/trips/types')).toBeNull()
    expect(tripIdFromPath('/dishes')).toBeNull()
  })
})

describe('кеш ответов', () => {
  beforeEach(() => {
    memory.responses.clear()
    memory.state.clear()
    // По умолчанию «список ещё неизвестен» — кешируем всё.
    setCacheableTrips(null)
  })

  it('сохраняет ответ с путём, походом и временем', async () => {
    await writeCachedResponse('/trips/679/meals', { meals: [] })

    const entry = (await readCachedResponse('/trips/679/meals')) as {
      tripId: string
      savedAt: number
    } | null

    expect(entry?.tripId).toBe('679')
    expect(entry?.savedAt).toBeTypeOf('number')
  })

  it('отдаёт копию с погашенными правами, кеш при этом не портит', async () => {
    await writeCachedResponse('/trips/679/gear', {
      canEdit: true,
      items: [{ name: 'Тент', canEdit: true }],
    })

    const cached = await readCachedResponse('/trips/679/gear')
    expect(cached?.body).toMatchObject({ canEdit: false, items: [{ canEdit: false }] })

    // В хранилище остался настоящий ответ: при возврате связи он не пригодится,
    // но и врать о правах в самом кеше нельзя — это чужие данные.
    const stored = (await listCachedResponses())[0]?.body as { canEdit: boolean }
    expect(stored.canEdit).toBe(true)
  })

  it('пустой кеш — null, а не исключение', async () => {
    await expect(readCachedResponse('/trips/679/meals')).resolves.toBeNull()
  })

  it('удаляет только данные переставшего быть текущим похода', async () => {
    await writeCachedResponse('/trips/1/meals', { meals: [] })
    await writeCachedResponse('/trips/2/meals', { meals: [] })
    await writeCachedResponse('/trips?mine=true', { trips: [] })

    await clearTripCache('1')

    expect(await readCachedResponse('/trips/1/meals')).toBeNull()
    expect(await readCachedResponse('/trips/2/meals')).not.toBeNull()
    // Список походов — не данные одного похода, его не трогаем.
    expect(await readCachedResponse('/trips?mine=true')).not.toBeNull()
  })

  it('хранит служебное состояние отдельно от ответов', async () => {
    await writeOfflineState('currentTrips', [{ id: '679' }])

    expect(await readOfflineState('currentTrips')).toEqual([{ id: '679' }])
    expect(await listCachedResponses()).toHaveLength(0)
  })

  it('не хранит данные похода, который не идёт сейчас', async () => {
    setCacheableTrips(['679'])

    await writeCachedResponse('/trips/679/meals', { meals: [] })
    await writeCachedResponse('/trips/700/meals', { meals: [] })
    // Список походов и словари не привязаны к походу — их храним всегда.
    await writeCachedResponse('/trips?mine=true', { trips: [] })

    expect(await readCachedResponse('/trips/679/meals')).not.toBeNull()
    expect(await readCachedResponse('/trips/700/meals')).toBeNull()
    expect(await readCachedResponse('/trips?mine=true')).not.toBeNull()
  })

  it('удаление кеша похода сбрасывает отметку прогрева', async () => {
    await writeOfflineState('prefetch:679', 123)

    await clearTripCache('679')

    expect(await readOfflineState('prefetch:679')).toBeNull()
  })
})
