import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { prefetchKey, prefetchTripCache } from '@/offline/prefetch'
import type { Trip } from '@/types/trips'

/**
 * Прогрев кеша текущего похода.
 *
 * Полный прогрев проверять здесь незачем: он состоит из вызовов API,
 * а у них свои тесты. Важны два предохранителя — не трогать закончившийся
 * поход и не ходить в сеть, которой нет.
 */
const TRIP = {
  id: '679',
  status: 'decided',
  goalObject: { id: '1', name: 'Витязь', type: 'скальник', url: null },
  startsAt: '2020-01-01T00:00:00.000Z',
  endsAt: null,
  cancelledAt: null,
} as Trip

const FINISHED = {
  ...TRIP,
  id: '680',
  endsAt: '2020-01-05T00:00:00.000Z',
} as Trip

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value })
}

describe('prefetchTripCache', () => {
  beforeEach(() => {
    setNavigatorOnline(true)
  })

  afterEach(() => {
    setNavigatorOnline(true)
  })

  it('ключ прогрева привязан к походу', () => {
    expect(prefetchKey('679')).toBe('prefetch:679')
  })

  it('закончившийся поход не прогревает', async () => {
    await expect(prefetchTripCache(FINISHED)).resolves.toBeNull()
  })

  it('в офлайне не ходит в сеть', async () => {
    setNavigatorOnline(false)

    await expect(prefetchTripCache(TRIP)).resolves.toBeNull()
  })
})
