import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deleteAvatar, uploadAvatar } from '@/api/users'
import type { User } from '@/api/types'

const updatedUser: User = {
  id: 'u1',
  displayName: 'Тест',
  location: null,
  avatarUrl: '/api/uploads/avatars/u1/3f2504e0-4f89-41d3-9a0c-0305e82c3301.webp',
}

interface Call {
  url: string
  init: RequestInit
}

/** Подменяет fetch одним успешным ответом и записывает вызов. */
function mockFetch(body: unknown = updatedUser) {
  const calls: Call[] = []

  const mock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init })
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })

  vi.stubGlobal('fetch', mock)

  return {
    calls,
    headersOf: (index: number) => new Headers(calls[index]!.init.headers),
  }
}

/**
 * Достать содержимое FormData из тела запроса.
 *
 * В jsdom `instanceof FormData` для чужого экземпляра не работает
 * (разные реализации одного интерфейса), поэтому смотрим на сам объект
 * структурно: наличие append/entries достаточно, чтобы отличить его
 * от строки JSON.
 */
async function readFormData(body: unknown): Promise<FormData> {
  const candidate = body as { append?: unknown; entries?: unknown }
  if (typeof candidate?.append !== 'function') {
    throw new Error('в теле запроса не FormData')
  }
  return candidate as FormData
}

describe('api/users — аватарка', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uploadAvatar отправляет файл как multipart на POST /users/me/avatar', async () => {
    const { calls } = mockFetch()
    const blob = new Blob(['картинка'], { type: 'image/jpeg' })

    await expect(uploadAvatar(blob)).resolves.toEqual(updatedUser)

    expect(calls[0]!.url).toBe('/api/users/me/avatar')
    expect(calls[0]!.init.method).toBe('POST')

    const formData = await readFormData(calls[0]!.init.body)
    const file = formData.get('file')
    expect(file).toBeInstanceOf(Blob)
    expect((file as File).type).toBe('image/jpeg')
    // Имя файла бэкенд не использует, но без него часть multipart уходит
    // без filename, и часть парсеров принимает её за обычное поле.
    expect((file as File).name).toBe('avatar.jpg')
  })

  it('uploadAvatar НЕ ставит Content-Type руками', async () => {
    // Если поставить заголовок самому, браузер не добавит boundary,
    // и multer не разберёт тело — в ответ придёт «Файл не передан».
    const { headersOf } = mockFetch()

    await uploadAvatar(new Blob(['x'], { type: 'image/jpeg' }))

    expect(headersOf(0).has('Content-Type')).toBe(false)
  })

  it('deleteAvatar идёт методом DELETE и возвращает профиль', async () => {
    const withoutAvatar = { ...updatedUser, avatarUrl: null }
    const { calls } = mockFetch(withoutAvatar)

    await expect(deleteAvatar()).resolves.toEqual(withoutAvatar)

    expect(calls[0]!.url).toBe('/api/users/me/avatar')
    expect(calls[0]!.init.method).toBe('DELETE')
  })

  it('на ошибке бросает ApiError с сообщением бэка', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: 'Файл больше 10 МБ' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    )

    await expect(
      uploadAvatar(new Blob(['x'], { type: 'image/jpeg' })),
    ).rejects.toMatchObject({ status: 400, message: 'Файл больше 10 МБ' })
  })
})
