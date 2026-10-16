<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import { TRIP_STATUS_LABELS, type Trip } from '@/types/trips'
import { tripBadges, tripDatesText } from '@/utils/tripDisplay'

/**
 * Карточка похода в ленте.
 *
 * **Вся карточка — одна ссылка**, а не заголовок-ссылка плюс кнопка
 * «Открыть»: на телефоне палец не выбирает мелкие цели, а лишняя кнопка
 * в каждой карточке — это двадцать кнопок на экране. Вложенных ссылок нет,
 * поэтому карточка целиком может быть `RouterLink`.
 *
 * Имя похода — цель из справочника, а не анонс: так решил заказчик, и это
 * видно по тому, как поход называется в остальных местах. Анонс идёт
 * подписью под именем.
 */
const props = defineProps<{ trip: Trip }>()

const goalName = computed(() => props.trip.goalObject?.name ?? 'Без цели')
const goalType = computed(() => props.trip.goalObject?.type ?? null)
const dates = computed(() => tripDatesText(props.trip))
const badges = computed(() => tripBadges(props.trip))
</script>

<template>
  <RouterLink
    :to="{ name: 'trip', params: { id: trip.id } }"
    class="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 no-underline transition-colors hover:border-primary"
    data-test="trip-card"
  >
    <h3 class="text-base font-medium text-text" data-test="trip-card-goal">
      {{ goalName }}
      <span v-if="goalType" class="text-xs font-normal text-muted"> · {{ goalType }}</span>
    </h3>

    <p
      v-if="trip.announcement"
      class="line-clamp-3 text-sm text-text"
      data-test="trip-card-announcement"
    >
      {{ trip.announcement }}
    </p>

    <p class="text-sm text-muted" data-test="trip-card-when">
      {{ TRIP_STATUS_LABELS[trip.status] }}
      <template v-if="dates"> · {{ dates }}</template>
    </p>

    <ul v-if="badges.length > 0" class="flex flex-wrap gap-2">
      <li
        v-for="badge in badges"
        :key="badge"
        class="rounded-full border border-border px-2 py-0.5 text-xs text-muted"
        data-test="trip-card-badge"
      >
        {{ badge }}
      </li>
    </ul>
  </RouterLink>
</template>
