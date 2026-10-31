import { apiFetch } from '@/api/client'
import type { AdminGearGroup, AdminGearGroupList } from '@/types/gear'

/**
 * Админка групп снаряжения (31.10.2026).
 *
 * Отдельный файл, а не добавка к `api/gearTypes.ts`: типы и группы —
 * соседние, но разные справочники, и один файл на оба стал бы свалкой
 * из двух наборов путей. Публичное чтение групп — `fetchGearGroups`
 * в `api/gear.ts`: его спрашивает каталог, а не админка.
 *
 * Все пути под `/gear/admin/groups`: права проверяет бэкенд
 * (`isAdminUser`), чужому — 403 «Раздел только для администратора».
 */

/** GET /api/gear/admin/groups — все группы, включая архивные. */
export async function fetchAdminGearGroups(): Promise<AdminGearGroup[]> {
  const list = await apiFetch<AdminGearGroupList>('/gear/admin/groups')

  return list.items
}

/**
 * POST /api/gear/admin/groups — новая полка.
 *
 * `code` занимается навсегда: в `PATCH` его нет, а ошибку исправляют
 * архивом и новым кодом (как у типов).
 */
export async function createGearGroup(input: {
  code: string
  name: string
  sortOrder?: number
}): Promise<AdminGearGroup> {
  return apiFetch<AdminGearGroup>('/gear/admin/groups', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** PATCH /api/gear/admin/groups/:id — имя, порядок, архив и возврат. */
export async function updateGearGroup(
  id: number,
  patch: { name?: string; sortOrder?: number; isActive?: boolean },
): Promise<AdminGearGroup> {
  return apiFetch<AdminGearGroup>(`/gear/admin/groups/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/**
 * DELETE /api/gear/admin/groups/:id — в архив (204).
 *
 * «Прочее» (`other`) так убрать нельзя — сервер ответит 409: это группа
 * по умолчанию, в неё кладутся вещи без явной полки.
 */
export async function archiveGearGroup(id: number): Promise<void> {
  await apiFetch<void>(`/gear/admin/groups/${id}`, { method: 'DELETE' })
}
