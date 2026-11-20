/**
 * «Поход идёт сейчас» — правило бэкенда, повторённое на клиенте.
 *
 * В офлайне спросить сервер нельзя, а решить, какой поход доступен, надо.
 * Поэтому правило одно и то же с фильтром `when=ongoing`
 * (`backend/src/trips/trips.service.ts`):
 *
 *   starts_at <= now() AND (ends_at IS NULL OR ends_at >= now())
 *
 * Фактических дат похода больше нет (миграция 96, 21.11.2026): «вышли»
 * и «вернулись» — это отметки присутствия конкретного человека, а не
 * свойство похода. Здесь считается **план**: он у похода один.
 *
 * Следствие, которое легко потерять: **поход без конца и с прошедшим
 * началом идёт** — «не знаем, когда вернутся» не то же самое, что
 * «уже вернулись».
 *
 * Отменённый поход текущим не считается: в ленту отменённые не попадают,
 * и открывать его в офлайне незачем.
 */

import type { Trip } from '@/types/trips'

/** Поля похода, которых хватает для решения. */
export type TripTiming = Pick<Trip, 'startsAt' | 'endsAt' | 'cancelledAt'>

function toTime(value: string | null): number | null {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

/** Начало похода по плану. */
export function tripStartTime(trip: TripTiming): number | null {
  return toTime(trip.startsAt)
}

/** Конец похода по плану. `null` — конца не знаем. */
export function tripEndTime(trip: TripTiming): number | null {
  return toTime(trip.endsAt)
}

/**
 * Идёт ли поход в указанный момент.
 *
 * `now` — миллисекунды, чтобы тест мог зафиксировать время, а не ждать
 * полночи. По умолчанию — текущее.
 */
export function isTripOngoing(trip: TripTiming, now: number = Date.now()): boolean {
  if (trip.cancelledAt) return false

  const start = tripStartTime(trip)
  if (start === null) return false

  const end = tripEndTime(trip)
  return start <= now && (end === null || end >= now)
}
