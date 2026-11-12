<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { ApiError } from '@/api/errors'
import { createTripCompensation } from '@/api/finance'
import type { CompensationSender, TripFinance } from '@/types/finance'
import { compensationRequisites, noRequisitesPhrase } from '@/utils/finance'
import { formatRub, parseRub } from '@/utils/money'

/**
 * «Компенсация» — «я перевёл тебе столько» (12.11.2026).
 *
 * Слова заказчика: «Модалка „Компенсация“ — выбор участника, кому должен
 * пользователь и сумма (подставляется автоматически, можно редактировать).
 * По выбранному участнику отображается его реквизиты из Профиля в виде
 * подсказки, если нет, то надпись „получатель <имя>“».
 *
 * **Варианты считает сервер** (`compensationOptions`). С 12.11.2026 вариант —
 * **семья целиком**: Вася и Аня стоят одной строкой, а сумма — `min(долг
 * моей семьи, кредит этой)`. Поэтому в варианте список людей, реквизиты
 * показываются у всех, у кого они есть, а отсутствие объясняется словами
 * заказчика («придётся спросить у них самих»).
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
  /** Я — смотрящий: первый отправитель в выборе. */
  meId?: string
  /**
   * От кого можно переводить: я и люди без аккаунта, которых я веду.
   * Варианты получателей считает сервер для каждого отправителя.
   */
  senders: CompensationSender[]
}>()

const emit = defineEmits<{
  /** Сервер вернул вкладку целиком — родитель заменяет состояние. */
  saved: [view: TripFinance]
  /** Сервер говорит, что переводить нечего: подсказки на экране устарели. */
  stale: []
  close: []
}>()

/**
 * Выбранный вариант — по первому человеку семьи: он же уходит на сервер
 * как `toUserId`, а семью сервер восстановит по родству сам.
 *
 * **Отправителей может быть несколько** (12.11.2026): я и люди без
 * аккаунта, которых я веду. У каждого свои подсказки — их посчитал сервер.
 * По умолчанию выбираю себя, если мне есть кому переводить.
 */
const initialSender = computed(
  () =>
    props.senders.find(
      (sender) =>
        sender.userId === props.meId && sender.suggestions.length > 0,
    ) ??
    props.senders.find((sender) => sender.suggestions.length > 0) ??
    props.senders[0] ??
    null,
)

const selectedSenderId = ref(initialSender.value?.userId ?? '')

const selectedSender = computed(
  () => props.senders.find((sender) => sender.userId === selectedSenderId.value) ?? null,
)

const suggestions = computed(() => selectedSender.value?.suggestions ?? [])

const selectedUserId = ref(suggestions.value[0]?.userIds[0] ?? '')
const amount = ref(String(suggestions.value[0]?.amountRub ?? ''))

const isSaving = ref(false)
const error = ref<string | null>(null)

const selected = computed(
  () =>
    suggestions.value.find((option) => option.userIds[0] === selectedUserId.value) ?? null,
)

/** Потолок суммы — остаток долга выбранного отправителя этой семье. */
const maxAmount = computed(() => selected.value?.amountRub ?? 0)

const requisitesList = computed(() =>
  selected.value === null ? [] : compensationRequisites(selected.value),
)

const noRequisitesText = computed(() => {
  if (selected.value === null) return ''

  return noRequisitesPhrase(selected.value)
})

/**
 * Почему переводить некому — про **выбранного отправителя**, а не про
 * смотрящего.
 *
 * 12.11.2026 заказчик спросил, о ком фраза «вам никто не должен»: о семье
 * или лично о человеке без аккаунта. Ответ: о выбранном в «Кто переводит» —
 * подсказки считаются для него, а у виртуального семьи нет, поэтому его
 * «семья» — он сам. Прежний текст обращался к смотрящему и в этом случае
 * врал; новый называет отправителя и говорит, чего именно не хватает.
 */
const senderIsMe = computed(
  () => selectedSenderId.value === '' || selectedSenderId.value === props.meId,
)

const emptyHint = computed(() => {
  const sender = selectedSender.value
  if (sender === null) {
    return 'Переводить некому: с учётом ожидающих переводов переводить нечего.'
  }

  if (sender.familyDebtRub > 0) {
    return 'Переводить некому: свободный кредит получателей уже занят ожидающими переводами.'
  }

  return senderIsMe.value
    ? 'Переводить некому: у твоей семьи долга с учётом ожидающих переводов нет.'
    : `Переводить некому: ${sender.displayName} — долга с учётом ожидающих переводов нет.`
})

/**
 * Смена варианта подставляет его сумму заново: подсказка у каждой семьи
 * своя, и прежняя цифра после переключения была бы суммой «не той».
 */
watch(selectedUserId, (userId) => {
  const option = suggestions.value.find((item) => item.userIds[0] === userId)
  if (option) amount.value = String(option.amountRub)
  error.value = null
})

/** Смена отправителя — свои подсказки, значит и первый вариант свой. */
watch(selectedSenderId, () => {
  const first = suggestions.value[0]

  selectedUserId.value = first?.userIds[0] ?? ''
  amount.value = String(first?.amountRub ?? '')
  error.value = null
})

/**
 * Родитель перечитал вкладку, и выбранной семьи в подсказках больше нет
 * (перевод сделан, кредит забронирован). Не оставляем радиокнопку, которой
 * нет ни в списке, ни в ответе сервера, — выбираем первый живой вариант.
 */
watch(suggestions, (list) => {
  if (list.some((option) => option.userIds[0] === selectedUserId.value)) return

  selectedUserId.value = list[0]?.userIds[0] ?? ''
  amount.value = String(list[0]?.amountRub ?? '')
})

/** Отправителя убрали из ответа (перевод подтвердили) — выбираем живого. */
watch(
  () => props.senders,
  (list) => {
    if (list.some((sender) => sender.userId === selectedSenderId.value)) return

    selectedSenderId.value = initialSender.value?.userId ?? ''
  },
)

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback
}

async function save(): Promise<void> {
  if (isSaving.value || selected.value === null) return

  error.value = null

  const sum = parseRub(amount.value)
  if (sum === null) {
    error.value = 'Укажи сумму перевода'
    return
  }
  if (sum === undefined) {
    error.value = 'Сумма — целое число рублей, больше нуля'
    return
  }
  if (sum > maxAmount.value) {
    error.value = `Больше остатка — можно ${formatRub(maxAmount.value)}`
    return
  }

  isSaving.value = true

  try {
    emit(
      'saved',
      await createTripCompensation(props.tripId, {
        toUserId: selected.value.userIds[0]!,
        amountRub: sum,
        // Себя сервер знает по токену; поле шлём, только когда переводит
        // человек без аккаунта, которого мы ведём.
        ...(selectedSenderId.value === '' || selectedSenderId.value === props.meId
          ? {}
          : { fromUserId: selectedSenderId.value }),
      }),
    )
  } catch (problem) {
    error.value = messageOf(problem, 'Не удалось записать компенсацию')

    // 400 про остаток значит, что деньги изменились после загрузки вкладки.
    // Родитель перечитает её, а сообщение сервера останется — оно правдиво.
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

      <!-- Текст заказчика дословно (12.11.2026), тремя абзацами -->
      <div class="flex flex-col gap-1 text-xs text-muted" data-test="finance-compensation-note">
        <p>Запись значит «я перевёл». Получателю требуется подтвердить получение.</p>
        <p>
          Расчёт произведён по всем расходам и оптимизирован для наименьшего количества
          транзакций.
        </p>
        <p>
          Не смущайся если Вася оплатил твой шулэн, а предлагается перевод Коле, значит Вася
          должен Коле
        </p>
      </div>

      <!--
        От кого перевод. Несколько отправителей — только люди без аккаунта,
        которых ведёт смотрящий: у них нет входа, за них действует он.
      -->
      <label
        v-if="senders.length > 1"
        class="flex flex-col gap-1 text-xs text-muted"
        data-test="finance-compensation-sender"
      >
        Кто переводит
        <select
          v-model="selectedSenderId"
          class="w-full cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
          data-test="finance-compensation-sender-select"
        >
          <option v-for="sender in senders" :key="sender.userId" :value="sender.userId">
            {{ sender.displayName }}
          </option>
        </select>
      </label>

      <p
        v-if="suggestions.length === 0"
        class="text-sm text-muted"
        data-test="finance-compensation-empty"
      >
        {{ emptyHint }}
      </p>

      <template v-else>
        <fieldset class="flex flex-col gap-1" data-test="finance-compensation-people">
          <legend class="text-xs text-muted">Кому переводишь</legend>

          <label
            v-for="option in suggestions"
            :key="option.userIds[0]"
            class="flex cursor-pointer items-baseline gap-2 rounded-xl border px-3 py-2 text-sm transition-colors"
            :class="
              selectedUserId === option.userIds[0]
                ? 'border-primary bg-field'
                : 'border-border bg-surface hover:border-primary'
            "
          >
            <input
              v-model="selectedUserId"
              type="radio"
              name="finance-compensation-to"
              class="h-4 w-4 cursor-pointer accent-[var(--theme-primary)]"
              :value="option.userIds[0]"
              :data-test="`finance-compensation-to-${option.userIds[0]}`"
            />
            <span class="text-text">{{ option.displayName }}</span>
            <span class="ml-auto whitespace-nowrap text-xs text-muted">
              {{ formatRub(option.amountRub) }}
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

        <!-- Реквизиты всех, у кого они есть: у семьи их может быть несколько -->
        <div
          class="flex flex-col gap-2 rounded-xl border border-border bg-field p-3 text-sm"
          data-test="finance-compensation-requisites"
        >
          <template v-if="requisitesList.length > 0">
            <div v-for="person in requisitesList" :key="person.userId">
              <p class="text-xs text-muted">Перевести → {{ person.displayName }}</p>
              <p class="mt-1 text-text" data-test="finance-compensation-details">
                {{ person.paymentDetails }}
              </p>
              <p
                v-if="person.paymentBank"
                class="text-xs text-muted"
                data-test="finance-compensation-bank"
              >
                {{ person.paymentBank }}
              </p>
            </div>
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
