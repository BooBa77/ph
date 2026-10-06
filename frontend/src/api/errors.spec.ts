import { describe, expect, it } from 'vitest'

import { ApiError, extractMessage, parseErrorBody } from '@/api/errors'

function jsonResponse(body: unknown, status = 400): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('ApiError', () => {
  it('сохраняет статус, сообщение, тело и имя', () => {
    const error = new ApiError(404, 'Не найдено', { detail: 'нет' })

    expect(error.status).toBe(404)
    expect(error.message).toBe('Не найдено')
    expect(error.body).toEqual({ detail: 'нет' })
    expect(error.name).toBe('ApiError')
  })

  it('тело по умолчанию null', () => {
    expect(new ApiError(500, 'Упало').body).toBeNull()
  })

  it('остаётся узнаваемым через instanceof', () => {
    const error = new ApiError(400, 'Плохой запрос')

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toBeInstanceOf(Error)
  })
})

describe('extractMessage', () => {
  it('берёт message из тела NestJS', () => {
    expect(
      extractMessage({ message: 'Неверный код', statusCode: 401 }, 401),
    ).toBe('Неверный код')
  })

  it('подставляет HTTP-статус, если message нет', () => {
    expect(extractMessage({ error: 'Bad Request' }, 400)).toBe('HTTP 400')
  })

  it('не спотыкается о null, строку и массив', () => {
    expect(extractMessage(null, 502)).toBe('HTTP 502')
    expect(extractMessage('<html>502 Bad Gateway</html>', 502)).toBe('HTTP 502')
    expect(extractMessage([{ message: 'вложенное' }], 500)).toBe('HTTP 500')
  })

  it('не принимает не-строковый message', () => {
    expect(extractMessage({ message: 42 }, 400)).toBe('HTTP 400')
  })
})

describe('parseErrorBody', () => {
  it('разбирает JSON-тело', async () => {
    await expect(parseErrorBody(jsonResponse({ message: 'нет' }))).resolves.toEqual(
      { message: 'нет' },
    )
  })

  it('возвращает текст для не-JSON — например, HTML от nginx', async () => {
    const res = new Response('<html>502 Bad Gateway</html>', {
      status: 502,
      headers: { 'Content-Type': 'text/html' },
    })

    await expect(parseErrorBody(res)).resolves.toContain('502 Bad Gateway')
  })

  it('возвращает null, если тело вообще не читается', async () => {
    const broken = {
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => {
        throw new Error('тело оборвалось')
      },
      text: async () => {
        throw new Error('тело оборвалось')
      },
    } as unknown as Response

    await expect(parseErrorBody(broken)).resolves.toBeNull()
  })
})
