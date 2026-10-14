<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { fetchSessions, revokeSession, type SessionInfo } from '@/api/sessions'
import { ApiError } from '@/api/errors'
import { useAppStore } from '@/stores/app'

/**
 * «Настройки» — то, что относится к аккаунту и устройству, а не к профилю.
 *
 * Пока здесь две вещи:
 *   - сессии: список устройств, где человек вошёл, и отзыв чужого;
 *   - анимация: сезонный декор (осенью — листья) можно выключить.
 *
 * Сессии переехали сюда из сайдбара: пункт «Сессии (скоро)» стоял отдельным
 * разделом, хотя это настройка аккаунта, и рядом с ней логично живёт
 * переключатель оформления.
 */
const appStore = useAppStore()

const sessions = ref<SessionInfo[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)
/** Идентификатор сессии, которую отзываем прямо сейчас. */
const revokingId = ref<string | null>(null)

/** Даты словами: «13 октября 2026». Без времени — оно здесь не нужно. */
const DATE = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : DATE.format(date)
}

async function load() {
  isLoading.value = true
  error.value = null
  try {
    sessions.value = await fetchSessions()
  } catch (cause) {
    error.value =
      cause instanceof ApiError
        ? cause.message
        : 'Не удалось загрузить устройства.'
  } finally {
    isLoading.value = false
  }
}

async function revoke(session: SessionInfo) {
  revokingId.value = session.id
  error.value = null
  try {
    await revokeSession(session.id)
    // Перечитываем список, а не выкидываем строку локально: если бэк
    // отказал, пользователь увидит правду, а не красивую картинку.
    await load()
  } catch (cause) {
    error.value =
      cause instanceof ApiError ? cause.message : 'Не удалось отозвать сессию.'
  } finally {
    revokingId.value = null
  }
}

/** Галочка «Анимация»: значение живёт в localStorage и в store. */
function onAnimationChange(event: Event) {
  appStore.setSeasonAnimation((event.target as HTMLInputElement).checked)
}

onMounted(load)
</script>

<template>
  <section>
    <h2 class="mb-2 text-xl font-semibold text-text">Настройки</h2>

    <h3
      class="mt-8 mb-1 border-t border-border pt-6 text-base font-medium text-text"
    >
      Сессии
    </h3>

    <p class="mb-2 text-sm text-muted">
      Устройства, где вы вошли. Отзыв выкидывает устройство при следующем
      обновлении токена — пароль заново вводить не нужно, вход по коду
      на почту.
    </p>

    <p v-if="isLoading" class="text-sm text-muted">Загружаем…</p>
    <p v-else-if="error" class="text-sm text-red-600">{{ error }}</p>
    <p v-else-if="sessions.length === 0" class="text-sm text-muted">
      Активных сессий нет — это странно: текущая должна быть в списке.
    </p>

    <ul v-else class="divide-y divide-border">
      <li
        v-for="session in sessions"
        :key="session.id"
        class="flex flex-wrap items-center justify-between gap-2 py-3"
      >
        <div class="min-w-0">
          <div class="text-sm text-text">
            {{ session.deviceLabel ?? 'Устройство без имени' }}
            <span v-if="session.isCurrent" class="text-muted">
              · это устройство
            </span>
          </div>
          <div class="text-xs text-muted">
            Начало: {{ formatDate(session.createdAt) }} · действует до
            {{ formatDate(session.expiresAt) }}
          </div>
        </div>

        <!--
          Текущую сессию отзывать не предлагаем: для неё есть «Выйти»
          в меню кабинета, и кнопка «выйти» рядом с пометкой «это
          устройство» читалась бы как второй, другой выход.
        -->
        <button
          v-if="!session.isCurrent"
          type="button"
          :disabled="revokingId === session.id"
          class="cursor-pointer rounded-lg border border-border px-3 py-1 text-sm text-text transition-colors hover:border-red-600 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
          @click="revoke(session)"
        >
          {{ revokingId === session.id ? 'Отзываем…' : 'Выйти на устройстве' }}
        </button>
      </li>
    </ul>

    <h3
      class="mt-8 mb-1 border-t border-border pt-6 text-base font-medium text-text"
    >
      Анимация
    </h3>

    <div class="flex flex-col gap-1 py-3 md:flex-row md:items-center md:gap-6">
      <div class="text-sm text-muted md:w-48 md:shrink-0">Сезонный декор</div>

      <label class="flex cursor-pointer items-center gap-2 text-base text-text">
        <input
          type="checkbox"
          class="size-4 cursor-pointer accent-primary"
          :checked="appStore.isSeasonAnimationEnabled"
          @change="onAnimationChange"
        />
        <span>Показывать сезонную анимацию (осенние листья)</span>
      </label>
    </div>

    <p class="text-xs text-muted">
      Настройка хранится в этом браузере: на другом устройстве анимацию
      придётся выключить заново.
    </p>
  </section>
</template>
