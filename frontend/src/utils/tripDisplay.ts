import { TRIP_STATUS_LABELS, type Trip } from '@/types/trips'

/**
 * Тексты о походе для экрана.
 *
 * Вынесены из компонентов чистыми функциями по той же причине, что
 * `markdown.ts`: одно и то же «когда» показывают карточка ленты, шапка
 * похода и вкладка «Информация». Три копии одного форматирования
 * разойдутся — в одном месте месяц словом, в другом цифрой.
 *
 * Здесь нет ни Vue, ни запросов: вход — поход, выход — строка. Это
 * и делает функции проверяемыми без браузера.
 */

type WhenTrip = Pick<Trip, 'startsAt' | 'endsAt' | 'status'>

/** Дата словами: «5 мая 2027 г.». */
export function formatTripDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/** Момент словами: «5 мая 2027 г., 08:00». Часы нужны там, где важен час. */
export function formatTripMoment(iso: string): string {
  const at = new Date(iso)
  const time = at.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

  return `${formatTripDate(iso)}, ${time}`
}

/**
 * Сбор: где и когда. Пустая строка — не указано вовсе.
 *
 * Место и время показываются вместе, потому что по отдельности они
 * бесполезны: «у вокзала» без часа и «в 8:00» без места не помогают
 * собраться. Если известно одно — показываем одно, врать нечем.
 */
export function tripMeetingText(
  trip: Pick<Trip, 'meetingPlace' | 'meetingAt'>,
): string {
  const parts: string[] = []

  if (trip.meetingPlace) parts.push(trip.meetingPlace)
  if (trip.meetingAt) parts.push(formatTripMoment(trip.meetingAt))

  return parts.join(' · ')
}

/**
 * Даты похода одной строкой. Пустая строка — дат нет вовсе.
 *
 * Конец без начала показываем как есть: это не ошибка отображения,
 * а незаполненное поле, и врать про него нечем.
 */
export function tripDatesText(trip: Pick<Trip, 'startsAt' | 'endsAt'>): string {
  if (!trip.startsAt) return ''
  return trip.endsAt
    ? `${formatTripDate(trip.startsAt)} — ${formatTripDate(trip.endsAt)}`
    : formatTripDate(trip.startsAt)
}

/**
 * Что написать в поле «Когда».
 *
 * У решённого похода стоят даты, у мечты и плана их может не быть вовсе —
 * тогда честнее показать готовность, чем пустое место.
 */
export function tripWhenText(trip: WhenTrip): string {
  return tripDatesText(trip) || TRIP_STATUS_LABELS[trip.status]
}

/**
 * Рамка похода словами — для строки «Рамка» на вкладке «Информация»: тут
 * важно и отсутствие коммерции, потому что строка отвечает на вопрос
 * «это платное?» целиком.
 */
export function tripFrameParts(
  trip: Pick<Trip, 'isCommercial' | 'isOfficial' | 'priceRub'>,
): string[] {
  const parts = [trip.isCommercial ? 'коммерческий' : 'некоммерческий']

  if (trip.isOfficial) parts.push('официальный поход')
  if (trip.isCommercial && trip.priceRub) parts.push(`${trip.priceRub} ₽`)

  return parts
}

/**
 * Признаки похода для карточки ленты: только то, чем поход отличается.
 *
 * «Некоммерческий» в ленте — не признак, а норма: писать его в каждой
 * карточке значит засорить список. На вкладке «Информация» — наоборот,
 * там строка обязана быть полной (см. `tripFrameParts`).
 */
export function tripBadges(
  trip: Pick<Trip, 'isCommercial' | 'isOfficial' | 'priceRub'>,
): string[] {
  const badges: string[] = []

  if (trip.isCommercial) {
    badges.push(trip.priceRub ? `коммерческий · ${trip.priceRub} ₽` : 'коммерческий')
  }
  if (trip.isOfficial) badges.push('официальный поход')

  return badges
}
