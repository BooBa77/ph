<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import { sendConversationMessage } from '@/api/conversations'
import { ApiError } from '@/api/errors'
import { confirmTripCompensation } from '@/api/finance'
import { closeNotification } from '@/api/notifications'
import { useNotificationsStore } from '@/stores/notifications'
import type { AppNotification } from '@/types/notifications'
import { conversationTime } from '@/utils/conversations'
import { chatUnreadOf, isChatNotification, openAlmanacSection } from '@/utils/notifications'

/**
 * Карточка уведомления — одна на колонку и мобильную панель (24.11.2026).
 *
 * Карточка раскрывается в текст и кнопки **своего вида** (§14.2): деньги
 * подтверждают, просьба о платеже ведёт в «Бухгалтерию», альманах
 * предлагает «ОК» и переход в гостевую, чаты дают последние сообщения
 * и быстрый ответ. Общая на две поверхности намеренно: правила одной
 * карточки в двух копиях разошлись бы при первой правке — ровно так
 * колонка и мобильная панель однажды уже считали непрочитанное по-разному.
 *
 * **Раскрыта всегда одна карточка.** Это решает родитель (`expandedId`),
 * карточка лишь сообщает о клике: иначе выбор второй карточки оставлял бы
 * первую открытой, а панель 352 px на две раскрытые не рассчитана.
 *
 * **Чего карточка не делает.** Не архивирует деньги: «ОК» для них сервер
 * отвергнет (`400`), а состояние перевода меняет только подтверждение или
 * оплата. Клиента архива здесь нет — экрана архива в этом шаге нет
 * (§10 п.8).
 */
const props = defineProps<{
  notification: AppNotification
  expanded: boolean
  /** Префикс `data-test`: у колонки `rail`, у мобильной панели `mobile-messages`. */
  testPrefix: string
}>()

const emit = defineEmits<{ toggle: [] }>()

const router = useRouter()
const store = useNotificationsStore()

/** Ответ в поле: и «Сообщение отправителю», и быстрый ответ в чат. */
const draft = ref('')
const error = ref<string | null>(null)
const isBusy = ref(false)

const item = computed(() => props.notification)
const isChat = computed(() => isChatNotification(item.value))
const isTransfer = computed(() => item.value.kind === 'money_transfer')
const isPaymentRequest = computed(() => item.value.kind === 'payment_request')
const isAlmanac = computed(() => item.value.kind === 'almanac')
const isDirectChat = computed(() => item.value.kind === 'direct_chat')
const unread = computed(() => chatUnreadOf(item.value))

/** Подтверждение возможно, только если сервер дал и поход, и перевод. */
const canConfirm = computed(
  () =>
    isTransfer.value &&
    item.value.tripId !== null &&
    item.value.compensationId !== null,
)

function plain(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function describe(problem: unknown, fallback: string): string {
  return problem instanceof ApiError ? problem.message : fallback
}

/**
 * «Подтвердить» — та же ручка, что у «Бухгалтерии».
 *
 * Она архивирует карточку с причиной `confirmed` на сервере, поэтому
 * отдельного id действия искать не нужно: ответ на перевод один, и его
 * состояние живёт в компенсации, а не в карточке. После ответа секции
 * перечитываются: карточка исчезает, счётчик уменьшается.
 */
async function confirm(): Promise<void> {
  const { tripId, compensationId } = item.value

  if (!canConfirm.value || tripId === null || compensationId === null) return
  if (isBusy.value) return

  isBusy.value = true
  error.value = null

  try {
    await confirmTripCompensation(tripId, compensationId)
    await store.refresh()
  } catch (problem) {
    error.value = describe(problem, 'Не удалось подтвердить перевод')
  } finally {
    isBusy.value = false
  }
}

/**
 * «OK» — убрать карточку без архива.
 *
 * Так закрываются чаты и альманах: следующее новое сообщение или редакция
 * заведёт карточку заново. Деньгам кнопка не рисуется вовсе.
 */
async function markOk(): Promise<void> {
  if (isBusy.value) return

  isBusy.value = true
  error.value = null

  try {
    await closeNotification(item.value.id)
    await store.refresh()
  } catch (problem) {
    error.value = describe(problem, 'Не удалось закрыть уведомление')
  } finally {
    isBusy.value = false
  }
}

/**
 * Поле ответа — обычное личное сообщение.
 *
 * У денег это «Сообщение отправителю»: уходит в диалог через обычную ручку
 * сообщений и **таймер автосогласия не трогает** — через 72 часа перевод
 * засчитается сам, а реплика «деньги ещё не пришли» останется в переписке.
 * У чатов — быстрый ответ, чтобы не открывать экран.
 */
async function send(): Promise<void> {
  const body = draft.value.trim()
  const conversationId = item.value.conversationId

  if (!body || conversationId === null || isBusy.value) return

  isBusy.value = true
  error.value = null

  try {
    await sendConversationMessage(conversationId, body)
    draft.value = ''
    // Предпросмотр карточки собирает сервер из сообщений: своё сообщение
    // появится в нём только после перечитывания.
    await store.refresh()
  } catch (problem) {
    error.value = describe(problem, 'Не удалось отправить сообщение')
  } finally {
    isBusy.value = false
  }
}

/** «Перейти» у просьбы о платеже — «Бухгалтерия» похода. */
function goFinance(): void {
  if (item.value.tripId === null) return

  void router.push({ path: `/trips/${item.value.tripId}`, query: { tab: 'finance' } })
}

/**
 * «Перейти» у альманаха — гостевая похода с раскрытой секцией.
 *
 * Секция «Альманах» сворачиваемая и помнит состояние в `localStorage`
 * (`GuestTripView.vue`); без записи перехода человек попал бы на свёрнутую
 * секцию и не увидел, о чём уведомление.
 */
function goAlmanac(): void {
  if (item.value.tripId === null) return

  openAlmanacSection(item.value.tripId)
  void router.push({ path: `/trips/${item.value.tripId}`, query: { tab: 'guest' } })
}

/** «Открыть чат» у личного сообщения — экран переписки. */
function openDirectChat(): void {
  if (item.value.conversationId === null) return

  void router.push(`/messages/${item.value.conversationId}`)
}
</script>

<template>
  <article
    class="rounded-xl border border-border bg-bg"
    :data-test="`${testPrefix}-card-${item.id}`"
  >
    <button
      type="button"
      class="flex w-full cursor-pointer items-start gap-2 px-2 py-2 text-left"
      :aria-expanded="expanded"
      @click="emit('toggle')"
    >
      <span class="min-w-0 flex-1">
        <span class="flex items-baseline gap-2">
          <span
            class="truncate text-sm text-text"
            :class="unread > 0 ? 'font-semibold' : ''"
            :data-test="`${testPrefix}-title-${item.id}`"
          >
            {{ item.title }}
          </span>
          <span class="ml-auto shrink-0 text-xs text-muted">
            {{ conversationTime(item.updatedAt) }}
          </span>
        </span>

        <!--
          У чатов подпись — последнее сообщение из превью, а у денег,
          просьбы и альманаха — текст карточки. Превью показывается
          в раскрытии целиком, но одну строку видно и в заголовке.
        -->
        <span class="mt-0.5 line-clamp-2 block text-xs text-muted">
          {{ isChat ? plain(item.preview.at(-1)?.body ?? item.body) : plain(item.body) }}
        </span>
      </span>

      <span
        v-if="unread > 0"
        class="shrink-0 rounded-full bg-primary px-1.5 text-xs font-medium text-white"
        :data-test="`${testPrefix}-unread-${item.id}`"
      >
        {{ unread }}
      </span>
    </button>

    <div v-if="expanded" class="flex flex-col gap-2 px-2 pb-2">
      <p
        v-if="error"
        class="text-xs text-red-600"
        :data-test="`${testPrefix}-error`"
      >
        {{ error }}
      </p>

      <!--
        Текст карточки целиком — только у нечатов. У чата вместо текста
        последние сообщения: заголовок уже показывает последнее, повторять
        его абзацем незачем.
      -->
      <p v-if="!isChat" class="text-xs leading-relaxed text-text">
        {{ plain(item.body) }}
      </p>

      <ol
        v-if="isChat && item.preview.length > 0"
        class="flex flex-col gap-1"
        :data-test="`${testPrefix}-messages-${item.id}`"
      >
        <li
          v-for="message in item.preview"
          :key="message.id"
          class="rounded-lg bg-field px-2 py-1"
        >
          <span class="block text-xs font-medium text-text">
            {{ message.senderName ?? 'Кто-то' }}
          </span>
          <span class="line-clamp-3 block text-xs leading-relaxed text-text">
            {{ plain(message.body) }}
          </span>
        </li>
      </ol>

      <!-- Поле ответа: «Сообщение отправителю» у денег, быстрый ответ у чатов. -->
      <div v-if="isChat || isTransfer" class="flex gap-1">
        <input
          v-model="draft"
          type="text"
          class="min-w-0 flex-1 rounded-lg border border-border bg-field px-2 py-1 text-xs text-text outline-none focus:border-primary"
          :placeholder="isTransfer ? 'Сообщение отправителю:' : 'Ответить…'"
          :aria-label="isTransfer ? 'Сообщение отправителю' : 'Быстрый ответ'"
          :data-test="`${testPrefix}-reply-input`"
        />
        <button
          type="button"
          class="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs text-text disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!draft.trim() || isBusy"
          :data-test="`${testPrefix}-reply-send`"
          @click="send()"
        >
          →
        </button>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button
          v-if="canConfirm"
          type="button"
          class="cursor-pointer rounded-lg bg-primary px-2 py-1 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="isBusy"
          :data-test="`${testPrefix}-confirm`"
          @click="confirm()"
        >
          Подтвердить
        </button>

        <button
          v-if="isPaymentRequest"
          type="button"
          class="cursor-pointer rounded-lg bg-primary px-2 py-1 text-xs font-medium text-white"
          :data-test="`${testPrefix}-go-finance`"
          @click="goFinance()"
        >
          Перейти
        </button>

        <button
          v-if="isAlmanac"
          type="button"
          class="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs text-text"
          :data-test="`${testPrefix}-go-almanac`"
          @click="goAlmanac()"
        >
          Перейти
        </button>

        <button
          v-if="isChat || isAlmanac"
          type="button"
          class="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs text-text disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="isBusy"
          :data-test="`${testPrefix}-ok`"
          @click="markOk()"
        >
          ОК
        </button>

        <button
          v-if="isDirectChat"
          type="button"
          class="ml-auto cursor-pointer text-xs text-primary underline-offset-2 hover:underline"
          :data-test="`${testPrefix}-open-chat`"
          @click="openDirectChat()"
        >
          Открыть чат
        </button>
      </div>
    </div>
  </article>
</template>
