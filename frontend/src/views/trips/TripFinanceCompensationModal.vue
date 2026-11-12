<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { ApiError } from '@/api/errors'
import { createTripCompensation } from '@/api/finance'
import type { CompensationOption, TripFinance } from '@/types/finance'
import { formatRub, parseRub } from '@/utils/money'

/**
 * «Компенсация» — «я перевёл тебе столько» (12.11.2026).
 *
 * Слова заказчика: «Модалка „Компенсация“ — выбор участника, кому должен
 * пользователь и сумма (подставляется автоматически, можно редактировать).
 * По выбранному участнику отображается его реквизиты из Профиля в виде
 * подсказки, если нет, то надпись „получатель <имя>“».
 *
 * **Варианты считает сервер** (`compensationOptions`): это все кредиторы
 * с остатком, сумма — `min(долг, кредит)`. Ожидающие компенсации бронируют
 * кредит, поэтому список у двух должников разный и живой: кто первым создал
 * перевод, тот и занял кредит. Вторая копия этой арифметики на фронте
 * разошлась бы с сервером — модалка только выбирает.
 *
 * **Сумму можно уменьшить, но не увеличить.** Сумма больше остатка — уже
 * подарок, а не расчёт; об этом говорит подсказка и проверка перед отправкой.
 *
 * **Реквизиты приходят только сюда.** Это единственный экран, где участнику
 * похода нужен телефон или карта другого человека; в профиле и списке
 * участников их по-прежнему нет.
 */
const props = defineProps<{
  tripId: string
  /** Кому я должен: посчитано сервером, отсортировано по составу. */
  suggestions: CompensationOption[]
}>()

const emit = defineEmits<{
  /** Сервер вернул вкладку целиком — родитель заменяет состояние. */
  saved: [view: TripFinance]
  close: []
}>()

const selectedUserId = ref(props.suggestions[0]?.userId ?? '')
const amount = ref(String(props.suggestions[0]?.amountRub ?? ''))

const isSaving = ref(false)
const error = ref<string | null>(null)

const selected = computed(
  () => props.suggestions.find((option) => option.userId === selectedUserId.value) ?? null,
)

/** Потолок суммы — остаток долга именно этому человеку. */
const maxAmount = computed(() => selected.value?.amountRub ?? 0)

const requisites = computed(() => {
  if (!selected.value) return null

  const details = selected.value.paymentDetails
  const bank = selected.value.paymentBank

  if (!details) return null

  return { details, bank }
})

const noRequisitesText = computed(() => {
  const name = selected.value?.displayName ?? 'Получатель'

  return `${name} не указал(а) реквизиты в своём профиле, спроси у него/неё самого/самой.`
})

/**
 * Смена кредитора подставляет его сумму заново: подсказка у каждого своя,
 * и прежняя цифра после переключения была бы суммой «не тому».
 */
watch(selectedUserId, (userId) => {
  const option = props.suggestions.find((item) => item.userId === userId)
  if (option) amount.value = String(option.amountRub)
  error.value = null
})

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback
}

async function save(): Promise<void> {
  if (isSaving.value || selected.value === null) return

  error.value = null

  const sum = parseRub(amount.value)
  if (sum === null) {
    error.value = 'Укажите сумму перевода'
    return
  }
  if (sum === undefined) {
    error.value = 'Сумма — целое число рублей, больше нуля'
    return
  }
  if (sum > maxAmount.value) {
    error.value = `Больше остатка: этому человеку вы должны ${formatRub(maxAmount.value)}`
    return
  }

  isSaving.value = true

  try {
    emit(
      'saved',
      await createTripCompensation(props.tripId, {
        toUserId: selectedUserId.value,
        amountRub: sum,
      }),
    )
  } catch (problem) {
    error.value = messageOf(problem, 'Не удалось записать компенсацию')
  } finally {
    isSaving.value = false
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
    aria-labelledby="finance-compensation-title"
    data-test="finance-compensation-modal"
    @click.self="emit('close')"
  >
    <form
      class="flex max-h-[85vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-2xl bg-surface p-4 shadow-xl"
      @submit.prevent="save"
    >
      <div class="flex items-baseline justify-between gap-2">
        <h2 id="finance-compensation-title" class="text-lg font-semibold text-text">
          Компенсация
        </h2>

        <button
          type="button"
          class="cursor-pointer text-xs text-muted underline transition-colors hover:text-text"
          data-test="finance-compensation-close"
          @click="emit('close')"
        >
          Закрыть
        </button>
      </div>

      <p class="text-xs text-muted">
        Запись значит «я перевёл». Получатель подтвердит получение — до этого
        баланс не меняется.
      </p>

      <p
        v-if="suggestions.length === 0"
        class="text-sm text-muted"
        data-test="finance-compensation-empty"
      >
        Переводить некому: вам никто не должен с учётом ожидающих переводов.
      </p>

      <template v-else>
        <fieldset class="flex flex-col gap-1" data-test="finance-compensation-people">
          <legend class="text-xs text-muted">Кому переводите</legend>

          <label
            v-for="option in suggestions"
            :key="option.userId"
            class="flex cursor-pointer items-baseline gap-2 rounded-xl border px-3 py-2 text-sm transition-colors"
            :class="
              selectedUserId === option.userId
                ? 'border-primary bg-field'
                : 'border-border bg-surface hover:border-primary'
            "
          >
            <input
              v-model="selectedUserId"
              type="radio"
              name="finance-compensation-to"
              class="h-4 w-4 cursor-pointer accent-[var(--theme-primary)]"
              :value="option.userId"
              :data-test="`finance-compensation-to-${option.userId}`"
            />
            <span class="text-text">{{ option.displayName }}</span>
            <span class="ml-auto whitespace-nowrap text-xs text-muted">
              не больше {{ formatRub(option.amountRub) }}
            </span>
          </label>
        </fieldset>

        <label class="flex flex-col gap-1 text-xs text-muted">
          Сумма, ₽
          <input
            v-model="amount"
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
            class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
            data-test="finance-compensation-amount"
          />
        </label>

        <!-- Реквизиты выбранного: единственное место, где они видны участнику -->
        <div
          class="rounded-xl border border-border bg-field p-3 text-sm"
          data-test="finance-compensation-requisites"
        >
          <template v-if="requisites">
            <p class="text-xs text-muted">Перевести → {{ selected?.displayName }}</p>
            <p class="mt-1 text-text" data-test="finance-compensation-details">
              {{ requisites.details }}
            </p>
            <p v-if="requisites.bank" class="text-xs text-muted" data-test="finance-compensation-bank">
              {{ requisites.bank }}
            </p>
          </template>

          <p v-else class="text-muted" data-test="finance-compensation-no-requisites">
            {{ noRequisitesText }}
          </p>
        </div>

        <p v-if="error" class="text-sm text-red-600" data-test="finance-compensation-error">
          {{ error }}
        </p>

        <div class="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            :disabled="isSaving || selected === null"
            data-test="finance-compensation-save"
          >
            {{ isSaving ? 'Записываем…' : 'Я перевёл' }}
          </button>

          <button
            type="button"
            class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary"
            :disabled="isSaving"
            data-test="finance-compensation-cancel"
            @click="emit('close')"
          >
            Отмена
          </button>
        </div>
      </template>
    </form>
  </div>
</template>
