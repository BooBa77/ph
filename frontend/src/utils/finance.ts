import type { TripCompensation, TripExpense, TripFinance } from '@/types/finance'
import { formatRub } from '@/utils/money'

/**
 * Чистые функции «Бухгалтерии»: одна строка движения денег, подпись долей
 * и предварительный расчёт деления (12.11.2026).
 *
 * **Почему деление повторяется на фронте.** Считает его сервер
 * (`src/trips/finance.ts`), и в таблице показываются уже готовые доли.
 * Но модалке «Добавить расход» нужно показать, сколько получится **до**
 * сохранения: иначе человек узнаёт арифметику после записи. Копия правила
 * здесь неизбежна — и она держится тестом рядом, один в один с серверным:
 * рубли, остаток по рублю первым по составу.
 */

/** Участник, между которым делят расход в предварительном расчёте. */
export interface PreviewMember {
  userId: string
  displayName: string
}

/** Доля участника в предварительном расчёте. */
export interface PreviewShare {
  userId: string
  displayName: string
  amountRub: number
}

/**
 * Поделить сумму поровну в рублях, остаток — по рублю первым по составу.
 *
 * Копия `splitAmount` из бэкенда: 1000 на троих — 334, 333, 333. Порядок
 * `userIds` — это порядок состава похода, а не порядок галочек: от него
 * зависит, кому достанется рубль, и он должен совпадать с сервером.
 */
export function splitRub(amountRub: number, userIds: string[]): number[] {
  if (userIds.length === 0) return []

  const base = Math.floor(amountRub / userIds.length)
  let rest = amountRub - base * userIds.length

  return userIds.map(() => {
    const extra = rest > 0 ? 1 : 0
    rest -= extra

    return base + extra
  })
}

/** Доли участников для подсказки в модалке расхода. */
export function previewShares(amountRub: number, members: PreviewMember[]): PreviewShare[] {
  const amounts = splitRub(
    amountRub,
    members.map((member) => member.userId),
  )

  return members.map((member, index) => ({
    userId: member.userId,
    displayName: member.displayName,
    amountRub: amounts[index] ?? 0,
  }))
}

/**
 * Подсказка под формой расхода: «Поровну: 12 000 ₽ — по 2 000 ₽» или
 * «1 000 ₽: Анна 334 ₽, Борис 333 ₽, Вера 333 ₽».
 *
 * Когда доли равные, список из шести фамилий ничего не добавляет; когда
 * нет — он единственный способ увидеть, кому достанется рубль остатка.
 */
export function sharesPreview(amountRub: number, members: PreviewMember[]): string {
  const shares = previewShares(amountRub, members)

  if (shares.length === 0) return ''

  const first = shares[0]?.amountRub ?? 0

  if (shares.every((share) => share.amountRub === first)) {
    return `Поровну: ${formatRub(amountRub)} — по ${formatRub(first)}`
  }

  return `${formatRub(amountRub)}: ${shares
    .map((share) => `${share.displayName} ${formatRub(share.amountRub)}`)
    .join(', ')}`
}

/**
 * Подпись под расходом в таблице: «на всех · по 2 000 ₽» или
 * «Анна, Борис, Вера · по 500 ₽».
 *
 * **Почему «на» только у «всех» и «питающихся с общего».** Имена
 * в винительном падеже пришлось бы склонять, а «на Анна, Борис» читается
 * хуже, чем список имён. Смысл подписи — показать, на кого разделили
 * и по сколько вышло; предлог ничего к этому не добавляет.
 */
export function splitCaption(expense: TripExpense): string {
  const shares = expense.shares
  if (shares.length === 0) return 'ни на кого'

  const first = shares[0]?.amountRub ?? 0
  const perPerson = shares.every((share) => share.amountRub === first)
    ? `по ${formatRub(first)}`
    : shares.map((share) => formatRub(share.amountRub)).join(', ')

  if (expense.split === 'all') return `на всех · ${perPerson}`
  if (expense.split === 'commonEaters') return `на питающихся с общего · ${perPerson}`

  return `${shares.map((share) => share.displayName).join(', ')} · ${perPerson}`
}

/** Одна строка таблицы движения денег — расход или компенсация. */
export type MoneyRow =
  | { kind: 'expense'; key: string; at: string; expense: TripExpense }
  | { kind: 'compensation'; key: string; at: string; compensation: TripCompensation }

/**
 * Расходы и компенсации одной лентой, свежие сверху.
 *
 * Ключ сортировки у расхода — дата траты (`ГГГГ-ММ-ДД`), у компенсации —
 * момент создания. Сравнение строк работает: `2026-11-11` лексикографически
 * меньше `2026-11-11T18:00:00Z`, то есть перевод, созданный в этот день,
 * встанет выше траты того же дня. Внутри дня сохраняется порядок ответа
 * сервера (`id` по убыванию), стабильная сортировка его не ломает.
 */
export function movementRows(finance: TripFinance): MoneyRow[] {
  const rows: MoneyRow[] = [
    ...finance.expenses.map((expense) => ({
      kind: 'expense' as const,
      key: `expense-${expense.id}`,
      at: expense.spentAt,
      expense,
    })),
    ...finance.compensations.map((compensation) => ({
      kind: 'compensation' as const,
      key: `compensation-${compensation.id}`,
      at: compensation.createdAt,
      compensation,
    })),
  ]

  return rows.sort((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0))
}
