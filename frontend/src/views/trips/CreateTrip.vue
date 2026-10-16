<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import { ApiError } from '@/api/errors'
import { createTrip } from '@/api/trips'
import TripForm from '@/components/trips/TripForm.vue'
import type { CreateTripRequest } from '@/types/trips'

/**
 * Создание похода — отдельная страница, а не панель в списке.
 *
 * Сама форма живёт в `TripForm`: она одна на создание и на правку, а здесь
 * остаётся только то, чем эти два случая различаются — запрос и куда идти
 * после него.
 *
 * Организатором становится владелец токена: поля с организатором в форме
 * нет намеренно, и бэкенд лишнее поле отбивает 400-м.
 */
const router = useRouter()

const isSubmitting = ref(false)
const submitError = ref<string | null>(null)

async function submit(payload: CreateTripRequest) {
  isSubmitting.value = true
  submitError.value = null

  try {
    const trip = await createTrip(payload)

    // Сразу уходим в поход: создание — это начало работы с ним, а не отчёт
    // о выполненном действии. Карточка «Поход создан» с кнопкой «Создать ещё»
    // только мешала — заказчик убрал её прямо.
    //
    // В тестах роутера может не быть — тогда просто остаёмся на форме.
    await router?.push({ name: 'trip', params: { id: trip.id } })
  } catch (error) {
    // Текст ошибки даёт бэкенд: он один знает правила окончательно,
    // и переписывать их здесь своими словами — значит разойтись с ним.
    submitError.value = error instanceof ApiError ? error.message : 'Не удалось создать поход'
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <TripForm
    submit-label="Создать поход"
    :is-submitting="isSubmitting"
    :error="submitError"
    @submit="submit"
  />
</template>
