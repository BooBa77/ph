<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import { useOfflineStore } from '@/stores/offline'

/**
 * Полоса «нет связи» над всем приложением.
 *
 * Показывается только в офлайне: в поле человек должен сразу понимать,
 * почему часть разделов исчезла и почему кнопки не работают. Ссылка ведёт
 * к единственному доступному месту — текущему походу, а если его нет,
 * на экран с объяснением.
 *
 * `role="status"` — скринридер прочитает смену состояния, не забирая фокус.
 */
const offline = useOfflineStore()

const target = computed(() => {
  const single = offline.primaryTrip
  if (offline.currentTrips.length === 1 && single) {
    return { name: 'trip', params: { id: single.id } }
  }
  return { name: 'offline' }
})

const actionLabel = computed(() => {
  const single = offline.primaryTrip
  if (offline.currentTrips.length === 1 && single) return `Открыть «${single.name}»`
  return offline.hasCurrentTrips ? 'Что доступно' : 'Подробнее'
})
</script>

<template>
  <div
    v-if="offline.isOffline"
    class="border-b border-border bg-field"
    role="status"
    data-test="offline-banner"
  >
    <div
      class="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm"
    >
      <p class="text-text">
        Нет связи. Доступен только текущий поход, изменения не отправляются.
      </p>

      <RouterLink
        :to="target"
        class="shrink-0 text-text underline transition-colors hover:text-primary"
        data-test="offline-banner-link"
      >
        {{ actionLabel }}
      </RouterLink>
    </div>
  </div>
</template>
