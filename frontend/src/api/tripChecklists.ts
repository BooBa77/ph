import { apiFetch } from '@/api/client'
import type {
  Checklist,
  ChecklistArea,
  RecommendationMark,
  TripChecklists,
} from '@/types/checklists'

/**
 * Чек-листы похода: «Список» вкладки «Снаряжение» (05.11.2026).
 *
 * Список похода — это те же `checklists`, что и шаблоны профиля, поэтому
 * создание, пункты и отметки идут общими ручками `/api/checklists`
 * (`api/checklists.ts`). Здесь только то, что относится к походу:
 * чтение трёх списков, создание, импорт из шаблонов и личная отметка
 * на рекомендации организатора.
 *
 * **Импорт — отдельная ручка, а не N вызовов `POST .../items`.** Сервер
 * сам решает, чем станет вещь: в личном списке экземпляром, в общем
 * и в рекомендации — типом. На клиенте это правило жило бы второй копией
 * и однажды разошлось бы с серверной.
 */

/** GET /api/trips/:id/checklists — общий, личный и рекомендация. */
export async function listTripChecklists(tripId: string): Promise<TripChecklists> {
  return apiFetch<TripChecklists>(`/trips/${tripId}/checklists`)
}

/** POST /api/trips/:id/checklists — завести список в походе. */
export async function createTripChecklist(
  tripId: string,
  scope: 'trip' | 'personal' | 'recommendation',
  area: ChecklistArea = 'gear',
): Promise<Checklist> {
  return apiFetch<Checklist>(`/trips/${tripId}/checklists`, {
    method: 'POST',
    body: JSON.stringify({ scope, area }),
  })
}

/**
 * POST /api/trips/:id/checklists/import — добавить выбранные пункты
 * из моих шаблонов. Возвращает целевой список целиком.
 *
 * `itemIds` — пункты шаблонов, а не шаблоны: из «Кострового» можно взять
 * топор и пилу, не беря спички.
 */
export async function importChecklistItems(
  tripId: string,
  body: {
    scope: 'trip' | 'personal' | 'recommendation'
    area?: ChecklistArea
    itemIds: number[]
  },
): Promise<Checklist> {
  return apiFetch<Checklist>(`/trips/${tripId}/checklists/import`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * PATCH /api/trips/:id/checklists/recommendation/items/:itemId — своя
 * отметка на пункте рекомендации.
 *
 * Отдельно от `updateChecklistItem`: там `isDone` пишется в общий пункт,
 * и «взял» стал бы общим на всех. Здесь отметка принадлежит смотрящему.
 */
export async function setRecommendationMark(
  tripId: string,
  itemId: string,
  isDone: boolean,
): Promise<RecommendationMark> {
  return apiFetch<RecommendationMark>(
    `/trips/${tripId}/checklists/recommendation/items/${itemId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ isDone }),
    },
  )
}
