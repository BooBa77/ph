<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { ApiError } from '@/api/errors'
import { subscribeTripEvents } from '@/api/events'
import type { TripEvent } from '@/api/events'
import {
  confirmTripCompensation,
  deleteTripCompensation,
  getTripFinance,
  requestTripPayments,
  setTripDepositStatus,
} from '@/api/finance'
import {
  pendingForLedger,
  pushExpenseOutbox,
  readExpenseOutbox,
  removeQueuedExpense,
  type ExpenseOutboxEntry,
} from '@/offline/expenseOutbox'
import { useAuthStore } from '@/stores/auth'
import { useOfflineStore } from '@/stores/offline'
import {
  type CompensationOption,
  type CompensationSender,
  type DepositDecision,
  type DepositStatus,
  type TripCompensation,
  type TripDepositForfeit,
  type TripDepositReturn,
  type TripExpense,
  type TripFinance,
} from '@/types/finance'
import {
  depositReturnCaption,
  depositStatusCaption,
  forfeitCaption,
  movementRows,
  splitCaption,
  type MoneyRow,
} from '@/utils/finance'
import { formatDay, formatRub, formatRubSigned } from '@/utils/money'
import TripChat from '@/views/trips/TripChat.vue'
import TripFinanceCompensationModal from '@/views/trips/TripFinanceCompensationModal.vue'
import TripFinanceDepositModal from '@/views/trips/TripFinanceDepositModal.vue'
import TripFinanceExpenseModal from '@/views/trips/TripFinanceExpenseModal.vue'

/**
 * Вкладка «Бухгалтерия» похода (09.11.2026, деньги — 12.11.2026).
 *
 * Заказчик: «Основная часть — это таблица движения денег. Колонки — {дата,
 * кто, сколько, за что, кнопка подтверждения}. Всем видны все записи, чтобы
 * была понятна арифметика. Строки с расходами редактируются авторами.
 * Итоговый баланс пользователя. И две кнопки — Добавить расход, Компенсация».
 *
 * **Арифметику считает сервер, экран её показывает.** `GET /finance` отдаёт
 * готовые балансы, остатки, доли и подсказки компенсации; вкладка ничего
 * не пересчитывает, иначе рубль остатка от деления разошёлся бы с сервером.
 * Каждая операция возвращает вкладку целиком — поэтому после сохранения,
 * подтверждения или отмены состояние заменяется одним ответом.
 *
 * **Баланс и «с учётом ожидающих» — две разные цифры.** Ожидающий перевод
 * баланс не двигает, но бронирует кредит: в примере заказчика у второго
 * должника остаётся один вариант, потому что первый уже занял кредит.
 * Поэтому вторая строка появляется только когда цифры разошлись.
 *
 * **Кнопка «Компенсация» выключена, если переводить нечего.** Это дешевле,
 * чем открыть модалку с пустым списком. Подписи-объяснения под балансом
 * (13.11.2026) убраны по слову заказчика: выключенной кнопки достаточно,
 * а правила семейного зачёта видно в самой модалке.
 *
 * **«Живой» поток — `scope = 'finance'`.** Канал событий на бэкенде один на
 * поход, поэтому сюда прилетают и события снаряжения; чужую вкладку экран
 * пропускает по `scope`. Своё действие тоже перечитывается: под одним
 * аккаунтом человек держит несколько вкладок браузера (13.11.2026), и вторая
 * из них иначе осталась бы со старым балансом — `actorId` не говорит, какая
 * именно вкладка сделала изменение.
 */
const props = defineProps<{ tripId: string }>()

const auth = useAuthStore()
const offline = useOfflineStore()
const meId = computed(() => auth.user?.id ?? '')

const finance = ref<TripFinance | null>(null)
const isLoading = ref(true)
const error = ref<string | null>(null)
const actionError = ref<string | null>(null)
const busyCompensation = ref<string | null>(null)

/**
 * Чеки, созданные без связи и ещё не доехавшие (19.11.2026).
 *
 * Живут в очереди устройства, а не в ответе сервера: показываем их в той же
 * ленте, но с подписью «не отправлено» и черновыми долями. Балансы сервер
 * их не считает — до синхронизации цифры в «Твоём балансе» не окончательные.
 */
const pendingExpenses = ref<ExpenseOutboxEntry[]>([])
const queuedNotice = ref<string | null>(null)

const expenseModalOpen = ref(false)
const editingExpense = ref<TripExpense | null>(null)
const compensationOpen = ref(false)
const depositTransferOpen = ref(false)

// ───────────────────────────── загрузка ─────────────────────────────

/** Версия ответа: поздний ответ за прошлый поход не должен перетереть новый. */
let viewVersion = 0

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback
}

async function load(): Promise<void> {
  isLoading.value = true
  error.value = null

  const tripId = props.tripId
  const version = ++viewVersion

  try {
    const view = await getTripFinance(tripId)
    const pending = await readExpenseOutbox(tripId)
    if (version !== viewVersion || tripId !== props.tripId) return

    finance.value = view
    pendingExpenses.value = pending
  } catch (problem) {
    if (version !== viewVersion) return

    error.value = messageOf(problem, 'Не удалось загрузить бухгалтерию похода')
    finance.value = null
  } finally {
    if (version === viewVersion) isLoading.value = false
  }

  // Очередь могла остаться с прошлого раза: связь есть — отправляем сразу.
  if (!isLoading.value && !offline.isOffline) void flushQueuedExpenses()
}

watch(() => props.tripId, load, { immediate: true })

/**
 * Отправить очередь офлайн-чеков, когда связь вернулась (19.11.2026).
 *
 * Запускает не только вкладка: очередь уходит и на старте приложения
 * (`App.vue`), потому что человек мог закрыть приложение с неотправленным
 * чеком. Здесь — чтобы лента и балансы обновились без перезахода.
 * Отказ сервера по отдельному чеку очередь уже разложила по причинам;
 * обрыв запроса просто оставляет всё как есть до следующего `online`.
 */
async function flushQueuedExpenses(): Promise<void> {
  if (isLoading.value) return

  try {
    const result = await pushExpenseOutbox(props.tripId)
    if (result === null) return

    if (result.view !== null) {
      // Ответ мутации новее любого GET, начатого до него.
      viewVersion += 1
      finance.value = result.view
      actionError.value = null
    }

    pendingExpenses.value = result.pending
    queuedNotice.value =
      result.pending.length === 0
        ? 'Чеки отправлены — доли и балансы пересчитаны.'
        : null
  } catch {
    // Связи нет или сервер недоступен: чеки остались в очереди.
  }
}

watch(
  () => offline.isOffline,
  (offlineNow) => {
    if (!offlineNow) void flushQueuedExpenses()
  },
)

// ───────────────────────────── живые обновления (SSE) ─────────────────────────────

/**
 * Перевод и подтверждение часто идут подряд — пауза склеивает серию
 * событий в один запрос, как у «Снаряжения».
 */
const LIVE_REFRESH_DELAY = 300

let stopLiveEvents: (() => void) | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null

function onLiveEvent(event: TripEvent): void {
  // Поток общий с «Снаряжением»: чужую вкладку не перечитываем.
  if (event.scope !== 'finance') return

  // `actorId` не различает вкладки: своё действие в другой вкладке того же
  // аккаунта тоже должно обновить экран, иначе человек видит старый баланс
  // после смены питания или подтверждения перевода. Лишний один GET после
  // собственной мутации дешевле, чем расходящиеся цифры (13.11.2026).
  if (refreshTimer !== null) return

  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void refreshQuietly()
  }, LIVE_REFRESH_DELAY)
}

/**
 * Перечитать вкладку, не показывая «Загружаем…».
 *
 * Ошибку глотаем: живые обновления — удобство, а не данные. Следующее
 * событие или перезагрузка страницы попробует снова; красная плашка посреди
 * работы из-за чужого перевода только мешала бы.
 */
async function refreshQuietly(): Promise<void> {
  if (isLoading.value) return

  const tripId = props.tripId
  const version = ++viewVersion

  try {
    const view = await getTripFinance(tripId)
    if (version !== viewVersion || tripId !== props.tripId || isLoading.value) return

    finance.value = view
    pendingExpenses.value = await readExpenseOutbox(tripId)
    error.value = null
  } catch {
    // Молча — по той же причине.
  }
}

watch(
  () => props.tripId,
  (tripId) => {
    stopLiveEvents?.()
    stopLiveEvents = subscribeTripEvents(tripId, onLiveEvent, 'finance')
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  stopLiveEvents?.()
  stopLiveEvents = null

  if (refreshTimer !== null) clearTimeout(refreshTimer)
  refreshTimer = null
})

// ───────────────────────────── шапка: баланс и кнопки ─────────────────────────────

const me = computed(() => finance.value?.me ?? null)

/** Менять деньги может только идущий участник — так решил сервер. */
const canSpend = computed(() => finance.value?.me.canSpend === true)

/**
 * Добавлять чек можно и без связи (19.11.2026).
 *
 * Офлайн-копия гасит `canSpend`, потому что сервер не подтвердил права
 * (`offline/readOnly.ts`). Но чек без связи — разрешённое действие:
 * он ложится в очередь, а права перепроверит сервер при отправке.
 * Компенсации и залог офлайн по-прежнему недоступны — это банк.
 */
const canAddExpense = computed(() => canSpend.value || offline.isOffline)

const suggestions = computed<CompensationOption[]>(
  () => finance.value?.me.suggestions ?? [],
)

/**
 * От кого можно переводить: я и люди без аккаунта, которых я веду.
 *
 * За виртуального нет входа, поэтому платёж и перевод за него записывает
 * участник похода. У семьи отдельного выбора нет — «на пользователя
 * всё вешаем»: родные входят сами.
 */
const senders = computed<CompensationSender[]>(() => {
  if (finance.value === null) return []

  return [
    {
      userId: meId.value,
      displayName: 'Я',
      familyDebtRub: finance.value.me.familyDebtRub,
      familyCreditRub: finance.value.me.familyCreditRub,
      suggestions: suggestions.value,
    },
    ...(finance.value.managedSenders ?? []),
  ]
})

/**
 * «Компенсация» открывается, когда переводить есть кому **хоть у одного
 * из доступных отправителей**.
 *
 * Отправителей два вида, и оба важны (13.11.2026):
 *
 * - **я как семья** — у родных общая касса, поэтому личный плюс не мешает
 *   кнопке: у папы +1 000, у сына −1 500, касса семьи −500 — папа платит
 *   за сына;
 * - **мой человек без аккаунта** — его кошелёк отдельный: у меня +1 000,
 *   у Дяди Вити −500 — я перевожу за Дядю Витю.
 */
const canCompensate = computed(
  () => canSpend.value && senders.value.some((sender) => sender.suggestions.length > 0),
)

/**
 * «Отправить уведомления о компенсации» — организатору и соорганизатору
 * (24.11.2026). Право считает сервер (`me.canRequestPayments`), кнопка лишь
 * показывает его: спрятанная кнопка — не запрет.
 */
const canRequestPayments = computed(() => finance.value?.me.canRequestPayments === true)

/** Сколько уведомлений ушло — или почему не ушло ни одного. */
const paymentsNotice = ref<string | null>(null)

/** Кнопка отправки уведомлений занята: второй клик ничего не делает. */
const busyPayments = ref(false)

const balanceClass = computed(() => {
  const balance = finance.value?.me.balanceRub ?? 0

  if (balance > 0) return 'text-emerald-700'
  if (balance < 0) return 'text-red-600'

  return 'text-text'
})

/**
 * Баланс — цифрой со знаком, а не фразой «Вы должны».
 *
 * Заказчик 12.11.2026: «не нужно это некрасивое ВЫ ДОЛЖНЫ, пусть будет
 * в одну строку „Ваш баланс“ + красный 500 р». Знак и цвет говорят то же
 * самое, и строка не разъезжается на две.
 *
 * **Цифра личная, а не семейная (13.11.2026).** Заказчик: «отображать кассу
 * семьи не очень идея… в балансе и движении средств отображать персонально.
 * Если A и B — семья, у B всё равно баланс должен отображаться −500 ₽.
 * Людям глазами трудно считать с учётом этих семейных нюансов». Семейный
 * зачёт остаётся только в компенсациях: там он и нужен — кто кому платит.
 */
const balanceText = computed(() =>
  formatRubSigned(finance.value?.me.balanceRub ?? 0),
)

/** Вторая цифра нужна только когда ожидающие переводы её сдвинули. */
const hasRemainingShift = computed(
  () =>
    finance.value !== null &&
    finance.value.me.remainingRub !== finance.value.me.balanceRub,
)

// ───────────────────────────── залог участия ─────────────────────────────

/**
 * Залог участия (17.11.2026, v3 — 18.11.2026).
 *
 * Заказчик: «Мне не нравится блок „Залог“, у рядового участника это лишнее.
 * Перенесём это всё в блок „Баланс“, сверху информация „В походе установлен
 * залог — 200 руб“, и если участник не потратился на сумму залога, то
 * доступна кнопка „Перевести залог“». Поэтому отдельного блока у рядового
 * участника больше нет: строка и кнопка живут в «Твоём балансе».
 *
 * **Залог покрывается расходами.** `covered = min(D, invested +
 * transferred)` считает сервер: если человек уже оплатил расходов на сумму
 * залога, отдельные 200 ₽ он не переводит. Переводить можно только
 * недостачу, частями; в модалке сумма подставлена, её можно менять, в том
 * числе в бо́льшую сторону.
 *
 * **Секция риска — только организатору и соорганизатору.** В ней ушедшие
 * с ненулевым покрытием (решить, вернуть залог или удержать) и идущие,
 * которые не добрали залог: «залог не покрыт».
 * Ушедшего с нулём нет вовсе — решать нечего. Кнопки «Снять» больше нет:
 * только «Вернуть» и «Удержать».
 */
const deposit = computed(() => finance.value?.deposit ?? null)

/** Мой залог: покрытие и кнопка «Перевести залог» в «Твоём балансе». */
const myDeposit = computed(() => deposit.value?.me ?? null)

/** Есть кого/за кого передать залог: я или мой человек без аккаунта. */
const canSendDeposit = computed(() => (deposit.value?.senders.length ?? 0) > 0)

/** Секцию риска видит организатор и соорганизатор. */
const canManageDeposit = computed(() => deposit.value?.canManage === true)

/** Только риск: отказавшиеся и не вложившие сумму залога. */
const depositRisk = computed(() => deposit.value?.participants ?? [])

/** Какая строка сейчас отправляет запрос — чтобы не нажимали дважды. */
const busyDeposit = ref<string | null>(null)

/** Цвет состояния: не покрыт — внимание, покрыт — хорошо, остальное нейтрально. */
const DEPOSIT_CLASS: Record<DepositStatus, string> = {
  pending: 'text-orange-700',
  held: 'text-emerald-700',
  returned: 'text-muted',
  forfeited: 'text-red-600',
}

async function markDeposit(
  userId: string,
  status: DepositDecision,
): Promise<void> {
  if (busyDeposit.value !== null) return

  busyDeposit.value = userId
  actionError.value = null

  try {
    applyView(await setTripDepositStatus(props.tripId, userId, status))
  } catch (problem) {
    actionError.value = messageOf(problem, 'Не удалось сохранить решение по залогу')
  } finally {
    busyDeposit.value = null
  }
}

// ───────────────────────────── таблица движения денег ─────────────────────────────

/**
 * Строка для экрана: всё, что нужно разметке, уже посчитано.
 *
 * Так шаблон не разбирается с объединением «расход или компенсация»
 * в каждом углу, а действия получают исходную запись и её флаги прав.
 */
interface MoneyRowView {
  key: string
  kind: 'expense' | 'compensation' | 'deposit' | 'depositReturn' | 'pendingExpense'
  /** Ключ сортировки: дата траты или момент записи. */
  at: string
  day: string
  who: string
  amountRub: number
  description: string
  caption: string
  status: 'pending' | 'confirmed' | null
  canEdit: boolean
  canConfirm: boolean
  canCancel: boolean
  expense: TripExpense | null
  compensation: TripCompensation | null
  forfeit: TripDepositForfeit | null
  returned: TripDepositReturn | null
  /** Чек из очереди устройства: править его нельзя, только убрать. */
  pending?: ExpenseOutboxEntry | null
}

/**
 * Подпись стороны перевода — **конкретный человек** (13.11.2026).
 *
 * Заказчик: «в балансе и движении средств отображать персонально». Семейный
 * зачёт остаётся в компенсациях (кто и с кем рассчитывается), но в ленте
 * человек видит имена: «Пётр → Григорий», даже если Пётр платил из общей
 * кассы семьи. Иначе приходилось бы в уме раскладывать семейные плюсы
 * и минусы, а этого заказчик как раз и просил не делать.
 */
function toView(row: MoneyRow): MoneyRowView {
  if (row.kind === 'expense') {
    return {
      key: row.key,
      kind: 'expense',
      at: row.at,
      day: formatDay(row.at),
      who: row.expense.authorName,
      amountRub: row.expense.amountRub,
      description: row.expense.description,
      caption: splitCaption(row.expense),
      status: null,
      canEdit: row.expense.canEdit,
      canConfirm: false,
      canCancel: false,
      expense: row.expense,
      compensation: null,
      forfeit: null,
      returned: null,
    }
  }

  if (row.kind === 'deposit') {
    // Удержание залога — не расход и не перевод: деньги остаются в фонде
    // группы. Ни правки, ни подтверждения у строки нет.
    return {
      key: row.key,
      kind: 'deposit',
      at: row.at,
      day: formatDay(row.at),
      who: row.forfeit.sourceName,
      amountRub: row.forfeit.amountRub,
      description: 'Залог удержан',
      caption: forfeitCaption(),
      status: null,
      canEdit: false,
      canConfirm: false,
      canCancel: false,
      expense: null,
      compensation: null,
      forfeit: row.forfeit,
      returned: null,
    }
  }

  if (row.kind === 'depositReturn') {
    // Возврат: запись удержания уже снята, но доли идущих изменились.
    // Строка объясняет, откуда у них прибавился долг, а у ушедшего —
    // кредит. Действий у неё нет: это следствие решения организатора.
    return {
      key: row.key,
      kind: 'depositReturn',
      at: row.at,
      day: formatDay(row.at),
      who: row.returned.sourceName,
      amountRub: row.returned.amountRub,
      description: 'Залог возвращён',
      caption: depositReturnCaption(row.returned),
      status: null,
      canEdit: false,
      canConfirm: false,
      canCancel: false,
      expense: null,
      compensation: null,
      forfeit: null,
      returned: row.returned,
    }
  }

  const compensation = row.compensation

  return {
    key: row.key,
    kind: 'compensation',
    at: row.at,
    day: formatDay(row.at),
    who: `${compensation.fromName} → ${compensation.toName}`,
    amountRub: compensation.amountRub,
    // Залог — тот же перевод, но подпись честно говорит, что это залог,
    // а не расчёт по долгам.
    description:
      compensation.kind === 'deposit' ? 'Залог за участие' : '',
    caption: '',
    status: compensation.status,
    canEdit: false,
    canConfirm: compensation.canConfirm,
    canCancel: compensation.canCancel,
    expense: null,
    compensation,
    forfeit: null,
    returned: null,
  }
}

/**
 * Офлайн-чек в ленте: те же колонки, но действий правки нет.
 *
 * Сумма — настоящая (её человек ввёл), а доли — черновые: их посчитает
 * сервер по составу на момент отправки. Подпись честно это говорит,
 * а если сервер отказал — вместо неё причина отказа.
 */
function pendingToView(entry: ExpenseOutboxEntry): MoneyRowView {
  const payer = entry.payerUserId
  const member =
    payer === undefined
      ? undefined
      : finance.value?.members.find((item) => item.userId === payer)
  const who =
    payer === undefined || payer === meId.value
      ? 'Я'
      : (member?.displayName ?? 'Плательщик')

  return {
    key: `pending-${entry.clientId}`,
    kind: 'pendingExpense',
    at: entry.spentAt,
    day: formatDay(entry.spentAt),
    who,
    amountRub: entry.amountRub,
    description: entry.description ?? 'на продукты',
    caption: entry.error ?? 'доли уточнятся при отправке',
    status: null,
    canEdit: false,
    canConfirm: false,
    canCancel: false,
    expense: null,
    compensation: null,
    forfeit: null,
    returned: null,
    pending: entry,
  }
}

const rows = computed<MoneyRowView[]>(() => {
  if (finance.value === null) return []

  const server = movementRows(finance.value).map(toView)
  const pending = pendingForLedger(
    finance.value.expenses,
    pendingExpenses.value,
  ).map(pendingToView)

  // Один список, свежие сверху: офлайн-чек встаёт на своё место по дате,
  // а не отдельным блоком над лентой.
  return [...server, ...pending].sort((left, right) =>
    left.at < right.at ? 1 : left.at > right.at ? -1 : 0,
  )
})

// ───────────────────────────── действия ─────────────────────────────

/** Модалки и операции меняют вкладку целиком — так отвечает сервер. */
function applyView(view: TripFinance): void {
  // Ответ мутации новее любого GET, начатого до неё: иначе поздний ответ
  // тихого обновления перетёр бы свежие цифры старыми.
  viewVersion += 1

  finance.value = view
  actionError.value = null
  paymentsNotice.value = null
  expenseModalOpen.value = false
  editingExpense.value = null
  compensationOpen.value = false
  depositTransferOpen.value = false
}

function openNewExpense(): void {
  if (!canAddExpense.value) return

  editingExpense.value = null
  expenseModalOpen.value = true
}

/**
 * Чек сохранён без связи (19.11.2026).
 *
 * Модалка уже закрывается сама; здесь — сразу показать чек в ленте
 * и сказать словами, что он уйдёт при связи. Балансы при этом не двигаем:
 * их считает сервер, а черновик на экране выдал бы себя за правду.
 */
function onQueued(entries: ExpenseOutboxEntry[]): void {
  pendingExpenses.value = entries
  queuedNotice.value =
    'Чек сохранён на устройстве. Уйдёт, когда появится связь.'
  expenseModalOpen.value = false
  editingExpense.value = null
}

/** Убрать офлайн-чек из очереди: человек передумал или сервер отказал. */
async function removePending(entry: ExpenseOutboxEntry): Promise<void> {
  pendingExpenses.value = await removeQueuedExpense(props.tripId, entry.clientId)
  if (pendingExpenses.value.length === 0) queuedNotice.value = null
}

function openEdit(row: MoneyRowView): void {
  if (row.expense === null || !row.expense.canEdit) return

  editingExpense.value = row.expense
  expenseModalOpen.value = true
}

/**
 * Открыть «Компенсацию» — предварительно перечитав вкладку.
 *
 * 12.11.2026 заказчик получил «Вам не нужно ничего компенсировать», хотя
 * на экране был долг и в модалке предложение: вкладка держала подсказки
 * с прошлой загрузки, а записи к этому моменту уже изменились. Один тихий
 * GET перед открытием дешевле, чем объяснять человеку противоречие.
 */
async function openCompensation(): Promise<void> {
  if (!canCompensate.value) return

  await refreshQuietly()

  if (!canCompensate.value) {
    actionError.value = 'Ты никому не должен.'
    return
  }

  compensationOpen.value = true
}

/**
 * Сервер отказал компенсации (400) — значит, подсказки устарели между
 * открытием модалки и нажатием. Перечитываем вкладку: следующая попытка
 * пойдёт от правды, а баланс на экране перестанет врать.
 */
function onCompensationStale(): void {
  void refreshQuietly()
}

/**
 * «Перевести залог» (18.11.2026).
 *
 * Перед открытием перечитываем вкладку: залог мог быть покрыт расходами
 * или переведён с другого устройства, и модалка предложила бы отправить
 * деньги второй раз.
 */
async function openDepositTransfer(): Promise<void> {
  if (!canSendDeposit.value) return

  await refreshQuietly()

  if (!canSendDeposit.value) {
    actionError.value = 'Залог уже покрыт или ждёт подтверждения.'
    return
  }

  depositTransferOpen.value = true
}

/** Залог отметили, пока модалка была открыта: перечитываем вкладку. */
function onDepositStale(): void {
  void refreshQuietly()
}

async function confirmCompensation(compensation: TripCompensation): Promise<void> {
  if (busyCompensation.value !== null) return

  busyCompensation.value = compensation.id
  actionError.value = null

  try {
    applyView(await confirmTripCompensation(props.tripId, compensation.id))
  } catch (problem) {
    actionError.value = messageOf(problem, 'Не удалось подтвердить получение')
  } finally {
    busyCompensation.value = null
  }
}

/**
 * Отмена ожидающего перевода. Без второго нажатия: запись не окончательная,
 * её можно завести снова, а перевод «на обратной дороге» отменяют на ходу.
 */
async function cancelCompensation(compensation: TripCompensation): Promise<void> {
  if (busyCompensation.value !== null) return

  busyCompensation.value = compensation.id
  actionError.value = null

  try {
    applyView(await deleteTripCompensation(props.tripId, compensation.id))
  } catch (problem) {
    actionError.value = messageOf(problem, 'Не удалось отменить компенсацию')
  } finally {
    busyCompensation.value = null
  }
}

function confirmRow(row: MoneyRowView): void {
  if (row.compensation !== null) void confirmCompensation(row.compensation)
}

function cancelRow(row: MoneyRowView): void {
  if (row.compensation !== null) void cancelCompensation(row.compensation)
}

/**
 * Позвать должников уведомлениями (24.11.2026).
 *
 * Заказчик: кнопка «Отправить уведомления о компенсации» — участникам
 * с отрицательным балансом, а при установленном залоге ещё и с нулевым
 * уходит личное сообщение «Организатор запросил платёж по походу …»
 * с кнопкой «Перейти» в эту вкладку. Ответ сервера — вкладка целиком,
 * поэтому применяем его как обычную мутацию; `notified` говорит, скольким
 * ушло: при пустом списке должников молчание выглядело бы поломкой.
 */
async function requestPaymentsSend(): Promise<void> {
  if (busyPayments.value) return

  busyPayments.value = true
  actionError.value = null
  paymentsNotice.value = null

  try {
    const view = await requestTripPayments(props.tripId)
    applyView(view)

    // Три исхода, и все три видны словами: ушло N; уведомления уже лежали
    // непрочитанными (повтор не плодим); должников нет вовсе.
    paymentsNotice.value =
      view.notified > 0
        ? `Уведомления отправлены: ${view.notified}.`
        : view.recipients > 0
          ? 'Уведомления уже отправлены — повторно не шлём.'
          : 'Должников нет — отправлять некому.'
  } catch (problem) {
    actionError.value = messageOf(
      problem,
      'Не удалось отправить уведомления о компенсации',
    )
  } finally {
    busyPayments.value = false
  }
}
</script>

<template>
  <section class="flex flex-col gap-3" data-test="trip-finance">
    <p v-if="isLoading" class="text-sm text-muted" data-test="finance-loading">
      Загружаем бухгалтерию…
    </p>

    <p v-else-if="error" class="text-sm text-muted" data-test="finance-error">{{ error }}</p>

    <template v-else-if="finance && me">
      <!--
        «Твой баланс» — первое, что человек ищет в этой вкладке. Цифра стоит
        в той же строке: «Вы должны 500 ₽» заказчик забраковал — знак и цвет
        говорят то же самое короче. Цифра **личная**: семейный зачёт виден
        только в компенсациях. Вторая строка появляется, только когда
        ожидающие переводы сдвинули цифру.
      -->
      <div class="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="flex flex-col gap-1">
            <div class="flex flex-wrap items-baseline gap-x-2">
              <h2 class="text-xs text-muted" data-test="finance-card-title">Твой баланс</h2>
              <p
                class="text-2xl font-semibold whitespace-nowrap"
                :class="balanceClass"
                data-test="finance-balance"
              >
                {{ balanceText }}
              </p>
            </div>
            <p
              v-if="hasRemainingShift"
              class="text-xs text-muted"
              data-test="finance-remaining"
            >
              С учётом ожидающих — {{ formatRub(me.remainingRub) }}
            </p>
          </div>

          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!canAddExpense"
              data-test="finance-add-expense"
              @click="openNewExpense"
            >
              Добавить чек
            </button>

            <!--
              «Компенсация» прячется, когда переводить нечего (17.11.2026):
              заказчик: «Кнопку Компенсация тоже можно скрывать если
              в положительном балансе». Семейный долг и долг человека без
              аккаунта кнопку сохраняют — за них платить есть кому.
            -->
            <button
              v-if="canCompensate"
              type="button"
              class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              data-test="finance-compensate"
              @click="openCompensation"
            >
              Компенсация
            </button>

            <!--
              «Отправить уведомления о компенсации» (24.11.2026) — только
              организатору и соорганизатору. Зовёт должников в личку:
              у отрицательного баланса всегда, у нулевого — если в походе
              установлен залог.
            -->
            <button
              v-if="canRequestPayments"
              type="button"
              class="cursor-pointer rounded-xl border border-border bg-surface px-3 py-1.5 text-sm text-text transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="busyPayments"
              data-test="finance-request-payments"
              @click="requestPaymentsSend"
            >
              Отправить уведомления о компенсации
            </button>
          </div>
        </div>

        <p
          v-if="paymentsNotice"
          class="text-xs text-muted"
          data-test="finance-payments-notice"
        >
          {{ paymentsNotice }}
        </p>

        <!--
          Залог участия (v3, 18.11.2026) — больше не отдельный блок:
          заказчик просил перенести его в «Твой баланс». Сверху — сумма,
          ниже — покрытие: залог считается закрытым расходами человека,
          и переводить нужно только недостачу. Кнопка есть, пока недостача
          не закрыта (в том числе у организатора — за виртуальных друзей).
        -->
        <div
          v-if="deposit"
          class="flex flex-col gap-1 border-t border-border pt-2"
          data-test="finance-deposit-self"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm text-text" data-test="finance-deposit-self-text">
              В походе установлен залог —
              <span class="font-medium">{{ formatRub(deposit.amountRub) }}</span>
            </p>

            <button
              v-if="canSendDeposit"
              type="button"
              class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90"
              data-test="finance-deposit-transfer"
              @click="openDepositTransfer"
            >
              Перевести залог
            </button>
          </div>

          <!--
            У организатора (selfHeld) второй строки нет вовсе: его залог
            и так у него, объяснять нечего. У остальных — нейтральные цифры
            без рода: «вложено · переведено · не хватает», чтобы одна и та же
            строка годилась и мужчине, и женщине.
          -->
          <p
            v-if="myDeposit && !myDeposit.selfHeld"
            class="text-xs text-muted"
            data-test="finance-deposit-self-details"
          >
            вложено {{ formatRub(myDeposit.investedRub) }}
            <template v-if="myDeposit.transferredRub > 0">
              · переведено {{ formatRub(myDeposit.transferredRub) }}
            </template>
            <template v-if="myDeposit.missingRub > 0 && myDeposit.coveredRub > 0">
              ·
              <span
                class="font-medium text-orange-700"
                data-test="finance-deposit-self-missing"
                >не хватает {{ formatRub(myDeposit.missingRub) }}</span
              >
            </template>
            <span
              v-if="myDeposit.missingRub === 0"
              class="font-medium text-emerald-700"
              data-test="finance-deposit-self-covered"
              >залог покрыт</span
            >
            <template v-if="myDeposit.hasPendingTransfer">
              · в пути {{ formatRub(myDeposit.pendingRub) }}, ждёт подтверждения
            </template>
            <template v-if="myDeposit.holderName && myDeposit.transferredRub > 0">
              · держит {{ myDeposit.holderName }}
            </template>
          </p>
        </div>

        <p v-if="actionError" class="text-sm text-red-600" data-test="finance-action-error">
          {{ actionError }}
        </p>

        <!--
          Чек, сохранённый без связи (19.11.2026): сначала он живёт только
          на устройстве. Говорим это словами, чтобы человек не искал его
          в ленте у остальных и не считал балансы окончательными.
        -->
        <p
          v-if="queuedNotice"
          class="text-xs text-muted"
          data-test="finance-queued-notice"
        >
          {{ queuedNotice }}
        </p>

        <!--
          Балансы — по людям, как в жизни: у каждого своя цифра. Семейный
          зачёт существует только в компенсациях, где он и нужен.
        -->
        <div class="border-t border-border pt-2">
          <h3 class="text-xs text-muted">Балансы</h3>
          <ul class="flex flex-wrap gap-x-3 gap-y-1 text-sm" data-test="finance-members">
            <li
              v-for="person in finance.members"
              :key="person.userId"
              class="flex items-baseline gap-1"
              data-test="finance-member"
            >
              <span class="text-text">{{ person.displayName }}</span>
              <span
                class="whitespace-nowrap font-medium"
                :class="
                  person.balanceRub > 0
                    ? 'text-emerald-700'
                    : person.balanceRub < 0
                      ? 'text-red-600'
                      : 'text-muted'
                "
                >{{ formatRubSigned(person.balanceRub) }}</span
              >
            </li>
          </ul>
        </div>
      </div>

      <!--
        Секция риска залога (17.11.2026, v3 — 18.11.2026) — только
        организатору и соорганизатору, **над** «Движением денег».
        Заказчик: «тех, кто вложился в поход свыше залога, не нужны…
        экономим пространство». Поэтому в списке только ушедшие с ненулевым
        покрытием (решить, вернуть залог или удержать) и идущие, которые
        не добрали залог — «залог не покрыт». Правой колонки подсказок нет:
        «переводит сам участник» и «решать нечего» убраны 18.11.2026 — в строке
        остались имя, «отказался», статус и нейтральные цифры.
        Ушедший с нулём не показывается вовсе: решать нечего. Кнопки
        «Снять» и «Сдал/не сдал» убраны — сдачу подтверждает получатель
        перевода, а из решения остались только «Вернуть» и «Удержать».
      -->
      <div
        v-if="deposit && canManageDeposit"
        class="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4"
        data-test="finance-deposit"
      >
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h2 class="text-xs text-muted" data-test="finance-deposit-title">
            Залог участия
          </h2>
          <p class="text-sm font-medium text-text" data-test="finance-deposit-amount">
            {{ formatRub(deposit.amountRub) }} с человека
          </p>
        </div>

        <p
          v-if="depositRisk.length === 0"
          class="text-xs text-muted"
          data-test="finance-deposit-clear"
        >
          Риска нет: все либо вложились в поход не меньше залога, либо перевели
          его.
        </p>

        <ul
          v-else
          class="flex flex-col divide-y divide-border"
          data-test="finance-deposit-list"
        >
          <li
            v-for="person in depositRisk"
            :key="person.userId"
            class="flex flex-wrap items-center justify-between gap-2 py-1.5"
            data-test="finance-deposit-person"
          >
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <p class="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span class="text-text">{{ person.displayName }}</span>
                <span v-if="person.isMe" class="text-xs text-muted">это ты</span>
                <span v-if="person.declined" class="text-xs font-medium text-red-600">
                  отказался
                </span>
                <span
                  class="text-xs font-medium"
                  :class="DEPOSIT_CLASS[person.status]"
                  :data-test="`finance-deposit-status-${person.status}`"
                  >{{ depositStatusCaption(person, deposit.amountRub) }}</span
                >
                <span v-if="person.hasPendingTransfer" class="text-xs text-muted">
                  · ждёт подтверждения
                </span>
              </p>
              <p class="text-xs text-muted" data-test="finance-deposit-invested">
                <template v-if="person.declined">
                  вложено {{ formatRub(person.investedRub) }} · переведено
                  {{ formatRub(person.transferredRub) }} · покрыто
                  {{ formatRub(person.coveredRub) }} из
                  {{ formatRub(deposit.amountRub) }}
                </template>
                <template v-else>
                  вложено {{ formatRub(person.investedRub) }}
                  <template v-if="person.transferredRub > 0">
                    · переведено {{ formatRub(person.transferredRub) }}
                  </template>
                  <template v-if="person.missingRub > 0 && person.coveredRub > 0">
                    · не хватает {{ formatRub(person.missingRub) }}
                  </template>
                </template>
                <template v-if="person.holderName">
                  · держит {{ person.holderName }}
                </template>
              </p>
            </div>

            <!--
              Флаг решения — два сегмента, без «Снять»: заказчик просил
              оставить только «Вернуть» и «Удержать». Решать есть что,
              когда у ушедшего хоть что-то покрыто: залог мог покрыться
              расходами, без единого перевода.
            -->
            <div
              v-if="person.declined && person.canDecide"
              class="flex flex-wrap items-center gap-1"
            >
              <div
                class="inline-flex overflow-hidden rounded-xl border border-border"
                data-test="finance-deposit-flag"
              >
                <button
                  type="button"
                  class="cursor-pointer px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  :class="
                    person.status === 'returned'
                      ? 'bg-primary text-white'
                      : 'text-text hover:bg-surface'
                  "
                  :disabled="busyDeposit !== null"
                  data-test="finance-deposit-return"
                  @click="markDeposit(person.userId, 'returned')"
                >
                  Вернуть
                </button>
                <button
                  type="button"
                  class="cursor-pointer border-l border-border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  :class="
                    person.status === 'forfeited'
                      ? 'bg-red-600 text-white'
                      : 'text-text hover:bg-surface'
                  "
                  :disabled="busyDeposit !== null"
                  data-test="finance-deposit-forfeit"
                  @click="markDeposit(person.userId, 'forfeited')"
                >
                  Удержать
                </button>
              </div>
            </div>
          </li>
        </ul>

        <p
          v-if="(finance.depositForfeits?.length ?? 0) > 0"
          class="text-xs text-muted"
          data-test="finance-deposit-effect"
        >
          Удержанный залог остаётся в фонде группы и виден в «Движении денег».
        </p>
      </div>

      <!--
        Таблица движения денег — «лист ведомости» (13.11.2026).
        Заказчик: «только Движение денег, хочу, чтобы она выглядела как лист
        ведомости». Поэтому без скруглений, бумажная заливка и плотная
        почти чёрная окантовка — токенами `--theme-paper` / `--theme-ink`
        (`themes.css`), а не хардкодом: у каждой сезонной темы своя бумага.
        Карточки баланса выше остались прежними — расхождение «из разных
        эпох» осознанное.

        На телефоне строки становятся карточками: сумма и кнопки стоят
        справа и не переносятся, а подпись долей уходит под описание.
      -->
      <div
        class="flex flex-col gap-2 rounded-none border-2 border-[var(--theme-ink)] bg-[var(--theme-paper)] p-4"
        data-test="finance-ledger"
      >
        <h2
          class="border-b border-[var(--theme-ink)] pb-2 text-xs font-semibold tracking-[0.14em] text-text uppercase"
        >
          Движение денег
        </h2>

        <p
          v-if="rows.length === 0"
          class="text-sm text-muted"
          data-test="finance-empty"
        >
          Пока никто ничего не тратил. «Добавить чек» запишет первую трату
          и посчитает, кто кому сколько должен.
        </p>

        <ul v-else class="flex flex-col divide-y divide-[var(--theme-ink)]" data-test="finance-rows">
          <li
            v-for="row in rows"
            :key="row.key"
            class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2"
            :data-test="`finance-row-${row.kind}`"
          >
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <p class="flex flex-wrap items-baseline gap-x-2 text-sm text-text">
                <span class="font-medium">{{ row.who }}</span>
                <span class="text-xs text-muted">{{ row.day }}</span>
              </p>

              <p v-if="row.description" class="text-sm text-text">
                {{ row.description }}
              </p>

              <p v-if="row.caption" class="text-xs text-muted" data-test="finance-row-caption">
                {{ row.caption }}
              </p>
            </div>

            <div class="flex flex-col items-end gap-1">
              <p class="whitespace-nowrap text-sm font-semibold text-text tabular-nums">
                {{ formatRub(row.amountRub) }}
              </p>

              <!--
                У ожидающего перевода «не подтверждено» стоит под суммой
                (18.11.2026): дату «получено 18.11.2026» заказчик просил
                не печатать, а после подтверждения подписи нет вовсе.
              -->
              <p
                v-if="row.kind === 'compensation' && row.status === 'pending'"
                class="text-xs text-orange-700"
                data-test="finance-compensation-pending"
              >
                не подтверждено
              </p>

              <!-- Офлайн-чек ещё на устройстве: сервер его не видел. -->
              <p
                v-if="row.kind === 'pendingExpense'"
                class="text-xs text-orange-700"
                data-test="finance-pending"
              >
                не отправлено
              </p>

              <div class="flex flex-wrap items-center justify-end gap-2">
                <button
                  v-if="row.pending"
                  type="button"
                  class="cursor-pointer rounded-none border border-[var(--theme-ink)] bg-transparent px-2 py-0.5 text-xs text-muted transition-colors hover:border-red-600 hover:text-red-600"
                  data-test="finance-pending-remove"
                  @click="row.pending && removePending(row.pending)"
                >
                  Убрать
                </button>

                <button
                  v-if="row.canEdit"
                  type="button"
                  class="cursor-pointer rounded-none border border-[var(--theme-ink)] bg-transparent px-2 py-0.5 text-xs text-muted transition-colors hover:bg-[var(--theme-ink)] hover:text-[var(--theme-paper)]"
                  aria-label="Изменить расход"
                  title="Изменить расход"
                  data-test="finance-expense-edit"
                  @click="openEdit(row)"
                >
                  ✎
                </button>

                <button
                  v-if="row.canConfirm"
                  type="button"
                  class="cursor-pointer rounded-none border border-primary bg-primary px-2 py-0.5 text-xs text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  :disabled="busyCompensation !== null"
                  data-test="finance-compensation-confirm"
                  @click="confirmRow(row)"
                >
                  Получено
                </button>

                <button
                  v-if="row.canCancel"
                  type="button"
                  class="cursor-pointer rounded-none border border-[var(--theme-ink)] bg-transparent px-2 py-0.5 text-xs text-muted transition-colors hover:text-red-600 disabled:opacity-60"
                  :disabled="busyCompensation !== null"
                  data-test="finance-compensation-cancel"
                  @click="cancelRow(row)"
                >
                  Отменить
                </button>
              </div>
            </div>
          </li>
        </ul>
      </div>

      <TripFinanceExpenseModal
        v-if="expenseModalOpen"
        :trip-id="tripId"
        :me-id="meId"
        :members="finance.members"
        :expense="editingExpense"
        @saved="applyView"
        @queued="onQueued"
        @close="expenseModalOpen = false"
      />

      <TripFinanceCompensationModal
        v-if="compensationOpen"
        :trip-id="tripId"
        :me-id="meId"
        :senders="senders"
        @saved="applyView"
        @stale="onCompensationStale"
        @close="compensationOpen = false"
      />

      <TripFinanceDepositModal
        v-if="depositTransferOpen && deposit"
        :trip-id="tripId"
        :amount-rub="deposit.amountRub"
        :senders="deposit.senders"
        @saved="applyView"
        @stale="onDepositStale"
        @close="depositTransferOpen = false"
      />
    </template>

    <!-- Чат — тема вкладки, как у «Снаряжения» и остальных. -->
    <TripChat :trip-id="tripId" kind="trip_finance" />
  </section>
</template>
