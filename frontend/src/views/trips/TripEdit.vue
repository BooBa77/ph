<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { ApiError } from '@/api/errors'
import { fetchTripTransfer, getTrip, updateTrip } from '@/api/trips'
import TripForm from '@/components/trips/TripForm.vue'
import { armTransferDatesAlert } from '@/composables/useTransferDatesAlert'
import { useAuthStore } from '@/stores/auth'
import type { CreateTripRequest, Trip, UpdateTripRequest } from '@/types/trips'
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
        ? 'Поход не найден или закрыт для тебя'
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
    const patch = buildTripPatch(trip.value, payload)
    const saved = await updateTrip(trip.value.id, patch)

    /**
     * Правка дат пересматривает весь план (19.11.2026). Заказчик: «при
     * смещении дат стоит оценить, есть ли уже трансферы… уведомление
     * организатору… и редирект на закладку „Трансфер“». Рейсы сервер сдвинет
     * вместе с началом, но билеты, места и договорённости о заброске
     * покупались на прежние числа — это нужно перепроверить глазами.
     *
     * Тревогу ставим, только если рейсы в самом деле есть: без них
     * предупреждать не о чем, и человек спокойно возвращается в поход.
     */
    if (datesChanged(patch) && (await hasTransferLegs(saved.id))) {
      armTransferDatesAlert(saved.id)
      await router?.push({
        name: 'trip',
        params: { id: saved.id },
        query: { tab: 'transfer' },
      })
      return
    }

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

/** Даты в патче есть — значит человек их в самом деле сдвинул. */
function datesChanged(patch: UpdateTripRequest): boolean {
  return patch.startsAt !== undefined || patch.endsAt !== undefined
}

/**
 * Уже запланированные рейсы: их придётся перепроверить.
 *
 * План читаем отдельным запросом — в ответе похода трансферов нет. Не
 * получилось (сеть, отказ) — молчим: ложная тревога про несуществующие
 * рейсы хуже, чем её отсутствие, а сама правка дат уже прошла.
 */
async function hasTransferLegs(id: string): Promise<boolean> {
  try {
    const plan = await fetchTripTransfer(id)
    return plan.legs.length > 0
  } catch {
    return false
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
