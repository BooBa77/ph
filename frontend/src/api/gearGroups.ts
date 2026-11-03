import { apiFetch } from '@/api/client'
import type {
  AdminGearGroupTemplate,
  AdminGearGroupTemplateList,
} from '@/types/gear'

/**
 * Админка **рекомендуемых** групп снаряжения (02.11.2026).
 *
 * С 02.11.2026 группы бывают двумя видами: рекомендуемые (шаблоны, этот
 * файл) и личные (копии у человека, `api/gear.ts`). Шаблон — образец:
 * новый пользователь получает его копию, а новый тип приходит в ту группу,
 * которую админ указал рекомендацией.
 *
 * Все пути под `/gear/admin/group-templates`: права проверяет бэкенд
 * (`isAdminUser`), чужому — 403 «Раздел только для администратора».
 */

/** GET /api/gear/admin/group-templates — все шаблоны, включая архивные. */
export async function fetchAdminGearGroupTemplates(): Promise<
  AdminGearGroupTemplate[]
> {
  const list = await apiFetch<AdminGearGroupTemplateList>(
    '/gear/admin/group-templates',
  )

  return list.items
}

/**
 * POST /api/gear/admin/group-templates — новая рекомендуемая группа.
 *
 * `code` занимается навсегда: в `PATCH` его нет, а ошибку исправляют
 * архивом и новой группой с новым кодом (как у типов).
 */
export async function createGearGroupTemplate(input: {
  code: string
  name: string
  sortOrder?: number
}): Promise<AdminGearGroupTemplate> {
  return apiFetch<AdminGearGroupTemplate>('/gear/admin/group-templates', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** PATCH /api/gear/admin/group-templates/:id — имя, порядок, архив и возврат. */
export async function updateGearGroupTemplate(
  id: number,
  patch: { name?: string; sortOrder?: number; isActive?: boolean },
): Promise<AdminGearGroupTemplate> {
  return apiFetch<AdminGearGroupTemplate>(
    `/gear/admin/group-templates/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    },
  )
}

/**
 * DELETE /api/gear/admin/group-templates/:id — в архив (204).
 *
 * «Прочее» (`other`) так убрать нельзя — сервер ответит 409: это умолчание
 * для типа без рекомендованной группы.
 */
export async function archiveGearGroupTemplate(id: number): Promise<void> {
  await apiFetch<void>(`/gear/admin/group-templates/${id}`, {
    method: 'DELETE',
  })
}
