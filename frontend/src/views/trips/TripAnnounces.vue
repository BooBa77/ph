<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { LocationQueryRaw } from 'vue-router'

import { listObjectsByIds } from '@/api/objects'
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
 * **Фильтры живут в адресе.** Человек открывает поход, возвращается назад —
 * и подборка на месте; ту же ссылку можно отправить товарищу. Состояние
 * в `ref` этого не даёт: возврат с чужой страницы монтирует компонент
 * заново, и фильтры обнулялись бы.
 *
 * Значение из адреса **проверяется по словарю**: `?when=что-нибудь` — это
 * не повод показать пустую ленту, это повод не применять фильтр. Бэкенд
 * на такое ответил бы 400, а ссылка с опечаткой должна просто работать.
 */
const route = useRoute()
const router = useRouter()

/** Значение из адреса, если оно есть в словаре. Иначе — пусто. */
function queryValue<T extends string>(key: string, allowed: readonly T[]): T | '' {
  const raw = route.query[key]
  const value = typeof raw === 'string' ? raw : ''
  return (allowed as readonly string[]).includes(value) ? (value as T) : ''
}

/** Булев фильтр из адреса: строки 'true'/'false', всё остальное — «любое». */
function queryBoolean(key: string): '' | 'true' | 'false' {
  const raw = route.query[key]
  return raw === 'true' || raw === 'false' ? raw : ''
}

function queryObjectId(): number | null {
  const raw = route.query.objectId
  const value = Number(typeof raw === 'string' ? raw : NaN)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

/**
 * Объект фильтра: цель похода **или** упоминание в маршруте.
 *
 * В адресе лежит только id, а показывать надо имя — поэтому при заходе
 * по ссылке объект подтягивается запросом. id и объект хранятся порознь
 * не для красоты: первый запрос должен уйти сразу, не дожидаясь ответа
 * справочника, иначе лента ждала бы имя объекта, которого ещё нет.
 */
const objectId = ref<number | null>(queryObjectId())
const object = ref<GeoObject | null>(null)

const when = ref<TripWhen | ''>(queryValue('when', TRIP_WHEN_VALUES))
const status = ref<TripStatus | ''>(queryValue('status', TRIP_STATUSES))
const commercial = ref<'' | 'true' | 'false'>(queryBoolean('isCommercial'))
const sport = ref<'' | 'true' | 'false'>(queryBoolean('isSport'))

/** Имя объекта для подписи фильтра: оно нужно только на экране. */
async function restoreObject(id: number) {
  const found = await listObjectsByIds([String(id)])
  object.value = found[0] ?? null
}

function chooseObject(picked: GeoObject) {
  object.value = picked
  objectId.value = Number(picked.id)
}

function clearObject() {
  object.value = null
  objectId.value = null
}

if (objectId.value !== null) {
  void restoreObject(objectId.value)
}

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
    objectId: objectId.value ?? undefined,
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
    objectId.value !== null ||
    when.value !== '' ||
    status.value !== '' ||
    commercial.value !== '' ||
    sport.value !== '',
)

/** Снять всё выбранное: один обработчик вместо пяти одинаковых. */
function resetFilters() {
  object.value = null
  objectId.value = null
  when.value = ''
  status.value = ''
  commercial.value = ''
  sport.value = ''
}

/** Адрес без пустых фильтров: `?when=weekend`, а не `?when=&status=`. */
function filterQuery(): LocationQueryRaw {
  const query: LocationQueryRaw = {}

  if (objectId.value !== null) query.objectId = String(objectId.value)
  if (when.value) query.when = when.value
  if (status.value) query.status = status.value
  if (commercial.value) query.isCommercial = commercial.value
  if (sport.value) query.isSport = sport.value

  return query
}

/**
 * Смена любого фильтра перезагружает ленту с первой страницы и обновляет
 * адрес. `replace`, а не `push`: фильтр — это не переход, и забивать
 * историю браузера десятком записей «поменял список» нельзя, иначе кнопка
 * «назад» перестаёт выводить со страницы.
 *
 * Vue собирает изменения одного такта в один вызов: сброс пяти фильтров
 * кнопкой — это один запрос и одна правка адреса, а не пять.
 */
watch(
  [objectId, when, status, commercial, sport],
  () => {
    void router.replace({ query: filterQuery() })
    void load()
  },
  { immediate: true },
)
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
      <div class="flex flex-col gap-1">
        <GeoObjectPicker label="Объект" @select="chooseObject" />
        <p class="text-xs text-muted">
          Цель похода или упоминание в маршруте — подойдёт и то, и другое.
        </p>
      </div>

      <p v-if="object" class="flex items-center gap-2 text-sm text-text" data-test="filter-goal">
        <span>{{ object.name }}</span>
        <button
          type="button"
          class="cursor-pointer border-0 bg-transparent p-0 text-xs text-muted underline"
          data-test="filter-goal-clear"
          @click="clearObject"
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
            <option value="false">Некоммерческие</option>
            <option value="true">Коммерческие</option>
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

      <p class="text-xs text-muted" data-test="filters-hint">
        «Любое» в «Когда» — без фильтра по датам: в ленте будут и предстоящие,
        и прошедшие, и походы без дат. «Без дат» — только те, у которых даты
        не выбраны вовсе.
      </p>

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
