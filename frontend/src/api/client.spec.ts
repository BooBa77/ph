import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiFetch } from '@/api/client'
import { ApiError } from '@/api/errors'
import { useAuthStore } from '@/stores/auth'
import type { User } from '@/api/types'

const user = { id: 'u1', displayName: 'Тест' } as User

/*
 * Токены в тестах — только ASCII. Значения заголовков в Fetch API
 * обязаны быть ByteString, и кириллица в `new Headers(...)` роняет
 * всё с TypeError. Настоящие токены (JWT, base64url) всегда ASCII,
 * так что это не ограничение теста, а свойство предметной области.
 */
const FRESH_TOKEN = 'fresh-token'
const OLD_TOKEN = 'old-token'

interface Call {
  url: string
  init: RequestInit
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Подменяет fetch заранее заданной очередью ответов и записывает вызовы.
 *
 * Очередь, а не правила по URL: в сценарии с 401 важен именно порядок —
 * сначала защищённый запрос, потом refresh, потом повтор.
 */
function mockFetch(responses: Response[]) {
  const calls: Call[] = []

  const mock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init })
    const next = responses.shift()
    if (!next) {
      throw new Error(`fetch вызван лишний раз: ${String(input)}`)
    }
    return next
  })

  vi.stubGlobal('fetch', mock)

  return {
    calls,
    headersOf: (index: number) => new Headers(calls[index]!.init.headers),
  }
}

describe('apiFetch', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('идёт на /api<path> с credentials: include и Accept', async () => {
    const { calls, headersOf } = mockFetch([jsonResponse({ ok: true })])

    await apiFetch('/users/me')

    expect(calls[0]!.url).toBe('/api/users/me')
    expect(calls[0]!.init.credentials).toBe('include')
    expect(headersOf(0).get('Accept')).toBe('application/json')
  })

  it('подставляет Bearer-токен из store', async () => {
    useAuthStore().accessToken = 'token-123'
    const { headersOf } = mockFetch([jsonResponse({})])

    await apiFetch('/users/me')

    expect(headersOf(0).get('Authorization')).toBe('Bearer token-123')
  })

  it('не ставит Authorization, когда токена нет', async () => {
    const { headersOf } = mockFetch([jsonResponse({})])

    await apiFetch('/users/me')

    expect(headersOf(0).has('Authorization')).toBe(false)
  })

  it('ставит Content-Type: application/json при наличии тела', async () => {
    const { headersOf } = mockFetch([jsonResponse({})])

    await apiFetch('/users/me', {
      method: 'PATCH',
      body: JSON.stringify({ displayName: 'Новое имя' }),
    })

    expect(headersOf(0).get('Content-Type')).toBe('application/json')
  })

  it('возвращает undefined на 204 No Content', async () => {
    mockFetch([new Response(null, { status: 204 })])

    await expect(apiFetch('/auth/logout', { method: 'POST' })).resolves.toBeUndefined()
  })

  it('на 4xx бросает ApiError с сообщением из тела', async () => {
    mockFetch([jsonResponse({ message: 'Имя занято' }, 400)])

    await expect(apiFetch('/users/me', { method: 'PATCH' })).rejects.toMatchObject({
      status: 400,
      message: 'Имя занято',
    })
  })

  it('на 401 обновляет токен и повторяет запрос один раз', async () => {
    mockFetch([
      jsonResponse({ message: 'Unauthorized' }, 401),
      jsonResponse({ accessToken: FRESH_TOKEN, user }),
      jsonResponse({ id: 'u1' }),
    ])

    await expect(apiFetch('/users/me')).resolves.toEqual({ id: 'u1' })

    const store = useAuthStore()
    expect(store.accessToken).toBe(FRESH_TOKEN)
    expect(store.user).toEqual(user)
  })

  it('повтор уходит с уже обновлённым токеном', async () => {
    const { calls, headersOf } = mockFetch([
      jsonResponse({ message: 'Unauthorized' }, 401),
      jsonResponse({ accessToken: FRESH_TOKEN, user }),
      jsonResponse({ id: 'u1' }),
    ])

    await apiFetch('/users/me')

    expect(calls).toHaveLength(3)
    expect(calls[1]!.url).toBe('/api/auth/refresh')
    expect(calls[2]!.url).toBe('/api/users/me')
    expect(headersOf(2).get('Authorization')).toBe(`Bearer ${FRESH_TOKEN}`)
  })

  it('не зацикливается: если повтор снова 401 — кидает и не ретраит', async () => {
    const { calls } = mockFetch([
      jsonResponse({ message: 'Unauthorized' }, 401),
      jsonResponse({ accessToken: FRESH_TOKEN, user }),
      jsonResponse({ message: 'Unauthorized' }, 401),
    ])

    await expect(apiFetch('/users/me')).rejects.toBeInstanceOf(ApiError)

    // refresh вызван ровно один раз, третьего захода за токеном нет
    expect(calls.filter((c) => c.url === '/api/auth/refresh')).toHaveLength(1)
    expect(calls).toHaveLength(3)
  })

  it('если refresh ответил «не залогинен» — бросает 401 и чистит store', async () => {
    const store = useAuthStore()
    store.accessToken = OLD_TOKEN
    const { calls } = mockFetch([
      jsonResponse({ message: 'Unauthorized' }, 401),
      jsonResponse({ accessToken: null }),
    ])

    await expect(apiFetch('/users/me')).rejects.toMatchObject({ status: 401 })

    expect(store.accessToken).toBeNull()
    expect(store.user).toBeNull()
    // повторять нечем — третьего запроса нет
    expect(calls).toHaveLength(2)
  })
})
