<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import { useOfflineStore } from '@/stores/offline'
import { tripDatesText } from '@/utils/tripDisplay'

/**
 * Экран «нет связи».
 *
 * Сюда разворачивает guard, когда в офлайне нет ни одного сохранённого
 * похода либо человек открыл адрес, который в офлайне недоступен.
 *
 * Здесь же видно, что именно лежит на устройстве: поход, даты и когда
 * данные сохранялись. Врать «всё сохранено» нельзя — человек в поле
 * доверяет этому экрану.
 */
const offline = useOfflineStore()

const trips = computed(() => offline.currentTrips)

/** Время сохранения словами: «16 ноября, 10:20». */
function savedText(savedAt: number | null): string {
  if (savedAt === null) return 'ещё не сохранялся'

  return new Date(savedAt).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function reload() {
  window.location.reload()
}
</script>

<template>
  <main class="flex flex-col gap-4">
    <h1 class="text-2xl font-bold text-text">Нет связи</h1>

    <template v-if="trips.length === 0">
      <p class="text-sm text-text" data-test="offline-empty">
        Связи нет, а сохранённых походов на устройстве нет. Подключись к сети и открой поход —
        его данные сохранятся для офлайна.
      </p>
    </template>

    <template v-else>
      <p class="text-sm text-text" data-test="offline-list-hint">
        В офлайне доступны сохранённые походы: решённые, куда ты идёшь, и недавно закончившиеся.
        Остальные разделы появятся, когда вернётся связь.
      </p>

      <ul class="flex flex-col gap-2" data-test="offline-trip-list">
        <li v-for="item in trips" :key="item.id">
          <RouterLink
            :to="{ name: 'trip', params: { id: item.id } }"
            class="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4 no-underline transition-colors hover:border-primary"
            data-test="offline-trip-link"
          >
            <span class="text-base font-medium text-text">{{ item.name }}</span>
            <span v-if="tripDatesText(item)" class="text-sm text-muted">
              {{ tripDatesText(item) }}
            </span>
            <span class="text-xs text-muted">Сохранено: {{ savedText(item.cachedAt) }}</span>
          </RouterLink>
        </li>
      </ul>
    </template>

    <button
      type="button"
      class="cursor-pointer self-start rounded-xl border border-border bg-field px-3 py-2 text-sm text-text transition-colors hover:border-primary"
      data-test="offline-retry"
      @click="reload"
    >
      Проверить связь
    </button>
  </main>
</template>
