import { apiFetch } from '@/api/client'
import type { DiarySyncEntry, TripDiary } from '@/types/diary'

/**
 * Дневник похода: личные записи (16.11.2026).
 *
 * Две ручки, как и на сервере:
 *
 * - `getTripDiary` — мои записи; в офлайне `apiFetch` отдаст сохранённую
 *   копию, если поход прогревали;
 * - `syncTripDiary` — пачка изменений с устройства. Ответ — дневник
 *   целиком, чтобы после отправки не собирать правду из двух источников.
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
