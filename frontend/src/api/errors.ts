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
    // `new.target` вместо `ApiError`: у подкласса (OfflineError) прототип
    // должен остаться своим, иначе `instanceof OfflineError` врёт.
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Нет связи: запрос не ушёл или ушёл и не вернулся.
 *
 * Наследуется от `ApiError` с нулевым статусом, чтобы существующие экраны,
 * которые показывают `problem.message` только для `ApiError`, показали
 * человеческий текст, а не «не удалось». Статуса 0 у HTTP не бывает —
 * это не ответ сервера, а его отсутствие.
 */
export class OfflineError extends ApiError {
  /** Отличает обрыв от ответа сервера, не заглядывая в `status`. */
  readonly isOffline = true

  constructor(
    message = 'Нет связи: изменения не отправлены. Попробуй, когда появится сеть.',
  ) {
    super(0, message, null)
    this.name = 'OfflineError'
  }
}

/**
 * Похоже ли исключение на «сеть пропала», а не на ответ сервера.
 *
 * `fetch` при обрыве кидает `TypeError`; наш явный офлайн — `OfflineError`.
 * Ответы 4xx/5xx — всегда `ApiError` с ненулевым статусом, их из кеша
 * подменять нельзя: сервер сказал «нельзя», а не «не слышу».
 */
export function isNetworkProblem(problem: unknown): boolean {
  if (problem instanceof OfflineError) return true
  return problem instanceof TypeError && !(problem instanceof ApiError)
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
