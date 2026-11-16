import {
  ApiError,
  OfflineError,
  extractMessage,
  isNetworkProblem,
  parseErrorBody,
} from '@/api/errors'
import {
  isCacheablePath,
  readCachedResponse,
  writeCachedResponse,
} from '@/offline/cache'
import { useAuthStore } from '@/stores/auth'

/** Базовый префикс. В dev через Vite proxy, в prod через nginx — оба ведут на NestJS. */
const BASE_URL = '/api'

/** Сообщение, когда связи нет и нужного ответа в кеше не нашлось. */
const OFFLINE_EMPTY = 'Нет связи, а этот экран не сохранён для офлайна.'

/**
 * Внутренняя реализация с флагом isRetry.
 *
 * isRetry защищает от бесконечного цикла:
 *   запрос → 401 → refresh → повтор → 401 → refresh → ...
 * После одного повтора 401 больше не ретраим — кидаем как есть.
 *
 * Публичный apiFetch (ниже) зовёт эту функцию с isRetry = false.
 */
async function apiFetchInternal<T>(path: string, init: RequestInit, isRetry: boolean): Promise<T> {
  // useAuthStore() можно вызывать только внутри функции, не на уровне модуля:
  // на момент импорта файла Pinia ещё не инициализирована (app.use(pinia) не вызван).
  const store = useAuthStore()

  // --- заголовки ---
  const headers = new Headers(init.headers)

  // Content-Type: application/json — автоматически, если есть тело и это не FormData.
  // FormData сам выставляет multipart/form-data с правильным boundary, лезть туда нельзя.
  if (init.body !== undefined && !(init.body instanceof FormData)) {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
  }

  // Accept: application/json — чтобы бэк знал, что мы ждём JSON, а не HTML.
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json')
  }

  // Authorization: Bearer <accessToken> — если токен есть в store.
  if (store.accessToken) {
    headers.set('Authorization', `Bearer ${store.accessToken}`)
  }

  // --- запрос ---
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
    // credentials: 'include' — обязательно: без этого браузер не отправит
    // httpOnly refresh-cookie и не сохранит новую с ответа refresh.
    credentials: 'include',
  })

  // --- 401: пробуем обновить токен и повторить один раз ---
  if (res.status === 401 && !isRetry) {
    // refreshAccessToken — single-flight внутри store: параллельные вызовы
    // получат один и тот же промис, дубля POST /refresh не будет.
    const refreshResult = await store.refreshAccessToken()

    // refreshResult.accessToken === null → бэк честно сказал «не залогинен».
    // store сам вызвал clear() внутри refreshAccessToken, повторять нечем.
    if (refreshResult.accessToken === null) {
      throw new ApiError(401, 'Не авторизован', null)
    }

    // Токен обновился — повторяем исходный запрос с isRetry = true.
    // Рекурсия тут одного уровня: если повтор снова вернёт 401 — уйдём
    // в общую обработку ошибки внизу и просто кидаем ApiError.
    return apiFetchInternal<T>(path, init, true)
  }

  // --- 204 No Content ---
  // Тело пустое, res.json() упал бы с «Unexpected end of JSON input».
  if (res.status === 204) {
    return undefined as T
  }

  // --- успех: 2xx ---
  if (res.ok) {
    return parseResponse<T>(res)
  }

  // --- ошибка 4xx/5xx ---
  const body = await parseErrorBody(res)
  const message = extractMessage(body, res.status)
  throw new ApiError(res.status, message, body)
}

/**
 * Разбор успешного ответа.
 * - application/json → res.json()
 * - иначе → res.text() (на случай, если бэк вернёт HTML/plain с 200)
 */
async function parseResponse<T>(res: Response): Promise<T> {
  const contentType = res.headers.get('Content-Type') ?? ''
  if (contentType.includes('application/json')) {
    return (await res.json()) as T
  }
  return (await res.text()) as unknown as T
}

/** Есть ли связь по мнению браузера. */
function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/**
 * Публичная обёртка над fetch для защищённых API-запросов.
 *
 * Возможности:
 *   - BASE_URL = /api (в dev через Vite proxy, в prod через nginx)
 *   - Authorization: Bearer <accessToken> из useAuthStore
 *   - credentials: 'include' (refresh-cookie)
 *   - автоматический Content-Type: application/json, если есть body
 *   - при 401: refresh + один повтор исходного запроса
 *   - бросает ApiError при 4xx/5xx
 *
 * **Офлайн-режим (16.11.2026):**
 *   - GET-ответы походов и словарей складываются в IndexedDB;
 *   - без связи GET отдаётся из кеша, а если его нет — `OfflineError`;
 *   - без связи изменения не отправляются вовсе (`OfflineError`), а не висят
 *     в ожидании сети;
 *   - обрыв уже начатого запроса (TypeError) тоже откатывается на кеш —
 *     `navigator.onLine` успевает соврать.
 *
 * НЕ использовать для:
 *   - request-code, verify-code (публичные, без токена)
 *   - refresh (живёт в store, прямой fetch, иначе рекурсия)
 *   - logout (не должен зависеть от живости access)
 *
 * Тип T по умолчанию unknown — заставляет указывать тип явно,
 * чтобы случайно не работать с необработанными данными.
 */
export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  const canUseCache = method === 'GET' && isCacheablePath(path)

  // --- явный офлайн: сеть не трогаем вовсе ---
  if (isBrowserOffline()) {
    if (canUseCache) {
      const cached = await readCachedResponse(path)
      if (cached) return cached.body as T
    }

    throw new OfflineError(
      method === 'GET' ? OFFLINE_EMPTY : 'Нет связи: изменения не отправлены.',
    )
  }

  try {
    const result = await apiFetchInternal<T>(path, init, false)

    // Кеш — побочное дело: неудачная запись не должна ронять удачный ответ.
    if (canUseCache && result !== undefined) {
      try {
        await writeCachedResponse(path, result)
      } catch {
        // Хранилище запрещено или переполнено — живём без кеша.
      }
    }

    return result
  } catch (problem) {
    // Оборвался уже начатый запрос: браузер мог ещё считать себя онлайн.
    if (canUseCache && isNetworkProblem(problem)) {
      const cached = await readCachedResponse(path)
      if (cached) return cached.body as T
      throw new OfflineError(OFFLINE_EMPTY)
    }

    throw problem
  }
}
