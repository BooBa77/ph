import { describe, expect, it } from 'vitest'

import { tripDayNumber, tripDayText, tripStartDate } from '@/utils/tripDay'

/**
 * Номер дня похода для кнопки «День N» в дневнике (16.11.2026).
 *
 * Проверяем правило, которое заказчик назвал словами «порядковый номер дня
 * похода»: считается от планового начала. До старта номера нет, но кнопка
 * не выключена — она отсчитывает оставшиеся дни (21.11.2026). Даты строятся
 * в местной зоне — дневник пишут в той, где человек стоит.
 *
 * Фактических дат похода больше нет (миграция 96, 21.11.2026): «вышел»
 * и «вернулся» — это отметки присутствия человека, а не свойство похода,
 * поэтому «день 1» приходит по плану.
 */
function local(
  year: number,
  month: number,
  day: number,
  hours = 12,
  minutes = 0,
): string {
  return new Date(year, month - 1, day, hours, minutes).toISOString()
}

describe('tripDayNumber', () => {
  it('первый день похода — единица', () => {
    const trip = { startsAt: local(2026, 11, 16), cancelledAt: null }

    expect(tripDayNumber(trip, new Date(local(2026, 11, 16, 18)))).toBe(1)
  })

  it('день считается по календарным датам, а не по часам', () => {
    const trip = { startsAt: local(2026, 11, 16, 23), cancelledAt: null }

    // Через два часа после выхода наступил следующий календарный день.
    expect(tripDayNumber(trip, new Date(local(2026, 11, 17, 1)))).toBe(2)
  })

  it('день считается от планового начала', () => {
    const trip = {
      startsAt: local(2026, 11, 10),
      cancelledAt: null,
    }

    expect(tripDayNumber(trip, new Date(local(2026, 11, 12)))).toBe(3)
  })

  it('до старта номера нет', () => {
    const trip = { startsAt: local(2026, 11, 20), cancelledAt: null }

    expect(tripDayNumber(trip, new Date(local(2026, 11, 16)))).toBeNull()
  })

  it('без дат номера нет', () => {
    expect(
      tripDayNumber({ startsAt: null, cancelledAt: null }),
    ).toBeNull()
  })

  it('отменённый поход дней не считает', () => {
    const trip = {
      startsAt: local(2026, 11, 10),
      cancelledAt: local(2026, 11, 11),
    }

    expect(tripDayNumber(trip, new Date(local(2026, 11, 12)))).toBeNull()
  })
})

describe('tripStartDate', () => {
  it('берёт плановое начало', () => {
    const trip = {
      startsAt: local(2026, 11, 20),
      cancelledAt: null,
    }

    expect(tripStartDate(trip)?.toISOString()).toBe(local(2026, 11, 20))
  })

  it('без дат возвращает null', () => {
    expect(
      tripStartDate({ startsAt: null, cancelledAt: null }),
    ).toBeNull()
  })
})

describe('tripDayText', () => {
  it('в походе подставляет номер дня', () => {
    const trip = { startsAt: local(2026, 11, 10), cancelledAt: null }

    expect(tripDayText(trip, new Date(local(2026, 11, 12)))).toBe('День 3')
  })

  it('в день старта — первый день, а не отсчёт', () => {
    const trip = { startsAt: local(2026, 11, 20, 23), cancelledAt: null }

    // Утром в день выхода поход ещё не начался по часам, но день уже первый.
    expect(tripDayText(trip, new Date(local(2026, 11, 20, 6)))).toBe('День 1')
  })

  it('до старта отсчитывает оставшиеся дни', () => {
    const trip = { startsAt: local(2026, 12, 10), cancelledAt: null }

    expect(tripDayText(trip, new Date(local(2026, 12, 9)))).toBe(
      'До старта 1 день',
    )
    expect(tripDayText(trip, new Date(local(2026, 12, 8)))).toBe(
      'До старта 2 дня',
    )
    expect(tripDayText(trip, new Date(local(2026, 12, 5)))).toBe(
      'До старта 5 дней',
    )
  })

  it('хвост 11–14 — «дней», а не по последней цифре', () => {
    const trip = { startsAt: local(2026, 12, 25), cancelledAt: null }

    expect(tripDayText(trip, new Date(local(2026, 12, 14)))).toBe(
      'До старта 11 дней',
    )
    expect(tripDayText(trip, new Date(local(2026, 12, 12)))).toBe(
      'До старта 13 дней',
    )
    expect(tripDayText(trip, new Date(local(2026, 12, 3)))).toBe(
      'До старта 22 дня',
    )
    expect(tripDayText(trip, new Date(local(2026, 12, 4)))).toBe(
      'До старта 21 день',
    )
  })

  it('отменённому походу подставлять нечего', () => {
    const trip = {
      startsAt: local(2026, 11, 10),
      cancelledAt: local(2026, 11, 11),
    }

    expect(tripDayText(trip, new Date(local(2026, 11, 20)))).toBeNull()
  })

  it('без даты начала подставлять нечего', () => {
    expect(tripDayText({ startsAt: null, cancelledAt: null })).toBeNull()
  })
})
