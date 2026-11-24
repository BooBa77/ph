<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import {
  getConversation,
  listConversationMessages,
  markConversationRead,
  sendConversationMessage,
  setConversationMuted,
} from '@/api/conversations'
import { ApiError } from '@/api/errors'
import { respondToAction } from '@/api/message-actions'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { useAuthStore } from '@/stores/auth'
import { useConversationsStore } from '@/stores/conversations'
import type { Conversation } from '@/types/conversations'
import type { TripMessage } from '@/types/trips'
import { tripTabOf } from '@/utils/chatTabs'
import {
  conversationHeading,
  isPaymentRequest,
  rowAction,
} from '@/utils/conversations'
import { markdownToHtml } from '@/utils/markdown'

/**
 * Экран диалога `/messages/:id` (23.11.2026).
 *
 * Зачем: правая колонка показывает три последних сообщения и даёт ответить
 * одной строкой, но полной переписки не было — у личного диалога кнопка
 * «Открыть чат» даже не показывалась, потому что вести было некуда.
 *
 * **Один экран на диалог, а не на вид чата.** Личный диалог и чат похода
 * отличаются шапкой (собеседник или «чат + поход») и тем, что у личного
 * есть отметка прочтения. Всё остальное — одно и то же, поэтому экран
 * один: `GET /api/conversations/:id` отдаёт диалог, и по `kind` решается,
 * что писать в шапке.
 *
 * **История вверх по курсору `before`.** Сервер листает по id сообщения,
 * а не по дате: две записи с одинаковым `created_at` — обычное дело,
 * и страница по дате либо зациклилась бы, либо теряла сообщения. Первая
 * страница — 50 сообщений; когда она кончается вверху, подгружается
 * предыдущая. Позиция прокрутки сохраняется: иначе чтение истории
 * прыгало бы к первому сообщению страницы.
 *
 * **«Прочитано» — на последнем своём сообщении.** В базе одна метка на
 * диалог (`peerLastReadAt`), точнее нарисовать нечем: по отдельным
 * сообщениям отметок нет, поэтому галочка стоит только на последнем —
 * «до этого места прочитано».
 *
 * **Живость (24.11.2026).** Поток на человека один, и держит его стор
 * ленты (`stores/conversations.ts`); экран только слушает событие. Чужое
 * сообщение дописывается в переписку, а не перечитывается: `row.lastMessage`
 * уже дотянут с сервера сторо́м, второго запроса за ним нет. «Прочитано»
 * приходит событием `read` — иначе оно появлялось бы только при повторном
 * открытии диалога.
 *
 * **Деньги на экране, а не только в ленте (24.11.2026).** «Подтверждаю»
 * и поле «Сообщение отправителю» жили в правой колонке и мобильной панели,
 * а на экране их не было: человек, открывший переписку по прямой ссылке,
 * подтвердить перевод не мог. Экран показывает то же действие диалога,
 * что и лента, — `Conversation.action` (`rowAction`), одно и выбранное
 * сервером. Свой ответ стор не применяет (`actorId` — мой), поэтому после
 * ответа экран сам перечитывает диалог и строку ленты.
 */
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

/** Размер страницы: столько же, сколько у чатов похода по умолчанию. */
const PAGE_SIZE = 50

const conversation = ref<Conversation | null>(null)
const messages = ref<TripMessage[]>([])
const hasMore = ref(false)
const isLoading = ref(true)
const isLoadingMore = ref(false)
const isSending = ref(false)
const isMuting = ref(false)
const error = ref<string | null>(null)
const muteError = ref<string | null>(null)
const draft = ref('')
/**
 * «Сообщение отправителю» к ответу на перевод (24.11.2026).
 *
 * Отдельно от `draft`: то поле — обычная отправка в чат, а это живёт в
 * карточке денежного действия и уходит либо вместе с «Подтверждаю», либо
 * само по себе обычным сообщением.
 */
const replyDraft = ref('')
/** Ответ на действие в полёте: два клика не должны отправить его дважды. */
const isAnswering = ref(false)
/** Ошибка карточки действия: остальные ошибки экрана живут выше. */
const actionError = ref<string | null>(null)

const listEl = ref<HTMLElement | null>(null)

/** Мой id: по нему отличаем свои сообщения от чужих. */
const myId = computed(() => auth.user?.id ?? null)

/** Заголовок шапки: имя собеседника или название чата. */
const heading = computed(() => conversation.value?.peer?.displayName ?? conversation.value?.title ?? '')

/**
 * Действие диалога — одно, и какое именно, решает сервер (24.11.2026).
 *
 * Берём то же поле, что лента (`utils/conversations.ts`): неразрешённый
 * перевод важнее просьбы о платеже. Своей логики выбора на экране нет —
 * иначе экран и колонка разошлись бы в том, что показывать, когда в диалоге
 * лежат оба.
 */
const action = computed(() => (conversation.value ? rowAction(conversation.value) : null))

/** Ждёт ли перевод моего «Подтверждаю»: у просьбы о платеже ответа нет. */
const isConfirmable = computed(() => action.value?.canRespond === true)

/** Просьба организатора о платеже: отвечать нечем, только «Перейти». */
const isPaymentRequestAction = computed(
  () => conversation.value !== null && isPaymentRequest(conversation.value),
)

/** Заголовок карточки: у перевода — сумма, у просьбы — словами. */
const actionTitle = computed(() => {
  const row = conversation.value

  if (!row) return ''

  return isConfirmable.value ? conversationHeading(row) : 'Организатор запросил платёж'
})

/** Свои сообщения — по правому краю. */
function isOwn(message: TripMessage): boolean {
  return message.senderId !== null && message.senderId === myId.value
}

/**
 * Последнее своё сообщение — единственное, на котором рисуется «Прочитано».
 *
 * Ищем с конца: новых сообщений больше, а нужно именно последнее. Если
 * после него я ничего не писал, метка собеседника относится и к нему.
 */
const lastOwnId = computed(() => {
  for (let index = messages.value.length - 1; index >= 0; index -= 1) {
    const message = messages.value[index]

    if (!message) continue
    if (!message.isSystem && isOwn(message)) return message.id
  }

  return null
})

/**
 * Прочитано ли сообщение собеседником.
 *
 * Метка одна на диалог, поэтому «прочитано» получают все мои сообщения,
 * созданные до неё. Сравниваем строки ISO: формат один и тот же, и
 * лексикографический порядок совпадает с временным.
 */
function isRead(message: TripMessage): boolean {
  const readAt = conversation.value?.peerLastReadAt

  return readAt !== null && readAt !== undefined && message.createdAt <= readAt
}

/**
 * Показывать ли «Прочитано» под сообщением.
 *
 * Только у личного диалога: у чата похода метки прочтения собеседника нет,
 * и «Прочитано» у всех подряд означало бы то, чего мы не знаем.
 */
function showReadMark(message: TripMessage): boolean {
  return (
    conversation.value?.kind === 'direct' &&
    message.id === lastOwnId.value &&
    isRead(message)
  )
}

/** Время сообщения: «14:05». Дату показываем только у старых, в подписи. */
function time(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Дата сообщения для разделителя: «23.11.2026». */
function day(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

/** Нужен ли перед сообщением разделитель с датой. */
function startsDay(index: number): boolean {
  if (index === 0) return true

  const current = messages.value[index]
  const previous = messages.value[index - 1]

  if (!current || !previous) return true

  return day(current.createdAt) !== day(previous.createdAt)
}

/** Тело сообщения — markdown, как в чатах похода; санитайз внутри рендера. */
function bodyHtml(message: TripMessage): string {
  return markdownToHtml(message.body, {}, {})
}

async function scrollToBottom(): Promise<void> {
  await nextTick()

  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
}

/**
 * Первое открытие: диалог, первая страница сообщений, отметка прочтения.
 *
 * Отметку ставим последней и молча: непрочитанное — счётчик в колонке,
 * а не условие показа переписки. Ошибка отметки не должна прятать чат.
 */
async function open(id: string): Promise<void> {
  isLoading.value = true
  error.value = null
  muteError.value = null
  conversation.value = null
  messages.value = []
  hasMore.value = false
  draft.value = ''
  replyDraft.value = ''
  actionError.value = null
  isAnswering.value = false

  try {
    conversation.value = await getConversation(id)
  } catch (problem) {
    error.value =
      problem instanceof ApiError && (problem.status === 403 || problem.status === 404)
        ? 'Диалог не найден или недоступен'
        : 'Не удалось открыть диалог'
    isLoading.value = false
    return
  }

  try {
    const page = await listConversationMessages(id, { limit: PAGE_SIZE })

    messages.value = page.messages
    hasMore.value = page.hasMore
  } catch (problem) {
    error.value =
      problem instanceof ApiError ? problem.message : 'Не удалось загрузить сообщения'
  } finally {
    isLoading.value = false
  }

  await scrollToBottom()

  try {
    await markConversationRead(id)
    // Сервер обнулил счётчик; строку ленты надо поправить здесь же, иначе
    // бейдж в колонке показывал бы прочитанный диалог до следующего опроса.
    feed.clearUnread(String(id))
  } catch {
    // Счётчик в колонке промолчит до следующего обновления — не беда.
  }
}

/**
 * Страница истории выше — по курсору `before`.
 *
 * Прокрутку держим на месте: после вставки сообщений сверху браузер
 * оставляет тот же `scrollTop`, и человек увидел бы не продолжение
 * истории, а её середину. Поэтому запоминаем высоту до и разницу
 * компенсируем после.
 */
async function loadOlder(): Promise<void> {
  const first = messages.value[0]

  if (!first || !hasMore.value || isLoadingMore.value) return

  isLoadingMore.value = true
  const list = listEl.value

  const before = list ? list.scrollHeight : 0
  const keepTop = list ? list.scrollTop : 0

  try {
    const page = await listConversationMessages(conversation.value?.id ?? '', {
      before: first.id,
      limit: PAGE_SIZE,
    })

    messages.value = [...page.messages, ...messages.value]
    hasMore.value = page.hasMore

    await nextTick()

    if (listEl.value && list) {
      listEl.value.scrollTop = listEl.value.scrollHeight - before + keepTop
    }
  } catch (problem) {
    error.value =
      problem instanceof ApiError ? problem.message : 'Не удалось загрузить историю'
  } finally {
    isLoadingMore.value = false
  }
}

/** Прокрутка вверх до предела подгружает предыдущую страницу. */
function onScroll(): void {
  const list = listEl.value

  if (list && list.scrollTop <= 24) void loadOlder()
}

async function send(): Promise<void> {
  const body = draft.value.trim()

  if (!body || isSending.value || !conversation.value) return

  isSending.value = true
  error.value = null

  try {
    const message = await sendConversationMessage(conversation.value.id, body)

    messages.value = [...messages.value, message]
    draft.value = ''
    // Строка ленты должна показать это же сообщение, а не прошлое: событие
    // своего автора стор не применяет, а ответ ручки уже всё принёс.
    feed.rememberMessage(conversation.value.id, message)
    await scrollToBottom()
  } catch (problem) {
    error.value =
      problem instanceof ApiError ? problem.message : 'Не удалось отправить сообщение'
  } finally {
    isSending.value = false
  }
}

/**
 * Перечитать диалог и строку ленты после ответа (24.11.2026).
 *
 * Своё действие стор не применяет: `actorId` события — мой id, и лента
 * ждала бы минуту опроса, а «Подтверждаю» висела бы на уже закрытом
 * переводе. Поэтому экран читает `GET /conversations/:id` сам — это же
 * приносит и обновлённое действие, и текст из поля «Сообщение отправителю»
 * последним сообщением, — а строку ленты перечитывает стор.
 */
async function reloadAfterAnswer(): Promise<void> {
  const row = conversation.value

  if (!row) return

  try {
    const fresh = await getConversation(row.id)

    conversation.value = fresh

    /**
     * Текст из поля сервер записал обычным сообщением. Своё сообщение
     * событием не приходит (`actorId` — мой), поэтому дописываем его из
     * `lastMessage`. Уже показанное — не дублируем: последнее сообщение
     * почти всегда есть в списке.
     */
    const incoming = fresh.lastMessage

    if (incoming && !messages.value.some((message) => message.id === incoming.id)) {
      messages.value = [...messages.value, incoming]
      await scrollToBottom()
    }
  } catch {
    // Ответ уже прошёл; ошибку чтения не показываем — следующий опрос
    // диалога догонит. Кнопка просто останется до перезагрузки экрана.
  }

  await feed.refresh()
}

/**
 * «Подтверждаю» — единственный ответ на перевод (24.11.2026).
 *
 * Кнопки «не получено» нет: она перевод не отменяла, а снимала
 * автосогласие и подвешивала строку навсегда. Ответ окончательный, поэтому
 * после него перечитываем диалог и ленту, а не ждём события.
 */
async function answer(): Promise<void> {
  const current = action.value

  if (!current || isAnswering.value) return

  isAnswering.value = true
  actionError.value = null

  try {
    await respondToAction(current.id, replyDraft.value)
    replyDraft.value = ''
    await reloadAfterAnswer()
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось ответить'
  } finally {
    isAnswering.value = false
  }
}

/**
 * Поле «Сообщение отправителю» без подтверждения (24.11.2026).
 *
 * «Деньги ещё не пришли, жду» — обычное сообщение в тот же диалог, а не
 * ответ на действие: таймер автосогласия продолжает идти, и через 72 часа
 * перевод засчитается сам. Перевод остаётся неразрешённым, поэтому после
 * отправки перечитываем то же, что после ответа: последнее сообщение
 * сменилось, а действие осталось.
 */
async function replyToSender(): Promise<void> {
  const row = conversation.value
  const body = replyDraft.value.trim()

  if (!row || !body || isAnswering.value) return

  isAnswering.value = true
  actionError.value = null

  try {
    const message = await sendConversationMessage(row.id, body)

    messages.value = [...messages.value, message]
    replyDraft.value = ''
    // Строка ленты должна показать это же сообщение: событие своего автора
    // стор не применяет, а ответ ручки уже всё принёс.
    feed.rememberMessage(row.id, message)
    await scrollToBottom()
    await reloadAfterAnswer()
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось отправить сообщение'
  } finally {
    isAnswering.value = false
  }
}

/**
 * «Перейти» из просьбы организатора о платеже (24.11.2026).
 *
 * Адрес — из `payload.tripId`: просьба приходит личным диалогом, и своей
 * привязки к походу у строки нет.
 */
function openFinance(): void {
  const tripId = action.value?.payload?.tripId

  if (typeof tripId !== 'string') return

  void router.push({ path: `/trips/${tripId}`, query: { tab: 'finance' } })
}

/**
 * Переключить «Уведомлять об этом чате».
 *
 * Состояние меняем после ответа сервера: галочка — настройка, и показать её
 * снятой, не сохранив, значит соврать. При ошибке возвращаем как было.
 */
async function toggleMuted(): Promise<void> {
  const row = conversation.value

  if (!row || isMuting.value) return

  const next = !row.muted

  isMuting.value = true
  muteError.value = null

  try {
    await setConversationMuted(row.id, next)
    conversation.value = { ...row, muted: next }
  } catch (problem) {
    muteError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось изменить уведомления'
    conversation.value = { ...row }
  } finally {
    isMuting.value = false
  }
}

/** Ссылка на поход для чата похода — в нужную вкладку. */
const tripLink = computed(() => {
  const row = conversation.value

  if (!row?.tripId) return null

  const tab = tripTabOf(row.kind)

  return { path: `/trips/${row.tripId}`, query: tab ? { tab } : {} }
})

function back(): void {
  router.back()
}

/**
 * Живое сообщение в открытом диалоге (24.11.2026).
 *
 * Подписка живёт, пока экран на экране: поток уже открыт сторо́м ленты,
 * поэтому это наблюдатель, а не соединение. `actorId` сравниваем со своим —
 * своё сообщение дописано ответом `POST /messages`, и второй раз его
 * вставлять нельзя.
 */
const feed = useConversationsStore()

const stopEvents = feed.onEvent((event, row) => {
  const openId = conversation.value?.id

  if (!openId || String(event.conversationId) !== openId) return
  if (event.actorId === myId.value) return

  if (event.kind === 'read') {
    if (!conversation.value) return
    conversation.value = { ...conversation.value, peerLastReadAt: event.at }
    return
  }

  /**
   * Сообщение переписали (24.11.2026) — заменяем тело уже показанной
   * строки, а не дописываем второе: заказчик просил, чтобы вместо просьбы
   * подтвердить в переписке оказалось объяснение «время вышло». Прокрутка
   * и «Прочитано» тут не при чём: сообщение не новое, место не меняется.
   */
  if (event.kind === 'message_updated') {
    const { messageId, body } = event

    if (messageId === undefined || body === undefined) return

    messages.value = messages.value.map((message) =>
      message.id === messageId ? { ...message, body } : message,
    )
    return
  }

  const incoming = row?.lastMessage
  const list = listEl.value
  /**
   * Прокрутку догоняем, только если человек читал последние сообщения.
   * Иначе приход нового сообщения выдернул бы его из истории, которую он
   * листает вверх.
   */
  const atBottom = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 120

  if (incoming && !messages.value.some((message) => message.id === incoming.id)) {
    messages.value = [...messages.value, incoming]
    if (atBottom) void scrollToBottom()
  }

  // Диалог открыт — пришедшее сообщение прочитано сразу: бейдж не растёт.
  if (row) void feed.markRead(row)
  else void feed.refresh()
})

onUnmounted(stopEvents)

watch(
  () => route.params.id,
  (id) => {
    if (typeof id === 'string' && id.length > 0) void open(id)
  },
  { immediate: true },
)
</script>

<template>
  <section class="flex flex-col gap-3" data-test="message-screen">
    <button
      type="button"
      class="self-start cursor-pointer text-sm text-muted transition-colors hover:text-text"
      data-test="message-back"
      @click="back"
    >
      ← Назад
    </button>

    <p v-if="isLoading" class="text-sm text-muted" data-test="message-loading">
      Загружаем переписку…
    </p>

    <template v-else-if="conversation">
      <!-- Шапка: с кем и о каком походе -->
      <header
        class="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
        data-test="message-header"
      >
        <UserAvatar
          v-if="conversation.peer"
          :src="conversation.peer.avatarUrl"
          :alt="conversation.peer.displayName"
          :size="40"
        />

        <div class="flex min-w-0 flex-col">
          <h1 class="truncate text-lg font-semibold text-text" data-test="message-title">
            {{ heading }}
          </h1>

          <RouterLink
            v-if="tripLink"
            :to="tripLink"
            class="truncate text-xs text-muted underline-offset-2 hover:text-text hover:underline"
            data-test="message-trip"
          >
            {{ conversation.tripTitle ?? 'Поход' }}
          </RouterLink>
        </div>

        <label class="ml-auto flex cursor-pointer items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            class="h-4 w-4 cursor-pointer accent-primary"
            :checked="!conversation.muted"
            :disabled="isMuting"
            data-test="message-mute"
            @change="toggleMuted"
          />
          Уведомлять об этом чате
        </label>
      </header>

      <p v-if="muteError" class="text-xs text-muted" data-test="message-mute-error">
        {{ muteError }}
      </p>

      <!--
        Действие диалога (24.11.2026). Та же карточка, что в правой колонке
        и мобильной панели, но на весь экран: человек, открывший переписку
        по прямой ссылке, должен подтвердить перевод здесь, а не искать
        колонку. Действие одно — его выбрал сервер (`Conversation.action`).
      -->
      <section
        v-if="action"
        class="flex flex-col gap-2 rounded-xl border border-border bg-surface px-4 py-3"
        data-test="message-action"
      >
        <p class="text-sm font-medium text-text" data-test="message-action-title">
          {{ actionTitle }}
        </p>

        <p
          v-if="actionError"
          class="text-xs text-muted"
          data-test="message-action-error"
        >
          {{ actionError }}
        </p>

        <template v-if="isConfirmable">
          <div class="flex gap-2">
            <input
              v-model="replyDraft"
              type="text"
              class="min-w-0 flex-1 rounded-xl border border-border bg-field px-3 py-2 text-sm text-text outline-none focus:border-primary"
              placeholder="Сообщение отправителю:"
              aria-label="Сообщение отправителю"
              data-test="message-reply-input"
            />
            <button
              type="button"
              class="shrink-0 cursor-pointer rounded-xl border border-border px-3 py-2 text-sm text-text disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!replyDraft.trim() || isAnswering"
              data-test="message-reply-send"
              @click="replyToSender"
            >
              →
            </button>
          </div>

          <button
            type="button"
            class="w-full cursor-pointer rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="isAnswering"
            data-test="message-confirm"
            @click="answer"
          >
            Подтверждаю
          </button>
        </template>

        <!-- Просьба организатора о платеже: отвечать нечем, только «Перейти». -->
        <button
          v-else-if="isPaymentRequestAction"
          type="button"
          class="w-full cursor-pointer rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white"
          data-test="message-go-finance"
          @click="openFinance"
        >
          Перейти
        </button>
      </section>

      <p v-if="error" class="text-sm text-muted" data-test="message-error">{{ error }}</p>

      <p
        v-if="messages.length === 0"
        class="text-sm text-muted"
        data-test="message-empty"
      >
        Пока пусто — напиши первым.
      </p>

      <ol
        v-else
        ref="listEl"
        class="flex max-h-[60vh] flex-col gap-2 overflow-y-auto rounded-xl border border-border bg-surface p-3"
        data-test="message-list"
        @scroll.passive="onScroll"
      >
        <li v-if="hasMore" class="text-center">
          <button
            type="button"
            class="cursor-pointer text-xs text-primary hover:underline disabled:opacity-50"
            :disabled="isLoadingMore"
            data-test="message-more"
            @click="loadOlder"
          >
            {{ isLoadingMore ? 'Загружаем…' : 'Показать более ранние' }}
          </button>
        </li>

        <li v-for="(message, index) in messages" :key="message.id" class="flex flex-col gap-1">
          <p
            v-if="startsDay(index)"
            class="text-center text-xs text-muted"
            :data-test="`message-day-${index}`"
          >
            {{ day(message.createdAt) }}
          </p>

          <div v-if="message.isSystem" class="text-center text-xs text-muted">
            {{ message.body }}
          </div>

          <div
            v-else
            class="max-w-[85%] rounded-xl px-3 py-2"
            :class="
              isOwn(message)
                ? 'self-end border border-primary/40 bg-primary/10'
                : 'self-start bg-field'
            "
            :data-test="`message-${message.id}`"
          >
            <div
              v-if="!isOwn(message) && conversation.kind !== 'direct'"
              class="mb-1 text-xs font-medium text-text"
            >
              {{ message.senderName ?? 'Кто-то' }}
            </div>

            <div
              class="chat-message text-sm leading-relaxed text-text"
              v-html="bodyHtml(message)"
            />

            <div class="mt-1 flex items-baseline justify-end gap-2 text-xs text-muted">
              <span data-test="message-read" v-if="showReadMark(message)">Прочитано</span>
              <span>{{ time(message.createdAt) }}</span>
            </div>
          </div>
        </li>
      </ol>

      <form class="flex flex-col gap-2" @submit.prevent="send">
        <textarea
          v-model="draft"
          rows="2"
          class="w-full resize-y rounded-xl border border-border bg-field px-3 py-2 text-sm text-text outline-none focus:border-primary"
          placeholder="Написать…"
          :aria-label="`Написать в ${heading}`"
          data-test="message-input"
          @keydown.enter.exact.prevent="send"
        />

        <button
          type="submit"
          class="self-end cursor-pointer rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!draft.trim() || isSending"
          data-test="message-send"
        >
          Отправить
        </button>
      </form>
    </template>

    <p v-else-if="error" class="text-sm text-muted" data-test="message-error">{{ error }}</p>
  </section>
</template>
