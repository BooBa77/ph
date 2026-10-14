import { apiFetch } from '@/api/client'

/**
 * Сессии устройств — раздел «Настройки».
 *
 * Контракт совпадает с `SessionDto` на бэке: хэш refresh-токена наружу
 * не уходит никогда, только идентификатор, подпись устройства и сроки.
 */
export interface SessionInfo {
  id: string
  /** «Chrome on Windows» или null, если User-Agent разобрать не удалось. */
  deviceLabel: string | null
  createdAt: string
  expiresAt: string
  /** Это устройство, с которого сделан запрос: его не предлагаем отзывать. */
  isCurrent: boolean
}

/** GET /api/users/me/sessions — активные сессии пользователя. */
export async function fetchSessions(): Promise<SessionInfo[]> {
  return apiFetch<SessionInfo[]>('/users/me/sessions')
}

/**
 * DELETE /api/users/me/sessions/:id — отозвать сессию устройства.
 *
 * Ответ 204 без тела: `apiFetch` на него возвращает undefined.
 * Отозванное устройство вылетит при следующем обновлении токена.
 */
export async function revokeSession(id: string): Promise<void> {
  await apiFetch<void>(`/users/me/sessions/${id}`, { method: 'DELETE' })
}
