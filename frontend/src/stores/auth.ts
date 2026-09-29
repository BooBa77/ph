import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { ApiError } from '@/api/errors'
import type { RefreshResponse, User } from '@/api/types'

/**
 * Single-flight для refresh.
 *
 * Если два запроса одновременно получили 401 и оба хотят обновить токен —
 * второй должен ждать тот же промис, а не запускать второй POST /refresh.
 * Иначе бэк ротирует cookie дважды: первый запрос её потратит,
 * второй придёт со старой — и юзера выкинет.
 *
 * Храним НЕ в state: это не UI-состояние, реактивность не нужна,
 * devtools не должен его видеть.
 */
let refreshPromise: Promise<RefreshResponse> | null = null

/**
 * Прямой запрос refresh, без apiFetch (его ещё нет, да и цикл был бы:
 * client → store → client). Refresh — всегда прямой fetch.
 *
 * Возвращает union RefreshResponse:
 *   { accessToken, user } — успех
 *   { accessToken: null } — не залогинен (cookie нет/протухла)
 * При сети/5xx — КИДАЕТ как есть (ApiError или TypeError).
 * Разницу между «не залогинен» и «сеть упала» caller различает сам.
 */
async function doRefresh(): Promise<RefreshResponse> {
  const res = await fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })

  if (res.ok) {
    return (await res.json()) as RefreshResponse
  }

  // Тело может быть не-JSON (nginx, HTML-ошибка) — парсим best-effort.
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = await res.text().catch(() => null)
  }

  const message =
    typeof body === 'object' && body !== null && 'message' in body
      ? String((body as { message: unknown }).message)
      : `HTTP ${res.status}`

  throw new ApiError(res.status, message, body)
}

export const useAuthStore = defineStore('auth', () => {
  // --- state ---
  const user = ref<User | null>(null)
  const accessToken = ref<string | null>(null)
  const isBootstrapped = ref(false)

  // --- getters ---
  const isAuthenticated = computed(() => user.value !== null)

  // --- actions ---

  function setAuth(nextUser: User, nextToken: string) {
    user.value = nextUser
    accessToken.value = nextToken
  }

  function clear() {
    user.value = null
    accessToken.value = null
  }

  /**
   * Обновление access-токена. Single-flight: параллельные вызовы
   * получают один и тот же промис.
   *
   * Возвращает RefreshResponse (см. doRefresh). Кидает при сети/5xx.
   */
  async function refreshAccessToken(): Promise<RefreshResponse> {
    if (refreshPromise) return refreshPromise

    refreshPromise = doRefresh()
    try {
      const result = await refreshPromise
      // Если бэк сказал «токена нет» — зачищаем стор, чтобы не осталось
      // полу-состояния «access протух, но user висит».
      if (result.accessToken === null) {
        clear()
      } else {
        setAuth(result.user, result.accessToken)
      }
      return result
    } finally {
      refreshPromise = null
    }
  }

  /**
   * Вызывается один раз при старте приложения (из router guard).
   * Пробует refresh: если юзер залогинен — setAuth, если нет — тишина.
   * НИКОГДА не падает: сеть/500/«не залогинен» — всё приводит
   * к одному исходу «не залогинен». isBootstrapped ставится в finally.
   */
  async function bootstrap() {
    try {
      await refreshAccessToken()
    } catch {
      // Сеть/5xx — просто считаем, что не залогинены. Не шумим.
      clear()
    } finally {
      isBootstrapped.value = true
    }
  }

  return {
    // state
    user,
    accessToken,
    isBootstrapped,
    // getters
    isAuthenticated,
    // actions
    setAuth,
    clear,
    refreshAccessToken,
    bootstrap,
  }
})