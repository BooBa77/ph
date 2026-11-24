import { apiFetch } from '@/api/client'
import type { MessageAction } from '@/types/trips'

/**
 * Действия в сообщениях — ручки `/api/message-actions`.
 *
 * Создания здесь нет намеренно: действие вешает сервер, тот код, который
 * знает контекст (у денег это Бухгалтерия). Клиент только отвечает.
 */

/**
 * POST /api/message-actions/:id/respond — «Получено» или «Не получено».
 *
 * `body` — необязательное сообщение отправителю (24.11.2026). Заказчик:
 * у уведомления о переводе есть поле «сообщение отправителю»; текст уходит
 * обычным сообщением в тот же диалог, а пустой не отправляется вовсе.
 */
export function respondToAction(
  actionId: string,
  result: 'confirmed' | 'disputed',
  body?: string,
): Promise<MessageAction> {
  const payload: { result: string; body?: string } = { result }

  if (body !== undefined && body.trim().length > 0) payload.body = body.trim()

  return apiFetch<MessageAction>(`/message-actions/${actionId}/respond`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
