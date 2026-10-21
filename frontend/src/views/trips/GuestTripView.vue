<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { listObjectsByIds } from '@/api/objects'
import { fetchGuestTrip } from '@/api/trips'
import { ApiError } from '@/api/errors'
import {
  extractObjectIds,
  markdownToHtml,
  objectToken,
  type MentionLinks,
  type MentionNames,
} from '@/utils/markdown'
import { tripFrameParts, tripWhenText } from '@/utils/tripDisplay'
import { TRIP_STATUS_LABELS, type GuestTrip } from '@/types/trips'

/**
 * «Гостевая» вкладка — поход глазами гостя.
 *
 * Гость — зарегистрированный человек, который **в походе не участвует**.
 * Ему показывается обзор из «Общей»: цель, анонс, даты, маршрут, требования,
 * коммерция и цена. **Места сбора здесь нет** (решение заказчика
 * 21.10.2026): «где встречаемся» — дело состава. Состава и фактических дат
 * выхода в гостевом обзоре тоже нет — это отдаёт бэкенд, а не прячет фронт.
 *
 * Организатору вкладка нужна как превью: он видит ровно то же, что гость.
 */
const props = defineProps<{ tripId: string }>()

const trip = ref<GuestTrip | null>(null)
const isLoading = ref(true)
const error = ref<string | null>(null)

const names = ref<MentionNames>({})
const links = ref<MentionLinks>({})

async function resolveObjects(text: string) {
  const ids = extractObjectIds(text ?? '')
  if (ids.length === 0) return

  const objects = await listObjectsByIds(ids)

  names.value = {
    ...names.value,
    ...Object.fromEntries(objects.map((object) => [objectToken(object.id), object.name])),
  }
  links.value = {
    ...links.value,
    ...Object.fromEntries(
      objects
        .filter((object) => object.url)
        .map((object) => [objectToken(object.id), object.url as string]),
    ),
  }
}

async function load() {
  isLoading.value = true
  error.value = null

  try {
    trip.value = await fetchGuestTrip(props.tripId)
    await resolveObjects(`${trip.value.routeText}\n${trip.value.requirementsText ?? ''}`)
  } catch (problem) {
    error.value =
      problem instanceof ApiError && problem.status === 404
        ? 'Поход не найден или закрыт'
        : 'Не удалось загрузить гостевой обзор'
    trip.value = null
  } finally {
    isLoading.value = false
  }
}

const whenText = computed(() => (trip.value ? tripWhenText(trip.value) : ''))
const frame = computed(() => (trip.value ? tripFrameParts(trip.value).join(' · ') : ''))

const routeHtml = computed(() => markdownToHtml(trip.value?.routeText ?? '', names.value, links.value))
const requirementsHtml = computed(() =>
  markdownToHtml(trip.value?.requirementsText ?? '', names.value, links.value),
)

onMounted(load)
</script>

<template>
  <section class="flex flex-col gap-4" data-test="guest-trip">
    <p class="rounded-xl border border-dashed border-border p-3 text-xs text-muted">
      Так поход видит гость: обзор без состава, места сбора и фактических дат. Всё, что ниже, гость
      видит и без участия в походе.
    </p>

    <p v-if="isLoading" class="text-sm text-muted" data-test="guest-loading">Загружаем…</p>

    <p v-else-if="error" class="text-sm text-muted" data-test="guest-error">{{ error }}</p>

    <template v-else-if="trip">
      <dl class="grid gap-3 md:grid-cols-2">
        <div>
          <dt class="text-xs text-muted">Цель</dt>
          <dd class="text-sm text-text" data-test="guest-goal">
            {{ trip.goalObject?.name ?? '—' }}
            <span v-if="trip.goalObject" class="text-muted"> · {{ trip.goalObject.type }}</span>
          </dd>
        </div>

        <div>
          <dt class="text-xs text-muted">Когда</dt>
          <dd class="text-sm text-text" data-test="guest-when">
            {{ whenText }} · {{ TRIP_STATUS_LABELS[trip.status] }}
          </dd>
        </div>

        <div>
          <dt class="text-xs text-muted">Рамка</dt>
          <dd class="text-sm text-text" data-test="guest-frame">{{ frame }}</dd>
        </div>

        <div v-if="trip.isRecruitmentClosed">
          <dt class="text-xs text-muted">Набор</dt>
          <dd class="text-sm text-text">закрыт</dd>
        </div>
      </dl>

      <div v-if="trip.announcement" class="text-sm text-text" data-test="guest-announcement">
        {{ trip.announcement }}
      </div>

      <div v-if="trip.priceNote?.trim()">
        <h2 class="mb-1 text-sm text-muted">Что входит в стоимость</h2>
        <p class="text-sm whitespace-pre-line text-text">{{ trip.priceNote }}</p>
      </div>

      <div v-if="trip.routeText.trim()">
        <h2 class="mb-1 text-sm text-muted">Маршрут</h2>
        <div
          class="flex flex-col gap-1 text-sm leading-relaxed text-text"
          data-test="guest-route"
          v-html="routeHtml"
        />
      </div>

      <div v-if="trip.requirementsText?.trim()">
        <h2 class="mb-1 text-sm text-muted">Требования к участникам</h2>
        <div
          class="flex flex-col gap-1 text-sm leading-relaxed text-text"
          data-test="guest-requirements"
          v-html="requirementsHtml"
        />
      </div>
    </template>
  </section>
</template>
