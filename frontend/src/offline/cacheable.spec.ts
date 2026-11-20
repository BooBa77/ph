import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Правило «какой поход хранится на устройстве» и «когда копию пора убрать».
 *
 * Хранилище подменено: проверяется арифметика сроков и отмены, а не
 * IndexedDB. Очередь дневника пуста по умолчанию — непустую очередь
 * проверяет отдельный тест.
 */
const outbox = vi.hoisted(() => ({
  entries: [] as unknown[],
  expenses: [] as unknown[],
}))

vi.mock('@/offline/diaryOutbox', () => ({
  readDiaryOutbox: async () => outbox.entries,
}))

vi.mock('@/offline/expenseOutbox', () => ({
  readExpenseOutbox: async () => outbox.expenses,
}))

import {
  KEEP_AFTER_END_MS,
  isTripCacheable,
  keepOfflineCopy,
  shouldDropOfflineCopy,
} from '@/offline/cacheable'
import type { Trip } from '@/types/trips'

const BASE = {
  id: '679',
  status: 'decided',
  startsAt: '2026-11-10T00:00:00.000Z',
  endsAt: '2026-11-20T00:00:00.000Z',
  actualStartedAt: null,
  actualFinishedAt: null,
  cancelledAt: null,
} as Trip

const NOW = Date.parse('2026-11-16T00:00:00.000Z')

describe('isTripCacheable', () => {
  it('решённый незакончившийся поход хранится', () => {
    expect(isTripCacheable(BASE, NOW)).toBe(true)
  })

  it('поход без конца хранится: «не знаем, когда вернутся» — не «вернулись»', () => {
    expect(isTripCacheable({ ...BASE, endsAt: null }, NOW)).toBe(true)
  })

  it('планируемый и «мечта» не хранятся', () => {
    expect(isTripCacheable({ ...BASE, status: 'planning' } as Trip, NOW)).toBe(false)
    expect(isTripCacheable({ ...BASE, status: 'idea' } as Trip, NOW)).toBe(false)
  })

  it('отменённый не хранится', () => {
    expect(
      isTripCacheable({ ...BASE, cancelledAt: '2026-11-12T00:00:00.000Z' }, NOW),
    ).toBe(false)
  })

  it('закончившийся по плану не хранится', () => {
    expect(isTripCacheable({ ...BASE, endsAt: '2026-11-15T00:00:00.000Z' }, NOW)).toBe(false)
  })

  it('отметка возвращения важнее плана: поход завершён', () => {
    expect(
      isTripCacheable(
        { ...BASE, actualFinishedAt: '2026-11-14T00:00:00.000Z' },
        NOW,
      ),
    ).toBe(false)
  })

  it('завершённый автором поход не хранится (20.11.2026)', () => {
    expect(
      isTripCacheable(
        { ...BASE, completedAt: '2026-11-16T00:00:00.000Z' },
        NOW,
      ),
    ).toBe(false)
  })
})

describe('shouldDropOfflineCopy', () => {
  beforeEach(() => {
    outbox.entries = []
    outbox.expenses = []
  })

  afterEach(() => {
    outbox.entries = []
    outbox.expenses = []
  })

  it('идущий поход не удаляется никогда', async () => {
    await expect(shouldDropOfflineCopy(BASE, NOW)).resolves.toBe(false)
  })

  it('задержавшаяся группа: после конца копия живёт ещё неделю', async () => {
    const ended = { ...BASE, endsAt: '2026-11-15T00:00:00.000Z' }

    expect(NOW - Date.parse(ended.endsAt) < KEEP_AFTER_END_MS).toBe(true)
    await expect(shouldDropOfflineCopy(ended, NOW)).resolves.toBe(false)
  })

  it('срок вышел и очередь пуста — копию пора убирать', async () => {
    const ended = { ...BASE, endsAt: '2026-11-01T00:00:00.000Z' }

    await expect(shouldDropOfflineCopy(ended, NOW)).resolves.toBe(true)
  })

  it('в очереди дневника есть запись — копию не трогаем', async () => {
    const ended = { ...BASE, endsAt: '2026-11-01T00:00:00.000Z' }
    outbox.entries = [{ id: 'entry' }]

    await expect(shouldDropOfflineCopy(ended, NOW)).resolves.toBe(false)
    await expect(keepOfflineCopy(ended, NOW)).resolves.toBe(true)
  })

  it('в очереди есть неотправленный чек — копию не трогаем (20.11.2026)', async () => {
    const ended = { ...BASE, endsAt: '2026-11-01T00:00:00.000Z' }
    outbox.expenses = [{ clientId: 'чек-в-поле' }]

    await expect(shouldDropOfflineCopy(ended, NOW)).resolves.toBe(false)
  })

  it('отменённый поход удаляется сразу', async () => {
    const cancelled = { ...BASE, cancelledAt: '2026-11-12T00:00:00.000Z' }

    await expect(shouldDropOfflineCopy(cancelled, NOW)).resolves.toBe(true)
  })
})
