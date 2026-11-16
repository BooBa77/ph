import { describe, expect, it } from 'vitest'

import {
  isTripOngoing,
  tripEndTime,
  tripStartTime,
  type TripTiming,
} from '@/offline/isTripOngoing'

/**
 * Правило «поход идёт сейчас» — копия серверного фильтра `when=ongoing`.
 *
 * Тесты важны не сами по себе: в офлайне этим правилом решается, какой
 * поход человек сможет открыть. Ошибка здесь либо спрячет поход в поле,
 * либо покажет уже закончившийся.
 */
const NOW = Date.parse('2026-11-16T12:00:00+08:00')

function timing(overrides: Partial<TripTiming> = {}): TripTiming {
  return {
    startsAt: null,
    endsAt: null,
    actualStartedAt: null,
    actualFinishedAt: null,
    cancelledAt: null,
    ...overrides,
  }
}

describe('isTripOngoing', () => {
  it('поход с датами вокруг сегодняшнего дня идёт', () => {
    expect(
      isTripOngoing(
        timing({ startsAt: '2026-11-15T08:00:00+08:00', endsAt: '2026-11-17T20:00:00+08:00' }),
        NOW,
      ),
    ).toBe(true)
  })

  it('границы включительные: начало и конец ровно «сейчас» идут', () => {
    const now = '2026-11-16T12:00:00+08:00'

    expect(isTripOngoing(timing({ startsAt: now, endsAt: '2026-11-18T00:00:00+08:00' }), NOW)).toBe(
      true,
    )
    expect(isTripOngoing(timing({ startsAt: '2026-11-14T00:00:00+08:00', endsAt: now }), NOW)).toBe(
      true,
    )
  })

  it('до начала и после конца — не идёт', () => {
    expect(isTripOngoing(timing({ startsAt: '2026-11-17T00:00:00+08:00' }), NOW)).toBe(false)
    expect(
      isTripOngoing(
        timing({ startsAt: '2026-11-10T00:00:00+08:00', endsAt: '2026-11-12T00:00:00+08:00' }),
        NOW,
      ),
    ).toBe(false)
  })

  it('без дат вовсе — не идёт', () => {
    expect(isTripOngoing(timing(), NOW)).toBe(false)
    expect(tripStartTime(timing())).toBeNull()
    expect(tripEndTime(timing())).toBeNull()
  })

  it('начался и конца не знаем — идёт: «не вернулись» ≠ «вернулись»', () => {
    expect(isTripOngoing(timing({ startsAt: '2026-11-14T00:00:00+08:00' }), NOW)).toBe(true)
  })

  it('факт важнее плана: вышли раньше — поход уже идёт', () => {
    expect(
      isTripOngoing(
        timing({
          startsAt: '2026-12-01T00:00:00+08:00',
          endsAt: '2026-12-05T00:00:00+08:00',
          actualStartedAt: '2026-11-16T09:00:00+08:00',
        }),
        NOW,
      ),
    ).toBe(true)
  })

  it('факт важнее плана: вернулись — поход закончился, хотя план ещё идёт', () => {
    expect(
      isTripOngoing(
        timing({
          startsAt: '2026-11-14T00:00:00+08:00',
          endsAt: '2026-11-20T00:00:00+08:00',
          actualStartedAt: '2026-11-14T08:00:00+08:00',
          actualFinishedAt: '2026-11-16T10:00:00+08:00',
        }),
        NOW,
      ),
    ).toBe(false)
  })

  it('отменённый поход текущим не считается', () => {
    expect(
      isTripOngoing(
        timing({
          startsAt: '2026-11-15T00:00:00+08:00',
          endsAt: '2026-11-18T00:00:00+08:00',
          cancelledAt: '2026-11-14T00:00:00+08:00',
        }),
        NOW,
      ),
    ).toBe(false)
  })

  it('битую дату считает отсутствующей, а не «сейчас»', () => {
    expect(isTripOngoing(timing({ startsAt: 'не дата', endsAt: null }), NOW)).toBe(false)
  })
})
