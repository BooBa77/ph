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

/**
 * Сбор: только место. Пустая строка — не указано вовсе.
 *
 * Время сбора ушло вместе с полем: «во сколько выезжаем» — это трансфер
 * (кто на чём едет, во сколько отправление), и его строки живут во вкладке
 * «Трансфер», а не в шапке похода. Место осталось — его ищут глазами
 * в день выхода.
 */
export function tripMeetingText(trip: Pick<Trip, 'meetingPlace'>): string {
  return trip.meetingPlace ?? ''
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
 *
 * «Будет гитара» здесь именно признак: он отличает один поход от другого
 * и отвечает на вопрос, который задают первым делом. Пишется только когда
 * гитара есть, — «без гитары» так же нормально, как и «некоммерческий».
 */
export function tripBadges(
  trip: Pick<Trip, 'isCommercial' | 'isOfficial' | 'priceRub' | 'hasGuitar'>,
): string[] {
  const badges: string[] = []

  if (trip.isCommercial) {
    badges.push(trip.priceRub ? `коммерческий · ${trip.priceRub} ₽` : 'коммерческий')
  }
  if (trip.isOfficial) badges.push('официальный поход')
  if (trip.hasGuitar) badges.push('будет гитара')

  return badges
}
