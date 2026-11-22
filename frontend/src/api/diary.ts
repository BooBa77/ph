import { apiFetch } from '@/api/client'
import type { DiarySyncEntry, TripAlmanac, TripDiary } from '@/types/diary'

/**
 * Дневник похода: личные записи (16.11.2026) и альманах (22.11.2026).
 *
 * Три ручки, как и на сервере:
 *
 * - `getTripDiary` — мои записи; в офлайне `apiFetch` отдаст сохранённую
 *   копию, если поход прогревали;
 * - `syncTripDiary` — пачка изменений с устройства. Ответ — дневник
 *   целиком, чтобы после отправки не собирать правду из двух источников;
 * - `getTripAlmanac` — общий текст из помеченных записей. Только после
 *   завершения похода: до него сервер отвечает `409`, и иконке альманаха
 *   на вкладке нечего показывать.
 *
 * Офлайн-запись через `syncTripDiary` не уходит: `apiFetch` бросает
 * `OfflineError` на любую мутацию без связи. Именно это и ловит очередь
 * (`offline/diaryOutbox.ts`) — запись остаётся на устройстве до появления
 * сети.
 */
export function getTripDiary(tripId: string): Promise<TripDiary> {
  return apiFetch<TripDiary>(`/trips/${tripId}/diary`)
}

export function syncTripDiary(
  tripId: string,
  entries: DiarySyncEntry[],
): Promise<TripDiary> {
  return apiFetch<TripDiary>(`/trips/${tripId}/diary/sync`, {
    method: 'POST',
    body: JSON.stringify({ entries }),
  })
}

/**
 * Альманах похода — то, что авторы разрешили включить.
 *
 * В кеш не кладётся: это общий текст, который меняется, когда кто-то
 * снимает пометку, и показывать вчерашнюю сборку значило бы врать.
 * Офлайн — ошибка связи, а не молчаливая пустота.
 */
export function getTripAlmanac(tripId: string): Promise<TripAlmanac> {
  return apiFetch<TripAlmanac>(`/trips/${tripId}/almanac`)
}
