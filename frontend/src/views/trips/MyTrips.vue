<script setup lang="ts">
import { RouterLink } from 'vue-router'

import TripCard from '@/components/trips/TripCard.vue'
import { useTripList } from '@/composables/useTripList'

/**
 * «Мои походы» — корень раздела `/trips`.
 *
 * Это походы, где человек организатор или участник (`mine: true`); чужие
 * анонсы лежат отдельной страницей. Разделение не украшение: смешанная
 * лента заставляла бы искать свои походы среди чужих, а «создать поход» —
 * среди тех, куда человек не собирался.
 *
 * Отдельного «я организатор» и «я участник» здесь нет: бэкенд считает
 * своим и то и другое, а поход, который я организовал и не иду, — всё
 * равно мой.
 */
const { trips, total, isLoading, isLoadingMore, error, remaining, load, loadMore } = useTripList(
  () => ({ mine: true }),
)

void load()
</script>

<template>
  <section class="flex flex-col gap-4">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex flex-col gap-1">
        <h2 class="text-lg font-medium text-text">Мои походы</h2>
        <p class="text-sm text-muted">Где вы организатор или участник.</p>
      </div>

      <RouterLink
        to="/trips/new"
        class="rounded-xl border border-primary bg-primary px-4 py-2 text-sm text-white no-underline transition-opacity hover:opacity-90"
        data-test="my-trips-create"
      >
        Создать поход
      </RouterLink>
    </header>

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
      Здесь появятся походы, которые вы создадите или в которые вас позовут. Пока их нет.
    </p>

    <template v-else>
      <p class="text-sm text-muted" data-test="my-trips-total">Всего: {{ total }}</p>

      <ul class="flex flex-col gap-3" data-test="my-trips-list">
        <li v-for="trip in trips" :key="trip.id">
          <TripCard :trip="trip" />
        </li>
      </ul>

      <button
        v-if="remaining > 0"
        type="button"
        class="cursor-pointer self-center rounded-xl border border-border bg-field px-4 py-2 text-sm text-text transition-colors hover:border-primary disabled:opacity-60"
        :disabled="isLoadingMore"
        data-test="my-trips-more"
        @click="loadMore"
      >
        {{ isLoadingMore ? 'Загружаем…' : `Показать ещё (${remaining})` }}
      </button>
    </template>
  </section>
</template>
