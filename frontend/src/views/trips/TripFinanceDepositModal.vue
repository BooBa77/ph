<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { ApiError } from '@/api/errors'
import { transferTripDeposit } from '@/api/finance'
import type { DepositRecipient, TripFinance } from '@/types/finance'
import { formatRub } from '@/utils/money'

/**
 * «Перевести залог» (17.11.2026).
 *
 * Заказчик: «Фактически „Перевести залог“ — перевод суммы организаторам.
 * Это отдельная кнопка из-за того, что у нас нет прямых переводов между
 * участниками. Если участник ещё никому не должен, общих расходов
 * не производит, но хочет внести залог, инструментов нет. В этом случае
 * организатор становится частичным держателем кассы».
 *
 * Поэтому модалка — не «Компенсация»: она не требует долга, сумма не
 * правится (залог один на поход), а получатель выбирается из организаторов
 * похода. Реквизиты показываются те же, что в профиле, — переводить
 * некуда, если человек их не заполнил, и об этом говорится прямо.
 *
 * **Балансы это не двигает.** Залог меняет их только в момент удержания
 * (`finance.md` §2.5), поэтому сумма здесь — не перевод долга, а передача
 * денег на хранение.
 */
const props = defineProps<{
  tripId: string
  /** Сумма залога с человека — одна на поход, из «Правки похода». */
  amountRub: number
  /** Кому можно перевести: автор похода и соорганизаторы. */
  recipients: DepositRecipient[]
}>()

const emit = defineEmits<{
  /** Сервер вернул вкладку целиком — родитель заменяет состояние. */
  saved: [view: TripFinance]
  /** Вкладка устарела: залог уже отмечен, надо перечитать. */
  stale: []
  close: []
}>()

/**
 * По умолчанию — первый получатель с реквизитами, иначе первый в списке:
 * человек чаще всего переводит тому, у кого есть куда.
 */
const initialRecipient = computed(
  () =>
    props.recipients.find(
      (recipient) => recipient.paymentDetails !== null,
    ) ??
    props.recipients[0] ??
    null,
)

const selectedUserId = ref(initialRecipient.value?.userId ?? '')
const isSaving = ref(false)
const error = ref<string | null>(null)

const selected = computed(
  () =>
    props.recipients.find(
      (recipient) => recipient.userId === selectedUserId.value,
    ) ?? null,
)

const noRequisitesText = computed(() => {
  if (selected.value === null) return ''

  const verb = selected.value.gender === 'f' ? 'не указала' : 'не указал'

  return `${selected.value.displayName} ${verb} реквизиты в своём профиле, придётся спросить у него самого.`
})

const roleLabel = (recipient: DepositRecipient): string =>
  recipient.role === 'organizer' ? 'организатор' : 'соорганизатор'

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback
}

async function save(): Promise<void> {
  if (isSaving.value || selected.value === null) return

  isSaving.value = true
  error.value = null

  try {
    emit('saved', await transferTripDeposit(props.tripId, selected.value.userId))
  } catch (problem) {
    error.value = messageOf(problem, 'Не удалось записать перевод залога')

    // 400 «залог уже отмечен» значит, что его отметили после загрузки
    // вкладки: родитель перечитает её, а сообщение сервера правдиво.
    if (problem instanceof ApiError && problem.status === 400) emit('stale')
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
    aria-labelledby="finance-deposit-transfer-title"
    data-test="finance-deposit-modal"
    @click.self="emit('close')"
  >
    <form
      class="flex max-h-[85vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-2xl bg-surface p-4 shadow-xl"
      @submit.prevent="save"
    >
      <div class="flex items-baseline justify-between gap-2">
        <h2
          id="finance-deposit-transfer-title"
          class="text-lg font-semibold text-text"
        >
          Перевести залог
        </h2>

        <button
          type="button"
          class="cursor-pointer text-xs text-muted underline transition-colors hover:text-text"
          data-test="finance-deposit-close"
          @click="emit('close')"
        >
          Закрыть
        </button>
      </div>

      <div
        class="flex flex-col gap-1 text-xs text-muted"
        data-test="finance-deposit-note"
      >
        <p>
          Залог {{ formatRub(amountRub) }} уходит организатору: прямых переводов между
          участниками в приложении нет. Он держит эти деньги до конца похода.
        </p>
        <p>
          В балансах залог появится, только если его удержат: тогда он станет доходом
          фонда группы.
        </p>
      </div>

      <p
        v-if="recipients.length === 0"
        class="text-sm text-muted"
        data-test="finance-deposit-empty"
      >
        Переводить некому: в походе нет организатора, которому можно передать залог.
      </p>

      <template v-else>
        <fieldset class="flex flex-col gap-1" data-test="finance-deposit-people">
          <legend class="text-xs text-muted">Кому переводишь</legend>

          <label
            v-for="recipient in recipients"
            :key="recipient.userId"
            class="flex cursor-pointer items-baseline gap-2 rounded-xl border px-3 py-2 text-sm transition-colors"
            :class="
              selectedUserId === recipient.userId
                ? 'border-primary bg-field'
                : 'border-border bg-surface hover:border-primary'
            "
          >
            <input
              v-model="selectedUserId"
              type="radio"
              name="finance-deposit-to"
              class="h-4 w-4 cursor-pointer accent-[var(--theme-primary)]"
              :value="recipient.userId"
              :data-test="`finance-deposit-to-${recipient.userId}`"
            />
            <span class="text-text">{{ recipient.displayName }}</span>
            <span class="text-xs text-muted">{{ roleLabel(recipient) }}</span>
            <span class="ml-auto whitespace-nowrap text-xs font-medium text-text">
              {{ formatRub(amountRub) }}
            </span>
          </label>
        </fieldset>

        <div
          class="flex flex-col gap-1 rounded-xl border border-border bg-field p-3 text-sm"
          data-test="finance-deposit-requisites"
        >
          <template v-if="selected?.paymentDetails">
            <p class="text-xs text-muted">Перевести → {{ selected.displayName }}</p>
            <p class="text-text" data-test="finance-deposit-details">
              {{ selected.paymentDetails }}
            </p>
            <p
              v-if="selected.paymentBank"
              class="text-xs text-muted"
              data-test="finance-deposit-bank"
            >
              {{ selected.paymentBank }}
            </p>
          </template>

          <p v-else class="text-muted" data-test="finance-deposit-no-requisites">
            {{ noRequisitesText }}
          </p>
        </div>

        <p v-if="error" class="text-sm text-red-600" data-test="finance-deposit-error">
          {{ error }}
        </p>

        <div class="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            :disabled="isSaving || selected === null"
            data-test="finance-deposit-save"
          >
            {{ isSaving ? 'Записываем…' : `Я перевёл ${formatRub(amountRub)}` }}
          </button>

          <button
            type="button"
            class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary"
            :disabled="isSaving"
            data-test="finance-deposit-cancel"
            @click="emit('close')"
          >
            Отмена
          </button>
        </div>
      </template>
    </form>
  </div>
</template>
