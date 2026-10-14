/**
 * Календарная сетка месяца для раздела «Календарь» личного кабинета.
 *
 * Логика вынесена из компонента: она целиком про даты, а не про разметку.
 * Неделя начинается с понедельника, недостающие дни добираются из соседних
 * месяцев (они нужны, чтобы числа не съезжали по колонкам), «сегодня»
 * отмечается отдельно. В шаблоне остаётся только отрисовка.
 *
 * Все даты — локальные. `toISOString()` для ключа дня не годится: он
 * переводит время в UTC, и в Иркутске (UTC+8) любой день до восьми утра
 * уехал бы на сутки назад.
 */

/** День в сетке месяца. */
export interface CalendarDay {
  /** Ключ дня: `YYYY-MM-DD` по локальной дате. */
  iso: string
  /** Число месяца. */
  day: number
  /** День принадлежит показываемому месяцу (иначе — «хвост» соседнего). */
  inMonth: boolean
  /** Это сегодняшний день. */
  isToday: boolean
  /** Суббота или воскресенье. */
  isWeekend: boolean
}

/**
 * Заголовки колонок. Список зафиксирован, а не взят из `Intl`: порядок
 * обязан совпадать с началом недели в `buildMonthGrid`, и разъехаться
 * эти два места не должны.
 */
export const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

/** Локальная дата в `YYYY-MM-DD`. Месяц и день — с ведущим нулём. */
export function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * Сетка недель месяца, в котором лежит `anchor`.
 *
 * Возвращает массив недель (каждая — ровно семь дней, понедельник первый).
 * Недели, где не осталось ни одного дня своего месяца, не возвращаются:
 * иначе в коротком феврале, начавшемся с понедельника, снизу висела бы
 * пустая строка.
 *
 * `today` — параметр, а не `new Date()` внутри: без этого поведение
 * подчёркивания «сегодня» нельзя проверить тестом.
 */
export function buildMonthGrid(anchor: Date, today: Date = new Date()): CalendarDay[][] {
  const year = anchor.getFullYear()
  const month = anchor.getMonth()
  const todayIso = toIsoDate(today)

  // getDay(): 0 — воскресенье. Переставляем так, чтобы неделя начиналась
  // с понедельника: понедельник → 0, воскресенье → 6.
  const lead = (new Date(year, month, 1).getDay() + 6) % 7

  // Курсор идёт от первого дня первой недели до конца последней.
  const cursor = new Date(year, month, 1 - lead)
  const weeks: CalendarDay[][] = []

  do {
    const week: CalendarDay[] = []

    for (let i = 0; i < 7; i += 1) {
      const iso = toIsoDate(cursor)
      const weekday = cursor.getDay()

      week.push({
        iso,
        day: cursor.getDate(),
        inMonth: cursor.getMonth() === month,
        isToday: iso === todayIso,
        isWeekend: weekday === 0 || weekday === 6,
      })

      cursor.setDate(cursor.getDate() + 1)
    }

    weeks.push(week)
  } while (cursor.getMonth() === month)

  return weeks
}

/**
 * Форматтеры создаются один раз на модуль.
 *
 * `new Intl.DateTimeFormat` — дорогая операция (разбор локали и настройка
 * правил), а вызывается она на каждую клетку сетки и на каждую подпись:
 * тридцать пять созданий на одну перерисовку месяца — заметная работа
 * на ровном месте. Локаль фиксирована, так что кэш безопасен.
 */
const MONTH_LONG = new Intl.DateTimeFormat('ru-RU', { month: 'long' })
const DAY_MONTH_LONG = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })
const WEEKDAY_LONG = new Intl.DateTimeFormat('ru-RU', { weekday: 'long' })

/** Первая буква — заглавная: заголовки и подписи у нас с большой буквы. */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** «Октябрь 2026» — заголовок месяца. */
export function monthTitle(anchor: Date): string {
  return `${capitalize(MONTH_LONG.format(anchor))} ${anchor.getFullYear()}`
}

/**
 * Название месяца по его номеру (0 — январь).
 *
 * Год в дате-заглушке любой: название месяца от года не зависит, а Intl
 * без даты не работает. Форматтер тот же, что в `monthTitle`, поэтому
 * список в модалке выбора месяца не разъедется с заголовком календаря.
 */
export function monthName(index: number): string {
  return capitalize(MONTH_LONG.format(new Date(2000, index, 1)))
}

/** Двенадцать названий по порядку — для сетки выбора месяца. */
export const MONTH_NAMES = Array.from({ length: 12 }, (_, index) => monthName(index))

/**
 * «22 октября» — дата без года.
 *
 * Нужна подписям внутри ближайших недель: «в четверг» без числа читается
 * как «завтра», даже когда выходной через неделю.
 */
export function shortDate(date: Date): string {
  return DAY_MONTH_LONG.format(date)
}

/**
 * «7 октября 2026» — дата словами.
 *
 * Год приписываем руками: с `year: 'numeric'` Intl отдаёт «7 октября
 * 2026 г.», а сокращение в подписях лишнее.
 */
export function longDate(date: Date): string {
  return `${DAY_MONTH_LONG.format(date)} ${date.getFullYear()}`
}

/** «среда, 7 октября 2026» — день словами: заголовок модалки выбранного дня. */
export function fullDate(date: Date): string {
  return `${WEEKDAY_LONG.format(date)}, ${longDate(date)}`
}

/**
 * Разбор `YYYY-MM-DD` обратно в локальную дату.
 *
 * Обратная операция к `toIsoDate`. `new Date(iso)` здесь не годится:
 * строка без времени читается как UTC, и в Иркутске (UTC+8) день уехал бы
 * на сутки назад. Поэтому разбираем строку руками и собираем дату
 * в местной зоне — ровно так, как её записал `toIsoDate`.
 */
export function fromIsoDate(iso: string): Date {
  const [year = 0, month = 1, day = 1] = iso.split('-').map(Number)
  return new Date(year, month - 1, day)
}
