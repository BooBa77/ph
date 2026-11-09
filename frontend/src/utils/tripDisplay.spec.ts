import { describe, expect, it } from 'vitest'

import {
  tripBadges,
  tripDatesText,
  tripFrameParts,
  tripWhenText,
} from '@/utils/tripDisplay'

/**
 * Тесты текстов о походе.
 *
 * Смысл вынесения этих строк в чистые функции — возможность проверить их
 * без браузера. Проверяем ровно то, что легко сломать незаметно: что без дат
 * показывается готовность, а не пустое место, и что «некоммерческий» попадает
 * в строку «Рамка», но не в карточку ленты.
 */
const trip = (overrides: Record<string, unknown> = {}) => ({
  startsAt: null,
  endsAt: null,
  status: 'idea' as const,
  isCommercial: false,
  isOfficial: false,
  priceRub: null,
  hasGuitar: false,
  ...overrides,
})

describe('tripDisplay', () => {
  it('без дат показывает готовность', () => {
    expect(tripWhenText(trip())).toBe('Мечта')
    expect(tripWhenText(trip({ status: 'planning' }))).toBe('Планирую')
  })

  it('с началом и концом показывает обе даты, с одним началом — одну', () => {
    const dates = tripDatesText(
      trip({ startsAt: '2027-05-05T00:00:00.000Z', endsAt: '2027-05-09T00:00:00.000Z' }),
    )
    expect(dates).toContain('2027')
    expect(dates).toContain('—')

    const single = tripDatesText(trip({ startsAt: '2027-05-05T00:00:00.000Z' }))
    expect(single).toContain('2027')
    expect(single).not.toContain('—')
  })

  it('«Рамка» называет и отсутствие коммерции, а цены в ней больше нет', () => {
    expect(tripFrameParts(trip())).toEqual(['некоммерческий'])
    expect(tripFrameParts(trip({ isCommercial: true, priceRub: 25000 }))).toEqual([
      'коммерческий',
    ])
    expect(tripFrameParts(trip({ isCommercial: true, priceRub: 25000, isOfficial: true }))).toEqual([
      'коммерческий',
      'официальный поход',
    ])
  })

  /**
   * Стоимость скрыта 09.11.2026: «возникли юридические вопросы». Проверяем
   * именно отсутствие суммы — вернуть её случайно (например, собрав строку
   * заново) легче, чем заметить на экране.
   */
  it('цены нет ни в «Рамке», ни в значках ленты', () => {
    const commercial = trip({ isCommercial: true, priceRub: 25000 })

    expect(tripFrameParts(commercial).join(' ')).not.toContain('25000')
    expect(tripBadges(commercial).join(' ')).not.toContain('25000')
  })

  it('в карточке ленты «некоммерческий» не пишется: это норма, а не признак', () => {
    expect(tripBadges(trip())).toEqual([])
    expect(tripBadges(trip({ isCommercial: true }))).toEqual(['коммерческий'])
    expect(tripBadges(trip({ isOfficial: true }))).toEqual(['официальный поход'])
  })

  /**
   * Гитара — признак, а не норма: в карточке она появляется только когда
   * она есть. «Без гитары» в ленте так же нечего писать, как
   * и «некоммерческий».
   */
  it('«будет гитара» пишется только когда гитара есть', () => {
    expect(tripBadges(trip({ hasGuitar: true }))).toEqual(['будет гитара'])
    expect(
      tripBadges(trip({ hasGuitar: true, isCommercial: true, priceRub: 5000 })),
    ).toEqual(['коммерческий', 'будет гитара'])
  })
})
