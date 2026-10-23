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
import { tripFrameParts, tripWhenText, formatTripDate } from '@/utils/tripDisplay'
import {
  PARTICIPANT_STATUS_LABELS,
  TRIP_STATUS_LABELS,
  type GuestTrip,
} from '@/types/trips'

/**
 * «Гостевая» вкладка — обзор похода, один для всех.
 *
 * С 21.10.2026 отдельной вкладки «Инфо» нет: и участники, и гости видят
 * здесь одно и то же — цель, анонс, даты (решение и факт), состав с ролями,
 * маршрут, требования, коммерцию и цену. Правка — кнопкой «Редактировать»
 * в шапке. **Места сбора здесь нет**: «где встречаемся» уехало в «Трансфер».
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

/**
 * Фактические даты: их видят все, это часть анонса. Показываем, только
 * если поход действительно состоялся (или начался) — план и так выше.
 */
const actualText = computed(() => {
  const started = trip.value?.actualStartedAt
  const finished = trip.value?.actualFinishedAt
  if (!started) return ''

  return finished
    ? `${formatTripDate(started)} — ${formatTripDate(finished)}`
    : formatTripDate(started)
})

const routeHtml = computed(() => markdownToHtml(trip.value?.routeText ?? '', names.value, links.value))
const requirementsHtml = computed(() =>
  markdownToHtml(trip.value?.requirementsText ?? '', names.value, links.value),
)

onMounted(load)
</script>

<template>
  <section class="flex flex-col gap-4" data-test="guest-trip">
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

        <div v-if="actualText">
          <dt class="text-xs text-muted">Факт</dt>
          <dd class="text-sm text-text" data-test="guest-actual-dates">{{ actualText }}</dd>
        </div>
      </dl>

      <div v-if="trip.announcement" class="text-sm text-text" data-test="guest-announcement">
        {{ trip.announcement }}
      </div>

      <!--
        Состав — часть анонса и виден всем: с 21.10.2026 у «Гостевой» нет
        «урезанного» режима для гостей. Роли и статусы показываем как есть.
      -->
      <div v-if="trip.participants.length > 0">
        <h2 class="mb-1 text-sm text-muted">Состав</h2>
        <ul class="flex flex-col gap-1 text-sm text-text" data-test="guest-participants">
          <li v-for="person in trip.participants" :key="person.userId">
            <span>{{ person.displayName }}</span>
            <span v-if="person.isOrganizer" class="text-muted"> · организатор</span>
            <span v-if="person.roles.length" class="text-muted">
              · {{ person.roles.map((role) => role.name).join(', ') }}
            </span>
            <span class="text-muted"> · {{ PARTICIPANT_STATUS_LABELS[person.status] }}</span>
          </li>
        </ul>
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
