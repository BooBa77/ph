import { apiFetch } from '@/api/client'
import type { Checklist, ChecklistItem } from '@/types/checklists'

/**
 * Чек-листы: шаблоны пользователя и пункты.
 *
 * Здесь только то, что нужно профилю. Списки похода (`/api/trips/:id/checklists`)
 * появятся вместе с вкладками — до них у них нет экрана, и держать
 * неиспользуемые функции «на будущее» значит держать непроверенный код.
 *
 * Обёртки `{ checklists }` и `{ items }` разворачиваются здесь: компоненту
 * нечего делать с подробностями формы ответа.
 */

/** GET /api/checklists — мои шаблоны, с пунктами. */
export async function listTemplates(): Promise<Checklist[]> {
  const response = await apiFetch<{ checklists: Checklist[] }>('/checklists')
  return response.checklists
}

/** POST /api/checklists — новый шаблон. */
export async function createTemplate(title: string): Promise<Checklist> {
  return apiFetch<Checklist>('/checklists', {
    method: 'POST',
    body: JSON.stringify({ title }),
  })
}

/** PATCH /api/checklists/:id — переименовать список. Возвращает его целиком. */
export async function renameChecklist(id: string, title: string): Promise<Checklist> {
  return apiFetch<Checklist>(`/checklists/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  })
}

/** DELETE /api/checklists/:id — удалить список вместе с пунктами. */
export async function deleteChecklist(id: string): Promise<void> {
  await apiFetch<void>(`/checklists/${id}`, { method: 'DELETE' })
}

/** POST /api/checklists/:id/items — добавить пункт. */
export async function addChecklistItem(checklistId: string, title: string): Promise<ChecklistItem> {
  return apiFetch<ChecklistItem>(`/checklists/${checklistId}/items`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  })
}

/**
 * PATCH /api/checklists/items/:id — текст и/или отметка.
 *
 * Отметка и текст — разные права на бэкенде (в общем списке похода
 * отмечает участник, правит организатор), поэтому и здесь это одно тело
 * с двумя необязательными полями, а не два разных метода.
 */
export async function updateChecklistItem(
  itemId: string,
  patch: { title?: string; isDone?: boolean },
): Promise<ChecklistItem> {
  return apiFetch<ChecklistItem>(`/checklists/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/** DELETE /api/checklists/items/:id */
export async function deleteChecklistItem(itemId: string): Promise<void> {
  await apiFetch<void>(`/checklists/items/${itemId}`, { method: 'DELETE' })
}
