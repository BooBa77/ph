import { describe, expect, it } from 'vitest'

import {
  buildMonthGrid,
  capitalize,
  fromIsoDate,
  fullDate,
  longDate,
  MONTH_NAMES,
  monthTitle,
  toIsoDate,
  type CalendarDay,
} from '@/utils/calendar'

/**
 * Тесты календарной сетки.
 *
 * Здесь ловятся ошибки, которые глазами почти не видны: съехавшая на день
 * неделя, «сегодня» не в том месяце, лишняя пустая строка снизу. Поэтому
 * проверяем конкретные месяцы с разными характерами: обычный, начинающийся
 * с понедельника ровно на четыре недели и переходящий через Новый год.
 *
 * Мелкие помощники ниже нужны из-за `noUncheckedIndexedAccess`: любое
 * `weeks[0][0]` в проекте — «возможно undefined», и без них тест утонул бы
 * в `?.` и `!`. Падение помощника означает, что сетка короче ожидаемого,
 * и это честный провал теста, а не тихая подстановка.
 */

/** Все дни недели, попавшие в сетку, одной строкой. */
function flatten(weeks: CalendarDay[][]): CalendarDay[] {
  return weeks.flat()
}

/** Неделя по её номеру в сетке. */
function weekAt(weeks: CalendarDay[][], index: number): CalendarDay[] {
  const week = weeks[index]
  if (!week) throw new Error(`В сетке нет недели ${index}`)
  return week
}

/** День по его номеру в неделе. */
function dayAt(week: CalendarDay[], index: number): CalendarDay {
  const day = week[index]
  if (!day) throw new Error(`В неделе нет дня ${index}`)
  return day
}

function firstDay(week: CalendarDay[]): CalendarDay {
  return dayAt(week, 0)
}

function lastDay(week: CalendarDay[]): CalendarDay {
  return dayAt(week, week.length - 1)
}

function lastWeek(weeks: CalendarDay[][]): CalendarDay[] {
  return weekAt(weeks, weeks.length - 1)
}

describe('buildMonthGrid', () => {
  it('каждая неделя — семь дней, начиная с понедельника', () => {
    const weeks = buildMonthGrid(new Date(2026, 9, 1), new Date(2026, 9, 7))

    expect(weeks).toHaveLength(5)
    for (const week of weeks) {
      expect(week).toHaveLength(7)
      // 1 — понедельник в терминах getDay(), 0 — воскресенье.
      expect(fromIsoDate(firstDay(week).iso).getDay()).toBe(1)
      expect(fromIsoDate(lastDay(week).iso).getDay()).toBe(0)
    }
  })

  it('сетка октября 2026 начинается с 28 сентября: 1 октября — четверг', () => {
    const weeks = buildMonthGrid(new Date(2026, 9, 15))

    expect(dayAt(weekAt(weeks, 0), 0).iso).toBe('2026-09-28')
    expect(dayAt(weekAt(weeks, 0), 0).inMonth).toBe(false)
    expect(dayAt(weekAt(weeks, 0), 3).iso).toBe('2026-10-01')
    expect(dayAt(weekAt(weeks, 0), 3).inMonth).toBe(true)
  })

  it('все числа месяца на месте и ровно по одному разу', () => {
    const days = flatten(buildMonthGrid(new Date(2026, 9, 1))).filter((day) => day.inMonth)

    expect(days).toHaveLength(31)
    expect(days.map((day) => day.day)).toEqual(Array.from({ length: 31 }, (_, index) => index + 1))
  })

  it('февраль 2026: 28 дней и никаких пустых недель снизу', () => {
    const weeks = buildMonthGrid(new Date(2026, 1, 10))

    expect(flatten(weeks).filter((day) => day.inMonth)).toHaveLength(28)
    // Последняя неделя заканчивается 1 марта, и это единственный день
    // следующего месяца в ней — неделю выбрасывать нельзя.
    expect(lastDay(lastWeek(weeks)).iso).toBe('2026-03-01')
  })

  it('февраль 2027: начался с понедельника — ровно четыре недели без соседей', () => {
    const weeks = buildMonthGrid(new Date(2027, 1, 1))

    expect(weeks).toHaveLength(4)
    expect(flatten(weeks).every((day) => day.inMonth)).toBe(true)
  })

  it('декабрь переходит в январь следующего года', () => {
    const weeks = buildMonthGrid(new Date(2026, 11, 31))
    const last = lastDay(lastWeek(weeks))

    expect(last.iso).toBe('2027-01-03')
    expect(last.inMonth).toBe(false)
  })

  it('сегодня отмечается ровно один раз', () => {
    const weeks = buildMonthGrid(new Date(2026, 9, 1), new Date(2026, 9, 7))
    const today = flatten(weeks).filter((day) => day.isToday)

    expect(today.map((day) => day.iso)).toEqual(['2026-10-07'])
    expect(today.map((day) => day.inMonth)).toEqual([true])
  })

  it('если сегодня в другом месяце — подчёркивать нечего', () => {
    const weeks = buildMonthGrid(new Date(2026, 9, 1), new Date(2026, 10, 5))

    expect(flatten(weeks).some((day) => day.isToday)).toBe(false)
  })

  it('выходные — суббота и воскресенье', () => {
    const weekends = flatten(buildMonthGrid(new Date(2026, 9, 1)))
      .filter((day) => day.inMonth && day.isWeekend)
      .map((day) => day.day)

    // В октябре 2026 пять суббот и четыре воскресенья: 3, 4, 10, 11, 17,
    // 18, 24, 25, 31.
    expect(weekends).toEqual([3, 4, 10, 11, 17, 18, 24, 25, 31])
  })
})

describe('toIsoDate', () => {
  it('добивает месяц и день нулём', () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('не уводит дату в UTC: местная полночь остаётся тем же днём', () => {
    // Именно на этом ломается toISOString(): в Иркутске (UTC+8) он отдаёт
    // предыдущий день.
    expect(toIsoDate(new Date(2026, 9, 1, 0, 30))).toBe('2026-10-01')
  })
})

describe('fromIsoDate', () => {
  it('разбирает строку в тот же день, что и записал toIsoDate', () => {
    // Круговорот «дата → iso → дата → iso» обязан возвращать ту же строку:
    // именно так клетка сетки превращается в дату для модалки. Сравниваем
    // строки, а не getTime(): у даты со временем 00:30 время при разборе
    // не сохраняется, и это нормально — день тот же.
    for (const date of [
      new Date(2026, 9, 7),
      new Date(2026, 0, 1),
      new Date(2026, 11, 31),
      new Date(2026, 9, 1, 0, 30),
    ]) {
      expect(toIsoDate(fromIsoDate(toIsoDate(date)))).toBe(toIsoDate(date))
    }
  })

  it('не уезжает на предыдущий день, как new Date(iso)', () => {
    const date = fromIsoDate('2026-10-01')

    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(9)
    expect(date.getDate()).toBe(1)
  })
})

describe('подписи месяцев и дат', () => {
  it('заголовок месяца — с большой буквы и с годом', () => {
    expect(monthTitle(new Date(2026, 9, 1))).toBe('Октябрь 2026')
  })

  it('дата словами — без сокращения «г.»', () => {
    expect(longDate(new Date(2026, 9, 7))).toBe('7 октября 2026')
  })

  it('день недели словами — для заголовка модалки', () => {
    // 7 октября 2026 — среда.
    expect(fullDate(new Date(2026, 9, 7))).toBe('среда, 7 октября 2026')
  })

  it('capitalize поднимает только первую букву', () => {
    expect(capitalize('среда, 7 октября 2026')).toBe('Среда, 7 октября 2026')
    expect(capitalize('Октябрь')).toBe('Октябрь')
  })

  it('названия месяцев идут по порядку от января', () => {
    expect(MONTH_NAMES).toHaveLength(12)
    expect(MONTH_NAMES[0]).toBe('Январь')
    expect(MONTH_NAMES[9]).toBe('Октябрь')
    expect(MONTH_NAMES[11]).toBe('Декабрь')
  })

  it('название месяца совпадает с тем, что показывает заголовок', () => {
    // Список в модалке выбора месяца строится из тех же форматтеров, что
    // и заголовок календаря: «Октябрь» там и там должен быть одинаковым.
    for (const index of [0, 3, 9, 11]) {
      expect(monthTitle(new Date(2026, index, 1))).toBe(`${MONTH_NAMES[index] ?? ''} 2026`)
    }
  })
})
