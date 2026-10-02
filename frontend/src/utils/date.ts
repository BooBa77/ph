/**
 * Названия месяцев в родительном падеже — для формата «15 июня»,
 * а не «15 июнь». Русский язык требует именно родительного падежа
 * при указании дня месяца.
 *
 * Индекс 0 — январь, 11 — декабрь (как Date.getMonth()).
 */
const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const

/**
 * Форматировать дату рождения: '2000-06-15' → '15 июня'.
 *
 * Год намеренно не показываем: в проекте он фиктивный (2000),
 * используется только месяц и день. См. birth_date в User entity.
 *
 * При некорректном входе (null, пустая строка, невалидный формат)
 * возвращает '—' (прочерк). Так во всём UI: пустое = прочерк.
 */
export function formatBirthDate(iso: string | null): string {
  if (!iso) return '—'

  // Разбираем руками, а не через new Date() — чтобы избежать
  // сюрпризов с часовыми поясами. '2000-06-15' через new Date() может
  // дать '2000-06-14' в некоторых TZ (если интерпретируется как UTC
  // и потом сдвигается в локальное время).
  const parts = iso.split('-')
  if (parts.length !== 3) return '—'

  const month = Number(parts[1]) // 1–12
  const day = Number(parts[2]) // 1–31

  if (!Number.isInteger(month) || month < 1 || month > 12) return '—'
  if (!Number.isInteger(day) || day < 1 || day > 31) return '—'

  return `${day} ${MONTHS_GENITIVE[month - 1]}`
}

/**
 * Общий форматтер «пустое → прочерк».
 * Для строк и null.
 */
export function formatOrDash(value: string | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const trimmed = value.trim()
  return trimmed === '' ? '—' : trimmed
}