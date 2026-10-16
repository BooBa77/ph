<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import TripCard from '@/components/trips/TripCard.vue'
import GeoObjectPicker from '@/components/ui/GeoObjectPicker.vue'
import { useTripList } from '@/composables/useTripList'
import {
  TRIP_STATUSES,
  TRIP_STATUS_LABELS,
  TRIP_WHEN_LABELS,
  TRIP_WHEN_VALUES,
  type GeoObject,
  type TripListQuery,
  type TripStatus,
  type TripWhen,
} from '@/types/trips'

/**
 * «Анонсы» — лента походов других участников с фильтрами.
 *
 * **Свои походы сюда не попадают** (`mine: false` на бэкенде): они лежат
 * в «Моих походах», и показывать их ещё раз в ленте значит заставить
 * человека искать чужие походы среди своих. Это не уловка интерфейса,
 * а условие запроса — иначе и `total` считался бы вместе с моими.
 *
 * **Фильтры не уезжают в адрес.** Ссылку на «все платные походы на Витязь»
 * пока никто не просил, а состояние в query-параметрах — отдельная работа
 * со своими граблями. Попросят поделиться подборкой — переведём.
 */
/** Цель выбирается поиском по справочнику: 4213 объекта списком не листаются. */
const goal = ref<GeoObject | null>(null)
const when = ref<TripWhen | ''>('')
const status = ref<TripStatus | ''>('')
const commercial = ref<'' | 'true' | 'false'>('')
const sport = ref<'' | 'true' | 'false'>('')

/**
 * Тело запроса.
 *
 * `undefined` вместо `''` — потому что «любое значение» это отсутствие
 * параметра, а не `false`: `?isCommercial=false` вернёт только
 * некоммерческие походы.
 */
function currentQuery(): TripListQuery {
  return {
    mine: false,
    goalObjectId: goal.value ? Number(goal.value.id) : undefined,
    when: when.value || undefined,
    status: status.value || undefined,
    isCommercial: commercial.value === '' ? undefined : commercial.value === 'true',
    isSport: sport.value === '' ? undefined : sport.value === 'true',
  }
}

const { trips, total, isLoading, isLoadingMore, error, remaining, load, loadMore } =
  useTripList(currentQuery)

const hasFilters = computed(
  () =>
    goal.value !== null ||
    when.value !== '' ||
    status.value !== '' ||
    commercial.value !== '' ||
    sport.value !== '',
)

/** Снять всё выбранное: один обработчик вместо пяти одинаковых. */
function resetFilters() {
  goal.value = null
  when.value = ''
  status.value = ''
  commercial.value = ''
  sport.value = ''
}

/**
 * Смена любого фильтра перезагружает ленту с первой страницы.
 *
 * Vue сам собирает изменения одного такта в один вызов: сброс пяти
 * фильтров кнопкой — это один запрос, а не пять.
 */
watch([goal, when, status, commercial, sport], () => void load(), { immediate: true })
</script>

<template>
  <section class="flex flex-col gap-4">
    <header class="flex flex-col gap-1">
      <h2 class="text-lg font-medium text-text">Анонсы походов</h2>
      <p class="text-sm text-muted">
        Куда идут другие: открытые походы и сборы. Свои — в «Моих походах».
      </p>
    </header>

    <div
      class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
      data-test="filters"
    >
      <GeoObjectPicker label="Цель" @select="(object) => (goal = object)" />

      <p v-if="goal" class="flex items-center gap-2 text-sm text-text" data-test="filter-goal">
        <span>{{ goal.name }}</span>
        <button
          type="button"
          class="cursor-pointer border-0 bg-transparent p-0 text-xs text-muted underline"
          data-test="filter-goal-clear"
          @click="goal = null"
        >
          убрать
        </button>
      </p>

      <div class="grid gap-3 md:grid-cols-4">
        <label class="flex flex-col gap-1">
          <span class="text-sm text-muted">Когда</span>
          <select
            v-model="when"
            class="cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors hover:border-primary focus:border-primary focus:outline-none"
            data-test="filter-when"
          >
            <option value="">Любое</option>
            <option v-for="value in TRIP_WHEN_VALUES" :key="value" :value="value">
              {{ TRIP_WHEN_LABELS[value] }}
            </option>
          </select>
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-sm text-muted">Готовность</span>
          <select
            v-model="status"
            class="cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors hover:border-primary focus:border-primary focus:outline-none"
            data-test="filter-status"
          >
            <option value="">Любая</option>
            <option v-for="value in TRIP_STATUSES" :key="value" :value="value">
              {{ TRIP_STATUS_LABELS[value] }}
            </option>
          </select>
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-sm text-muted">Участие</span>
          <select
            v-model="commercial"
            class="cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors hover:border-primary focus:border-primary focus:outline-none"
            data-test="filter-commercial"
          >
            <option value="">Любое</option>
            <option value="false">Бесплатные</option>
            <option value="true">Платные</option>
          </select>
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-sm text-muted">Спортивный</span>
          <select
            v-model="sport"
            class="cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors hover:border-primary focus:border-primary focus:outline-none"
            data-test="filter-sport"
          >
            <option value="">Неважно</option>
            <option value="true">Только спортивные</option>
            <option value="false">Без спортивных</option>
          </select>
        </label>
      </div>

      <button
        v-if="hasFilters"
        type="button"
        class="cursor-pointer self-start rounded-xl border border-border bg-field px-3 py-2 text-sm text-text transition-colors hover:border-primary"
        data-test="filters-reset"
        @click="resetFilters"
      >
        Сбросить фильтры
      </button>
    </div>

    <p v-if="isLoading" class="text-muted" data-test="announces-loading">Загружаем анонсы…</p>

    <div v-else-if="error" class="flex flex-col items-start gap-2" data-test="announces-error">
      <p class="text-muted">{{ error }}</p>
      <button
        type="button"
        class="cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-sm text-text transition-colors hover:border-primary"
        data-test="announces-retry"
        @click="load()"
      >
        Повторить
      </button>
    </div>

    <p v-else-if="trips.length === 0" class="text-muted" data-test="announces-empty">
      <template v-if="hasFilters">
        Под эти условия ничего не нашлось — попробуйте снять фильтры.
      </template>
      <template v-else>Анонсов пока нет. Начните первым — «Создать поход».</template>
    </p>

    <template v-else>
      <p class="text-sm text-muted" data-test="announces-total">Найдено: {{ total }}</p>

      <ul class="flex flex-col gap-3" data-test="announces-list">
        <li v-for="trip in trips" :key="trip.id">
          <TripCard :trip="trip" />
        </li>
      </ul>

      <button
        v-if="remaining > 0"
        type="button"
        class="cursor-pointer self-center rounded-xl border border-border bg-field px-4 py-2 text-sm text-text transition-colors hover:border-primary disabled:opacity-60"
        :disabled="isLoadingMore"
        data-test="announces-more"
        @click="loadMore"
      >
        {{ isLoadingMore ? 'Загружаем…' : `Показать ещё (${remaining})` }}
      </button>
    </template>
  </section>
</template>
