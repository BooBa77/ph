/**
 * Чек-листы на фронте.
 *
 * Значения `scope` — ровно те строки, что принимает и отдаёт бэкенд
 * (`backend/src/checklists/checklist.types.ts`). Русские подписи живут
 * только здесь: бэкенд отдаёт значения, а как их назвать — дело интерфейса.
 */

export const CHECKLIST_SCOPES = ['template', 'trip', 'personal'] as const
export type ChecklistScope = (typeof CHECKLIST_SCOPES)[number]

/** Пункт списка: текст, отметка и её автор. */
export interface ChecklistItem {
  id: string
  title: string
  isDone: boolean
  /** Кто отметил. `null` — пункт не отмечен. */
  doneByUserId: string | null
  /** Когда отметили. Всегда пара с `doneByUserId`. */
  doneAt: string | null
  createdByUserId: string | null
  createdAt: string
}

/**
 * Список целиком, с пунктами.
 *
 * Пункты приходят вместе со списком: вкладке нужен список сразу,
 * а отдельных запросов за пунктами нет намеренно — это второй круг
 * до базы на каждое открытие.
 */
export interface Checklist {
  id: string
  scope: ChecklistScope
  /** Заголовок. У списков похода обычно пустой. */
  title: string
  tripId: string | null
  ownerUserId: string | null
  items: ChecklistItem[]
  createdAt: string
  updatedAt: string
}
