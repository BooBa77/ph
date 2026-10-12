import { describe, expect, it } from 'vitest'

import type { CalendarDay, CalendarDayType } from '@/api/calendar'
import { upcomingNotice } from '@/utils/calendarNotice'

/**
 * Тесты подписи «что впереди».
 *
 * Проверяем формулировки и то, как они выбираются: ближайший выходной
 * важнее далёкого, праздник называется по имени, короткий день упоминается,
 * а неподгруженные дни не превращаются в догадки.
 */

/** Источник дней: карта «дата → день», остальное считается незагруженным. */
function sourceOf(days: Record<string, { dayType: CalendarDayType; label?: string | null }>) {
  return (iso: string): CalendarDay | null => {
    const day = days[iso]
    return day ? { date: iso, dayType: day.dayType, label: day.label ?? null } : null
  }
}

/** Все дни диапазона одним типом — чтобы не расписывать каждую дату. */
function week(
  from: string,
  count: number,
  dayType: CalendarDayType,
  label: string | null = null,
) {
  const days: Record<string, { dayType: CalendarDayType; label: string | null }> = {}
  const start = new Date(`${from}T00:00:00`)
  for (let index = 0; index < count; index += 1) {
    const date = new Date(start)
    date.setDate(date.getDate() + index)
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    days[`${date.getFullYear()}-${month}-${day}`] = { dayType, label }
  }
  return days
}

describe('upcomingNotice', () => {
  const today = new Date(2026, 9, 7) // среда, 7 октября 2026

  it('сегодня выходной — так и говорит', () => {
    const notice = upcomingNotice(
      today,
      sourceOf({ '2026-10-07': { dayType: 'weekend', label: 'Суббота' } }),
    )

    expect(notice).toBe('Сегодня выходной, отдыхаем.')
  })

  it('сегодня праздник — называет его', () => {
    const notice = upcomingNotice(
      today,
      sourceOf({ '2026-10-07': { dayType: 'weekend', label: 'Новый год' } }),
    )

    expect(notice).toBe('Сегодня Новый год — отдыхаем.')
  })

  it('завтра выходной — подначивает планировать', () => {
    const notice = upcomingNotice(
      today,
      sourceOf({
        '2026-10-07': { dayType: 'workday', label: 'Среда' },
        '2026-10-08': { dayType: 'weekend', label: 'Четверг' },
      }),
    )

    expect(notice).toBe('Завтра выходной, ты уже всё спланировал?')
  })

  it('послезавтра праздник — называет праздник и день', () => {
    const notice = upcomingNotice(
      today,
      sourceOf({
        '2026-10-07': { dayType: 'workday', label: 'Среда' },
        '2026-10-08': { dayType: 'workday', label: 'Четверг' },
        '2026-10-09': { dayType: 'weekend', label: 'День народного единства' },
      }),
    )

    expect(notice).toBe(
      'Послезавтра День народного единства — выходной, ты уже всё спланировал?',
    )
  })

  it('дальше двух дней называет день недели в винительном падеже', () => {
    // Ближайший выходной — суббота 10 октября.
    const notice = upcomingNotice(
      today,
      sourceOf({
        ...week('2026-10-07', 7, 'workday'),
        '2026-10-10': { dayType: 'weekend', label: 'Суббота' },
      }),
    )

    expect(notice).toBe('В субботу выходной')
  })

  it('если впереди две недели рабочих дней — молчит', () => {
    // Такого в жизни не бывает, но подпись не должна выдумывать выходной.
    const notice = upcomingNotice(today, sourceOf(week('2026-10-07', 14, 'workday')))

    expect(notice).toBe('')
  })

  it('короткий день упоминает раньше выходного', () => {
    const notice = upcomingNotice(
      today,
      sourceOf({
        '2026-10-07': { dayType: 'workday', label: 'Среда' },
        '2026-10-08': { dayType: 'short_workday', label: 'Четверг' },
        '2026-10-10': { dayType: 'weekend', label: 'Суббота' },
      }),
    )

    expect(notice).toBe('Завтра короткий день: работаем на час меньше.')
  })

  it('неподгруженные дни пропускает, а не додумывает', () => {
    const notice = upcomingNotice(
      today,
      sourceOf({
        '2026-10-07': { dayType: 'workday', label: 'Среда' },
        '2026-10-10': { dayType: 'weekend', label: 'Суббота' },
      }),
    )

    expect(notice).toBe('В субботу выходной')
  })

  it('когда ничего не загружено — молчит', () => {
    expect(upcomingNotice(today, () => null)).toBe('')
  })

  it('праздник вместо имени дня недели узнаёт по метке', () => {
    // «Суббота» — это просто имя дня, праздником её считать нельзя.
    const notice = upcomingNotice(
      today,
      sourceOf(week('2026-10-07', 4, 'workday')),
    )

    expect(notice).not.toContain('Суббота')
  })
})
