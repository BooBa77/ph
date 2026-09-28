/**
 * Ошибка ответа API: сервер ответил статусом 4xx или 5xx.
 *
 * Используется в apiFetch и в прямых fetch-вызовах (auth.ts),
 * чтобы вызывающий код мог различать ошибки по статусу:
 *
 *   try {
 *     await verifyCode(email, code)
 *   } catch (e) {
 *     if (e instanceof ApiError && e.status === 400) {
 *       showError('Неверный код')
 *     }
 *   }
 *
 * ВАЖНО: сюда НЕ попадают сетевые ошибки (нет соединения, DNS, таймаут) —
 * fetch в таких случаях кидает TypeError, и мы его не оборачиваем,
 * а пробрасываем как есть. ApiError — только про ответы сервера.
 */
export class ApiError extends Error {
  /** HTTP-статус ответа: 400, 401, 404, 500 и т.д. */
  readonly status: number

  /** Разобранное тело ответа (если JSON) либо сырой текст. */
  readonly body: unknown

  constructor(status: number, message: string, body: unknown = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body

    // Восстанавливаем прототип: при транспиляции в ES5 у классов-наследников
    // Error он теряется, и `instanceof ApiError` начинает врать.
    // С ES2022 это не нужно, но оставить — дешёвая страховка.
    Object.setPrototypeOf(this, ApiError.prototype)
  }
}

/**
 * Best-effort разбор тела ответа с ошибкой.
 * Тело может быть не-JSON: HTML от nginx, пустая строка, что угодно.
 * Не кидаем — возвращаем null, если не получилось.
 */
export async function parseErrorBody(res: Response): Promise<unknown> {
  try {
    const contentType = res.headers.get('Content-Type') ?? ''
    if (contentType.includes('application/json')) {
      return await res.json()
    }
    return await res.text()
  } catch {
    return null
  }
}

/**
 * Достать человекочитаемое сообщение из тела ошибки.
 * Ожидаем { message: string } от NestJS, но не полагаемся на это.
 */
export function extractMessage(body: unknown, status: number): string {
  if (
    typeof body === 'object' &&
    body !== null &&
    'message' in body &&
    typeof (body as { message: unknown }).message === 'string'
  ) {
    return (body as { message: string }).message
  }
  return `HTTP ${status}`
}