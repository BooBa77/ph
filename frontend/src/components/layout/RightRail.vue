<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  listConversationMessages,
  sendConversationMessage,
  setConversationMuted,
} from '@/api/conversations'
import { ApiError } from '@/api/errors'
import { respondToAction } from '@/api/message-actions'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { useConversationsStore } from '@/stores/conversations'
import type { Conversation } from '@/types/conversations'
import type { TripMessage } from '@/types/trips'
import { tripTabOf } from '@/utils/chatTabs'
import {
  conversationHeading,
  conversationSubtitle,
  conversationTime,
  hasRowAction,
  isPaymentRequest,
  rowAction,
} from '@/utils/conversations'

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

/**
 * Лента живёт в сторе: её же показывает мобильная панель.
 *
 * Сортировка («деньги сверху»), заголовки и время строк переехали
 * в `utils/conversations.ts`, а загрузка и обновление — в
 * `stores/conversations.ts`. Иначе на мобиле пришлось бы держать вторую
 * копию правил, и первая же правка развела бы два вида ленты.
 */
const feed = useConversationsStore()

/** Ошибки действий (отправка, ответ на перевод, скрытие). */
const error = ref<string | null>(null)

/** Сколько символов влезает в раскрытую строку. */
const PREVIEW_CHARS = 300
/** Максимум сообщений в раскрытой строке. */
const PREVIEW_LIMIT = 3

/**
 * Вкладка похода для вида чата: куда ведёт «Открыть чат».
 *
 * Таблица переехала в `utils/chatTabs.ts`: её же спрашивает экран диалога,
 * когда ссылается на поход из шапки.
 */
const expandedId = ref<string | null>(null)
const draft = ref('')
/**
 * Сообщение отправителю вместе с ответом на перевод (24.11.2026).
 *
 * Отдельно от `draft`: то поле — обычная отправка в чат, а это живёт под
 * строкой денег и служит ответом «деньги не пришли, жду». Уйти может и с
 * подтверждением, и само по себе — второе важнее: подтверждать есть что
 * только тогда, когда деньги дошли.
 */
const replyDraft = ref('')
const previews = ref<Record<string, TripMessage[]>>({})
const isSending = ref(false)
const showMuted = ref(false)

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
   * перевод. Она раскрывается здесь же, как и раньше, с кнопкой
   * «Подтверждаю» и полем обратной связи: заставлять человека уходить на
   * другой экран ради одной кнопки — потеря того, ради чего колонка делалась.
   */
  if (!row.tripId && !hasRowAction(row)) {
    void router.push(`/messages/${row.id}`)
    return
  }

  if (expandedId.value === row.id) {
    expandedId.value = null
    draft.value = ''
    replyDraft.value = ''
    return
  }

  expandedId.value = row.id
  draft.value = ''
  replyDraft.value = ''

  await loadPreview(row)
  await feed.markRead(row)
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

/**
 * «Подтверждаю получение» — единственный ответ на перевод (24.11.2026).
 *
 * Кнопки «не получено» больше нет: заказчик снял её, потому что банковский
 * перевод идёт до трёх дней, а спор не отменял перевод, а подвешивал его
 * навсегда. Если денег ещё нет, человеку есть поле обратной связи: оно
 * отправляет обычное сообщение и автосогласие через 72 часа не трогает.
 */
async function answer(row: Conversation): Promise<void> {
  // Действие диалога, а не последнего сообщения: сервер мог выбрать перевод,
  // хотя последним в диалоге лежит просьба о платеже.
  const action = rowAction(row)

  if (!action) return

  try {
    await respondToAction(action.id, replyDraft.value)
    replyDraft.value = ''
    // Состояние действия меняет сервер: перечитываем, а не правим на месте.
    await feed.refresh()
  } catch (problem) {
    error.value =
      problem instanceof ApiError ? problem.message : 'Не удалось ответить'
  }
}

/**
 * Обратная связь отправителю без подтверждения (24.11.2026).
 *
 * «Деньги ещё не пришли, жду» — обычное сообщение в тот же диалог, а не
 * ответ на действие: таймер автосогласия продолжает идти, и через 72 часа
 * перевод засчитается сам. Действие при этом остаётся доступным: сервер
 * прикрепляет неразрешённый перевод к последнему сообщению диалога.
 */
async function replyToSender(row: Conversation): Promise<void> {
  const body = replyDraft.value.trim()

  if (!body || isSending.value) return

  isSending.value = true
  error.value = null

  try {
    await sendConversationMessage(row.id, body)
    replyDraft.value = ''
    // Последнее сообщение сменилось, а действие осталось: сервер прикрепляет
    // неразрешённый перевод к новой последней строке, поэтому перечитываем.
    await feed.refresh()
    await loadPreview(row)
  } catch (problem) {
    error.value =
      problem instanceof ApiError ? problem.message : 'Не удалось отправить сообщение'
  } finally {
    isSending.value = false
  }
}

/**
 * «Перейти» из просьбы организатора о платеже (24.11.2026).
 *
 * Заказчик: «Переход раздел Бухгалтерия похода». Адрес — из `payload.tripId`:
 * строка ленты у просьбы — личный диалог (`tripId === null`), и своей
 * привязки к походу у неё нет.
 */
function openFinance(row: Conversation): void {
  const tripId = rowAction(row)?.payload?.tripId

  if (typeof tripId !== 'string') return

  void feed.markRead(row)
  void router.push({ path: `/trips/${tripId}`, query: { tab: 'finance' } })
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

  void feed.markRead(row)

  const tab = tripTabOf(row.kind)

  void router.push({
    path: `/trips/${row.tripId}`,
    query: tab ? { tab } : {},
  })
}

/**
 * Живость ленты — у стора, а не здесь: тот же стор держит и мобильную
 * панель, и обновлять ленту дважды незачем. `hold()` возвращает отписку;
 * пока жив второй потребитель, лента продолжает обновляться.
 */
const releaseFeed = feed.hold()

/**
 * Живое сообщение в раскрытой строке (24.11.2026).
 *
 * Саму ленту правит стор, но у раскрытия свой список трёх последних
 * сообщений — без этого новый текст появился бы только после повторного
 * раскрытия. События своего автора стор не отдаёт, поэтому своя отправка
 * (её и так дописывает ответ ручки) дублем не придёт.
 */
const stopEvents = feed.onEvent((event, row) => {
  const incoming = row?.lastMessage

  if (event.kind !== 'message' || !row || !incoming) return

  const current = previews.value[row.id]

  if (!current || current.some((message) => message.id === incoming.id)) return

  previews.value = {
    ...previews.value,
    [row.id]: [...current, incoming].slice(-PREVIEW_LIMIT),
  }
})

onUnmounted(() => {
  releaseFeed()
  stopEvents()
})
</script>

<template>
  <!--
    Ширина 352 px вместо 288 (24.11.2026): заказчик просил «увеличить правую
    с сообщениями за счёт левого сайдбара» — текст в раскрытии и поле ввода
    в 288 px не помещались. Колонка меню в `App.vue` сузилась на столько же,
    поэтому контент страницы почти не потерял.
  -->
  <aside class="hidden xl:block xl:w-88 xl:shrink-0" data-test="right-rail">
    <div
      class="flex max-h-[calc(100vh-7rem)] flex-col gap-2 overflow-y-auto rounded-xl border border-border bg-surface p-3 xl:sticky xl:top-4"
    >
      <div class="flex items-baseline justify-between gap-2">
        <h2 class="text-sm font-medium text-text">Сообщения</h2>
        <span
          v-if="feed.unreadTotal > 0"
          class="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-white"
          data-test="rail-unread"
        >
          {{ feed.unreadTotal }}
        </span>
      </div>

      <p v-if="feed.isLoading" class="text-sm text-muted" data-test="rail-loading">
        Загружаем…
      </p>

      <p v-else-if="feed.error || error" class="text-sm text-muted" data-test="rail-error">
        {{ feed.error ?? error }}
      </p>

      <p
        v-else-if="feed.visible.length === 0"
        class="text-sm text-muted"
        data-test="rail-empty"
      >
        Пока тихо.
      </p>

      <template v-else>
        <article
          v-for="row in feed.visible"
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
                {{ conversationHeading(row) }}
              </span>
              <span class="ml-auto shrink-0 text-xs text-muted">
                {{ conversationTime(row.lastMessage?.createdAt) }}
              </span>
            </span>

            <span class="mt-0.5 line-clamp-2 block text-xs text-muted">
              {{ conversationSubtitle(row) }}
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
            v-if="rowAction(row)?.canRespond"
            class="flex flex-col gap-2"
            :data-test="`rail-action-${row.id}`"
          >
            <!--
              «Сообщение отправителю» (24.11.2026). Заказчик: в уведомлении
              о переводе есть кнопка «Подтвердить» и поле ввода. С 24.11.2026
              поле живёт и без ответа: «деньги ещё не пришли, жду» — обычное
              сообщение, а не подтверждение. Поэтому у поля своя отправка.
            -->
            <div class="flex gap-1">
              <input
                v-model="replyDraft"
                type="text"
                class="min-w-0 flex-1 rounded-lg border border-border bg-field px-2 py-1 text-xs text-text outline-none focus:border-primary"
                placeholder="Сообщение отправителю:"
                aria-label="Сообщение отправителю"
                data-test="rail-reply-input"
              />
              <button
                type="button"
                class="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs text-text disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!replyDraft.trim() || isSending"
                data-test="rail-reply-send"
                @click="replyToSender(row)"
              >
                →
              </button>
            </div>

            <button
              type="button"
              class="w-full cursor-pointer rounded-lg bg-primary px-2 py-1 text-xs font-medium text-white"
              data-test="rail-confirm"
              @click="answer(row)"
            >
              Подтверждаю
            </button>
          </div>

          <!--
            Просьба организатора о платеже: отвечать нечем, поэтому одна
            кнопка «Перейти» в «Бухгалтерию» похода (24.11.2026).
          -->
          <button
            v-else-if="isPaymentRequest(row)"
            type="button"
            class="cursor-pointer rounded-lg bg-primary px-2 py-1 text-xs font-medium text-white"
            data-test="rail-go-finance"
            @click="openFinance(row)"
          >
            Перейти
          </button>

          <form class="flex gap-1" @submit.prevent="send(row)">
            <input
              v-model="draft"
              type="text"
              class="min-w-0 flex-1 rounded-lg border border-border bg-field px-2 py-1 text-xs text-text outline-none focus:border-primary"
              placeholder="Написать…"
              :aria-label="`Написать в ${conversationHeading(row)}`"
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
      <div v-if="feed.muted.length > 0" class="mt-1 border-t border-border pt-2">
        <button
          type="button"
          class="cursor-pointer text-xs text-muted hover:text-text"
          data-test="rail-muted-toggle"
          @click="showMuted = !showMuted"
        >
          Скрытые чаты · {{ feed.muted.length }}
        </button>

        <ul v-if="showMuted" class="mt-1 flex flex-col gap-1">
          <li
            v-for="row in feed.muted"
            :key="row.id"
            class="flex items-center justify-between gap-2 text-xs text-muted"
          >
            <span class="truncate">{{ conversationHeading(row) }}</span>
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
