<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'

import { setConversationMuted } from '@/api/conversations'
import { ApiError } from '@/api/errors'
import {
  deleteTripMessage,
  editTripMessage,
  listTripChats,
  listTripMessages,
  sendTripMessage,
} from '@/api/trips'
import MarkdownEditor from '@/components/ui/MarkdownEditor.vue'
import { useAuthStore } from '@/stores/auth'
import { useConversationsStore } from '@/stores/conversations'
import { markdownToHtml } from '@/utils/markdown'
import { CHAT_KIND_LABELS, type ChatKind, type TripChat as ChatInfo, type TripMessage } from '@/types/trips'

/**
 * Чат похода: гостевой — на «Гостевой», членский — на «Участниках».
 *
 * Переписка на бэкенде готова с Ф1; здесь только экран: страница сообщений,
 * отправка и системные сообщения. Отдельной вкладки «Чаты» нет — цель,
 * к которой шли с самого начала: чат живёт внутри своей вкладки
 * (`tabs.md` §7).
 *
 * **Действия в сообщениях** (денежные подтверждения) сюда не рисуются:
 * они нужны Бухгалтерии, а не походному чату. Ответ приходит в DTO, но
 * кнопок «Да/Нет» здесь нет.
 *
 * **Галочка «Уведомлять об этом чате»** (23.11.2026) — та же настройка,
 * что «Скрыть чат» в правой колонке: `conversation_members.muted_at`.
 * Заказчик просил её и под самим чатом. Сам чат открыт по паре
 * «поход + вид», а галочке нужен id диалога, поэтому список чатов
 * похода читается отдельно (`GET /trips/:id/chats`); там же приходит
 * текущее состояние. Гостю публичного похода галочка не показывается:
 * глушить ему нечего, а ручка ответила бы 403.
 */
const props = defineProps<{ tripId: string; kind: ChatKind }>()

const messages = ref<TripMessage[]>([])
const chat = ref<ChatInfo | null>(null)
const isLoading = ref(true)
const isSending = ref(false)
const isMuting = ref(false)
const error = ref<string | null>(null)
const muteError = ref<string | null>(null)
const draft = ref('')

const listEl = ref<HTMLElement | null>(null)

/**
 * Правка и удаление своего сообщения в чате похода (25.11.2026).
 *
 * Те же правила, что на экране диалога: правится одна строка за раз, чужое
 * и системное не трогается, денежные сообщения сервер не даст править.
 * Подтверждение удаления — на месте, а не `window.confirm`: нативный диалог
 * блокирует вкладку и живую проверку через CDP.
 */
const editingId = ref<string | null>(null)
const editDraft = ref('')
const isSavingEdit = ref(false)
const deletingId = ref<string | null>(null)
const isDeleting = ref(false)

const auth = useAuthStore()

/** Мой id: по нему отличаем свои сообщения от чужих. */
const myId = computed(() => auth.user?.id ?? null)

const title = computed(() => CHAT_KIND_LABELS[props.kind])

/** Своё ли сообщение: системное автора не имеет и своим не бывает. */
function isOwn(message: TripMessage): boolean {
  return message.senderId !== null && message.senderId === myId.value
}

/** Можно ли править и удалять: только своё и только реплику. */
function canModify(message: TripMessage): boolean {
  if (message.isSystem || !isOwn(message)) return false

  return message.action === null || message.action === undefined
}

function startEdit(message: TripMessage): void {
  if (!canModify(message) || isSavingEdit.value) return

  editingId.value = message.id
  editDraft.value = message.body
  deletingId.value = null
  error.value = null
}

function cancelEdit(): void {
  editingId.value = null
  editDraft.value = ''
}

/**
 * Сохранить правку: ответ ручки — уже новое сообщение, история не
 * перечитывается. Собеседнику текст приходит кадром `message_updated`.
 */
async function saveEdit(): Promise<void> {
  const messageId = editingId.value
  const body = editDraft.value.trim()

  if (!messageId || !body || isSavingEdit.value) return

  isSavingEdit.value = true
  error.value = null

  try {
    const updated = await editTripMessage(
      props.tripId,
      props.kind,
      messageId,
      body,
    )

    messages.value = messages.value.map((message) =>
      message.id === updated.id ? updated : message,
    )
    editingId.value = null
    editDraft.value = ''
  } catch (problem) {
    error.value =
      problem instanceof ApiError ? problem.message : 'Не удалось изменить сообщение'
  } finally {
    isSavingEdit.value = false
  }
}

function askDelete(message: TripMessage): void {
  if (!canModify(message) || isDeleting.value) return

  deletingId.value = message.id
  editingId.value = null
  error.value = null
}

function cancelDelete(): void {
  deletingId.value = null
}

/** Удалить сообщение физически: строки в базе и в списке больше нет. */
async function confirmDelete(): Promise<void> {
  const messageId = deletingId.value

  if (!messageId || isDeleting.value) return

  isDeleting.value = true
  error.value = null

  try {
    await deleteTripMessage(props.tripId, props.kind, messageId)

    messages.value = messages.value.filter((message) => message.id !== messageId)
    deletingId.value = null
  } catch (problem) {
    error.value =
      problem instanceof ApiError ? problem.message : 'Не удалось удалить сообщение'
  } finally {
    isDeleting.value = false
  }
}

/** Время сообщения: «14:05». Полную дату здесь не показываем — шум. */
function time(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Тело сообщения — markdown. Имена объектов не подставляем: в чате
 * ссылки на объекты не нужны, а лишний запрос за ними — на каждое
 * сообщение.
 */
function bodyHtml(message: TripMessage): string {
  return markdownToHtml(message.body, {}, {})
}

async function scrollToBottom() {
  await nextTick()
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
}

async function load() {
  isLoading.value = true
  error.value = null
  editingId.value = null
  editDraft.value = ''
  deletingId.value = null

  try {
    const page = await listTripMessages(props.tripId, props.kind)
    messages.value = page.messages
    await scrollToBottom()
  } catch (problem) {
    error.value =
      problem instanceof ApiError ? problem.message : 'Не удалось загрузить чат'
  } finally {
    isLoading.value = false
  }
}

async function send() {
  const body = draft.value.trim()
  if (!body || isSending.value) return

  isSending.value = true
  error.value = null

  try {
    const message = await sendTripMessage(props.tripId, props.kind, body)
    messages.value.push(message)
    draft.value = ''
    await scrollToBottom()
  } catch (problem) {
    error.value =
      problem instanceof ApiError ? problem.message : 'Не удалось отправить сообщение'
  } finally {
    isSending.value = false
  }
}

onMounted(load)

/**
 * Загрузить состояние галочки.
 *
 * Отдельно от сообщений и с глушением ошибки: если список чатов не пришёл,
 * переписка всё равно читается — просто без галочки. Ронять весь чат
 * из-за настройки уведомлений незачем.
 */
async function loadChatState(): Promise<void> {
  try {
    const chats = await listTripChats(props.tripId)
    chat.value = chats.find((row) => row.kind === props.kind) ?? null
  } catch {
    chat.value = null
  }
}

onMounted(loadChatState)

/**
 * Переписанный текст в открытом чате (24.11.2026).
 *
 * Поток событий переписки держит стор ленты (`stores/conversations.ts`) —
 * здесь только наблюдатель, своего соединения чат не открывает. Событие
 * `message_updated` значит «сообщение изменилось»: заменяем тело уже
 * показанной строки, а не дописываем вторую. Новые сообщения и «прочитано»
 * этот слушатель не трогает: живость самого чата похода — отдельный шаг.
 *
 * Диалог узнаётся по id из `GET /trips/:id/chats`: у чата похода нет
 * своего id в адресе экрана.
 */
const feed = useConversationsStore()

/**
 * Держать ленту, пока чат открыт (25.11.2026).
 *
 * Правая колонка и мобильная панель с 24.11.2026 держат стор уведомлений:
 * до этого поток переписки был открыт и на вкладке чата, а после переезда
 * его перестал открывать кто-либо, и наблюдатель ниже молчал. `hold()`
 * заводит поток на первого держателя и снимает на последнем.
 */
const releaseFeed = feed.hold()

const stopEvents = feed.onEvent((event) => {
  const conversationId = chat.value?.id

  if (
    !conversationId ||
    (event.kind !== 'message_updated' && event.kind !== 'message_deleted')
  ) {
    return
  }

  if (String(event.conversationId) !== conversationId) return

  const { messageId } = event

  if (messageId === undefined) return

  if (event.kind === 'message_deleted') {
    // Удалённой строки в базе нет — убираем её и из списка, а не черкаем.
    messages.value = messages.value.filter((message) => message.id !== messageId)

    if (editingId.value === messageId) cancelEdit()
    if (deletingId.value === messageId) deletingId.value = null

    return
  }

  const { body } = event

  if (body === undefined) return

  messages.value = messages.value.map((message) =>
    message.id === messageId ? { ...message, body } : message,
  )
})

onUnmounted(stopEvents)
onUnmounted(releaseFeed)

/**
 * Переключить «Уведомлять об этом чате».
 *
 * Состояние переключаем после ответа сервера, а не до: галочка — это
 * настройка, и показать её снятой, не сохранив, значит соврать. При ошибке
 * возвращаем её же в прежнее положение.
 */
async function toggleMuted(): Promise<void> {
  if (!chat.value || chat.value.muted === null || isMuting.value) return

  const next = !chat.value.muted

  isMuting.value = true
  muteError.value = null

  try {
    await setConversationMuted(chat.value.id, next)
    chat.value = { ...chat.value, muted: next }
  } catch (problem) {
    muteError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось изменить уведомления'
    // Тот же объект — Vue не перерисует, а чекбокс человек уже переключил.
    chat.value = { ...chat.value }
  } finally {
    isMuting.value = false
  }
}
</script>

<template>
  <section class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4" data-test="trip-chat">
    <h2 class="text-sm text-muted">{{ title }}</h2>

    <p v-if="isLoading" class="text-sm text-muted" data-test="chat-loading">Загружаем…</p>

    <p v-else-if="error" class="text-sm text-muted" data-test="chat-error">{{ error }}</p>

    <p v-else-if="messages.length === 0" class="text-sm text-muted" data-test="chat-empty">
      Пока пусто — напиши первым.
    </p>

    <ol
      v-else
      ref="listEl"
      class="flex max-h-80 flex-col gap-2 overflow-y-auto"
      data-test="chat-messages"
    >
      <li v-for="message in messages" :key="message.id" :data-test="`chat-message-${message.id}`">
        <div v-if="message.isSystem" class="text-center text-xs text-muted">
          {{ message.body }}
        </div>
        <div v-else class="rounded-xl bg-field px-3 py-2">
          <div class="flex items-baseline justify-between gap-2">
            <span class="text-xs font-medium text-text">
              {{ message.senderName ?? 'Кто-то' }}
            </span>
            <span class="text-xs text-muted">{{ time(message.createdAt) }}</span>
          </div>

          <div
            v-if="editingId === message.id"
            class="mt-1 flex flex-col gap-2"
            data-test="chat-edit-form"
          >
            <textarea
              v-model="editDraft"
              rows="2"
              class="w-full resize-y rounded-xl border border-border bg-field px-3 py-2 text-sm text-text outline-none focus:border-primary"
              aria-label="Новый текст сообщения"
              data-test="chat-edit-input"
              @keydown.enter.exact.prevent="saveEdit"
            />
            <div class="flex justify-end gap-3 text-xs">
              <button
                type="button"
                class="cursor-pointer text-muted"
                data-test="chat-edit-cancel"
                @click="cancelEdit"
              >
                Отмена
              </button>
              <button
                type="button"
                class="cursor-pointer text-primary disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!editDraft.trim() || isSavingEdit"
                data-test="chat-edit-save"
                @click="saveEdit"
              >
                Сохранить
              </button>
            </div>
          </div>

          <div
            v-else
            class="chat-message text-sm leading-relaxed text-text"
            v-html="bodyHtml(message)"
          />

          <div
            v-if="deletingId === message.id"
            class="mt-1 flex flex-wrap items-center justify-end gap-2 text-xs"
            data-test="chat-delete-row"
          >
            <span class="text-muted">Удалить сообщение?</span>
            <button
              type="button"
              class="cursor-pointer text-muted"
              data-test="chat-delete-cancel"
              @click="cancelDelete"
            >
              Отмена
            </button>
            <button
              type="button"
              class="cursor-pointer text-primary disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="isDeleting"
              data-test="chat-delete-confirm"
              @click="confirmDelete"
            >
              Удалить
            </button>
          </div>

          <div
            v-else-if="canModify(message) && editingId !== message.id"
            class="mt-1 flex items-center justify-end gap-3 text-xs text-muted"
          >
            <button
              type="button"
              class="cursor-pointer underline-offset-2 hover:text-text hover:underline"
              data-test="chat-edit"
              @click="startEdit(message)"
            >
              Изменить
            </button>
            <button
              type="button"
              class="cursor-pointer underline-offset-2 hover:text-text hover:underline"
              data-test="chat-delete"
              @click="askDelete(message)"
            >
              Удалить
            </button>
          </div>
        </div>
      </li>
    </ol>

    <form class="flex flex-col gap-2" @submit.prevent="send">
      <MarkdownEditor
        v-model="draft"
        :objects="false"
        :emoji="true"
        min-height="4rem"
        placeholder="Написать в чат…"
      />
      <button
        type="submit"
        class="self-end cursor-pointer rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="!draft.trim() || isSending"
        data-test="chat-send"
      >
        Отправить
      </button>
    </form>

    <div v-if="chat && chat.muted !== null" class="flex flex-col gap-1 border-t border-border pt-2">
      <label class="flex cursor-pointer items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          class="h-4 w-4 cursor-pointer accent-primary"
          :checked="!chat.muted"
          :disabled="isMuting"
          data-test="chat-mute"
          @change="toggleMuted"
        />
        Уведомлять об этом чате
      </label>

      <p v-if="muteError" class="text-xs text-muted" data-test="chat-mute-error">
        {{ muteError }}
      </p>
    </div>
  </section>
</template>
