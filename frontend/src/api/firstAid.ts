import { apiFetch } from '@/api/client'
import type { FirstAidWeightScope, TripFirstAid } from '@/types/firstAid'

/**
 * «Аптечка» похода: чтение и вес (09.11.2026).
 *
 * Списки и пункты правятся общими ручками чек-листов (`api/checklists.ts`,
 * `api/tripChecklists.ts`): аптечка — та же подсистема списков, просто
 * с областью `first_aid`. Здесь только то, что относится ко вкладке целиком.
 */

/** GET /api/trips/:id/first-aid — две секции глазами смотрящего. */
export async function getTripFirstAid(tripId: string): Promise<TripFirstAid> {
  return apiFetch<TripFirstAid>(`/trips/${tripId}/first-aid`)
}

/**
 * PATCH /api/trips/:id/first-aid/weight — вес готовой аптечки.
 *
 * `null` — «ещё не взвесили». Сервер возвращает состояние вкладки целиком,
 * чтобы экран после сохранения не собирал его из двух ответов.
 */
export async function setFirstAidWeight(
  tripId: string,
  scope: FirstAidWeightScope,
  weightGrams: number | null,
): Promise<TripFirstAid> {
  return apiFetch<TripFirstAid>(`/trips/${tripId}/first-aid/weight`, {
    method: 'PATCH',
    body: JSON.stringify({ scope, weightGrams }),
  })
}
