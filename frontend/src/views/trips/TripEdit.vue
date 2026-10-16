<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { ApiError } from '@/api/errors'
import { getTrip, updateTrip } from '@/api/trips'
import TripForm from '@/components/trips/TripForm.vue'
import { useAuthStore } from '@/stores/auth'
import type { CreateTripRequest, Trip } from '@/types/trips'
import { buildTripPatch } from '@/utils/tripDiff'

/**
 * Правка похода — тот же экран, что создание, но с заполненными полями.
 *
 * Форма одна (`TripForm`): у создания и правки те же поля, тот же порядок
 * и те же правила, а различаются они запросом и тем, куда идти после него.
 * Двумя копиями они разошлись бы на первой же новой колонке.
 *
 * **Правка только для организатора.** Кнопка в походе показывается ему
 * одному, и это не защита, а вежливость: решает бэкенд и отвечает 403.
 * Если чужой откроет адрес руками — увидит отказ, а не форму.
 *
 * **Уходит патч, а не форма.** Присланные поля перезаписываются,
 * отсутствующие не трогаются — см. `buildTripPatch`.
 */
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const trip = ref<Trip | null>(null)
const isLoading = ref(true)
const loadError = ref<string | null>(null)

const isSubmitting = ref(false)
const submitError = ref<string | null>(null)

const tripId = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))

/** Править может только организатор: у остальных формы нет. */
const isOrganizer = computed(
  () => trip.value !== null && trip.value.organizerUserId === auth.user?.id,
)

async function load(id: string) {
  isLoading.value = true
  loadError.value = null

  try {
    trip.value = await getTrip(id)
  } catch (problem) {
    loadError.value =
      problem instanceof ApiError && problem.status === 404
        ? 'Поход не найден или закрыт для вас'
        : 'Не удалось загрузить поход'
    trip.value = null
  } finally {
    isLoading.value = false
  }
}

watch(
  tripId,
  (id) => {
    submitError.value = null
    if (id) void load(id)
  },
  { immediate: true },
)

async function submit(payload: CreateTripRequest) {
  if (!trip.value) return

  isSubmitting.value = true
  submitError.value = null

  try {
    const saved = await updateTrip(trip.value.id, buildTripPatch(trip.value, payload))

    // Возвращаемся в поход: он и есть результат правки, а отдельный экран
    // «сохранено» был бы ещё одним шагом ни за чем.
    await router?.push({ name: 'trip', params: { id: saved.id } })
  } catch (error) {
    // Текст ошибки даёт бэкенд — он один знает правила окончательно.
    submitError.value = error instanceof ApiError ? error.message : 'Не удалось сохранить поход'
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <section class="flex flex-col gap-4">
    <p v-if="isLoading" class="text-muted" data-test="edit-loading">Загружаем поход…</p>

    <p v-else-if="loadError" class="text-muted" data-test="edit-error">{{ loadError }}</p>

    <p v-else-if="trip && !isOrganizer" class="text-muted" data-test="edit-forbidden">
      Менять поход может только организатор.
    </p>

    <template v-else-if="trip">
      <header class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="text-lg font-medium text-text">
          Правка похода: {{ trip.goalObject?.name ?? 'без цели' }}
        </h2>

        <RouterLink
          :to="{ name: 'trip', params: { id: trip.id } }"
          class="text-sm text-muted underline transition-colors hover:text-text"
          data-test="edit-cancel"
        >
          Отменить и вернуться
        </RouterLink>
      </header>

      <TripForm
        :initial="trip"
        submit-label="Сохранить"
        :is-submitting="isSubmitting"
        :error="submitError"
        @submit="submit"
      />
    </template>
  </section>
</template>
