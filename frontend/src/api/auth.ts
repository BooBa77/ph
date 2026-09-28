import { ApiError, extractMessage, parseErrorBody } from '@/api/errors'
import type { AuthResponse, RequestCodeResponse } from '@/api/types'

/** Базовый префикс. В dev через Vite proxy, в prod через nginx. */
const BASE_URL = '/api'

/**
 * Прямой fetch с разбором ответа — без apiFetch и без авто-refresh.
 *
 * Почему не apiFetch: auth-эндпоинты либо публичные (токена нет),
 * либо сам являются механизмом refresh. Гонять их через apiFetch
 * означало бы рекурсию и лишние 401 → refresh → повтор.
 *
 * Возвращает распарсенный JSON. При 4xx/5xx кидает ApiError.
 * При 204 возвращает undefined (для logout).
 */
async function directFetch<T>(path: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers)

  // Тело всегда JSON у auth-эндпоинтов.
  if (init.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }
  headers.set('Accept', 'application/json')

  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
    // credentials: 'include' — чтобы:
    //   - verify-code сохранил refresh-cookie из Set-Cookie
    //   - logout отправил refresh-cookie на бэк (отзыв сессии)
    credentials: 'include',
  })

  // 204 No Content — тело пустое (logout).
  if (res.status === 204) {
    return undefined as T
  }

  if (res.ok) {
    return (await res.json()) as T
  }

  const body = await parseErrorBody(res)
  throw new ApiError(res.status, extractMessage(body, res.status), body)
}

/**
 * POST /api/auth/request-code
 *
 * Запрос кода на email. Публичный, без токена.
 * Бэк вернёт { message, resendAfterSeconds } — второе поле для таймера
 * «повторно через N секунд» на форме.
 *
 * Возможные ошибки (ApiError):
 *   400 — невалидный email
 *   429 — cooldown, ещё нельзя (тело содержит оставшиеся секунды)
 *   500 — smtp упал
 */
export async function requestCode(email: string): Promise<RequestCodeResponse> {
  return directFetch<RequestCodeResponse>('/auth/request-code', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

/**
 * POST /api/auth/verify-code
 *
 * Проверка кода и вход. Публичный.
 * При успехе бэк:
 *   - создаёт User+AuthIdentity (если первый вход)
 *   - создаёт Session
 *   - ставит refresh-cookie (httpOnly)
 *   - возвращает { accessToken, user }
 *
 * ВАЖНО: эта функция НЕ кладёт данные в store. Это делает компонент,
 * чтобы auth.ts не зависел от Pinia и оставался тестируемым.
 *
 * Возможные ошибки:
 *   400 — неверный код / код истёк
 *   429 — превышено число попыток
 */
export async function verifyCode(
  email: string,
  code: string,
): Promise<AuthResponse> {
  return directFetch<AuthResponse>('/auth/verify-code', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  })
}

/**
 * POST /api/auth/logout
 *
 * Отзыв текущей сессии (revoked_at) и очистка refresh-cookie.
 * Возвращает 204 No Content.
 *
 * Идёт напрямую, не через apiFetch: logout должен работать даже если
 * access-токен протух. Бэк отзывает сессию по refresh-cookie, access не нужен.
 *
 * Бэк всегда возвращает 204, даже если cookie нет (см. контекст).
 * Ошибки тут возможны только сетевые/500 — при них кидаем как есть,
 * компонент решит, показывать ли что-то юзеру.
 */
export async function logout(): Promise<void> {
  await directFetch<void>('/auth/logout', { method: 'POST' })
}