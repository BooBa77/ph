import { apiFetch } from '@/api/client'
import type { CreateTripRequest, Trip } from '@/types/trips'

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
