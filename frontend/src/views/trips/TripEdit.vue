<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

import { ApiError } from '@/api/errors'
import { cancelTrip, fetchTripTransfer, getTrip, updateTrip } from '@/api/trips'
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

/**
 * Отмена похода (26.11.2026, §4.6).
 *
 * Кнопка — маленькая текстовая внизу формы, а не рядом с «Сохранить»:
 * отмена необратима и не должна попадаться под руку при правке анонса.
 * Подтверждение — на месте, а не `window.confirm`: тот же приём, что
 * у удаления сообщения (`MessageView`), и он проверяется без диалога
 * браузера. После отмены уходим в поход: он остаётся на экране историей.
 */
const isCancelling = ref(false)
const cancelError = ref<string | null>(null)
const isCancelConfirming = ref(false)

/** Отменить можно всё, кроме завершённого; отменённое — уже отменено. */
const canCancel = computed(
  () =>
    isOrganizer.value &&
    trip.value !== null &&
    trip.value.completedAt === null &&
    trip.value.cancelledAt === null,
)

async function cancel(): Promise<void> {
  if (!trip.value || !canCancel.value || isCancelling.value) return

  isCancelling.value = true
  cancelError.value = null

  try {
    await cancelTrip(trip.value.id)
    await router?.push({ name: 'trip', params: { id: trip.value.id } })
  } catch (error) {
    cancelError.value =
      error instanceof ApiError ? error.message : 'Не удалось отменить поход'
  } finally {
    isCancelling.value = false
    isCancelConfirming.value = false
  }
}

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

      <!--
        Отмена похода — внизу, маленькой текстовой кнопкой (26.11.2026,
        §4.6). Подтверждение на месте: отмена необратима, но и модальное
        окно на весь экран ради одной строки не нужно.
      -->
      <div
        v-if="canCancel || cancelError"
        class="flex flex-col gap-3 border-t border-border pt-4"
        data-test="trip-cancel-section"
      >
        <p v-if="cancelError" class="text-sm text-red-600" data-test="trip-cancel-error">
          {{ cancelError }}
        </p>

        <template v-if="isCancelConfirming">
          <p class="text-sm text-text" data-test="trip-cancel-question">
            Поход будет отменён безвозвратно. Участники получат уведомление.
            Правки закроются, останутся «Бухгалтерия», «Дневник» и альманах.
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="cursor-pointer rounded-xl border border-red-600 px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-600 hover:text-white disabled:opacity-60"
              :disabled="isCancelling"
              data-test="trip-cancel-confirm"
              @click="cancel"
            >
              {{ isCancelling ? 'Отменяем…' : 'Отменить поход' }}
            </button>
            <button
              type="button"
              class="cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-sm text-text transition-colors hover:border-primary disabled:opacity-60"
              :disabled="isCancelling"
              data-test="trip-cancel-dismiss"
              @click="isCancelConfirming = false"
            >
              Оставить как есть
            </button>
          </div>
        </template>

        <button
          v-else
          type="button"
          class="cursor-pointer self-start text-sm text-muted underline transition-colors hover:text-text"
          data-test="trip-cancel"
          @click="isCancelConfirming = true"
        >
          Отменить поход
        </button>
      </div>
    </template>
  </section>
</template>
