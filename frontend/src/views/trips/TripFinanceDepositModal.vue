<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { ApiError } from '@/api/errors'
import { transferTripDeposit } from '@/api/finance'
import type { DepositSender, TripFinance } from '@/types/finance'
import { formatRub } from '@/utils/money'

/**
 * «Перевести залог» (17.11.2026, v3 — 18.11.2026).
 *
 * Заказчик: «Фактически „Перевести залог“ — перевод суммы организаторам…
 * Если участник ещё никому не должен, общих расходов не производит, но
 * хочет внести залог, инструментов нет. В этом случае организатор
 * становится частичным держателем кассы».
 *
 * **С 18.11.2026 (v3) в модалке подставлена недостача, и её можно менять.**
 * Заказчик: «если потратился, но меньше залога, кнопка есть, а в модалке
 * перевода подставим недостающую сумму, её конечно же можно изменить
 * на любую, может решит перевести организатору с запасом». Поэтому здесь
 * поле суммы: больше остатка разрешено, лишнее при подтверждении станет
 * обычным переводом (деньги не пропадут ни при удержании, ни при возврате).
 *
 * **Кто сдаёт.** Себя выбирает сам участник; за человека без аккаунта —
 * тот, кто его ведёт. Поэтому в модалке есть выбор отправителя, как
 * у компенсации: иначе организатор с виртуальными друзьями не смог бы
 * передать их залог.
 */
const props = defineProps<{
  tripId: string
  /** Сумма залога с человека — одна на поход, из «Правки похода». */
  amountRub: number
  /** Кто может передать: я и люди без аккаунта, которых я веду. */
  senders: DepositSender[]
}>()

const emit = defineEmits<{
  /** Сервер вернул вкладку целиком — родитель заменяет состояние. */
  saved: [view: TripFinance]
  /** Вкладка устарела: залог уже переведён, надо перечитать. */
  stale: []
  close: []
}>()

const initialSender = computed(
  () =>
    props.senders.find((sender) => sender.isMe) ??
    props.senders[0] ??
    null,
)

const selectedSenderId = ref(initialSender.value?.userId ?? '')
const isSaving = ref(false)
const error = ref<string | null>(null)

const selectedSender = computed(
  () =>
    props.senders.find(
      (sender) => sender.userId === selectedSenderId.value,
    ) ?? null,
)

/** Сколько осталось перевести выбранному отправителю — с сервера. */
const dueRub = computed(() => selectedSender.value?.dueRub ?? props.amountRub)

/**
 * Сумма перевода: по умолчанию недостача, но её можно менять.
 * `null` — поле пустое или в нём не целое число.
 */
const amount = ref<number | null>(dueRub.value)

/**
 * Получатели зависят от отправителя: виртуальный человек платит
 * организатору, который его ведёт, а сам участник себе не переводит.
 */
const availableRecipients = computed(
  () => selectedSender.value?.recipients ?? [],
)

function defaultRecipientUserId(): string {
  return (
    availableRecipients.value.find(
      (recipient) => recipient.paymentDetails !== null,
    )?.userId ??
    availableRecipients.value[0]?.userId ??
    ''
  )
}

const selectedUserId = ref(defaultRecipientUserId())

// Сменили отправителя — сменились и получатель, и недостача.
watch(selectedSenderId, () => {
  selectedUserId.value = defaultRecipientUserId()
  amount.value = dueRub.value
})

const selected = computed(
  () =>
    availableRecipients.value.find(
      (recipient) => recipient.userId === selectedUserId.value,
    ) ?? null,
)

/** Сумма сверх недостачи: разрешена, но должна быть видна человеку. */
const excessRub = computed(() => {
  if (amount.value === null) return 0

  return Math.max(0, amount.value - dueRub.value)
})

const isValidAmount = computed(() => {
  const value = amount.value

  return value !== null && Number.isInteger(value) && value >= 1 && value <= 10_000_000
})

const noRequisitesText = computed(() => {
  if (selected.value === null) return ''

  const verb = selected.value.gender === 'f' ? 'не указала' : 'не указал'

  return `${selected.value.displayName} ${verb} реквизиты в своём профиле, придётся спросить у него самого.`
})

const roleLabel = (recipient: { role: 'organizer' | 'coOrganizer' }): string =>
  recipient.role === 'organizer' ? 'организатор' : 'соорганизатор'

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback
}

async function save(): Promise<void> {
  if (
    isSaving.value ||
    selected.value === null ||
    selectedSender.value === null ||
    !isValidAmount.value ||
    amount.value === null
  ) {
    return
  }

  isSaving.value = true
  error.value = null

  try {
    emit(
      'saved',
      await transferTripDeposit(
        props.tripId,
        selected.value.userId,
        amount.value,
        selectedSender.value.isMe ? undefined : selectedSender.value.userId,
      ),
    )
  } catch (problem) {
    error.value = messageOf(problem, 'Не удалось записать перевод залога')

    // 400 значит, что перевод уже сделали с другого устройства: родитель
    // перечитает вкладку, а сообщение сервера правдиво.
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
          Залог {{ formatRub(amountRub) }} уходит организатору: прямых переводов
          между участниками в приложении нет. Он держит эти деньги до конца
          похода.
        </p>
        <p>
          Перевод встанет в «Движение денег» строкой «Залог за участие».
          Организатор подтвердит получение — тогда у тебя станет плюс
          на сумму перевода, а у него минус: он теперь должен группе.
        </p>
      </div>

      <p
        v-if="senders.length === 0"
        class="text-sm text-muted"
        data-test="finance-deposit-no-sender"
      >
        Передавать нечего: залог уже покрыт или ждёт подтверждения.
      </p>

      <p
        v-else-if="availableRecipients.length === 0"
        class="text-sm text-muted"
        data-test="finance-deposit-empty"
      >
        Переводить некому: в походе нет организатора, которому можно передать
        залог.
      </p>

      <template v-else>
        <!--
          Кто сдаёт: себя участник выбирает сам, за человека без аккаунта
          действует ведущий. Список из одного себя не показываем — незачем
          занимать место.
        -->
        <fieldset
          v-if="senders.length > 1"
          class="flex flex-col gap-1"
          data-test="finance-deposit-senders"
        >
          <legend class="text-xs text-muted">Кто сдаёт</legend>

          <label
            v-for="sender in senders"
            :key="sender.userId"
            class="flex cursor-pointer items-baseline gap-2 rounded-xl border px-3 py-2 text-sm transition-colors"
            :class="
              selectedSenderId === sender.userId
                ? 'border-primary bg-field'
                : 'border-border bg-surface hover:border-primary'
            "
          >
            <input
              v-model="selectedSenderId"
              type="radio"
              name="finance-deposit-from"
              class="h-4 w-4 cursor-pointer accent-[var(--theme-primary)]"
              :value="sender.userId"
              :data-test="`finance-deposit-from-${sender.userId}`"
            />
            <span class="text-text">{{ sender.displayName }}</span>
            <span v-if="sender.isMe" class="text-xs text-muted">это ты</span>
            <span v-else class="text-xs text-muted">человек без аккаунта</span>
            <span class="ml-auto whitespace-nowrap text-xs text-muted">
              осталось {{ formatRub(sender.dueRub) }}
            </span>
          </label>
        </fieldset>

        <fieldset class="flex flex-col gap-1" data-test="finance-deposit-people">
          <legend class="text-xs text-muted">Кому переводишь</legend>

          <label
            v-for="recipient in availableRecipients"
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

        <!--
          Сумма: по умолчанию недостача, но её можно менять — заказчик
          разрешил «перевести с запасом». Больше остатка не ошибка, а кредит
          перед группой, и модалка честно говорит, во что он превратится.
        -->
        <div class="flex flex-col gap-1">
          <label class="flex flex-wrap items-center gap-2 text-sm text-text">
            <span>Сумма перевода</span>
            <input
              v-model.number="amount"
              type="number"
              min="1"
              step="1"
              inputmode="numeric"
              class="w-28 rounded-xl border border-border bg-field px-3 py-1.5 text-right text-sm text-text"
              data-test="finance-deposit-amount"
            />
            <span class="text-xs text-muted">
              осталось {{ formatRub(dueRub) }}
            </span>
          </label>

          <p
            v-if="excessRub > 0"
            class="text-xs text-muted"
            data-test="finance-deposit-excess"
          >
            Сверх остатка — {{ formatRub(excessRub) }}. Залог покроется, а излишек
            станет обычным переводом: он виден в движении и пойдёт в расчёты.
          </p>

          <p
            v-else-if="!isValidAmount"
            class="text-xs text-red-600"
            data-test="finance-deposit-amount-error"
          >
            Сумма — целое число рублей больше нуля.
          </p>
        </div>

        <p v-if="error" class="text-sm text-red-600" data-test="finance-deposit-error">
          {{ error }}
        </p>

        <div class="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            :disabled="
              isSaving ||
              selected === null ||
              selectedSender === null ||
              !isValidAmount
            "
            data-test="finance-deposit-save"
          >
            {{ isSaving ? 'Записываем…' : `Я передал ${formatRub(amount ?? 0)}` }}
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
