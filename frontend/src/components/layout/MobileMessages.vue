<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { ApiError } from '@/api/errors'
import { sendConversationMessage } from '@/api/conversations'
import { respondToAction } from '@/api/message-actions'
import SidebarIcon from '@/components/ui/SidebarIcon.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { useConversationsStore } from '@/stores/conversations'
import type { Conversation } from '@/types/conversations'
import { tripTabOf } from '@/utils/chatTabs'
import {
  conversationHeading,
  conversationSubtitle,
  conversationTime,
  hasRowAction,
  isPaymentRequest,
} from '@/utils/conversations'

/**
 * Мобильная панель сообщений (23.11.2026).
 *
 * **Зачем.** Колонка сообщений живёт от `xl`, то есть на телефоне её нет
 * вовсе: ни ленты, ни счётчика непрочитанного. Экран диалога был, но попасть
 * на него можно было только по прямой ссылке или из профиля. Заказчик:
 * «в мобиле это может быть свёрнутое внизу иконку», как в VK.
 *
 * **Свёрнутая иконка — она же бейдж.** Кнопка в правом нижнем углу со
 * счётчиком: пока сообщений нет, это просто вход в панель, а с непрочитанным
 * она ещё и говорит, сколько. Отдельного значка-счётчика не заводим —
 * счётчик нужен там, куда человек и так тянется пальцем.
 *
 * **Развёрнутая панель — та же лента.** Порядок строк (деньги сверху),
 * заголовки и время берутся из `utils/conversations.ts`, данные — из
 * `stores/conversations.ts`, то есть из того же места, что и колонка на
 * десктопе. Копии правил нет: иначе «деньги сверху» на мобиле пришлось бы
 * помнить отдельно.
 *
 * **Куда ведёт строка.** Личный диалог — на свой экран `/messages/:id`,
 * чат похода — на вкладку похода (`?tab=`), как «Открыть чат» в колонке.
 * Строка с неотвеченным переводом раскрывается здесь же: это задача, а не
 * переписка, и кнопка «Подтверждаю» должна быть под пальцем.
 *
 * **Чего здесь нет намеренно.** Галочки «Уведомлять» и «Скрыть чат»:
 * первая живёт на экране диалога и под чатом похода, вторая — в колонке,
 * где есть куда вернуть скрытое. Панель на телефоне — только список и вход.
 */
const feed = useConversationsStore()
const route = useRoute()
const router = useRouter()

/** Панель открыта. */
const isOpen = ref(false)

/** Какая строка раскрыта (действия: перевод и просьба о платеже). */
const expandedId = ref<string | null>(null)

/** «Сообщение отправителю» к ответу на перевод (24.11.2026). */
const replyDraft = ref('')

/** Ошибка ответа на действие: остальные ошибки показывает стор. */
const actionError = ref<string | null>(null)

/** Панель: нужен фокус после открытия. */
const panel = ref<HTMLElement | null>(null)

/**
 * Счётчик в углу не раздувается: «99+» вместо четырёхзначного числа,
 * которое на кнопке 56 px уже не читается.
 */
const unreadLabel = computed(() =>
  feed.unreadTotal > 99 ? '99+' : String(feed.unreadTotal),
)

/**
 * Экран диалога занимает весь экран, и кнопка в углу перекрывала бы поле
 * ввода. Там она не нужна: панель — это вход в диалог, а мы уже в нём.
 */
const onDialogScreen = computed(() => route.name === 'messages')

function close(): void {
  isOpen.value = false
  expandedId.value = null
  replyDraft.value = ''
  actionError.value = null
}

async function open(row: Conversation): Promise<void> {
  // Действие — задача: раскрываем кнопки здесь, а не уводим на экран,
  // где отвечать нечем. Так же ведёт себя просьба организатора о платеже:
  // кнопка «Перейти» должна быть под пальцем.
  if (hasRowAction(row)) {
    expandedId.value = expandedId.value === row.id ? null : row.id
    replyDraft.value = ''
    return
  }

  void feed.markRead(row)
  close()

  if (row.tripId) {
    const tab = tripTabOf(row.kind)

    await router.push({ path: `/trips/${row.tripId}`, query: tab ? { tab } : {} })
    return
  }

  await router.push(`/messages/${row.id}`)
}

/**
 * «Подтверждаю получение» — единственный ответ на перевод (24.11.2026).
 *
 * «Не получено» убрано: банковский перевод идёт до трёх дней, а спор не
 * отменял перевод, а снимал автосогласие и подвешивал строку. Если денег
 * ещё нет, есть поле обратной связи.
 */
async function answer(row: Conversation): Promise<void> {
  const action = row.lastMessage?.action

  if (!action) return

  try {
    await respondToAction(action.id, replyDraft.value)
    replyDraft.value = ''
    // Состояние действия меняет сервер: перечитываем, а не правим на месте.
    await feed.refresh()
    expandedId.value = null
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось ответить'
  }
}

/**
 * Обратная связь отправителю без подтверждения (24.11.2026).
 *
 * Обычное сообщение в диалог: «деньги ещё не пришли, жду». Таймер
 * автосогласия не трогается — через 72 часа перевод засчитается сам,
 * а действие остаётся доступным, пока оно не разрешено.
 */
async function replyToSender(row: Conversation): Promise<void> {
  const body = replyDraft.value.trim()

  if (!body) return

  try {
    await sendConversationMessage(row.id, body)
    replyDraft.value = ''
    await feed.refresh()
  } catch (problem) {
    actionError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось отправить сообщение'
  }
}

/** «Перейти» из просьбы о платеже — в «Бухгалтерию» похода (24.11.2026). */
function openFinance(row: Conversation): void {
  const tripId = row.lastMessage?.action?.payload?.tripId

  if (typeof tripId !== 'string') return

  void feed.markRead(row)
  close()
  void router.push({ path: `/trips/${tripId}`, query: { tab: 'finance' } })
}

/**
 * Escape и прокрутка — как у мобильного меню: панель оверлей, и жест по ней
 * не должен прокручивать страницу под ней. Фокус кладём на саму панель,
 * чтобы с клавиатуры человек попадал внутрь, а не в начало документа.
 */
let savedOverflow = ''

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  close()
}

watch(isOpen, async (open) => {
  if (typeof document === 'undefined') return

  if (open) {
    savedOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeydown)
    await nextTick()
    panel.value?.focus()
    return
  }

  document.body.style.overflow = savedOverflow
  window.removeEventListener('keydown', onKeydown)
})

// Переход закрывает панель: поверх новой страницы ей не место.
watch(
  () => route.fullPath,
  () => close(),
)

/** Лента обновляется сама, пока панель (и колонка) кому-то видны. */
const releaseFeed = feed.hold()

onUnmounted(() => {
  releaseFeed()
  window.removeEventListener('keydown', onKeydown)

  if (typeof document !== 'undefined') document.body.style.overflow = savedOverflow
})
</script>

<template>
  <!--
    `xl:hidden` на обеих частях: от 1280 px лента уже стоит колонкой справа,
    и вторая кнопка в углу там только мешала бы.
  -->
  <div v-if="!onDialogScreen" class="xl:hidden">
    <button
      type="button"
      class="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-primary text-white shadow-2xl transition-transform active:scale-95"
      :aria-expanded="isOpen"
      aria-label="Сообщения"
      data-test="mobile-messages-button"
      @click="isOpen = true"
    >
      <span class="block h-6 w-6"><SidebarIcon name="messages" /></span>

      <span
        v-if="feed.unreadTotal > 0"
        class="absolute -top-1 -right-1 min-w-6 rounded-full border border-primary bg-white px-1.5 py-0.5 text-center text-xs font-semibold leading-none text-primary"
        data-test="mobile-messages-badge"
      >
        {{ unreadLabel }}
      </span>
    </button>

    <Transition name="sheet">
      <div v-if="isOpen" class="fixed inset-0 z-40 xl:hidden" data-test="mobile-messages-panel">
        <div
          class="absolute inset-0 bg-black/40"
          data-test="mobile-messages-backdrop"
          @click="close()"
        />

        <div
          ref="panel"
          class="sheet__panel absolute inset-x-0 bottom-0 flex max-h-[80vh] flex-col rounded-t-2xl border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] shadow-2xl outline-none"
          role="dialog"
          aria-modal="true"
          aria-label="Сообщения"
          tabindex="-1"
        >
          <div class="flex items-center gap-2 border-b border-border px-4 py-3">
            <span class="text-sm font-medium text-text">Сообщения</span>

            <span
              v-if="feed.unreadTotal > 0"
              class="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-white"
              data-test="mobile-messages-total"
            >
              {{ feed.unreadTotal }}
            </span>

            <button
              type="button"
              class="ml-auto cursor-pointer rounded-full p-2 text-muted transition-colors hover:bg-bg hover:text-text"
              aria-label="Закрыть сообщения"
              data-test="mobile-messages-close"
              @click="close()"
            >
              <span class="block h-5 w-5"><SidebarIcon name="close" /></span>
            </button>
          </div>

          <div class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
            <p v-if="feed.isLoading" class="p-2 text-sm text-muted" data-test="mobile-messages-loading">
              Загружаем…
            </p>

            <p
              v-else-if="feed.error"
              class="p-2 text-sm text-muted"
              data-test="mobile-messages-error"
            >
              {{ feed.error }}
            </p>

            <p
              v-else-if="feed.visible.length === 0"
              class="p-2 text-sm text-muted"
              data-test="mobile-messages-empty"
            >
              Пока тихо.
            </p>

            <template v-else>
              <article
                v-for="row in feed.visible"
                :key="row.id"
                class="rounded-xl border border-border bg-bg"
              >
                <button
                  type="button"
                  class="flex min-h-12 w-full cursor-pointer items-start gap-2 px-3 py-2 text-left"
                  :aria-expanded="expandedId === row.id"
                  :data-test="`mobile-messages-row-${row.id}`"
                  @click="open(row)"
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

                <!-- Действия: ответ на перевод или переход к платежу. -->
                <div
                  v-if="expandedId === row.id"
                  class="flex flex-col gap-2 px-3 pb-3"
                  :data-test="`mobile-messages-action-${row.id}`"
                >
                  <p v-if="actionError" class="text-xs text-red-600">{{ actionError }}</p>

                  <template v-if="row.lastMessage?.action?.canRespond">
                    <!-- «Сообщение отправителю»: уходит и ответом, и само по себе. -->
                    <div class="flex gap-1">
                      <input
                        v-model="replyDraft"
                        type="text"
                        class="min-w-0 flex-1 rounded-lg border border-border bg-field px-2 py-1.5 text-xs text-text outline-none focus:border-primary"
                        placeholder="Сообщение отправителю:"
                        aria-label="Сообщение отправителю"
                        data-test="mobile-messages-reply-input"
                      />
                      <button
                        type="button"
                        class="cursor-pointer rounded-lg border border-border px-2 py-1.5 text-xs text-text disabled:cursor-not-allowed disabled:opacity-50"
                        :disabled="!replyDraft.trim()"
                        data-test="mobile-messages-reply-send"
                        @click="replyToSender(row)"
                      >
                        →
                      </button>
                    </div>

                    <button
                      type="button"
                      class="w-full cursor-pointer rounded-lg bg-primary px-2 py-2 text-xs font-medium text-white"
                      data-test="mobile-messages-confirm"
                      @click="answer(row)"
                    >
                      Подтверждаю
                    </button>
                  </template>

                  <button
                    v-else-if="isPaymentRequest(row)"
                    type="button"
                    class="cursor-pointer rounded-lg bg-primary px-2 py-2 text-xs font-medium text-white"
                    data-test="mobile-messages-go-finance"
                    @click="openFinance(row)"
                  >
                    Перейти
                  </button>
                </div>
              </article>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* Панель выезжает снизу, подложка проявляется. Длительности короткие:
   панель — служебная вещь, задерживать человека на анимации незачем. */
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.18s ease;
}

.sheet-enter-active .sheet__panel,
.sheet-leave-active .sheet__panel {
  transition: transform 0.2s ease;
}

.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}

.sheet-enter-from .sheet__panel,
.sheet-leave-to .sheet__panel {
  transform: translateY(100%);
}

@media (prefers-reduced-motion: reduce) {
  .sheet-enter-active,
  .sheet-leave-active,
  .sheet-enter-active .sheet__panel,
  .sheet-leave-active .sheet__panel {
    transition: none;
  }
}
</style>
