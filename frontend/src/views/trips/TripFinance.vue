<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { ApiError } from '@/api/errors'
import { subscribeTripEvents } from '@/api/events'
import type { TripEvent } from '@/api/events'
import {
  confirmTripCompensation,
  deleteTripCompensation,
  getTripFinance,
} from '@/api/finance'
import { useAuthStore } from '@/stores/auth'
import type {
  CompensationOption,
  CompensationSender,
  TripCompensation,
  TripExpense,
  TripFinance,
} from '@/types/finance'
import { movementRows, splitCaption, type MoneyRow } from '@/utils/finance'
import { formatDay, formatRub, formatRubSigned } from '@/utils/money'
import TripChat from '@/views/trips/TripChat.vue'
import TripFinanceCompensationModal from '@/views/trips/TripFinanceCompensationModal.vue'
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

// ───────────────────────────── таблица движения денег ─────────────────────────────

/**
 * Строка для экрана: всё, что нужно разметке, уже посчитано.
 *
 * Так шаблон не разбирается с объединением «расход или компенсация»
 * в каждом углу, а действия получают исходную запись и её флаги прав.
 */
interface MoneyRowView {
  key: string
  kind: 'expense' | 'compensation'
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

            <button
              type="button"
              class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!canCompensate"
              data-test="finance-compensate"
              @click="openCompensation"
            >
              Компенсация
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
        Таблица движения денег. На телефоне строки становятся карточками:
        сумма и кнопки стоят справа и не переносятся, а подпись долей
        уходит под описание.
      -->
      <div class="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
        <h2 class="text-sm text-muted">Движение денег</h2>

        <p
          v-if="rows.length === 0"
          class="text-sm text-muted"
          data-test="finance-empty"
        >
          Пока никто ничего не тратил. «Добавить расход» запишет первую трату
          и посчитает, кто кому сколько должен.
        </p>

        <ul v-else class="flex flex-col divide-y divide-border" data-test="finance-rows">
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
              <p v-else class="text-xs" :class="row.status === 'pending' ? 'text-orange-700' : 'text-muted'">
                <template v-if="row.status === 'pending'">ждём подтверждения</template>
                <template v-else>получено {{ row.confirmedDay }}</template>
              </p>

              <p v-if="row.caption" class="text-xs text-muted" data-test="finance-row-caption">
                {{ row.caption }}
              </p>
            </div>

            <div class="flex flex-col items-end gap-1">
              <p class="whitespace-nowrap text-sm font-semibold text-text">
                {{ formatRub(row.amountRub) }}
              </p>

              <div class="flex flex-wrap items-center justify-end gap-2">
                <button
                  v-if="row.canEdit"
                  type="button"
                  class="cursor-pointer rounded-lg border border-border bg-field px-2 py-0.5 text-xs text-muted transition-colors hover:border-primary hover:text-text"
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
                  class="cursor-pointer rounded-lg border border-primary bg-primary px-2 py-0.5 text-xs text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  :disabled="busyCompensation !== null"
                  data-test="finance-compensation-confirm"
                  @click="confirmRow(row)"
                >
                  Получено
                </button>

                <button
                  v-if="row.canCancel"
                  type="button"
                  class="cursor-pointer rounded-lg border border-border bg-field px-2 py-0.5 text-xs text-muted transition-colors hover:border-red-600 hover:text-red-600 disabled:opacity-60"
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
    </template>

    <!-- Чат — тема вкладки, как у «Снаряжения» и остальных. -->
    <TripChat :trip-id="tripId" kind="trip_finance" />
  </section>
</template>
