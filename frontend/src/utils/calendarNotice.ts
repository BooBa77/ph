import type { CalendarDay } from '@/api/calendar'
import { capitalize, toIsoDate } from '@/utils/calendar'

/**
 * Подпись под заголовком календаря: что интересного впереди.
 *
 * Смысл — ответить на вопрос, из-за которого в календарь и заходят:
 * «когда отдыхаем?». Поэтому ищем ближайший выходной, праздник или короткий
 * день и говорим о нём словами: сегодня, завтра, послезавтра, «в субботу».
 *
 * Горизонт — две недели: если впереди ничего нет, лучше промолчать, чем
 * писать «впереди рабочие дни».
 */

/** Насколько далеко смотрим вперёд. */
const HORIZON = 14

/**
 * «в субботу», «во вторник». Именно винительный падеж, поэтому таблица,
 * а не `Intl`: «в вторник» — то, что получается из именительного.
 */
const WEEKDAY_IN = [
  'в воскресенье',
  'в понедельник',
  'во вторник',
  'в среду',
  'в четверг',
  'в пятницу',
  'в субботу',
]

/**
 * Метки, которые праздником не являются.
 *
 * У обычного дня метка — имя дня недели («Суббота»), у дня, в который
 * человек работал по своему графику, — «работа». Показывать их как
 * праздник («завтра работа — выходной») нельзя.
 */
const NOT_HOLIDAY_LABELS = new Set([
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
  'Воскресенье',
  'работа',
])

/**
 * Название праздника, если оно есть.
 *
 * Метки переносов тоже показываем: «завтра выходной» и «завтра перенос
 * за 8 марта» — разная степень понятности.
 */
function holidayName(day: CalendarDay): string | null {
  if (!day.label) return null
  return NOT_HOLIDAY_LABELS.has(day.label) ? null : day.label
}

function whenPhrase(offset: number, date: Date): string {
  if (offset === 0) return 'Сегодня'
  if (offset === 1) return 'Завтра'
  if (offset === 2) return 'Послезавтра'
  return capitalize(WEEKDAY_IN[date.getDay()] ?? '')
}

/**
 * Фраза о ближайшем выходном или коротком дне.
 *
 * `dayOf` — источник дней: обычно `store.day`. Дни, которых ещё нет в кэше,
 * пропускаем: сказать «завтра выходной» на основании неподгруженного дня
 * нельзя, а ждать загрузки подпись не должна.
 */
export function upcomingNotice(
  today: Date,
  dayOf: (iso: string) => CalendarDay | null,
): string {
  for (let offset = 0; offset < HORIZON; offset += 1) {
    const date = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + offset,
    )
    const day = dayOf(toIsoDate(date))
    if (!day) continue

    const holiday = holidayName(day)
    const when = whenPhrase(offset, date)

    if (day.dayType === 'weekend') {
      if (offset === 0) {
        return holiday
          ? `Сегодня ${holiday} — отдыхаем.`
          : 'Сегодня выходной, отдыхаем.'
      }

      // Подначиваем только про ближайшие дни: «в субботу выходной, ты уже
      // всё спланировал?» звучит уже навязчиво.
      const tail = offset <= 2 ? ', ты уже всё спланировал?' : ''

      return holiday
        ? `${when} ${holiday} — выходной${tail}`
        : `${when} выходной${tail}`
    }

    if (day.dayType === 'short_workday') {
      return `${when} короткий день: работаем на час меньше.`
    }
  }

  return ''
}
