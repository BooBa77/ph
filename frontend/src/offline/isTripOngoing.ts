/**
 * «Поход идёт сейчас» — правило бэкенда, повторённое на клиенте.
 *
 * В офлайне спросить сервер нельзя, а решить, какой поход доступен, надо.
 * Поэтому правило одно и то же с фильтром `when=ongoing`
 * (`backend/src/trips/trips.service.ts`):
 *
 *   COALESCE(actual_started_at, starts_at) <= now()
 *   AND (COALESCE(actual_finished_at, ends_at) IS NULL
 *        OR COALESCE(actual_finished_at, ends_at) >= now())
 *
 * Два следствия, которые легко потерять:
 *  - **факт важнее плана**: отметили выход — поход идёт, даже если по плану
 *    он ещё не начался;
 *  - **поход без конца и с прошедшим началом идёт**: «не знаем, когда
 *    вернутся» — это не «вернулись».
 *
 * Отменённый поход текущим не считается: в ленту отменённые не попадают,
 * и открывать его в офлайне незачем.
 */

import type { Trip } from '@/types/trips'

/** Поля похода, которых хватает для решения. */
export type TripTiming = Pick<
  Trip,
  'startsAt' | 'endsAt' | 'actualStartedAt' | 'actualFinishedAt' | 'cancelledAt'
>

function toTime(value: string | null): number | null {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

/** Начало похода по правилу «факт, иначе план». */
export function tripStartTime(trip: TripTiming): number | null {
  return toTime(trip.actualStartedAt ?? trip.startsAt)
}

/** Конец похода по правилу «факт, иначе план». `null` — конца не знаем. */
export function tripEndTime(trip: TripTiming): number | null {
  return toTime(trip.actualFinishedAt ?? trip.endsAt)
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
