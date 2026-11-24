import { apiFetch } from '@/api/client'
import type { NotificationList } from '@/types/notifications'

/**
 * Уведомления правой панели — ручки `/api/notifications` (24.11.2026).
 *
 * **Почему клиент отдельный от `conversations`.** Диалог и уведомление —
 * разные сущности: панель больше не читает ленту чатов (§14.1), а список
 * уведомлений имеет свой контракт (`{system, personal, systemCount,
 * personalCount}`) и свои действия («ОК» без архива, архив денежных).
 * Общий клиент заставил бы каждого читателя знать оба набора полей.
 *
 * **Архивации здесь нет намеренно.** `POST /api/notifications/:id/archive`
 * в API есть, но экрана архива в этом шаге нет (§10 п.8 остаётся открытым):
 * денежную карточку закрывает подтверждение перевода или оплата, а не
 * кнопка в панели. Клиент без вызова — мёртвый код, который пришлось бы
 * держать в актуальном состоянии.
 */

/** GET /api/notifications — две секции и счётчики. */
export function listNotifications(): Promise<NotificationList> {
  return apiFetch<NotificationList>('/notifications')
}

/**
 * POST /api/notifications/:id/close — «ОК»: убрать карточку без архива.
 *
 * Так закрываются чаты и альманах. Деньги сервер отвергнет (`400`): их
 * состояние меняет подтверждение или оплата, «убрать, чтобы не мешало»
 * оставило бы перевод висеть в расчёте без карточки.
 */
export function closeNotification(id: string): Promise<void> {
  return apiFetch<void>(`/notifications/${id}/close`, { method: 'POST' })
}
