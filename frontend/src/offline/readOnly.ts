/**
 * Флаги прав в ответах API, которые в офлайне обязаны стать «нельзя».
 *
 * Бэкенд отдаёт права в самих вкладках (`canEdit`, `canWrite`, `canSpend`),
 * и именно по ним интерфейс рисует кнопки. В офлайне изменения отправить
 * некуда, поэтому читать эти флаги как `true` нельзя: человек нажал бы
 * «Добавить» и получил ошибку связи вместо понятного «сейчас нельзя».
 *
 * Поэтому копия из кеша отдаётся с погашенными правами. Ответ в кеше
 * при этом не меняется — когда связь вернётся, придёт свежий ответ
 * с настоящими правами.
 */
const READ_ONLY_FLAGS = new Set([
  'canEdit',
  'canEditGear',
  'canManageRoles',
  'canWrite',
  'canSpend',
])

/**
 * Глубокая копия значения, в которой все флаги прав равны `false`.
 *
 * Вход — только распарсенный JSON (объекты, массивы, строки, числа, `null`),
 * поэтому циклы и даты обрабатывать не нужно. Исходное значение не мутируется:
 * по ссылке на него живёт кеш.
 */
export function readOnlyCopy<T>(value: T): T {
  return turnOff(value) as T
}

function turnOff(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(turnOff)

  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const copy: Record<string, unknown> = {}

    for (const [key, item] of Object.entries(source)) {
      copy[key] = READ_ONLY_FLAGS.has(key) && item === true ? false : turnOff(item)
    }

    return copy
  }

  return value
}
