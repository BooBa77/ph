<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  decideActivityRequest,
  fetchModeration,
  setActivityTypeActive,
  type ActivityRequest,
  type ModerationItem,
} from '@/api/calendar'
import { ApiError } from '@/api/errors'
import ActivityIcon from '@/components/ui/ActivityIcon.vue'
import { hasActivityIcon } from '@/assets/activity-icons'

/**
 * Модерация иконок: зародыш админки.
 *
 * Что здесь: список заявок пользователей (одобрить, отклонить, на доработку)
 * и все типы активности крупно — включая погашенные, потому что погашенный
 * тип и есть «вариант иконки ждёт решения». Доступ проверяет бэкенд: список
 * админов захардкожен, чужому сюда нельзя даже если он знает адрес.
 *
 * Иконки рисуются из кода фронтенда по ключу из базы: если ключа ещё нет
 * (`hasActivityIcon` вернул false), это видно прямо здесь — значит, иконку
 * забыли добавить в файл, и одобрять нечего.
 */
const types = ref<ModerationItem[]>([])
const requests = ref<ActivityRequest[]>([])
const comments = ref<Record<string, string>>({})
const error = ref<string | null>(null)
const isLoading = ref(false)

const candidates = computed(() => types.value.filter((type) => !type.isActive))
const activeTypes = computed(() => types.value.filter((type) => type.isActive))

async function load() {
  isLoading.value = true
  error.value = null
  try {
    const data = await fetchModeration()
    types.value = data.types
    requests.value = data.requests
  } catch (cause) {
    error.value =
      cause instanceof ApiError
        ? cause.message
        : 'Не удалось загрузить модерацию.'
  } finally {
    isLoading.value = false
  }
}

async function decide(
  id: string,
  status: 'approved' | 'rejected' | 'revision',
) {
  try {
    await decideActivityRequest(id, status, comments.value[id] ?? null)
    await load()
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : 'Не получилось.'
  }
}

async function toggle(type: ModerationItem) {
  try {
    await setActivityTypeActive(type.id, !type.isActive)
    await load()
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : 'Не получилось.'
  }
}

const statusWord: Record<ActivityRequest['status'], string> = {
  pending: 'на модерации',
  approved: 'одобрено',
  rejected: 'отклонено',
  revision: 'на доработке',
}

onMounted(load)
</script>

<template>
  <main class="mx-auto max-w-4xl px-4 py-8">
    <h1 class="text-2xl font-bold text-text">Модерация иконок</h1>

    <p class="mt-2 text-sm text-muted">
      Заявки пользователей и все варианты иконок. Иконка живёт в коде фронтенда,
      поэтому одобрение включает тип, а сама картинка приезжает деплоем.
    </p>

    <p v-if="error" class="mt-3 text-sm text-red-600">{{ error }}</p>
    <p v-if="isLoading" class="mt-3 text-sm text-muted">Загружаем…</p>

    <!-- Заявки -->
    <section class="mt-6">
      <h2 class="text-lg font-semibold text-text">Заявки</h2>

      <p v-if="requests.length === 0" class="mt-2 text-sm text-muted">
        Заявок пока нет.
      </p>

      <ul v-else class="mt-3 divide-y divide-border rounded-xl border border-border">
        <li v-for="request in requests" :key="request.id" class="p-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="text-sm text-text">
              «{{ request.label }}»
              <span class="text-muted">
                · {{ statusWord[request.status] }}
                <template v-if="request.userName"> · {{ request.userName }}</template>
              </span>
            </span>
            <span class="flex gap-1">
              <button
                type="button"
                class="cursor-pointer rounded-lg bg-primary px-3 py-1 text-xs font-medium text-white"
                @click="decide(request.id, 'approved')"
              >
                Принять
              </button>
              <button
                type="button"
                class="cursor-pointer rounded-lg border border-border px-3 py-1 text-xs text-text"
                @click="decide(request.id, 'revision')"
              >
                На доработку
              </button>
              <button
                type="button"
                class="cursor-pointer rounded-lg border border-border px-3 py-1 text-xs text-text hover:border-red-600 hover:text-red-600"
                @click="decide(request.id, 'rejected')"
              >
                Отклонить
              </button>
            </span>
          </div>

          <input
            v-model="comments[request.id]"
            type="text"
            maxlength="500"
            placeholder="комментарий: что поправить"
            class="mt-2 w-full rounded border border-border bg-bg px-2 py-1 text-sm text-text"
          />
          <p v-if="request.adminComment" class="mt-1 text-xs text-muted">
            Комментарий: {{ request.adminComment }}
          </p>
        </li>
      </ul>
    </section>

    <!-- Варианты, ждущие решения -->
    <section class="mt-8">
      <h2 class="text-lg font-semibold text-text">
        Варианты на рассмотрении ({{ candidates.length }})
      </h2>
      <p v-if="candidates.length === 0" class="mt-2 text-sm text-muted">
        Все иконки в работе. Новые варианты появляются здесь после того, как я
        нарисую иконку и заведу тип.
      </p>

      <div v-else class="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
        <div
          v-for="type in candidates"
          :key="type.id"
          class="flex flex-col items-center gap-1 rounded-xl border border-border p-3"
        >
          <span class="h-12 w-12 text-text">
            <ActivityIcon :name="type.icon" />
          </span>
          <span class="text-xs text-text">{{ type.label }}</span>
          <span class="text-[10px] text-muted">{{ type.groupLabel }}</span>
          <span v-if="!hasActivityIcon(type.icon)" class="text-[10px] text-red-600">
            нет иконки в коде
          </span>
          <button
            type="button"
            class="mt-1 cursor-pointer rounded-lg bg-primary px-2 py-0.5 text-xs text-white"
            @click="toggle(type)"
          >
            Включить
          </button>
        </div>
      </div>
    </section>

    <!-- Что уже у людей -->
    <section class="mt-8">
      <h2 class="text-lg font-semibold text-text">
        Иконки в работе ({{ activeTypes.length }})
      </h2>

      <div class="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
        <button
          v-for="type in activeTypes"
          :key="type.id"
          type="button"
          class="flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-border p-2 transition-colors hover:border-primary"
          :title="`${type.groupLabel}: ${type.label}. Нажмите, чтобы убрать из работы`"
          @click="toggle(type)"
        >
          <span class="h-10 w-10 text-text">
            <ActivityIcon :name="type.icon" />
          </span>
          <span class="text-[10px] text-muted">{{ type.label }}</span>
        </button>
      </div>
    </section>
  </main>
</template>
