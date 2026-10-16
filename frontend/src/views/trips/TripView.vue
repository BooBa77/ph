<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { ApiError } from '@/api/errors'
import { getTrip } from '@/api/trips'
import TripChats from '@/views/trips/TripChats.vue'
import TripInfo from '@/views/trips/TripInfo.vue'
import { TRIP_STATUS_LABELS, TRIP_VISIBILITY_LABELS, type Trip } from '@/types/trips'

/**
 * Страница похода: общая рамка и вкладки.
 *
 * **Вкладки сверху на десктопе и снизу на телефоне.** Это не украшение:
 * вверху в мобильном браузере вкладки конкурируют с адресной строкой,
 * а большой палец до верхнего края не дотягивается. Внизу — то место, где
 * вкладки живут в мобильных приложениях.
 *
 * Вкладки переключаются **внутренним состоянием, а не адресом**: страница
 * остаётся одним экраном, поход грузится один раз, переход между вкладками
 * мгновенный. Когда вкладок станет много и понадобятся ссылки на конкретную,
 * их переведут в адрес — это отдельный шаг.
 */
const route = useRoute()

const trip = ref<Trip | null>(null)
const isLoading = ref(true)
const error = ref<string | null>(null)

const TAB_INFO = 'info'
const TAB_CHATS = 'chats'
type Tab = typeof TAB_INFO | typeof TAB_CHATS

const tab = ref<Tab>(TAB_INFO)

const TABS: { key: Tab; label: string }[] = [
  { key: TAB_INFO, label: 'Информация' },
  { key: TAB_CHATS, label: 'Чаты' },
]

async function load(id: string) {
  isLoading.value = true
  error.value = null

  try {
    trip.value = await getTrip(id)
  } catch (problem) {
    // 404 приходит и на несуществующий поход, и на закрытый чужой: разница
    // намеренно неразличима, чтобы по коду ответа нельзя было узнать
    // о существовании приватного похода.
    error.value =
      problem instanceof ApiError && problem.status === 404
        ? 'Поход не найден или закрыт для вас'
        : 'Не удалось загрузить поход'
    trip.value = null
  } finally {
    isLoading.value = false
  }
}

watch(
  () => route.params.id,
  (id) => {
    tab.value = TAB_INFO
    if (typeof id === 'string') void load(id)
  },
  { immediate: true },
)

/** Имя похода — это цель. Анонс идёт подписью. */
const goalName = computed(() => trip.value?.goalObject?.name ?? 'Поход')

/** Когда: у решённого — даты, у мечты и плана — готовность. */
const whenText = computed(() => {
  const current = trip.value
  if (!current) return ''
  if (!current.startsAt) return TRIP_STATUS_LABELS[current.status]

  const format = (iso: string) =>
    new Date(iso).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })

  return current.endsAt
    ? `${format(current.startsAt)} — ${format(current.endsAt)}`
    : format(current.startsAt)
})
</script>

<template>
  <main class="flex flex-col gap-4 pb-20 md:pb-0">
    <p v-if="isLoading" class="text-muted">Загружаем поход…</p>

    <p v-else-if="error" class="text-muted" data-test="trip-error">
      {{ error }}
    </p>

    <template v-else-if="trip">
      <!-- Шапка: имя похода — цель, а не анонс -->
      <header class="flex flex-col gap-1">
        <h1 class="text-2xl font-bold text-text" data-test="trip-name">
          {{ goalName }}
        </h1>

        <p v-if="trip.announcement" class="text-sm text-text">
          {{ trip.announcement }}
        </p>

        <p class="text-sm text-muted" data-test="trip-when">
          {{ whenText }} · {{ TRIP_VISIBILITY_LABELS[trip.visibility] }}
          <template v-if="trip.isCommercial"> · коммерческий</template>
          <template v-if="trip.isSport"> · спортивный поход</template>
        </p>
      </header>

      <!-- Вкладки: на десктопе сверху -->
      <nav class="hidden gap-1 border-b border-border md:flex" aria-label="Разделы похода">
        <button
          v-for="item in TABS"
          :key="item.key"
          type="button"
          class="-mb-px cursor-pointer border-b-2 bg-transparent px-4 py-2 text-sm transition-colors"
          :class="
            tab === item.key
              ? 'border-primary font-medium text-primary'
              : 'border-transparent text-muted hover:text-text'
          "
          :data-test="`tab-${item.key}`"
          @click="tab = item.key"
        >
          {{ item.label }}
        </button>
      </nav>

      <TripInfo v-if="tab === TAB_INFO" :trip="trip" />
      <TripChats v-else :trip="trip" />

      <!-- Вкладки: на телефоне снизу, под большим пальцем -->
      <nav
        class="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-surface md:hidden"
        aria-label="Разделы похода"
      >
        <button
          v-for="item in TABS"
          :key="item.key"
          type="button"
          class="flex flex-1 cursor-pointer items-center justify-center border-t-2 bg-transparent py-3 text-sm transition-colors"
          :class="
            tab === item.key
              ? 'border-primary font-medium text-primary'
              : 'border-transparent text-muted'
          "
          :data-test="`tab-mobile-${item.key}`"
          @click="tab = item.key"
        >
          {{ item.label }}
        </button>
      </nav>
    </template>
  </main>
</template>
