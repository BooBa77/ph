import type { Trip } from '@/types/trips'

/**
 * Номер дня похода — для кнопки «День N» в дневнике (16.11.2026).
 *
 * Заказчик: «есть кнопки вставки… порядкового номера дня похода». Номер
 * считается по началу похода по плану: фактических дат в походе больше нет
 * (миграция 96, 21.11.2026), «вышел» и «вернулся» — это отметки присутствия
 * человека, а не свойство похода. Вернулись — номер всё равно продолжает
 * считаться, чтобы запись после возвращения не осталась без дня.
 *
 * **До старта — обратный отсчёт (21.11.2026).** Дневник открыт уже
 * в подготовке, а кнопка была выключена, пока поход не начался; заказчик
 * назвал это багом. Отрицательный «День −3» не подставляем: номер дня без
 * похода смысла не имеет, а «До старта 3 дня» — это ровно то, что человек
 * и хочет записать. Слово «день» согласуется по числу: 1 день, 3 дня,
 * 5 дней.
 *
 * Считаем **календарные дни в местной зоне**: поход с 24 октября по 26-е
 * — это три дня, а не «два с половиной». Сравнение идёт по полуночам,
 * поэтому переход на летнее время не сдвигает номер.
 */
export type TripDayTiming = Pick<Trip, 'startsAt' | 'cancelledAt'>

/** Начало похода по плану. */
export function tripStartDate(trip: TripDayTiming): Date | null {
  const raw = trip.startsAt
  if (!raw) return null

  const start = new Date(raw)
  return Number.isNaN(start.getTime()) ? null : start
}

/**
 * Номер дня похода на момент `at`: 1 — первый день, `null` — поход ещё
 * не начался, отменён или дат нет.
 */
export function tripDayNumber(
  trip: TripDayTiming,
  at: Date = new Date(),
): number | null {
  // Отменённый поход не идёт: считать в нём дни незачем.
  if (trip.cancelledAt) return null

  const start = tripStartDate(trip)
  if (!start) return null

  const days = calendarDaysBetween(start, at)
  return days < 0 ? null : days + 1
}

/**
 * Что вставляет кнопка дня в дневнике: «День 3» в походе и «До старта
 * 3 дня» до него.
 *
 * `null` — подставлять нечего: поход отменён или у него нет даты начала.
 */
export function tripDayText(
  trip: TripDayTiming,
  at: Date = new Date(),
): string | null {
  if (trip.cancelledAt) return null

  const start = tripStartDate(trip)
  if (!start) return null

  const days = calendarDaysBetween(start, at)
  if (days < 0) {
    const left = -days
    return `До старта ${left} ${daysWord(left)}`
  }

  return `День ${days + 1}`
}

/**
 * Разница календарных дат в днях: `at` минус `start`.
 *
 * `Date.UTC` от местных компонент, а не разность моментов времени: иначе
 * поход, начавшийся в 23:00, а продолженный в 01:00, дал бы «день 1»
 * вместо «день 2». Часовой пояс устройства — тот, в котором человек
 * пишет дневник.
 */
function calendarDaysBetween(start: Date, at: Date): number {
  const startDay = Date.UTC(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
  )
  const atDay = Date.UTC(at.getFullYear(), at.getMonth(), at.getDate())

  return Math.round((atDay - startDay) / 86_400_000)
}

/**
 * Согласование слова «день» по числу: 1 день, 2 дня, 5 дней.
 *
 * Хвост 11–14 — исключение из общего правила («11 дней», а не «11 день»),
 * поэтому считается по остатку от ста, а не от десяти.
 */
function daysWord(count: number): string {
  const tail100 = count % 100
  if (tail100 >= 11 && tail100 <= 14) return 'дней'

  const tail10 = count % 10
  if (tail10 === 1) return 'день'
  if (tail10 >= 2 && tail10 <= 4) return 'дня'

  return 'дней'
}
