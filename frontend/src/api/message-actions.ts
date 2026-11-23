import { apiFetch } from '@/api/client'
import type { MessageAction } from '@/types/trips'

/**
 * Действия в сообщениях — ручки `/api/message-actions`.
 *
 * Создания здесь нет намеренно: действие вешает сервер, тот код, который
 * знает контекст (у денег это Бухгалтерия). Клиент только отвечает.
 */

/** POST /api/message-actions/:id/respond — «Получено» или «Не получено». */
export function respondToAction(
  actionId: string,
  result: 'confirmed' | 'disputed',
): Promise<MessageAction> {
  return apiFetch<MessageAction>(`/message-actions/${actionId}/respond`, {
    method: 'POST',
    body: JSON.stringify({ result }),
  })
}
