import { apiFetch } from '@/api/client'
import type { NotificationList, ReadAllResult } from '@/types/notifications'

/**
 * Уведомления правой панели — ручки `/api/notifications` (24.11.2026).
 *
 * **Почему клиент отдельный от `conversations`.** Диалог и уведомление —
 * разные сущности: панель не читает ленту чатов (§14.1), а список
 * уведомлений имеет свой контракт (`{sections, personal, tripCount,
 * personalCount, total}`) и свои действия («ОК» без архива, «прочитать
 * все» по секции, архив денежных).
 *
 * **Архивации здесь нет намеренно.** `POST /api/notifications/:id/archive`
 * в API есть, но экрана архива в этом шаге нет (§10 п.8 остаётся открытым):
 * денежную карточку закрывает подтверждение перевода или оплата, а не
 * кнопка в панели. Клиент без вызова — мёртвый код, который пришлось бы
 * держать в актуальном состоянии.
 */

/** GET /api/notifications — секции походов, «Сообщения» и счётчики. */
export function listNotifications(): Promise<NotificationList> {
  return apiFetch<NotificationList>('/notifications')
}

/**
 * POST /api/notifications/:id/close — «ОК»: убрать карточку без архива.
 *
 * Так закрываются чаты и альманах. Перевод сервер отвергнет (`400`): его
 * состояние меняет подтверждение, «убрать, чтобы не мешало» оставило бы
 * перевод висеть в расчёте без карточки.
 */
export function closeNotification(id: string): Promise<void> {
  return apiFetch<void>(`/notifications/${id}/close`, { method: 'POST' })
}

/**
 * POST /api/notifications/read-all — двойная галочка секции похода (§1.3).
 *
 * Закрывает активные карточки похода, кроме `money_transfer`
 * и `payment_request`. `left` — сколько осталось: по нему клиент решает,
 * исчезла ли секция, и не считает второй раз на своей стороне.
 */
export function readAllNotifications(tripId: string): Promise<ReadAllResult> {
  return apiFetch<ReadAllResult>('/notifications/read-all', {
    method: 'POST',
    body: JSON.stringify({ tripId }),
  })
}
