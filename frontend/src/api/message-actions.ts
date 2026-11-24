import { apiFetch } from '@/api/client'
import type { MessageAction } from '@/types/trips'

/**
 * Действия в сообщениях — ручки `/api/message-actions`.
 *
 * Создания здесь нет намеренно: действие вешает сервер, тот код, который
 * знает контекст (у денег это Бухгалтерия). Клиент только отвечает.
 */

/**
 * POST /api/message-actions/:id/respond — «Подтверждаю получение».
 *
 * Ответ у действия один (24.11.2026). Заказчик несколько раз просил убрать
 * «Не подтверждаю получение»: банковский перевод идёт до трёх дней, и если
 * денег ещё нет, человеку достаточно подождать — через 72 часа перевод
 * засчитывается сам. Кнопка «не получено» при этом ничего не отменяла,
 * а подвешивала перевод навсегда (автосогласие по ней снималось).
 * Написать отправителю, что деньги не пришли, можно полем обратной связи:
 * оно отправляет обычное сообщение и таймер не трогает.
 *
 * `body` — необязательное сообщение отправителю вместе с подтверждением.
 * Пустой текст не отправляется вовсе (то же правило, что у `POST /messages`).
 */
export function respondToAction(
  actionId: string,
  body?: string,
): Promise<MessageAction> {
  const payload: { result: string; body?: string } = { result: 'confirmed' }

  if (body !== undefined && body.trim().length > 0) payload.body = body.trim()

  return apiFetch<MessageAction>(`/message-actions/${actionId}/respond`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
