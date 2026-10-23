<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'

import { ApiError } from '@/api/errors'
import { listTripMessages, sendTripMessage } from '@/api/trips'
import { markdownToHtml } from '@/utils/markdown'
import { CHAT_KIND_LABELS, type ChatKind, type TripMessage } from '@/types/trips'

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
 */
const props = defineProps<{ tripId: string; kind: ChatKind }>()

const messages = ref<TripMessage[]>([])
const isLoading = ref(true)
const isSending = ref(false)
const error = ref<string | null>(null)
const draft = ref('')

const listEl = ref<HTMLElement | null>(null)

const title = computed(() => CHAT_KIND_LABELS[props.kind])

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
</script>

<template>
  <section class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4" data-test="trip-chat">
    <h2 class="text-sm text-muted">{{ title }}</h2>

    <p v-if="isLoading" class="text-sm text-muted" data-test="chat-loading">Загружаем…</p>

    <p v-else-if="error" class="text-sm text-muted" data-test="chat-error">{{ error }}</p>

    <p v-else-if="messages.length === 0" class="text-sm text-muted" data-test="chat-empty">
      Пока пусто — напишите первым.
    </p>

    <ol
      v-else
      ref="listEl"
      class="flex max-h-80 flex-col gap-2 overflow-y-auto"
      data-test="chat-messages"
    >
      <li v-for="message in messages" :key="message.id">
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
          <div class="chat-message text-sm leading-relaxed text-text" v-html="bodyHtml(message)" />
        </div>
      </li>
    </ol>

    <form class="flex gap-2" @submit.prevent="send">
      <input
        v-model="draft"
        type="text"
        maxlength="4000"
        placeholder="Написать в чат…"
        class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
        data-test="chat-input"
      />
      <button
        type="submit"
        class="cursor-pointer rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="!draft.trim() || isSending"
        data-test="chat-send"
      >
        Отправить
      </button>
    </form>
  </section>
</template>
