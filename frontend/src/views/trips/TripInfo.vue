<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { listObjectsByIds } from '@/api/objects'
import { listTripTypes } from '@/api/trips'
import {
  extractObjectIds,
  markdownToHtml,
  objectToken,
  type MentionLinks,
  type MentionNames,
} from '@/utils/markdown'
import { tripFrameParts, tripMeetingText, tripWhenText } from '@/utils/tripDisplay'
import { TRIP_STATUS_LABELS, type Trip, type TripTypeOption } from '@/types/trips'

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
 * По запросу на объект — двадцать запросов на маршрут. Вместе с именем
 * приезжает `url`: в режиме чтения имя объекта — ссылка на его страницу
 * на «Природе Байкала» (`trip-tabs.md`, решение 20.10.2026). Своей страницы
 * объекта у нас ещё нет, и когда появится, ссылка переедет на неё —
 * менять придётся только эту карту.
 */
const props = defineProps<{ trip: Trip }>()

const names = ref<MentionNames>({})

/** Куда ведёт имя объекта. Пустая карта — имя покажется без ссылки. */
const links = ref<MentionLinks>({})

async function resolveObjects(text: string) {
  const ids = extractObjectIds(text ?? '')
  if (ids.length === 0) return

  const objects = await listObjectsByIds(ids)

  names.value = {
    ...names.value,
    ...Object.fromEntries(objects.map((object) => [objectToken(object.id), object.name])),
  }

  // Объекты без внешней страницы в карту не попадают: адрес `null` —
  // это не ссылка, и превращать имя в якорь с пустым `href` нельзя.
  links.value = {
    ...links.value,
    ...Object.fromEntries(
      objects
        .filter((object) => object.url)
        .map((object) => [objectToken(object.id), object.url as string]),
    ),
  }
}

watch(
  () => [props.trip.routeText, props.trip.requirementsText],
  ([route, requirements]) => {
    void resolveObjects(`${route ?? ''}\n${requirements ?? ''}`)
  },
  { immediate: true },
)

/**
 * Типы похода словами.
 *
 * В походе лежат только id (`activityTypeIds`), а подписи и иконки —
 * в справочнике. Словарь кешируется в `api/trips.ts`, поэтому карточки
 * ленты и эта вкладка стоят одного запроса на всю страницу.
 */
const tripTypes = ref<TripTypeOption[]>([])

onMounted(async () => {
  try {
    tripTypes.value = (await listTripTypes()).types
  } catch {
    // Справочник не загрузился — тип просто не показываем: выдумывать
    // подпись по id нельзя, а «тип 19» человеку ничего не говорит.
  }
})

const typesText = computed(() => {
  const labels = new Map(tripTypes.value.map((type) => [type.id, type.label]))

  return props.trip.activityTypeIds
    .map((id) => labels.get(id))
    .filter((label): label is string => Boolean(label))
    .join(' · ')
})

const routeHtml = computed(() =>
  markdownToHtml(props.trip.routeText ?? '', names.value, links.value),
)

const requirementsHtml = computed(() =>
  markdownToHtml(props.trip.requirementsText ?? '', names.value, links.value),
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

/**
 * Сбор: где встречаемся.
 *
 * Показывается, только если это заполнено: пустая строка «Сбор: —» читается
 * как поломка, а не как «ещё не решили».
 */
const meeting = computed(() => tripMeetingText(props.trip))
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

      <div v-if="typesText">
        <dt class="text-xs text-muted">Тип похода</dt>
        <dd class="text-sm text-text" data-test="info-types">{{ typesText }}</dd>
      </div>

      <div>
        <dt class="text-xs text-muted">Готовность</dt>
        <dd class="text-sm text-text">{{ TRIP_STATUS_LABELS[trip.status] }}</dd>
      </div>

      <div>
        <dt class="text-xs text-muted">Рамка</dt>
        <dd class="text-sm text-text" data-test="info-frame">{{ frame }}</dd>
      </div>

      <div v-if="meeting">
        <dt class="text-xs text-muted">Сбор</dt>
        <dd class="text-sm text-text" data-test="info-meeting">{{ meeting }}</dd>
      </div>

      <div v-if="trip.hasGuitar">
        <dt class="text-xs text-muted">Гитара</dt>
        <dd class="text-sm text-text" data-test="info-guitar">будет</dd>
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
        data-test="info-requirements"
        v-html="requirementsHtml"
      />
    </div>
  </section>
</template>
