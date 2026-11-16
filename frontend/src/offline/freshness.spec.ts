import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Сверка офлайн-копии с сервером.
 *
 * IndexedDB подменён картой в памяти — как в `cache.spec.ts`: проверяется
 * арифметика сравнения, а не браузерное хранилище.
 */
const memory = vi.hoisted(() => ({ state: new Map<string, unknown>() }))

vi.mock('@/offline/indexedDb', () => {
  const STATE_STORE = 'state'
  return {
    RESPONSES_STORE: 'responses',
    STATE_STORE,
    isIndexedDbAvailable: () => true,
    openOfflineDatabase: async () => null,
    getRecord: async (store: string, key: unknown) =>
      store === STATE_STORE ? (memory.state.get(String(key)) ?? null) : null,
    putRecord: async (store: string, value: unknown) => {
      const record = value as { key?: string }
      if (store === STATE_STORE) memory.state.set(String(record.key), value)
      return true
    },
    deleteRecord: async (store: string, key: unknown) => {
      if (store === STATE_STORE) memory.state.delete(String(key))
    },
    getAllRecords: async (store: string) =>
      store === STATE_STORE ? [...memory.state.values()] : [],
    deleteByIndex: async () => undefined,
    clearStore: async (store: string) => {
      if (store === STATE_STORE) memory.state.clear()
    },
  }
})

import {
  changedChats,
  clearCachedFreshness,
  freshnessKey,
  isFreshnessEqual,
  readCachedFreshness,
  toCachedFreshness,
  writeCachedFreshness,
} from '@/offline/freshness'
import type { TripCacheState } from '@/types/trips'

const STATE: TripCacheState = {
  contentRevision: '7',
  contentUpdatedAt: '2026-11-16T12:00:00.000Z',
  chats: [
    { kind: 'trip_guest', lastMessageId: '10' },
    { kind: 'trip_members', lastMessageId: null },
  ],
}

describe('отметка свежести', () => {
  beforeEach(() => {
    memory.state.clear()
  })

  it('ключ привязан к походу', () => {
    expect(freshnessKey('679')).toBe('freshness:679')
  })

  it('сохраняется и читается с диска', async () => {
    await writeCachedFreshness('679', STATE)

    const cached = await readCachedFreshness('679')
    expect(cached?.contentRevision).toBe('7')
    expect(cached?.chats).toEqual({ trip_guest: '10', trip_members: null })
    expect(typeof cached?.checkedAt).toBe('number')
  })

  it('пустое место читается как «не сверяли»', async () => {
    await expect(readCachedFreshness('679')).resolves.toBeNull()
  })

  it('мусор в хранилище не ломает сверку', async () => {
    memory.state.set('freshness:679', { key: 'freshness:679', value: { foo: 'bar' } })

    await expect(readCachedFreshness('679')).resolves.toBeNull()
  })

  it('удаление отметки', async () => {
    await writeCachedFreshness('679', STATE)
    await clearCachedFreshness('679')

    await expect(readCachedFreshness('679')).resolves.toBeNull()
  })
})

describe('isFreshnessEqual', () => {
  it('совпали счётчик и все курсоры — копия свежая', () => {
    expect(isFreshnessEqual(toCachedFreshness(STATE), STATE)).toBe(true)
  })

  it('счётчик вырос — копия устарела', () => {
    const next = { ...STATE, contentRevision: '8' }
    expect(isFreshnessEqual(toCachedFreshness(STATE), next)).toBe(false)
  })

  it('в чате появилось сообщение — копия устарела', () => {
    const next: TripCacheState = {
      ...STATE,
      chats: [{ kind: 'trip_members', lastMessageId: '11' }, { kind: 'trip_guest', lastMessageId: '10' }],
    }

    expect(isFreshnessEqual(toCachedFreshness(STATE), next)).toBe(false)
  })

  it('у похода появился новый чат — копия устарела', () => {
    const next: TripCacheState = {
      ...STATE,
      chats: [...STATE.chats, { kind: 'trip_meals', lastMessageId: null }],
    }

    expect(isFreshnessEqual(toCachedFreshness(STATE), next)).toBe(false)
  })

  it('счётчик и курсоры совпали — время правки роли не играет', () => {
    const next = { ...STATE, contentUpdatedAt: '2026-11-17T09:00:00.000Z' }
    expect(isFreshnessEqual(toCachedFreshness(STATE), next)).toBe(true)
  })
})

describe('changedChats', () => {
  it('перечисляет только сдвинувшиеся чаты', () => {
    const next: TripCacheState = {
      ...STATE,
      chats: [
        { kind: 'trip_guest', lastMessageId: '10' },
        { kind: 'trip_members', lastMessageId: '12' },
      ],
    }

    expect(changedChats(toCachedFreshness(STATE), next)).toEqual(['trip_members'])
  })

  it('ничего не сдвинулось — пустой список', () => {
    expect(changedChats(toCachedFreshness(STATE), STATE)).toEqual([])
  })
})
