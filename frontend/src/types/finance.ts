/**
 * «Бухгалтерия» похода — контракт с API (12.11.2026).
 *
 * Повторяет `backend/src/trips/dto/trip-finance.dto.ts`: сервер уже отдаёт
 * готовые подписи, флаги прав и посчитанные балансы, и фронт **ничего
 * не пересчитывает**. Причина в `finance.md` §2.3: баланс — это «заплатил
 * минус доля плюс переводы», и вторая его копия на экране однажды разошлась
 * бы с сервером на рубль остатка от деления.
 */

/** Как делят расход. Словарь общий с бэкендом (`EXPENSE_SPLITS`). */
export const EXPENSE_SPLITS = ['all', 'group', 'commonEaters'] as const

export type ExpenseSplit = (typeof EXPENSE_SPLITS)[number]

/** Подписи сегментов модалки расхода. */
export const EXPENSE_SPLIT_LABELS: Record<ExpenseSplit, string> = {
  all: 'За всех',
  group: 'За группу',
  commonEaters: 'На питающихся с общего',
}

/** Доля участника в расходе: сумма с именем, чтобы таблица не собирала имя. */
export interface TripExpenseShare {
  userId: string
  displayName: string
  amountRub: number
}

/** Строка расхода: «кто-то заплатил за кого-то». */
export interface TripExpense {
  id: string
  /** Дата траты `ГГГГ-ММ-ДД`. */
  spentAt: string
  authorUserId: string
  authorName: string
  authorAvatarUrl: string | null
  amountRub: number
  description: string
  split: ExpenseSplit
  shares: TripExpenseShare[]
  /** Править и удалять может только автор — решает сервер. */
  canEdit: boolean
}

export type CompensationStatus = 'pending' | 'confirmed'

/** Строка компенсации: «должник перевёл кредитору». */
export interface TripCompensation {
  id: string
  createdAt: string
  fromUserId: string
  fromName: string
  toUserId: string
  toName: string
  amountRub: number
  status: CompensationStatus
  confirmedAt: string | null
  /** «Получено» — только у получателя и только у ожидающей. */
  canConfirm: boolean
  /** Отменить — только отправителю и только ожидающую. */
  canCancel: boolean
}

/** Участник похода с балансом и реквизитами. */
export interface FinanceMember {
  userId: string
  displayName: string
  avatarUrl: string | null
  /** Положительный — человеку должны. */
  balanceRub: number
  /** То же с учётом ожидающих компенсаций. */
  remainingRub: number
  /** Человек без аккаунта: за него платит и переводит ведущий. */
  isVirtual: boolean
  /** Этого человека без аккаунта веду я — ему можно записать платёж. */
  managedByMe: boolean
  paymentDetails: string | null
  paymentBank: string | null
}

/** Получатель внутри варианта компенсации: реквизиты и пол. */
export interface CompensationPerson {
  userId: string
  displayName: string
  /** Пол нужен подписи об отсутствии реквизитов: «не указал» / «не указала». */
  gender: 'm' | 'f'
  paymentDetails: string | null
  paymentBank: string | null
}

/**
 * Вариант «кому перевести» в модалке компенсации.
 *
 * С 12.11.2026 вариант — **семья целиком**: «Вася и Аня» одной строкой,
 * а сумма — `min(долг моей семьи, кредит этой семьи)` по общей кассе
 * (12.11.2026). Поэтому здесь список людей: реквизиты показываются у всех,
 * у кого они есть.
 */
export interface CompensationOption {
  /** Идущие получатели семьи — в порядке состава похода. */
  userIds: string[]
  displayName: string
  /** Не больше остатка общей кассы моей семьи и кассы этой. */
  amountRub: number
  members: CompensationPerson[]
}

/**
 * Общая касса семьи (12.11.2026) — расчёт для компенсации.
 *
 * Внутри семьи деньги не считаются по людям: плюс одного гасит минус
 * другого. С 13.11.2026 экран её **не показывает** — заказчик просил
 * балансы персонально; касса нужна серверу для подсказок перевода.
 */
export interface FinanceFamily {
  /** Идущие участники семьи — в порядке состава похода. */
  memberIds: string[]
  displayName: string
  /** Касса семьи: сумма балансов её участников. */
  balanceRub: number
  /** Та же касса с учётом ожидающих компенсаций. */
  remainingRub: number
  /** Семья смотрящего. */
  isMine: boolean
}

/** Мой баланс и подсказки — шапка вкладки. */
export interface MyFinance {
  /** Личный баланс — его и показывает карточка. */
  balanceRub: number
  /** Личный остаток с учётом ожидающих переводов. */
  remainingRub: number
  /** Касса моей семьи — расчёт компенсации, не для экрана. */
  familyBalanceRub: number
  /** Та же касса с учётом ожидающих переводов. */
  familyRemainingRub: number
  /** Долг всей моей семьи — от него считается сумма компенсации. */
  familyDebtRub: number
  /** Кредит всей моей семьи — по нему видно, есть ли кому переводить. */
  familyCreditRub: number
  /**
   * Могу ли я менять деньги: расход и компенсацию добавляет только идущий.
   * Если `false`, кнопки на экране выключены и объясняют почему.
   */
  canSpend: boolean
  suggestions: CompensationOption[]
}

/** Отправитель перевода, за которого может действовать смотрящий. */
export interface CompensationSender {
  userId: string
  displayName: string
  familyDebtRub: number
  familyCreditRub: number
  suggestions: CompensationOption[]
}

/** Ответ `GET /api/trips/:id/finance` — вся вкладка одним запросом. */
export interface TripFinance {
  expenses: TripExpense[]
  compensations: TripCompensation[]
  members: FinanceMember[]
  /** Общие кассы семей: одна строка на семью, а не на человека. */
  families: FinanceFamily[]
  me: MyFinance
  /** Люди без аккаунта, которых веду я: за них можно записать перевод. */
  managedSenders: CompensationSender[]
}

/**
 * Тело `POST/PATCH /api/trips/:id/finance/expenses`.
 *
 * Одна форма на создание и правку: модалка всегда отправляет все поля
 * целиком, иначе частичная правка суммы оставила бы доли от прежней.
 * `participantIds` нужен только для `split = 'group'`.
 */
export interface SaveTripExpenseInput {
  amountRub: number
  /** Для чека можно не передавать — сервер запишет «на продукты». */
  description?: string
  split: ExpenseSplit
  participantIds?: string[]
  /** `ГГГГ-ММ-ДД`; не передано — сервер ставит сегодня. */
  spentAt?: string
  /** Кто заплатил; не передано — я. */
  payerUserId?: string
}

/** Тело `POST /api/trips/:id/finance/compensations`. */
export interface CreateTripCompensationInput {
  toUserId: string
  amountRub: number
  /** Кто переводит; не передано — я. */
  fromUserId?: string
}
