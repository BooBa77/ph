<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  listConversationMessages,
  listConversations,
  markConversationRead,
  sendConversationMessage,
  setConversationMuted,
} from '@/api/conversations'
import { ApiError } from '@/api/errors'
import { respondToAction } from '@/api/message-actions'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import type { Conversation } from '@/types/conversations'
import type { TripMessage } from '@/types/trips'
import { tripTabOf } from '@/utils/chatTabs'

/**
 * Правая колонка: лента сообщений и быстрый чат (23.11.2026).
 *
 * Заказчик: «в колонке заголовки сообщений, при клике сообщение
 * раскрывается». Раскрытие — не декорация: в нём три последних сообщения,
 * поле ввода и кнопки «Открыть чат» / «Скрыть чат». Полный экран переписки
 * для чатов похода по-прежнему не нужен — чат читается на своей вкладке,
 * а личные диалоги с 23.11.2026 открываются экраном `/messages/:id`.
 *
 * **Денежные действия — сверху.** Заказчик: «сообщениям про деньги
 * максимальный приоритет». Сортировка не по времени, а по срочности:
 * строки с неотвеченным действием всплывают над остальными, даже если
 * написаны раньше.
 *
 * **Лента выводится, а не хранится.** Отдельной таблицы уведомлений нет:
 * строка — это диалог с непрочитанным или действие, ждущее ответа.
 * Поэтому «прочитал» и «увидел» — одно и то же, и расходиться нечему.
 *
 * **Скрыть чат — это заглушить уведомления.** Диалог уходит из ленты
 * (и счётчик его не считает), но в самом чате похода непрочитанное
 * остаётся: галочка гасит напоминание, а не сообщения. Вернуть можно
 * внизу колонки — «Скрытые чаты».
 */
const router = useRouter()

/** Сколько символов влезает в раскрытую строку. */
const PREVIEW_CHARS = 300
/** Максимум сообщений в раскрытой строке. */
const PREVIEW_LIMIT = 3
/** Как часто обновлять ленту, пока вкладка открыта. */
const REFRESH_MS = 60_000

/**
 * Вкладка похода для вида чата: куда ведёт «Открыть чат».
 *
 * Таблица переехала в `utils/chatTabs.ts`: её же спрашивает экран диалога,
 * когда ссылается на поход из шапки.
 */
const conversations = ref<Conversation[]>([])
const isLoading = ref(true)
const error = ref<string | null>(null)
const expandedId = ref<string | null>(null)
const draft = ref('')
const previews = ref<Record<string, TripMessage[]>>({})
const isSending = ref(false)
const showMuted = ref(false)

/** Строки ленты: не заглушенные, срочные сверху. */
const visible = computed(() =>
  conversations.value
    .filter((row) => !row.muted)
    .sort(byImportance),
)

const mutedRows = computed(() => conversations.value.filter((row) => row.muted))

/** Счётчик в заголовке: заглушенные не считаются, их человек и гасил. */
const unreadTotal = computed(() =>
  conversations.value.reduce(
    (sum, row) => sum + (row.muted ? 0 : row.unreadCount),
    0,
  ),
)

function hasPendingAction(row: Conversation): boolean {
  return row.lastMessage?.action?.canRespond === true
}

/** Сначала ждущие ответа, потом по времени последнего сообщения. */
function byImportance(left: Conversation, right: Conversation): number {
  const leftUrgent = hasPendingAction(left) ? 1 : 0
  const rightUrgent = hasPendingAction(right) ? 1 : 0

  if (leftUrgent !== rightUrgent) return rightUrgent - leftUrgent

  const leftAt = left.lastMessage?.createdAt ?? ''
  const rightAt = right.lastMessage?.createdAt ?? ''

  return rightAt.localeCompare(leftAt)
}

function amountOf(row: Conversation): number | null {
  const amount = row.lastMessage?.action?.payload?.amountRub

  return typeof amount === 'number' ? amount : null
}

/** Заголовок строки: у денег — сумма, у остальных — имя или название чата. */
function heading(row: Conversation): string {
  const amount = amountOf(row)

  if (amount !== null && hasPendingAction(row)) {
    return `Перевод ${amount.toLocaleString('ru-RU')} ₽`
  }

  return row.peer?.displayName ?? row.title
}

/** Подпись под заголовком: поход для чатов, первая строка для людей. */
function subtitle(row: Conversation): string {
  if (row.tripId) {
    return row.tripTitle ? `${row.title} · ${row.tripTitle}` : row.title
  }

  return row.lastMessage?.body.replace(/\s+/g, ' ').slice(0, 80) ?? 'Пока пусто'
}

/** Время последнего сообщения: «14:05» для сегодняшних, «12.11» для старых. */
function timeLabel(iso: string | undefined): string {
  if (!iso) return ''

  const date = new Date(iso)
  const today = new Date()

  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  }

  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

/** Тело сообщения в раскрытой строке — простым текстом, без markdown. */
function plain(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Сообщения для раскрытия: три последних, но не длиннее 300 символов.
 *
 * Заказчик: «если сумма символов у них < 300, если превышает, то 2 или 1».
 * Считаем с конца: последнее сообщение — самое нужное, поэтому первым
 * отбрасывается самое старое.
 */
function previewMessages(row: Conversation): TripMessage[] {
  const all = previews.value[row.id] ?? []
  let count = Math.min(PREVIEW_LIMIT, all.length)

  while (count > 1 && charsOf(all.slice(-count)) > PREVIEW_CHARS) {
    count -= 1
  }

  return all.slice(-count)
}

function charsOf(list: TripMessage[]): number {
  return list.reduce((sum, message) => sum + message.body.length, 0)
}

async function loadPreview(row: Conversation): Promise<void> {
  try {
    const page = await listConversationMessages(row.id, { limit: PREVIEW_LIMIT })
    previews.value = { ...previews.value, [row.id]: page.messages }
  } catch (problem) {
    error.value =
      problem instanceof ApiError ? problem.message : 'Не удалось загрузить сообщения'
  }
}

async function markRead(row: Conversation): Promise<void> {
  if (row.unreadCount === 0) return

  try {
    await markConversationRead(row.id)
    row.unreadCount = 0
  } catch {
    // Отметка прочтения — не повод не показывать переписку.
  }
}

async function toggle(row: Conversation): Promise<void> {
  /**
   * Личный диалог открывается экраном, а не раскрытием.
   *
   * Заказчик: «клик по личному диалогу ведёт на /messages/:id». В колонке
   * 288 px переписку всё равно не читают, а полный экран с историей
   * появился 23.11.2026 — быстрый чат остаётся для чатов похода, где
   * «Открыть чат» ведёт на вкладку.
   *
   * **Кроме строки, которая ждёт моего ответа.** «Сообщениям про деньги
   * максимальный приоритет» — это не переписка, а задача: подтвердить
   * перевод. Она раскрывается здесь же, как и раньше, с кнопками
   * «Подтверждаю» / «Не получено»: заставлять человека уходить на другой
   * экран ради одной кнопки — потеря того, ради чего колонка делалась.
   */
  if (!row.tripId && !hasPendingAction(row)) {
    void router.push(`/messages/${row.id}`)
    return
  }

  if (expandedId.value === row.id) {
    expandedId.value = null
    draft.value = ''
    return
  }

  expandedId.value = row.id
  draft.value = ''

  await loadPreview(row)
  await markRead(row)
}

async function send(row: Conversation): Promise<void> {
  const body = draft.value.trim()

  if (!body || isSending.value) return

  isSending.value = true
  error.value = null

  try {
    const message = await sendConversationMessage(row.id, body)
    const list = [...(previews.value[row.id] ?? []), message]

    previews.value = { ...previews.value, [row.id]: list.slice(-PREVIEW_LIMIT) }
    row.lastMessage = message
    draft.value = ''
  } catch (problem) {
    error.value =
      problem instanceof ApiError ? problem.message : 'Не удалось отправить сообщение'
  } finally {
    isSending.value = false
  }
}

async function answer(row: Conversation, result: 'confirmed' | 'disputed'): Promise<void> {
  const action = row.lastMessage?.action

  if (!action) return

  try {
    await respondToAction(action.id, result)
    // Состояние действия меняет сервер: перечитываем, а не правим на месте.
    await refresh()
  } catch (problem) {
    error.value =
      problem instanceof ApiError ? problem.message : 'Не удалось ответить'
  }
}

async function hide(row: Conversation): Promise<void> {
  try {
    await setConversationMuted(row.id, true)
    row.muted = true

    if (expandedId.value === row.id) expandedId.value = null
  } catch (problem) {
    error.value = problem instanceof ApiError ? problem.message : 'Не удалось скрыть чат'
  }
}

async function restore(row: Conversation): Promise<void> {
  try {
    await setConversationMuted(row.id, false)
    row.muted = false
  } catch (problem) {
    error.value = problem instanceof ApiError ? problem.message : 'Не удалось вернуть чат'
  }
}

/** «Открыть чат» для чата похода — на нужную вкладку похода. */
function openTripChat(row: Conversation): void {
  if (!row.tripId) return

  void markRead(row)

  const tab = tripTabOf(row.kind)

  void router.push({
    path: `/trips/${row.tripId}`,
    query: tab ? { tab } : {},
  })
}

async function refresh(): Promise<void> {
  try {
    const data = await listConversations()

    conversations.value = data.conversations
    error.value = null
  } catch (problem) {
    error.value =
      problem instanceof ApiError ? problem.message : 'Не удалось загрузить сообщения'
  } finally {
    isLoading.value = false
  }
}

let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  void refresh()

  // Фокус окна и минута таймера: поток на каждого человека в этом шаге
  // не заводим, а лента должна оживать без перезагрузки.
  window.addEventListener('focus', onFocus)
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') void refresh()
  }, REFRESH_MS)
})

onUnmounted(() => {
  window.removeEventListener('focus', onFocus)
  if (timer !== null) clearInterval(timer)
})

function onFocus(): void {
  void refresh()
}
</script>

<template>
  <aside class="hidden xl:block xl:w-72 xl:shrink-0" data-test="right-rail">
    <div
      class="flex max-h-[calc(100vh-7rem)] flex-col gap-2 overflow-y-auto rounded-xl border border-border bg-surface p-3 xl:sticky xl:top-4"
    >
      <div class="flex items-baseline justify-between gap-2">
        <h2 class="text-sm font-medium text-text">Сообщения</h2>
        <span
          v-if="unreadTotal > 0"
          class="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-white"
          data-test="rail-unread"
        >
          {{ unreadTotal }}
        </span>
      </div>

      <p v-if="isLoading" class="text-sm text-muted" data-test="rail-loading">Загружаем…</p>

      <p v-else-if="error" class="text-sm text-muted" data-test="rail-error">{{ error }}</p>

      <p
        v-else-if="visible.length === 0"
        class="text-sm text-muted"
        data-test="rail-empty"
      >
        Пока тихо.
      </p>

      <template v-else>
        <article
          v-for="row in visible"
          :key="row.id"
          class="rounded-xl border border-border bg-bg"
          :data-test="`rail-row-${row.id}`"
        >
        <button
          type="button"
          class="flex w-full cursor-pointer items-start gap-2 px-2 py-2 text-left"
          :aria-expanded="expandedId === row.id"
          @click="toggle(row)"
        >
          <UserAvatar
            v-if="row.peer"
            :src="row.peer.avatarUrl"
            :size="28"
            :alt="row.peer.displayName"
          />

          <span class="min-w-0 flex-1">
            <span class="flex items-baseline gap-2">
              <span
                class="truncate text-sm text-text"
                :class="row.unreadCount > 0 ? 'font-semibold' : ''"
                :data-test="`rail-title-${row.id}`"
              >
                {{ heading(row) }}
              </span>
              <span class="ml-auto shrink-0 text-xs text-muted">
                {{ timeLabel(row.lastMessage?.createdAt) }}
              </span>
            </span>

            <span class="mt-0.5 line-clamp-2 block text-xs text-muted">
              {{ subtitle(row) }}
            </span>
          </span>

          <span
            v-if="row.unreadCount > 0"
            class="shrink-0 rounded-full bg-primary px-1.5 text-xs font-medium text-white"
          >
            {{ row.unreadCount }}
          </span>
        </button>

        <!-- Раскрытие: быстрый чат для чатов похода. Личные — на /messages/:id. -->
        <div v-if="expandedId === row.id" class="flex flex-col gap-2 px-2 pb-2">
          <p v-if="previewMessages(row).length === 0" class="text-xs text-muted">
            Пока пусто — напиши первым.
          </p>

          <ol v-else class="flex flex-col gap-1" :data-test="`rail-messages-${row.id}`">
            <li
              v-for="message in previewMessages(row)"
              :key="message.id"
              class="rounded-lg bg-field px-2 py-1"
            >
              <span class="block text-xs font-medium text-text">
                {{ message.isSystem ? 'Система' : (message.senderName ?? 'Кто-то') }}
              </span>
              <span class="line-clamp-3 block text-xs leading-relaxed text-text">
                {{ plain(message.body) }}
              </span>
            </li>
          </ol>

          <div
            v-if="row.lastMessage?.action?.canRespond"
            class="flex gap-2"
            :data-test="`rail-action-${row.id}`"
          >
            <button
              type="button"
              class="flex-1 cursor-pointer rounded-lg bg-primary px-2 py-1 text-xs font-medium text-white"
              data-test="rail-confirm"
              @click="answer(row, 'confirmed')"
            >
              Подтверждаю
            </button>
            <button
              type="button"
              class="flex-1 cursor-pointer rounded-lg border border-border px-2 py-1 text-xs text-text"
              data-test="rail-dispute"
              @click="answer(row, 'disputed')"
            >
              Не получено
            </button>
          </div>

          <form class="flex gap-1" @submit.prevent="send(row)">
            <input
              v-model="draft"
              type="text"
              class="min-w-0 flex-1 rounded-lg border border-border bg-field px-2 py-1 text-xs text-text outline-none focus:border-primary"
              placeholder="Написать…"
              :aria-label="`Написать в ${heading(row)}`"
              data-test="rail-input"
            />
            <button
              type="submit"
              class="cursor-pointer rounded-lg bg-primary px-2 py-1 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!draft.trim() || isSending"
              data-test="rail-send"
            >
              →
            </button>
          </form>

          <div class="flex items-center justify-between gap-2">
            <button
              v-if="row.tripId"
              type="button"
              class="cursor-pointer text-xs text-primary underline-offset-2 hover:underline"
              data-test="rail-open"
              @click="openTripChat(row)"
            >
              Открыть чат
            </button>
            <span v-else />

            <button
              type="button"
              class="ml-auto cursor-pointer text-xs text-muted hover:text-text"
              data-test="rail-hide"
              @click="hide(row)"
            >
              Скрыть чат
            </button>
          </div>
        </div>
      </article>
      </template>

      <!-- Возврат скрытых: «возможность вернуть есть и это несложно». -->
      <div v-if="mutedRows.length > 0" class="mt-1 border-t border-border pt-2">
        <button
          type="button"
          class="cursor-pointer text-xs text-muted hover:text-text"
          data-test="rail-muted-toggle"
          @click="showMuted = !showMuted"
        >
          Скрытые чаты · {{ mutedRows.length }}
        </button>

        <ul v-if="showMuted" class="mt-1 flex flex-col gap-1">
          <li
            v-for="row in mutedRows"
            :key="row.id"
            class="flex items-center justify-between gap-2 text-xs text-muted"
          >
            <span class="truncate">{{ heading(row) }}</span>
            <button
              type="button"
              class="shrink-0 cursor-pointer text-primary hover:underline"
              data-test="rail-restore"
              @click="restore(row)"
            >
              Вернуть
            </button>
          </li>
        </ul>
      </div>
    </div>
  </aside>
</template>
