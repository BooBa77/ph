/**
 * Деньги словами: «1 234 ₽», «Вам должны 2 000 ₽», «11.11.2026».
 *
 * Вынесено из компонентов и покрыто тестом по той же причине, что
 * `gearWeight.ts`: ошибка в форматировании денег не бросается в глаза,
 * а читается как правильная цифра. Здесь живут три вещи, которые спрашивают
 * и вкладка, и обе модалки:
 *
 * - **рубли без копеек** — решение заказчика 12.11.2026, суммы целые;
 * - **знак баланса** — плюс значит «вам должны», минус — «вы должны»;
 * - **дата без времени** — трата живёт датой, а не моментом.
 */

/** Сумма в рублях: «12 000 ₽». Отрицательная — со знаком минус. */
export function formatRub(amount: number): string {
  const rounded = Math.trunc(amount)
  const sign = rounded < 0 ? '−' : ''
  const digits = Math.abs(rounded).toString()
  // Разряды по три: «1234567» → «1 234 567». Обычный пробел, а не
  // неразрывный: сумму переносить нельзя, и это делает `whitespace-nowrap`
  // на экране, а не невидимый символ в тексте.
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

  return `${sign}${grouped} ₽`
}

/** Сумма со знаком для списка балансов: «+2 000 ₽», «−1 000 ₽», «0 ₽». */
export function formatRubSigned(amount: number): string {
  const rounded = Math.trunc(amount)
  if (rounded === 0) return formatRub(0)

  return rounded > 0 ? `+${formatRub(rounded)}` : formatRub(rounded)
}

/**
 * Баланс одной фразой — то, что человек читает в шапке вкладки.
 *
 * Слова заказчика: «итоговый баланс пользователя». Знак без объяснения
 * читается как ошибка, поэтому положительный баланс подписан «Вам должны»,
 * отрицательный — «Вы должны».
 */
export function balancePhrase(balanceRub: number): string {
  const rounded = Math.trunc(balanceRub)

  if (rounded > 0) return `Вам должны ${formatRub(rounded)}`
  if (rounded < 0) return `Вы должны ${formatRub(-rounded)}`

  return 'Всё в расчёте'
}

/** Дата из `ГГГГ-ММ-ДД` или ISO-момента: «11.11.2026». */
export function formatDay(value: string): string {
  const day = value.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return ''

  const [year, month, date] = day.split('-')

  return `${date}.${month}.${year}`
}

/**
 * Сегодняшняя дата строкой `ГГГГ-ММ-ДД` — по местному календарю.
 *
 * Не `toISOString().slice(0, 10)`: тот отдаёт UTC, и в Иркутске (+8) вечером
 * 11-го числа форма расхода предлагала бы 11-е, хотя в UTC уже 12-е —
 * красиво для сервера и обидно для человека, который тратил деньги сегодня.
 * Аргумент — только для теста.
 */
export function localToday(now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')

  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * Сумма из поля формы: пусто — `null`, мусор — `undefined`.
 *
 * Три состояния, как у `parseWeightGrams`: «не заполнил» и «ввёл не то» —
 * разные вещи, и второе надо объяснить словами, а не отправить `NaN`.
 * Сумма расхода — целое число рублей больше нуля: и правило сервера,
 * и решение заказчика «округляем до рубля».
 */
export function parseRub(value: string | number): number | null | undefined {
  // Пробелы внутри суммы — это разряды («12 000»), их убираем. Всё
  // остальное, кроме цифр, — не рубли: «12.5» и «12,5» копеек не имеют,
  // а «1.000» человек прочитает как тысячу, Number — как единицу.
  const text = String(value).replace(/\s/g, '')
  if (text === '') return null
  if (!/^\d+$/.test(text)) return undefined

  const amount = Number(text)
  if (amount <= 0) return undefined

  return amount
}
