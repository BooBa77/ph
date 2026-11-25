import { apiFetch } from '@/api/client'
import type { Conversation } from '@/types/conversations'
import type { TripMessage } from '@/types/trips'

/**
 * Диалоги человека — ручки `/api/conversations`.
 *
 * Личные и походные диалоги приходят одним списком: лента правой колонки
 * не различает их по источнику, только по `kind`. Чтение и отправка идут
 * по id диалога, а не по паре «поход + вид чата»: id один, и он же ключ
 * для отметки прочтения и заглушения.
 */

/** GET /api/conversations — мои диалоги с последним сообщением и непрочитанным. */
export function listConversations(): Promise<{ conversations: Conversation[] }> {
  return apiFetch<{ conversations: Conversation[] }>('/conversations')
}

/** POST /api/conversations/direct — открыть личный диалог с человеком. */
export function openDirectConversation(userId: string): Promise<Conversation> {
  return apiFetch<Conversation>('/conversations/direct', {
    method: 'POST',
    body: JSON.stringify({ userId }),
  })
}

/**
 * GET /api/conversations/:id — один диалог.
 *
 * Нужен экрану `/messages/:id`: он открывается по прямой ссылке и о диалоге
 * знает только id, а шапке нужны подпись, собеседник, название похода
 * и состояние галочки «Уведомлять». Ответ — та же `Conversation`, что и
 * строка ленты, поэтому экран и лента считают непрочитанное одинаково.
 */
export function getConversation(conversationId: string): Promise<Conversation> {
  return apiFetch<Conversation>(`/conversations/${conversationId}`)
}

/**
 * GET /api/conversations/:id/messages — страница сообщений диалога.
 *
 * `limit` ограничен сотней на сервере; ленте быстрого чата хватает трёх,
 * а полному экрану — пятидесяти по умолчанию.
 */
export function listConversationMessages(
  conversationId: string,
  options: { before?: string; limit?: number } = {},
): Promise<{ messages: TripMessage[]; hasMore: boolean }> {
  const query = new URLSearchParams()
  if (options.before) query.set('before', options.before)
  if (options.limit) query.set('limit', String(options.limit))

  const suffix = query.size > 0 ? `?${query.toString()}` : ''

  return apiFetch<{ messages: TripMessage[]; hasMore: boolean }>(
    `/conversations/${conversationId}/messages${suffix}`,
  )
}

/** POST /api/conversations/:id/messages — отправить сообщение в диалог. */
export function sendConversationMessage(
  conversationId: string,
  body: string,
): Promise<TripMessage> {
  return apiFetch<TripMessage>(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
}

/**
 * PATCH /api/conversations/:id/messages/:messageId — изменить своё сообщение
 * (25.11.2026).
 *
 * Чужое и системное сервер не даст (403), сообщения с денежным действием —
 * тоже: текст уведомления о переводе человеку не принадлежит. Новый текст
 * приходит в ответе и уезжает собеседнику кадром `message_updated`.
 */
export function editConversationMessage(
  conversationId: string,
  messageId: string,
  body: string,
): Promise<TripMessage> {
  return apiFetch<TripMessage>(
    `/conversations/${conversationId}/messages/${messageId}`,
    { method: 'PATCH', body: JSON.stringify({ body }) },
  )
}

/**
 * DELETE /api/conversations/:id/messages/:messageId — удалить своё сообщение
 * (25.11.2026).
 *
 * Удаление физическое: ответ 204, возвращать нечего. В открытой переписке
 * обоих появляется кадр `message_deleted`, и строка исчезает без
 * перезагрузки.
 */
export function deleteConversationMessage(
  conversationId: string,
  messageId: string,
): Promise<void> {
  return apiFetch<void>(`/conversations/${conversationId}/messages/${messageId}`, {
    method: 'DELETE',
  })
}

/** POST /api/conversations/:id/read — отметить диалог прочитанным. */
export function markConversationRead(conversationId: string): Promise<void> {
  return apiFetch<void>(`/conversations/${conversationId}/read`, {
    method: 'POST',
  })
}

/**
 * Заглушить или вернуть уведомления по диалогу.
 *
 * Два метода на один адрес: `POST` — заглушить, `DELETE` — вернуть.
 * Настройка живёт в строке состава и не трогает непрочитанное в чате.
 */
export function setConversationMuted(
  conversationId: string,
  muted: boolean,
): Promise<void> {
  return apiFetch<void>(`/conversations/${conversationId}/mute`, {
    method: muted ? 'POST' : 'DELETE',
  })
}
