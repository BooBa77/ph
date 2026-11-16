/**
 * Какие походы хранятся на устройстве.
 *
 * Правило заказчика (16.11.2026, `lifecycle.md` §2.1): кешируем
 * **незавершённые решённые походы, где человек идёт**. «Мечты»,
 * «планирую», `maybe`/`helping`/`invited`/`declined` и завершённые —
 * не кешируем: в первых нет вкладок подготовки, во вторых человек
 * не в поле.
 *
 * Участие (`going`) здесь **не проверяется** — в DTO похода статуса
 * участия нет, и набор приходит уже отфильтрованным сервером
 * (`GET /trips?offline=true`). Клиент повторяет только то, что видно
 * в самом походе: статус, отмену и дату конца.
 */

import { tripEndTime, type TripTiming } from '@/offline/isTripOngoing'
import { readDiaryOutbox } from '@/offline/diaryOutbox'
import type { Trip } from '@/types/trips'

/**
 * Сколько копия живёт после планового конца похода, пока возвращение
 * не подтверждено.
 *
 * Это **временное** правило до шага «присутствие». Решение заказчика —
 * не стирать копию, пока человек не подтвердил возврат, — нельзя выполнить
 * без самой переклички: подтверждения ещё не существует. Семи дней хватает
 * задержавшейся группе и не копит на телефоне походы прошлого года.
 * Появится присутствие — здесь будет «возврат не подтверждён».
 */
export const KEEP_AFTER_END_MS = 7 * 24 * 60 * 60 * 1000

/** Поля похода, которых хватает для решения о кеше. */
export type TripCaching = TripTiming &
  Pick<Trip, 'id' | 'status'>

/**
 * Поход попадает в кеш: решён, не отменён и ещё не закончился.
 *
 * Конец — по правилу «факт, иначе план» (`tripEndTime`): если возвращение
 * уже отметили, поход завершён независимо от плановой даты.
 */
export function isTripCacheable(trip: TripCaching, now: number = Date.now()): boolean {
  if (trip.status !== 'decided') return false
  if (trip.cancelledAt) return false

  const end = tripEndTime(trip)
  return end === null || end >= now
}

/**
 * Копию пора удалять: поход закончился, срок хранения вышел и очередь пуста.
 *
 * Проверяется только когда есть связь и серверный список больше не содержит
 * поход — то есть поход действительно перестал быть кешируемым, а не просто
 * «сеть не ответила» (в офлайне `setCurrentTrips` не вызывается вовсе).
 *
 * Очередь дневника — единственная офлайн-запись, которая уже существует.
 * Непустая очередь значит «человек писал в поле, но не отправил»: стереть
 * копию вместе с очередью было бы потерей данных.
 */
export async function shouldDropOfflineCopy(
  trip: Trip,
  now: number = Date.now(),
): Promise<boolean> {
  if (trip.cancelledAt) return true

  const end = tripEndTime(trip)
  if (end === null) return false
  if (now - end <= KEEP_AFTER_END_MS) return false

  const outbox = await readDiaryOutbox(trip.id)
  return outbox.length === 0
}

/** Нужно ли оставить сохранённую копию, если сервер её больше не присылает. */
export async function keepOfflineCopy(
  trip: Trip,
  now: number = Date.now(),
): Promise<boolean> {
  return !(await shouldDropOfflineCopy(trip, now))
}
