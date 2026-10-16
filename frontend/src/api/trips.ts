import { apiFetch } from '@/api/client'
import type { CreateTripRequest, Trip, TripListQuery, TripListResponse } from '@/types/trips'

/**
 * POST /api/trips
 *
 * Создать поход. Организатором становится владелец токена — поля
 * с организатором в теле нет и быть не должно: `forbidNonWhitelisted`
 * на бэкенде отбивает лишние поля 400-м.
 *
 * Возвращает созданный поход целиком, отдельный GET не нужен.
 */
export async function createTrip(data: CreateTripRequest): Promise<Trip> {
  return apiFetch<Trip>('/trips', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

/**
 * GET /api/trips/:id
 *
 * Один поход целиком. Приватный поход чужому отдаёт 404, а не 403 —
 * существование закрытого похода не должно утекать.
 */
export async function getTrip(id: string): Promise<Trip> {
  return apiFetch<Trip>(`/trips/${id}`)
}

/**
 * Собрать строку запроса ленты.
 *
 * **Параметр уходит только если он задан.** `?isCommercial=false` и
 * отсутствие параметра — разные запросы: первое просит только некоммерческие
 * походы, второе — любые. Поэтому `undefined` отбрасывается, а `false`
 * остаётся: `false` здесь такое же значение, как `true`.
 *
 * Вынесено отдельной функцией и экспортировано, чтобы это правило
 * проверялось тестом, а не глазами в разметке компонента.
 */
export function buildTripListQuery(query: TripListQuery = {}): string {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }

  const text = params.toString()
  return text ? `?${text}` : ''
}

/**
 * GET /api/trips
 *
 * Лента походов с фильтрами и пагинацией. Приватные походы видны только
 * участникам, отменённые в ленту не попадают — и то и другое без
 * возможности отключить параметром.
 */
export async function listTrips(query: TripListQuery = {}): Promise<TripListResponse> {
  return apiFetch<TripListResponse>(`/trips${buildTripListQuery(query)}`)
}
