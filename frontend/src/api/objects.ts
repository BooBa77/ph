import { apiFetch } from '@/api/client'
import type { GeoObject } from '@/types/trips'

/**
 * GET /api/objects
 *
 * Справочник географических объектов — цели походов. Ищет по подстроке
 * имени; без `search` отдаёт первые по алфавиту.
 *
 * Возвращает только список: обёртка `{ objects: [...] }` — подробность
 * ответа бэкенда, и разворачивать её в каждом компоненте незачем.
 */
export async function listObjects(search?: string): Promise<GeoObject[]> {
  const query = search ? `?search=${encodeURIComponent(search)}` : ''
  const response = await apiFetch<{ objects: GeoObject[] }>(`/objects${query}`)
  return response.objects
}
