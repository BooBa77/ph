<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { ApiError } from '@/api/errors'
import {
  createTripExpense,
  deleteTripExpense,
  updateTripExpense,
} from '@/api/finance'
import {
  EXPENSE_SPLIT_LABELS,
  type ExpenseSplit,
  type FinanceMember,
  type SaveTripExpenseInput,
  type TripExpense,
  type TripFinance,
} from '@/types/finance'
import { sharesPreview } from '@/utils/finance'
import { localToday, parseRub } from '@/utils/money'

/**
 * «Добавить расход» и правка расхода — одна модалка (12.11.2026).
 *
 * Слова заказчика: «Модалка „Добавить расход“ — указывается общий расход или
 * на группу участников, сумма, описание расхода», и отдельно: «Строки
 * с расходами редактируются авторами».
 *
 * **Одна форма на создание и правку.** Сервер принимает одно тело
 * (`SaveTripExpenseDto`) и пересобирает доли целиком; две почти одинаковые
 * формы разошлись бы на первой правке — ровно как это было с полями
 * характеристик каталога. Режим задаёт пропс `expense`: `null` — новый.
 *
 * **«Чек» из «Питания» — тоже расход**, просто `split = 'commonEaters'`.
 * Поэтому у чека третий сегмент деления, и он появляется только при правке
 * такой строки: молча превратить чек в «на всех» значило бы взять деньги
 * с тех, кто ест отдельно. У нового расхода сегментов два, как в постановке.
 *
 * **Суммы видит человек до сохранения.** Остаток от деления — рубль, и он
 * уходит первым по составу; подсказка под формой показывает ровно те доли,
 * которые запишет сервер (`utils/finance.ts`).
 *
 * **Удаление — в два нажатия**: «Удалить» → «Точно удалить?». Такой же приём
 * в «Контактах» и каталоге; расход с деньгами — тем более не место для
 * случайного тапа.
 */
const props = defineProps<{
  tripId: string
  /** Идущие участники: из них выбирают, на кого разделить. */
  members: FinanceMember[]
  /** Правим существующий расход; `null` — добавляем новый. */
  expense?: TripExpense | null
}>()

const emit = defineEmits<{
  /** Сервер вернул вкладку целиком — родитель заменяет состояние. */
  saved: [view: TripFinance]
  close: []
}>()

const isEdit = computed(() => props.expense !== null && props.expense !== undefined)

const amount = ref(props.expense ? String(props.expense.amountRub) : '')
const description = ref(props.expense?.description ?? '')
const spentAt = ref(props.expense?.spentAt ?? localToday())
const split = ref<ExpenseSplit>(props.expense?.split ?? 'all')

/**
 * Выбранные для `split = 'group'`. При правке группы берём прежние доли,
 * при переключении сегмента — пусто: «на группу» без единой галочки должно
 * быть ошибкой, а не молчаливым «на всех».
 */
const selected = ref<string[]>(
  props.expense?.split === 'group' ? props.expense.shares.map((share) => share.userId) : [],
)

const isSaving = ref(false)
const isDeleting = ref(false)
const confirmDelete = ref(false)
const error = ref<string | null>(null)

/**
 * Сегменты деления. Третий — только у чека из «Питания»: у нового расхода
 * его нет, потому что чек заводят из «Питания», а не из «Бухгалтерии».
 */
const splitOptions = computed<{ value: ExpenseSplit; label: string }[]>(() => {
  const options: { value: ExpenseSplit; label: string }[] = [
    { value: 'all', label: EXPENSE_SPLIT_LABELS.all },
    { value: 'group', label: EXPENSE_SPLIT_LABELS.group },
  ]

  if (props.expense?.split === 'commonEaters') {
    options.push({ value: 'commonEaters', label: EXPENSE_SPLIT_LABELS.commonEaters })
  }

  return options
})

/** На кого делим в предварительном расчёте: порядок — порядок состава. */
const previewMembers = computed(() => {
  if (split.value === 'all') return props.members
  if (split.value === 'group') {
    return props.members.filter((member) => selected.value.includes(member.userId))
  }

  // Питающихся с общего список не знает — состав считает сервер.
  return []
})

const parsedAmount = computed(() => parseRub(amount.value))

const preview = computed(() => {
  if (typeof parsedAmount.value !== 'number' || previewMembers.value.length === 0) return ''

  return sharesPreview(parsedAmount.value, previewMembers.value)
})

const canDelete = computed(() => isEdit.value && props.expense?.canEdit === true)

function toggleMember(userId: string): void {
  selected.value = selected.value.includes(userId)
    ? selected.value.filter((id) => id !== userId)
    : [...selected.value, userId]
}

/** Ошибка словами: сервер объясняет права и лимиты сам, врать не надо. */
function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback
}

async function save(): Promise<void> {
  if (isSaving.value || isDeleting.value) return

  error.value = null

  const sum = parseRub(amount.value)
  if (sum === null) {
    error.value = 'Укажите сумму расхода'
    return
  }
  if (sum === undefined) {
    error.value = 'Сумма — целое число рублей, больше нуля'
    return
  }

  const text = description.value.trim()
  if (text === '' && split.value !== 'commonEaters') {
    error.value = 'Опишите, за что расход'
    return
  }

  if (split.value === 'group' && previewMembers.value.length === 0) {
    error.value = 'Отметьте, на кого разделить расход'
    return
  }

  const body: SaveTripExpenseInput = {
    amountRub: sum,
    split: split.value,
    spentAt: spentAt.value,
  }
  if (text !== '') body.description = text
  if (split.value === 'group') {
    body.participantIds = previewMembers.value.map((member) => member.userId)
  }

  isSaving.value = true

  try {
    const view = props.expense
      ? await updateTripExpense(props.tripId, props.expense.id, body)
      : await createTripExpense(props.tripId, body)

    emit('saved', view)
  } catch (problem) {
    error.value = messageOf(problem, 'Не удалось сохранить расход')
  } finally {
    isSaving.value = false
  }
}

async function remove(): Promise<void> {
  if (!canDelete.value || props.expense === null || props.expense === undefined) return
  if (isSaving.value || isDeleting.value) return

  // Первое нажатие только спрашивает: расход уносит доли и меняет балансы.
  if (!confirmDelete.value) {
    confirmDelete.value = true
    return
  }

  error.value = null
  isDeleting.value = true

  try {
    emit('saved', await deleteTripExpense(props.tripId, props.expense.id))
  } catch (problem) {
    error.value = messageOf(problem, 'Не удалось удалить расход')
  } finally {
    isDeleting.value = false
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="finance-expense-title"
    data-test="finance-expense-modal"
    @click.self="emit('close')"
  >
    <form
      class="flex max-h-[85vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-2xl bg-surface p-4 shadow-xl"
      @submit.prevent="save"
    >
      <div class="flex items-baseline justify-between gap-2">
        <h2 id="finance-expense-title" class="text-lg font-semibold text-text">
          {{ isEdit ? 'Изменить расход' : 'Добавить расход' }}
        </h2>

        <button
          type="button"
          class="cursor-pointer text-xs text-muted underline transition-colors hover:text-text"
          data-test="finance-expense-close"
          @click="emit('close')"
        >
          Закрыть
        </button>
      </div>

      <p class="text-xs text-muted">
        Плательщик — вы: этот расход запишется на ваше имя.
      </p>

      <!-- На кого разделить: сегменты, как в постановке «общий или на группу» -->
      <div
        class="flex flex-wrap gap-2"
        role="group"
        aria-label="На кого разделить расход"
        data-test="finance-expense-split"
      >
        <button
          v-for="option in splitOptions"
          :key="option.value"
          type="button"
          class="cursor-pointer rounded-xl border px-3 py-1.5 text-sm transition-colors"
          :class="
            split === option.value
              ? 'border-primary bg-primary text-white'
              : 'border-border bg-field text-text hover:border-primary'
          "
          :data-test="`finance-expense-split-${option.value}`"
          @click="split = option.value"
        >
          {{ option.label }}
        </button>
      </div>

      <p v-if="split === 'commonEaters'" class="text-xs text-muted" data-test="finance-expense-common-hint">
        Чек из «Питания» делится на всех, кто ест с общего. Кого именно — считает сервер.
      </p>

      <fieldset
        v-if="split === 'group'"
        class="flex flex-col gap-1 rounded-xl border border-border bg-field p-3"
        data-test="finance-expense-members"
      >
        <legend class="px-1 text-xs text-muted">Кого включить в доли</legend>

        <label
          v-for="member in members"
          :key="member.userId"
          class="flex cursor-pointer items-center gap-2 text-sm text-text"
        >
          <input
            type="checkbox"
            class="h-4 w-4 cursor-pointer accent-[var(--theme-primary)]"
            :checked="selected.includes(member.userId)"
            :data-test="`finance-expense-member-${member.userId}`"
            @change="toggleMember(member.userId)"
          />
          {{ member.displayName }}
        </label>
      </fieldset>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="flex flex-col gap-1 text-xs text-muted">
          Сумма, ₽
          <input
            v-model="amount"
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
            placeholder="12000"
            class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
            data-test="finance-expense-amount"
          />
        </label>

        <label class="flex flex-col gap-1 text-xs text-muted">
          Дата траты
          <input
            v-model="spentAt"
            type="date"
            class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
            data-test="finance-expense-date"
          />
        </label>
      </div>

      <label class="flex flex-col gap-1 text-xs text-muted">
        За что
        <input
          v-model="description"
          type="text"
          maxlength="200"
          :placeholder="split === 'commonEaters' ? 'Пусто — запишем «на продукты»' : 'Продукты на всё время похода'"
          class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
          data-test="finance-expense-description"
        />
      </label>

      <p v-if="preview" class="text-xs text-muted" data-test="finance-expense-preview">
        {{ preview }}
      </p>

      <p v-if="error" class="text-sm text-red-600" data-test="finance-expense-error">{{ error }}</p>

      <div class="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          :disabled="isSaving || isDeleting"
          data-test="finance-expense-save"
        >
          {{ isSaving ? 'Сохраняем…' : isEdit ? 'Сохранить' : 'Добавить' }}
        </button>

        <button
          type="button"
          class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary disabled:opacity-60"
          :disabled="isSaving || isDeleting"
          data-test="finance-expense-cancel"
          @click="emit('close')"
        >
          Отмена
        </button>

        <button
          v-if="canDelete"
          type="button"
          class="ml-auto cursor-pointer rounded-xl border border-red-300 px-3 py-1.5 text-sm text-red-600 transition-colors hover:border-red-600 disabled:opacity-60"
          :disabled="isSaving || isDeleting"
          data-test="finance-expense-delete"
          @click="remove"
        >
          {{ confirmDelete ? 'Точно удалить?' : 'Удалить' }}
        </button>
      </div>
    </form>
  </div>
</template>
