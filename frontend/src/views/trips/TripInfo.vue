<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { listObjectsByIds } from '@/api/objects'
import { extractObjectIds, markdownToHtml, objectToken, type MentionNames } from '@/utils/markdown'
import { tripFrameParts, tripWhenText } from '@/utils/tripDisplay'
import { TRIP_STATUS_LABELS, type Trip } from '@/types/trips'

/**
 * Вкладка «Информация»: то, что заполнили при создании похода.
 *
 * **Текст здесь читается, а не правится**, и это принципиально: маршрут
 * показывается без разметки, со ссылками и с именами объектов. Править
 * его будет отдельный режим — иначе случайное касание на телефоне
 * переписывало бы чужой маршрут.
 *
 * Имена объектов подтягиваются **одним запросом по списку id** из текста:
 * в походе лежат только токены `[[object:N]]`, а показать надо «Витязь».
 * По запросу на объект — двадцать запросов на маршрут.
 */
const props = defineProps<{ trip: Trip }>()

const names = ref<MentionNames>({})

async function resolveObjects(text: string) {
  const ids = extractObjectIds(text ?? '')
  if (ids.length === 0) return

  const objects = await listObjectsByIds(ids)
  names.value = {
    ...names.value,
    ...Object.fromEntries(objects.map((object) => [objectToken(object.id), object.name])),
  }
}

watch(
  () => [props.trip.routeText, props.trip.requirementsText],
  ([route, requirements]) => {
    void resolveObjects(`${route ?? ''}\n${requirements ?? ''}`)
  },
  { immediate: true },
)

const routeHtml = computed(() => markdownToHtml(props.trip.routeText ?? '', names.value))

const requirementsHtml = computed(() =>
  markdownToHtml(props.trip.requirementsText ?? '', names.value),
)

/**
 * Когда.
 *
 * У решённого похода стоят даты, у мечты и плана их может не быть вовсе —
 * тогда честнее показать готовность, чем пустое место. Форматирование
 * общее с карточкой ленты, чтобы «когда» не выглядело по-разному
 * в списке и внутри похода.
 */
const dates = computed(() => tripWhenText(props.trip))

/** Рамка: коммерция, спортивность, цена — строкой через точку. */
const frame = computed(() => tripFrameParts(props.trip).join(' · '))
</script>

<template>
  <section class="flex flex-col gap-4">
    <dl class="grid gap-3 md:grid-cols-2">
      <div>
        <dt class="text-xs text-muted">Цель</dt>
        <dd class="text-sm text-text" data-test="info-goal">
          {{ trip.goalObject?.name ?? '—' }}
          <span v-if="trip.goalObject" class="text-muted"> · {{ trip.goalObject.type }} </span>
        </dd>
      </div>

      <div>
        <dt class="text-xs text-muted">Когда</dt>
        <dd class="text-sm text-text" data-test="info-dates">{{ dates }}</dd>
      </div>

      <div>
        <dt class="text-xs text-muted">Готовность</dt>
        <dd class="text-sm text-text">{{ TRIP_STATUS_LABELS[trip.status] }}</dd>
      </div>

      <div>
        <dt class="text-xs text-muted">Рамка</dt>
        <dd class="text-sm text-text" data-test="info-frame">{{ frame }}</dd>
      </div>
    </dl>

    <div v-if="trip.routeText.trim()">
      <h2 class="mb-1 text-sm text-muted">Маршрут</h2>
      <!-- Разметку собираем мы сами из экранированного текста, чужой HTML
           сюда попасть не может — поэтому v-html здесь безопасен -->
      <div
        class="flex flex-col gap-1 text-sm leading-relaxed text-text"
        data-test="info-route"
        v-html="routeHtml"
      />
    </div>

    <div v-if="trip.requirementsText?.trim()">
      <h2 class="mb-1 text-sm text-muted">Требования к участникам</h2>
      <div
        class="flex flex-col gap-1 text-sm leading-relaxed text-text"
        v-html="requirementsHtml"
      />
    </div>
  </section>
</template>
