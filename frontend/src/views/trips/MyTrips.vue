<script setup lang="ts">
import { computed, watch } from 'vue'

import TripCard from '@/components/trips/TripCard.vue'
import { useTripList } from '@/composables/useTripList'
import { useOfflineStore } from '@/stores/offline'

/**
 * «Мои походы» — корень раздела `/trips`.
 *
 * Это походы, где человек организатор или участник (`mine: true`); чужие
 * анонсы лежат отдельной страницей. Разделение не украшение: смешанная
 * лента заставляла бы искать свои походы среди чужих, а «создать поход» —
 * среди тех, куда человек не собирался.
 *
 * **Офлайн (16.11.2026).** Без связи список не запрашивается: показываем
 * только походы, которые идут сейчас и сохранены на устройстве. Остальные
 * в поле не нужны, а их карточки вели бы на закрытые адреса.
 */
const offline = useOfflineStore()

const {
  trips: loadedTrips,
  total: loadedTotal,
  isLoading: listLoading,
  isLoadingMore,
  error: listError,
  remaining,
  load,
  loadMore,
} = useTripList(() => ({ mine: true }))

/** Что видно на экране: сеть — обычный список, офлайн — сохранённые походы. */
const trips = computed(() =>
  offline.isOnline ? loadedTrips.value : offline.currentTrips.map((item) => item.trip),
)

const total = computed(() => (offline.isOnline ? loadedTotal.value : trips.value.length))
const isLoading = computed(() => offline.isOnline && listLoading.value)
const error = computed(() => (offline.isOnline ? listError.value : null))
const remainingCount = computed(() => (offline.isOnline ? remaining.value : 0))

if (offline.isOnline) void load()

// Связь вернулась — догружаем то, что показывали бы онлайн.
watch(
  () => offline.isOnline,
  (isOnline) => {
    if (isOnline) void load()
  },
)
</script>

<template>
  <section class="flex flex-col gap-4">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex flex-col gap-1">
        <h2 class="text-lg font-medium text-text">Мои походы</h2>
        <p class="text-sm text-muted">Где ты организатор или участник.</p>
      </div>
    </header>

    <p v-if="offline.isOffline" class="text-sm text-muted" data-test="my-trips-offline-note">
      Нет связи. Показан только поход, который идёт сейчас.
    </p>

    <p v-if="isLoading" class="text-muted" data-test="my-trips-loading">Загружаем походы…</p>

    <div v-else-if="error" class="flex flex-col items-start gap-2" data-test="my-trips-error">
      <p class="text-muted">{{ error }}</p>
      <button
        type="button"
        class="cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-sm text-text transition-colors hover:border-primary"
        data-test="my-trips-retry"
        @click="load()"
      >
        Повторить
      </button>
    </div>

    <p v-else-if="trips.length === 0" class="text-muted" data-test="my-trips-empty">
      <template v-if="offline.isOffline">
        Связи нет, а похода, который идёт сейчас, на устройстве не сохранено. Подключись к сети и
        открой поход — он сохранится для офлайна.
      </template>
      <template v-else>
        Здесь появятся походы, которые ты создашь или в которые тебя позовут. Пока их нет.
      </template>
    </p>

    <template v-else>
      <p class="text-sm text-muted" data-test="my-trips-total">Всего: {{ total }}</p>

      <ul class="flex flex-col gap-3" data-test="my-trips-list">
        <li v-for="trip in trips" :key="trip.id">
          <TripCard :trip="trip" />
        </li>
      </ul>

      <button
        v-if="remainingCount > 0"
        type="button"
        class="cursor-pointer self-center rounded-xl border border-border bg-field px-4 py-2 text-sm text-text transition-colors hover:border-primary disabled:opacity-60"
        :disabled="isLoadingMore"
        data-test="my-trips-more"
        @click="loadMore"
      >
        {{ isLoadingMore ? 'Загружаем…' : `Показать ещё (${remainingCount})` }}
      </button>
    </template>
  </section>
</template>
