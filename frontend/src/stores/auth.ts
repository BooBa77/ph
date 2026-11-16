import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { ApiError, isNetworkProblem } from '@/api/errors'
import type { RefreshResponse, User } from '@/api/types'
import { clearAllOfflineData } from '@/offline/cache'
import {
  clearOfflineUser,
  readOfflineUser,
  saveOfflineUser,
} from '@/offline/session'

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

  /**
   * Сессия поднята из офлайн-копии, токена нет.
   *
   * Так PWA в поле открывается на текущем походе, а не на форме входа,
   * которую без сети всё равно не пройти. Отличить нужно ради честности:
   * часть действий (профиль, выход) без связи недоступна.
   */
  const isOfflineSession = ref(false)

  // --- getters ---
  const isAuthenticated = computed(() => user.value !== null)

  // --- actions ---

  function setAuth(nextUser: User, nextToken: string) {
    user.value = nextUser
    accessToken.value = nextToken
    isOfflineSession.value = false
    saveOfflineUser(nextUser)
  }

  /**
   * Обновить данные пользователя в store (например, после PATCH /users/me).
   * Access-токен не трогаем — он остаётся.
   */
  function setUser(nextUser: User) {
    user.value = nextUser
    saveOfflineUser(nextUser)
  }

  function clear() {
    user.value = null
    accessToken.value = null
    isOfflineSession.value = false

    // Выход — это и уход с устройства: чужой профиль и чужие походы
    // в хранилище остаться не должны. Ждать очистку IndexedDB не нужно,
    // поэтому не `await`: локальное состояние важнее уборки.
    clearOfflineUser()
    void clearAllOfflineData()
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
   *
   * **Офлайн-ветка важнее прежнего поведения.** Раньше любая сетевая ошибка
   * означала «не залогинен», и PWA в поле выбрасывала на `/auth`. Теперь:
   *  - сети нет вовсе — поднимаем профиль последнего входа;
   *  - сеть есть, но refresh не дошёл — тоже поднимаем, если профиль сохранён;
   *  - сервер ответил 401/4xx/5xx — честно считаем, что вход не пройден.
   */
  async function bootstrap() {
    const cachedUser = readOfflineUser()

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      if (cachedUser) {
        user.value = cachedUser
        isOfflineSession.value = true
      }
      isBootstrapped.value = true
      return
    }

    try {
      await refreshAccessToken()
    } catch (problem) {
      if (isNetworkProblem(problem) && cachedUser) {
        user.value = cachedUser
        isOfflineSession.value = true
      } else {
        clear()
      }
    } finally {
      isBootstrapped.value = true
    }
  }

  /**
   * Попытка поднять сессию, когда связь вернулась.
   *
   * Уже вошедшего не трогаем: у него есть токен. Офлайн-сессия при этом
   * получает настоящий токен, и правки снова доступны. Неудача ничего
   * не ломает — остаёмся в офлайн-режиме до следующего события `online`.
   */
  async function resumeSession() {
    if (accessToken.value && user.value) return

    try {
      await refreshAccessToken()
    } catch {
      // Связь всё ещё не работает. Профиль из офлайн-копии остаётся.
    }
  }

  return {
    // state
    user,
    accessToken,
    isBootstrapped,
    isOfflineSession,
    // getters
    isAuthenticated,
    // actions
    setAuth,
    setUser,
    clear,
    refreshAccessToken,
    bootstrap,
    resumeSession,
  }
})
