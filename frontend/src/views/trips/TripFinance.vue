<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { ApiError } from '@/api/errors'
import { subscribeTripEvents } from '@/api/events'
import type { TripEvent } from '@/api/events'
import {
  confirmTripCompensation,
  deleteTripCompensation,
  getTripFinance,
  setTripDepositStatus,
} from '@/api/finance'
import { useAuthStore } from '@/stores/auth'
import {
  DEPOSIT_STATUS_LABELS,
  type CompensationOption,
  type CompensationSender,
  type DepositStatus,
  type TripCompensation,
  type TripDepositForfeit,
  type TripExpense,
  type TripFinance,
} from '@/types/finance'
import {
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
const meId = computed(() => auth.user?.id ?? '')

const finance = ref<TripFinance | null>(null)
const isLoading = ref(true)
const error = ref<string | null>(null)
const actionError = ref<string | null>(null)
const busyCompensation = ref<string | null>(null)

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
    if (version !== viewVersion || tripId !== props.tripId) return

    finance.value = view
  } catch (problem) {
    if (version !== viewVersion) return

    error.value = messageOf(problem, 'Не удалось загрузить бухгалтерию похода')
    finance.value = null
  } finally {
    if (version === viewVersion) isLoading.value = false
  }
}

watch(() => props.tripId, load, { immediate: true })

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
 * Залог участия (17.11.2026, переделан 17.11.2026 — «залог как риск»).
 *
 * Заказчик: «Организатор может установить залог на участие, размести это
 * над секцией Движение денег». Блок рисуется только когда залог есть:
 * пустой «Залог: 0 ₽» на экране бесполезен.
 *
 * **С 17.11.2026 это секция риска, а не список всех.** Заказчик: «в секции
 * нужны именно те, кто отказался, чтобы организатор решал, что делать
 * с залогом. Можно также туда информативно разместить тех, кто не вложился
 * на сумму залога. Тех же, кто перевёл залог или достаточно потратился,
 * не стоит отображать — экономим пространство». Поэтому сервер присылает
 * `participants` уже отфильтрованными, а полный список — `allParticipants`
 * по кнопке «Все участники»: ошибочную отметку надо уметь снять.
 *
 * **Удержание двигает балансы.** Подтверждённая заказчиком формула:
 * «A −залог, каждому идущему +залог/число идущих» — это доход фонда группы.
 * Поэтому отметка «Удержать» здесь не просто подпись: строки удержания
 * приходят в ответе (`depositForfeits`) и стоят в ленте «Движения денег».
 */
const deposit = computed(() => finance.value?.deposit ?? null)

/** Мой залог: по нему в шапке появляется «Перевести залог». */
const myDeposit = computed(() => deposit.value?.me ?? null)

/** Переводить есть куда и нужно: залог не сдан, а я в походе. */
const canTransferDeposit = computed(() => myDeposit.value?.canTransfer === true)

/** Кому организатор ещё может поставить отметку. */
const canManageDeposit = computed(() => deposit.value?.canManage === true)

/**
 * «Все участники» — по требованию. По умолчанию виден только риск
 * (отказавшиеся и не вложившие сумму залога); полный список нужен, чтобы
 * снять ошибочную отметку «сдал».
 */
const showAllDeposit = ref(false)

const depositList = computed(() => {
  if (deposit.value === null) return []

  return showAllDeposit.value
    ? deposit.value.allParticipants
    : deposit.value.participants
})

/** Есть ли кого прятать: иначе кнопка «Все участники» бесполезна. */
const hasHiddenDeposit = computed(
  () =>
    deposit.value !== null &&
    deposit.value.allParticipants.length > deposit.value.participants.length,
)

/** Есть ли уже удержанный залог: тогда показываем, как он двигает балансы. */
const hasForfeitDeposit = computed(
  () =>
    deposit.value !== null &&
    deposit.value.allParticipants.some((person) => person.status === 'forfeited'),
)

/**
 * Доля одного идущего при удержании: `залог / число идущих`.
 *
 * Считает её сервер по `going` — «пока думаю» залог сдаёт, но в делёж
 * удержанного не входит. Остаток от деления по рублю уходит первым
 * по составу (как у долей расхода), поэтому в подписи — меньшая доля.
 */
const depositShareRub = computed(() => {
  const amount = deposit.value?.amountRub ?? 0
  const going = deposit.value?.summary.going ?? 0

  if (amount <= 0 || going <= 0) return 0

  return Math.floor(amount / going)
})

/** Какая строка сейчас отправляет запрос — чтобы не нажимали дважды. */
const busyDeposit = ref<string | null>(null)

/** Цвет состояния: «не сдал» — внимание, «сдал» — хорошо, остальное нейтрально. */
const DEPOSIT_CLASS: Record<DepositStatus, string> = {
  pending: 'text-orange-700',
  held: 'text-emerald-700',
  returned: 'text-muted',
  forfeited: 'text-red-600',
}

async function markDeposit(userId: string, status: DepositStatus): Promise<void> {
  if (busyDeposit.value !== null) return

  busyDeposit.value = userId
  actionError.value = null

  try {
    applyView(await setTripDepositStatus(props.tripId, userId, status))
  } catch (problem) {
    actionError.value = messageOf(problem, 'Не удалось сохранить отметку о залоге')
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
  kind: 'expense' | 'compensation' | 'deposit'
  day: string
  who: string
  amountRub: number
  description: string
  caption: string
  status: 'pending' | 'confirmed' | null
  confirmedDay: string
  canEdit: boolean
  canConfirm: boolean
  canCancel: boolean
  expense: TripExpense | null
  compensation: TripCompensation | null
  forfeit: TripDepositForfeit | null
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
      day: formatDay(row.at),
      who: row.expense.authorName,
      amountRub: row.expense.amountRub,
      description: row.expense.description,
      caption: splitCaption(row.expense),
      status: null,
      confirmedDay: '',
      canEdit: row.expense.canEdit,
      canConfirm: false,
      canCancel: false,
      expense: row.expense,
      compensation: null,
      forfeit: null,
    }
  }

  if (row.kind === 'deposit') {
    // Удержание залога — не расход и не перевод: его никто не «платил»,
    // это перераспределение на фонд группы. Поэтому ни правки, ни
    // подтверждения у строки нет.
    return {
      key: row.key,
      kind: 'deposit',
      day: formatDay(row.at),
      who: row.forfeit.sourceName,
      amountRub: row.forfeit.amountRub,
      description: 'Залог удержан',
      caption: forfeitCaption(row.forfeit),
      status: null,
      confirmedDay: '',
      canEdit: false,
      canConfirm: false,
      canCancel: false,
      expense: null,
      compensation: null,
      forfeit: row.forfeit,
    }
  }

  const compensation = row.compensation

  return {
    key: row.key,
    kind: 'compensation',
    day: formatDay(row.at),
    who: `${compensation.fromName} → ${compensation.toName}`,
    amountRub: compensation.amountRub,
    description: '',
    caption: '',
    status: compensation.status,
    confirmedDay: compensation.confirmedAt ? formatDay(compensation.confirmedAt) : '',
    canEdit: false,
    canConfirm: compensation.canConfirm,
    canCancel: compensation.canCancel,
    expense: null,
    compensation,
    forfeit: null,
  }
}

const rows = computed<MoneyRowView[]>(() =>
  finance.value === null ? [] : movementRows(finance.value).map(toView),
)

// ───────────────────────────── действия ─────────────────────────────

/** Модалки и операции меняют вкладку целиком — так отвечает сервер. */
function applyView(view: TripFinance): void {
  // Ответ мутации новее любого GET, начатого до неё: иначе поздний ответ
  // тихого обновления перетёр бы свежие цифры старыми.
  viewVersion += 1

  finance.value = view
  actionError.value = null
  expenseModalOpen.value = false
  editingExpense.value = null
  compensationOpen.value = false
  depositTransferOpen.value = false
}

function openNewExpense(): void {
  if (!canSpend.value) return

  editingExpense.value = null
  expenseModalOpen.value = true
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
 * «Перевести залог» (17.11.2026).
 *
 * Перед открытием перечитываем вкладку: залог мог быть отмечен организатором
 * с другого устройства, и модалка с кнопкой «Я перевёл» предложила бы
 * отправить деньги второй раз.
 */
async function openDepositTransfer(): Promise<void> {
  if (!canTransferDeposit.value) return

  await refreshQuietly()

  if (!canTransferDeposit.value) {
    actionError.value = 'Залог уже отмечен — переводить нечего.'
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
              :disabled="!canSpend"
              data-test="finance-add-expense"
              @click="openNewExpense"
            >
              Добавить расход
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
              class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary"
              data-test="finance-compensate"
              @click="openCompensation"
            >
              Компенсация
            </button>

            <!--
              «Перевести залог» — вместо прямого перевода между участниками
              (17.11.2026): у приложения такого действия нет, поэтому залог
              уходит организатору, и он держит кассу группы.
            -->
            <button
              v-if="canTransferDeposit"
              type="button"
              class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90"
              data-test="finance-deposit-transfer"
              @click="openDepositTransfer"
            >
              Перевести залог
            </button>
          </div>
        </div>

        <p v-if="actionError" class="text-sm text-red-600" data-test="finance-action-error">
          {{ actionError }}
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
        Залог участия (17.11.2026) — **над** «Движением денег», как просил
        заказчик. С 17.11.2026 это **секция риска**: в списке только
        отказавшиеся (организатор решает, вернуть залог или удержать)
        и те, кто не вложил сумму залога. Кто сдал или потратился
        достаточно — в счётчиках шапки; полный список открывается кнопкой
        «Все участники», чтобы ошибочную отметку можно было снять.

        «Вернуть / Удержать» — флаг, а не два действия: заказчик просил
        видеть выбранное решение. «Удержать» не просто подпись: залог
        перераспределяется в фонд группы и меняет балансы.
      -->
      <div
        v-if="deposit"
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

        <p class="text-xs text-muted" data-test="finance-deposit-summary">
          Сдали {{ deposit.summary.held }} из {{ deposit.summary.total }}.
          <template v-if="deposit.summary.pending > 0">
            Не сдавали {{ deposit.summary.pending }}.
          </template>
          <template v-if="deposit.summary.forfeited > 0">
            Удержано {{ deposit.summary.forfeited }}.
          </template>
          <template v-if="deposit.summary.cashRub > 0">
            На руках у организаторов {{ formatRub(deposit.summary.cashRub) }}.
          </template>
        </p>

        <p
          v-if="myDeposit"
          class="flex flex-wrap items-center gap-2 text-sm text-text"
          data-test="finance-deposit-me"
        >
          <span>
            Твой залог:
            <span
              class="font-medium"
              :class="DEPOSIT_CLASS[myDeposit.status]"
              :data-test="`finance-deposit-me-${myDeposit.status}`"
              >{{ DEPOSIT_STATUS_LABELS[myDeposit.status] }}</span
            >
            <span v-if="myDeposit.holderName" class="text-muted">
              · у {{ myDeposit.holderName }}</span
            >
          </span>

          <!--
            Организатору переводить некому — деньги у него самого. Свой
            залог он отмечает этой кнопкой. Участнику она не нужна: у него
            «Перевести залог» в шапке.
          -->
          <button
            v-if="canManageDeposit && myDeposit.status === 'pending'"
            type="button"
            class="cursor-pointer rounded-xl border border-emerald-700 px-2.5 py-1 text-xs text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="busyDeposit !== null"
            data-test="finance-deposit-take-me"
            @click="markDeposit(meId, 'held')"
          >
            Сдал
          </button>
        </p>

        <p
          v-if="depositList.length === 0"
          class="text-xs text-muted"
          data-test="finance-deposit-clear"
        >
          Риска нет: все сдали залог или уже вложили в поход не меньше него.
        </p>

        <ul
          v-else
          class="flex flex-col divide-y divide-border"
          data-test="finance-deposit-list"
        >
          <li
            v-for="person in depositList"
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
                  >{{ DEPOSIT_STATUS_LABELS[person.status] }}</span
                >
              </p>
              <p class="text-xs text-muted" data-test="finance-deposit-invested">
                вложил {{ formatRub(person.investedRub) }} из
                {{ formatRub(deposit.amountRub) }}
                <template v-if="person.holderName"> · у {{ person.holderName }}</template>
              </p>
              <p
                v-if="person.updatedByName && person.status !== 'pending'"
                class="text-xs text-muted"
                data-test="finance-deposit-updated-by"
              >
                отметил {{ person.updatedByName }}
              </p>
            </div>

            <div v-if="canManageDeposit" class="flex flex-wrap items-center gap-1">
              <button
                v-if="person.status === 'pending'"
                type="button"
                class="cursor-pointer rounded-xl border border-emerald-700 px-2.5 py-1 text-xs text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="busyDeposit !== null"
                data-test="finance-deposit-take"
                @click="markDeposit(person.userId, 'held')"
              >
                Сдал
              </button>

              <div
                v-else-if="person.declined"
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

              <button
                v-else
                type="button"
                class="cursor-pointer rounded-xl border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:border-primary hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="busyDeposit !== null"
                data-test="finance-deposit-reset"
                @click="markDeposit(person.userId, 'pending')"
              >
                Надо сдать
              </button>
            </div>
          </li>
        </ul>

        <p
          v-if="hasForfeitDeposit"
          class="text-xs text-muted"
          data-test="finance-deposit-effect"
        >
          Удержание — доход фонда группы: у отказавшегося −{{ formatRub(deposit.amountRub) }},
          у каждого идущего +{{ formatRub(depositShareRub) }}.
        </p>

        <button
          v-if="canManageDeposit && hasHiddenDeposit"
          type="button"
          class="cursor-pointer self-start text-xs text-primary underline"
          data-test="finance-deposit-toggle"
          @click="showAllDeposit = !showAllDeposit"
        >
          {{ showAllDeposit ? 'Только риски' : `Все участники (${deposit.allParticipants.length})` }}
        </button>
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
          Пока никто ничего не тратил. «Добавить расход» запишет первую трату
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

              <p v-if="row.kind === 'expense'" class="text-sm text-text">
                {{ row.description }}
              </p>
              <p v-else-if="row.kind === 'deposit'" class="text-sm text-text">
                {{ row.description }}
              </p>
              <p v-else class="text-xs" :class="row.status === 'pending' ? 'text-orange-700' : 'text-muted'">
                <template v-if="row.status === 'pending'">ждём подтверждения</template>
                <template v-else>получено {{ row.confirmedDay }}</template>
              </p>

              <p v-if="row.caption" class="text-xs text-muted" data-test="finance-row-caption">
                {{ row.caption }}
              </p>
            </div>

            <div class="flex flex-col items-end gap-1">
              <p class="whitespace-nowrap text-sm font-semibold text-text tabular-nums">
                {{ formatRub(row.amountRub) }}
              </p>

              <div class="flex flex-wrap items-center justify-end gap-2">
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
        :recipients="deposit.recipients"
        @saved="applyView"
        @stale="onDepositStale"
        @close="depositTransferOpen = false"
      />
    </template>

    <!-- Чат — тема вкладки, как у «Снаряжения» и остальных. -->
    <TripChat :trip-id="tripId" kind="trip_finance" />
  </section>
</template>
