import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { User } from '@/api/types'

/**
 * Старт приложения в офлайне.
 *
 * Раньше любая сетевая ошибка при `refresh` означала «не залогинен»,
 * и PWA в поле выбрасывала на форму входа. Теперь профиль последнего входа
 * поднимает офлайн-сессию, а ответ сервера 401 по-прежнему разлогинивает.
 *
 * Хранилище и кеш подменены: проверяется решение стора, а не localStorage.
 */
const mocks = vi.hoisted(() => ({
  readUser: vi.fn(),
  saveUser: vi.fn(),
  clearUser: vi.fn(),
  clearCache: vi.fn(),
}))

vi.mock('@/offline/session', () => ({
  readOfflineUser: mocks.readUser,
  saveOfflineUser: mocks.saveUser,
  clearOfflineUser: mocks.clearUser,
}))

vi.mock('@/offline/cache', () => ({
  clearAllOfflineData: mocks.clearCache,
}))

import { useAuthStore } from '@/stores/auth'

const USER: User = {
  id: 'u-1',
  displayName: 'Тест',
  location: null,
  avatarUrl: null,
  gender: 'm',
  isVegetarian: false,
  allergies: null,
  paymentDetails: null,
  paymentBank: null,
  sportExperience: null,
  isAdmin: false,
}

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value })
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('auth.bootstrap в офлайне', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setNavigatorOnline(true)
    vi.clearAllMocks()
    mocks.readUser.mockReturnValue(null)
    mocks.clearCache.mockResolvedValue(undefined)
  })

  afterEach(() => {
    setNavigatorOnline(true)
    vi.unstubAllGlobals()
  })

  it('без сети поднимает профиль последнего входа и не идёт на сервер', async () => {
    setNavigatorOnline(false)
    mocks.readUser.mockReturnValue(USER)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const store = useAuthStore()
    await store.bootstrap()

    expect(store.user).toEqual(USER)
    expect(store.isAuthenticated).toBe(true)
    expect(store.isOfflineSession).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('сеть есть, но сервер недоступен — тоже офлайн-сессия', async () => {
    mocks.readUser.mockReturnValue(USER)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    const store = useAuthStore()
    await store.bootstrap()

    expect(store.user).toEqual(USER)
    expect(store.isOfflineSession).toBe(true)
    expect(store.accessToken).toBeNull()
  })

  it('сервер ответил 401 — честно разлогинивает и чистит копию', async () => {
    mocks.readUser.mockReturnValue(USER)
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'Unauthorized' }, 401)))

    const store = useAuthStore()
    await store.bootstrap()

    expect(store.user).toBeNull()
    expect(store.isOfflineSession).toBe(false)
    expect(mocks.clearUser).toHaveBeenCalled()
  })

  it('успешный вход сохраняет профиль для будущего офлайна', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ accessToken: 'token', user: USER })),
    )

    const store = useAuthStore()
    await store.bootstrap()

    expect(store.accessToken).toBe('token')
    expect(store.user).toEqual(USER)
    expect(store.isOfflineSession).toBe(false)
    expect(mocks.saveUser).toHaveBeenCalledWith(USER)
  })

  it('связь вернулась — resumeSession получает токен и снимает офлайн-режим', async () => {
    setNavigatorOnline(false)
    mocks.readUser.mockReturnValue(USER)

    const store = useAuthStore()
    await store.bootstrap()
    expect(store.isOfflineSession).toBe(true)

    setNavigatorOnline(true)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ accessToken: 'fresh', user: USER })),
    )

    await store.resumeSession()

    expect(store.accessToken).toBe('fresh')
    expect(store.isOfflineSession).toBe(false)
  })

  it('выход убирает и профиль, и офлайн-данные', async () => {
    const store = useAuthStore()
    store.setAuth(USER, 'token')

    store.clear()

    expect(store.user).toBeNull()
    expect(mocks.clearUser).toHaveBeenCalled()
    expect(mocks.clearCache).toHaveBeenCalled()
  })
})
