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

/**
 * GET /api/objects?ids=1,2,3
 *
 * Конкретные объекты по id — когда текст уже написан и содержит ссылки
 * `[[object:N]]`, а показать надо имена. Один запрос вместо двадцати.
 */
export async function listObjectsByIds(ids: string[]): Promise<GeoObject[]> {
  if (ids.length === 0) return []

  const response = await apiFetch<{ objects: GeoObject[] }>(
    `/objects?ids=${encodeURIComponent(ids.join(','))}`,
  )
  return response.objects
}
