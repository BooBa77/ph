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
  /**
   * UUID чека с устройства (19.11.2026). По нему экран узнаёт, что
   * офлайн-чек уже доехал, и не рисует его второй раз. `null` — чек
   * заведён онлайн без очереди.
   */
  clientId?: string | null
}

export type CompensationStatus = 'pending' | 'confirmed'

/**
 * Вид перевода: обычная компенсация или залог за участие (18.11.2026).
 *
 * Залог идёт той же механикой, что компенсация, — «я перевёл» → «получено»;
 * отличается только подпись в ленте.
 */
export type CompensationKind = 'compensation' | 'deposit'

/** Строка компенсации: «должник перевёл кредитору». */
export interface TripCompensation {
  id: string
  createdAt: string
  fromUserId: string
  fromName: string
  toUserId: string
  toName: string
  amountRub: number
  kind: CompensationKind
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
  /**
   * Могу ли я позвать должников (24.11.2026): кнопка «Отправить уведомления
   * о компенсации» — организатору и соорганизатору, пока он в походе.
   */
  canRequestPayments: boolean
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

/**
 * Состояние залога участия (17.11.2026, v3 — 18.11.2026).
 *
 * `pending` — залог не покрыт, `held` — покрыт (расходами, переводами
 * или деньгами организатора), `returned` — вернули, `forfeited` — удержан.
 * Словарь общий с бэкендом (`DEPOSIT_STATUSES`); «залога нет» — это
 * `deposit === null`, а не отдельное состояние человека.
 *
 * С 18.11.2026 `held` — не отметка, а следствие покрытия: залог мог
 * покрыться расходами человека без единого перевода. Поэтому подписи
 * в блоке строятся по цифрам, а не по одному статусу.
 */
export const DEPOSIT_STATUSES = ['pending', 'held', 'returned', 'forfeited'] as const

export type DepositStatus = (typeof DEPOSIT_STATUSES)[number]

/**
 * Решение организатора по залогу отказавшегося: «покрыт» считается по
 * расходам и переводам, поэтому в решениях его нет.
 */
export type DepositDecision = 'pending' | 'returned' | 'forfeited'

/** Состояние залога одного участника (17.11.2026, v3 — 18.11.2026). */
export interface DepositParticipant {
  userId: string
  displayName: string
  avatarUrl: string | null
  status: DepositStatus
  /** `null` — отметку ещё не ставили: состояние по умолчанию. */
  updatedByName: string | null
  updatedAt: string | null
  isMe: boolean
  /** Сколько человек уже оплатил расходов похода — «вложился». */
  investedRub: number
  /** Сумма подтверждённых переводов залога. */
  transferredRub: number
  /** Переводы в пути: бронируют недостачу, но в покрытие не входят. */
  pendingRub: number
  /** `min(D, вложено + переведено)` — покрытая часть залога. */
  coveredRub: number
  /** `max(0, D − покрыто)` — сколько ещё не покрыто. */
  missingRub: number
  /** `max(0, недостача − в пути)` — сколько осталось перевести. */
  dueRub: number
  /** У кого залог на руках. `null` — ещё не передан. */
  holderName: string | null
  /** Человек отказался от похода: ради него секция риска и существует. */
  declined: boolean
  /** Перевод залога ждёт подтверждения получателем. */
  hasPendingTransfer: boolean
  /**
   * Есть что решать: у отказавшегося хоть что-то покрыто (`covered > 0`).
   * С 18.11.2026 это не зависит от `deposit_status`: залог мог покрыться
   * расходами, без единого перевода.
   */
  canDecide: boolean
}

/**
 * Мой залог: по нему экран решает, показывать ли «Перевести залог».
 *
 * С 18.11.2026 (v3) залог покрывается расходами человека, поэтому здесь
 * лежит весь расчёт с сервера: `investedRub`, `transferredRub`,
 * `pendingRub`, `coveredRub`/`missingRub` и `dueRub` — сколько осталось
 * перевести. Экран ничего не считает.
 */
export interface MyDeposit {
  status: DepositStatus
  amountRub: number
  /** Сколько я оплатил расходов похода. */
  investedRub: number
  /** Сколько подтверждённых переводов залога я сделал. */
  transferredRub: number
  /** Сколько я перевёл, но получатель ещё не подтвердил. */
  pendingRub: number
  /** Какая часть залога покрыта. */
  coveredRub: number
  /** Сколько ещё не покрыто. */
  missingRub: number
  /** Сколько осталось перевести: недостача минус уже отправленное. */
  dueRub: number
  /** Залог не покрыт, я в походе и есть кому перевести. */
  canTransfer: boolean
  /** Организатор держит свой залог сам — переводить не нужно. */
  selfHeld: boolean
  /** Кому уже передан. */
  holderName: string | null
  /** Мой перевод ждёт подтверждения. */
  hasPendingTransfer: boolean
}

/**
 * Кто может нажать «Я передал»: сам участник и люди без аккаунта,
 * которых он ведёт. У виртуального нет входа, поэтому залог за него
 * передаёт ведущий.
 *
 * `recipients` — свои для каждого отправителя: виртуальный платит
 * организатору, который его ведёт, а сам участник себе не переводит.
 */
export interface DepositSender {
  userId: string
  displayName: string
  isMe: boolean
  /** Сколько осталось перевести этому человеку: его недостача минус в пути. */
  dueRub: number
  recipients: DepositRecipient[]
}

/** Кому можно перевести залог: автор похода и соорганизаторы. */
export interface DepositRecipient {
  userId: string
  displayName: string
  role: 'organizer' | 'coOrganizer'
  /** Пол нужен подписи об отсутствии реквизитов: «не указал» / «не указала». */
  gender: 'm' | 'f'
  paymentDetails: string | null
  paymentBank: string | null
}

/**
 * Блок залога над «Движением денег». `null` в ответе — залога нет,
 * и блок не рисуется вовсе.
 *
 * `participants` — **не весь состав, а только риск** (18.11.2026):
 * отказавшиеся и не вложившие сумму залога. Приходит только организатору
 * и соорганизатору; рядовой участник видит свой залог в `me`.
 */
export interface TripDeposit {
  /** Сумма с человека, целые рубли. Одна на поход. */
  amountRub: number
  /** Решает судьбу залога автор похода или соорганизатор. */
  canManage: boolean
  /** Мой залог; `null` — меня нет в походе (например, я отказался). */
  me: MyDeposit | null
  /** Только риск: отказавшиеся и не вложившие сумму залога. */
  participants: DepositParticipant[]
  /** За кого смотрящий может передать залог. */
  senders: DepositSender[]
}

/**
 * Удержание залога в ленте «Движения денег» (18.11.2026).
 *
 * Удержание не двигает личные балансы: залог покрывает долю ушедшего.
 * Но в фонде группы появляются деньги, и лента объясняет, откуда плюс.
 */
export interface TripDepositForfeit {
  id: string
  at: string
  sourceUserId: string
  sourceName: string
  amountRub: number
}

/**
 * Возврат залога в ленте (18.11.2026).
 *
 * Запись удержания при возврате удаляется, но балансы меняются: доля
 * ушедшего расходится на идущих. Эта строка объясняет, почему у идущих
 * стало больше долга, а у ушедшего — больше кредита.
 */
export interface TripDepositReturn {
  id: string
  at: string
  sourceUserId: string
  sourceName: string
  /** Доля ушедшего, разошедшаяся на идущих. */
  amountRub: number
  shares: TripExpenseShare[]
}

/**
 * Деньги ушедшего в уведомлении о выходе (20.11.2026).
 *
 * `holdRub = min(залог, покрытие)` — сколько может удержать организатор;
 * `refundRub = max(0, покрытие − залог)` — сколько переведут человеку.
 * Оба нуля — о деньгах в уведомлении не говорим.
 */
export interface TripDepartureDeposit {
  amountRub: number
  coveredRub: number
  holdRub: number
  refundRub: number
}

/**
 * Ответ `GET /api/trips/:id/finance/departure` — уведомление при выходе.
 *
 * `gearTypes` — типы задействованного снаряжения: «взял», «несёт»,
 * «в палатке». Пустой массив — предупреждать не о чем.
 */
export interface TripDeparture {
  gearTypes: string[]
  /** Вложено (расходы плюс подтверждённый залог). 0 — о деньгах не говорим. */
  coveredRub: number
  deposit: TripDepartureDeposit | null
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
  /** Залог участия; `null` или поля нет — залога нет. */
  deposit?: TripDeposit | null
  /** Удержанные залоги: пополняют фонд группы и стоят в ленте. */
  depositForfeits?: TripDepositForfeit[]
  /** Возвраты залогов: объясняют пересборку долей в ленте. */
  depositReturns?: TripDepositReturn[]
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
  /**
   * UUID чека с устройства — ключ идемпотентности (19.11.2026).
   * Повторная отправка с тем же ключом не создаёт дубль.
   */
  clientId?: string
}

/**
 * Чек в очереди устройства (19.11.2026).
 *
 * Это тело обычного создания расхода плюс обязательный `clientId`: без
 * ключа синхронизация не отличила бы «ещё не отправляли» от «отправили,
 * но ответ не дошёл». Доли на экране — черновые, их считает сервер.
 */
export interface TripExpenseSyncEntry extends SaveTripExpenseInput {
  clientId: string
}

/** Итог одного чека в ответе синхронизации. */
export interface TripExpenseSyncResult {
  clientId: string
  status: 'accepted' | 'rejected'
  /** Почему чек не принят — только у `rejected`. */
  message?: string
}

/** Ответ `POST …/finance/expenses/sync`: вкладка целиком и итоги по чекам. */
export interface TripFinanceSync extends TripFinance {
  results: TripExpenseSyncResult[]
}

/**
 * Ответ `POST …/finance/payment-requests` (24.11.2026): вкладка целиком
 * и `notified` — скольким участникам ушло уведомление.
 */
export interface TripFinanceNotify extends TripFinance {
  /** Скольким ушло уведомление сейчас. */
  notified: number
  /**
   * Сколько должников нашлось всего. Больше `notified`, когда уведомление уже
   * лежало непрочитанным: второе не шлём, но и «некому» сказать нельзя.
   */
  recipients: number
}

/** Тело `POST /api/trips/:id/finance/compensations`. */
export interface CreateTripCompensationInput {
  toUserId: string
  amountRub: number
  /** Кто переводит; не передано — я. */
  fromUserId?: string
}
