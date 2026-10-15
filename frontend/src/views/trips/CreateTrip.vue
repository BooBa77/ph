<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'

import { ApiError } from '@/api/errors'
import { listObjects } from '@/api/objects'
import { createTrip } from '@/api/trips'
import {
  TRIP_STATUSES,
  TRIP_STATUS_LABELS,
  TRIP_VISIBILITIES,
  TRIP_VISIBILITY_LABELS,
  type CreateTripRequest,
  type GeoObject,
  type Trip,
  type TripStatus,
  type TripVisibility,
} from '@/types/trips'

/**
 * Создание похода — первый экран раздела.
 *
 * Организатором становится тот, кто заполнил форму: выбор организатора
 * в интерфейсе не предусмотрен намеренно, а бэкенд лишнее поле
 * с организатором отбивает 400-м.
 *
 * **Правила проверяются здесь же, а не только на бэкенде.** Цель, обе даты
 * у решённого похода, цена у коммерческого — бэкенд ответит на это 400-м
 * с внятным текстом, но человек узнает об ошибке после нажатия кнопки
 * и после запроса. Те же условия на клиенте дают ответ сразу; сервер
 * остаётся единственным, кто решает окончательно.
 */

/** Пауза перед поиском по справочнику: на каждую букву ходить незачем. */
const SEARCH_DELAY_MS = 300

// ─── Цель похода ───

const goalSearch = ref('')
const goalOptions = ref<GeoObject[]>([])
const selectedGoal = ref<GeoObject | null>(null)
/**
 * Список целей открыт сразу, а не по фокусу.
 *
 * Форма, где первое поле — пустой ввод без подсказки, читается как
 * «выбирать нечего». Справочник небольшой, список прокручивается,
 * а поиск его сужает.
 */
const isGoalListOpen = ref(true)
const isSearching = ref(false)
const goalError = ref<string | null>(null)

let searchTimer: ReturnType<typeof setTimeout> | undefined

/** Найти объекты по введённой строке. */
async function searchGoals() {
  isSearching.value = true
  goalError.value = null
  try {
    goalOptions.value = await listObjects(goalSearch.value.trim() || undefined)
  } catch {
    goalError.value = 'Не удалось загрузить справочник'
    goalOptions.value = []
  } finally {
    isSearching.value = false
  }
}

watch(goalSearch, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(searchGoals, SEARCH_DELAY_MS)
})

// Первая загрузка: показываем список, не дожидаясь ввода — объектов
// в справочнике немного, и пустой список при открытии выглядит поломкой.
searchGoals()

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

function chooseGoal(object: GeoObject) {
  selectedGoal.value = object
  isGoalListOpen.value = false
  searchGoals()
}

function resetGoal() {
  selectedGoal.value = null
  goalSearch.value = ''
  isGoalListOpen.value = true
  searchGoals()
}

/** Как объект подписан в списке: имя и родитель, потому что имена повторяются. */
function goalLabel(object: GeoObject): string {
  return object.parentName ? `${object.name} · ${object.parentName}` : object.name
}

// ─── Поля похода ───

const title = ref('')
const routeText = ref('')
const requirements = ref('')
const visibility = ref<TripVisibility>('public')
const status = ref<TripStatus>('idea')
const startsAt = ref('')
const endsAt = ref('')
const isCommercial = ref(false)
const priceRub = ref('')
const priceNote = ref('')

const isSubmitting = ref(false)
const submitError = ref<string | null>(null)
const created = ref<Trip | null>(null)

/**
 * Что мешает отправить форму. `null` — можно.
 *
 * Порядок проверок — от обязательного к уточняющему: сначала цель, потом
 * даты, потом цена. Показываем одну причину за раз: список из трёх
 * претензий к незаполненной форме читать неприятно.
 */
const validationProblem = computed<string | null>(() => {
  if (!selectedGoal.value) return 'Выберите цель похода'

  if (status.value === 'decided' && (!startsAt.value || !endsAt.value)) {
    return 'У решённого похода должны быть обе даты — начало и конец'
  }

  if (startsAt.value && endsAt.value && new Date(endsAt.value) < new Date(startsAt.value)) {
    return 'Конец похода раньше начала'
  }

  if (isCommercial.value && !(Number(priceRub.value) > 0)) {
    return 'У коммерческого похода укажите цену участия'
  }

  return null
})

const canSubmit = computed(() => validationProblem.value === null && !isSubmitting.value)

/** Локальное время из `<input type="datetime-local">` в момент времени ISO. */
function toIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null
}

function buildPayload(): CreateTripRequest {
  return {
    goalObjectId: Number(selectedGoal.value!.id),
    title: title.value.trim() || null,
    routeText: routeText.value,
    requirementsText: requirements.value.trim() || null,
    visibility: visibility.value,
    status: status.value,
    startsAt: toIso(startsAt.value),
    endsAt: toIso(endsAt.value),
    isCommercial: isCommercial.value,
    priceRub: isCommercial.value ? Number(priceRub.value) : null,
    priceNote: isCommercial.value ? priceNote.value.trim() || null : null,
  }
}

async function submit() {
  if (validationProblem.value) {
    submitError.value = validationProblem.value
    return
  }

  isSubmitting.value = true
  submitError.value = null

  try {
    created.value = await createTrip(buildPayload())
  } catch (error) {
    // Текст ошибки даёт бэкенд: он один знает правила окончательно,
    // и переписывать их здесь своими словами — значит разойтись с ним.
    submitError.value = error instanceof ApiError ? error.message : 'Не удалось создать поход'
  } finally {
    isSubmitting.value = false
  }
}

/** Начать заново: форма в исходное состояние. */
function startOver() {
  created.value = null
  submitError.value = null
  title.value = ''
  routeText.value = ''
  requirements.value = ''
  visibility.value = 'public'
  status.value = 'idea'
  startsAt.value = ''
  endsAt.value = ''
  isCommercial.value = false
  priceRub.value = ''
  priceNote.value = ''
  selectedGoal.value = null
  goalSearch.value = ''
  isGoalListOpen.value = true
  searchGoals()
}
</script>

<template>
  <!-- Готово: показываем, что создалось, чтобы не гадать, ушло ли -->
  <section
    v-if="created"
    class="rounded-xl border border-border bg-surface p-6"
    data-test="created"
  >
    <h2 class="text-lg font-medium text-text">Поход создан</h2>
    <p class="mt-2 text-sm text-muted">
      {{ created.title || created.goalObject?.name || 'Без названия' }}
      · {{ TRIP_STATUS_LABELS[created.status] }} · {{ TRIP_VISIBILITY_LABELS[created.visibility] }}
    </p>
    <p class="mt-1 text-xs text-muted">
      Вы записаны организатором и идёте — статус участия можно поменять в походе.
    </p>

    <button
      type="button"
      class="mt-4 cursor-pointer rounded-xl border border-border bg-field px-4 py-2 text-sm text-text transition-colors hover:border-primary"
      @click="startOver"
    >
      Создать ещё
    </button>
  </section>

  <form
    v-else
    class="flex flex-col gap-6 rounded-xl border border-border bg-surface p-6"
    @submit.prevent="submit"
  >
    <!-- Цель -->
    <div class="flex flex-col gap-2">
      <span class="text-sm text-muted">Цель похода</span>

      <div v-if="selectedGoal" class="flex flex-wrap items-center gap-2">
        <span
          class="rounded-xl border border-primary bg-field px-3 py-2 text-sm text-text"
          data-test="selected-goal"
        >
          {{ goalLabel(selectedGoal) }}
        </span>
        <button
          type="button"
          class="cursor-pointer text-sm text-muted underline transition-colors hover:text-text"
          @click="resetGoal"
        >
          Другая цель
        </button>
      </div>

      <div v-else class="flex flex-col gap-2">
        <input
          v-model="goalSearch"
          type="search"
          placeholder="Начните вводить название — например, Витязь"
          class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
          data-test="goal-search"
          @focus="isGoalListOpen = true"
        />

        <p v-if="goalError" class="text-sm text-red-600">{{ goalError }}</p>

        <ul
          v-else-if="isGoalListOpen"
          class="max-h-64 overflow-y-auto rounded-xl border border-border"
          data-test="goal-options"
        >
          <li v-if="isSearching" class="px-3 py-2 text-sm text-muted">Ищем…</li>
          <li v-else-if="goalOptions.length === 0" class="px-3 py-2 text-sm text-muted">
            Ничего не нашлось
          </li>
          <li v-for="object in goalOptions" v-else :key="object.id">
            <button
              type="button"
              class="w-full cursor-pointer px-3 py-2 text-left text-sm text-text transition-colors hover:bg-bg"
              @click="chooseGoal(object)"
            >
              {{ goalLabel(object) }}
              <span class="text-muted">· {{ object.type }}</span>
            </button>
          </li>
        </ul>
      </div>
    </div>

    <!-- Название -->
    <label class="flex flex-col gap-2">
      <span class="text-sm text-muted">Название</span>
      <input
        v-model="title"
        type="text"
        maxlength="120"
        placeholder="Пусто — покажем имя цели"
        class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
        data-test="title"
      />
    </label>

    <!-- Статус и видимость -->
    <div class="grid gap-4 md:grid-cols-2">
      <label class="flex flex-col gap-2">
        <span class="text-sm text-muted">Стадия</span>
        <select
          v-model="status"
          class="w-full cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors hover:border-primary focus:border-primary focus:outline-none"
          data-test="status"
        >
          <option v-for="value in TRIP_STATUSES" :key="value" :value="value">
            {{ TRIP_STATUS_LABELS[value] }}
          </option>
        </select>
      </label>

      <label class="flex flex-col gap-2">
        <span class="text-sm text-muted">Кто видит</span>
        <select
          v-model="visibility"
          class="w-full cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors hover:border-primary focus:border-primary focus:outline-none"
          data-test="visibility"
        >
          <option v-for="value in TRIP_VISIBILITIES" :key="value" :value="value">
            {{ TRIP_VISIBILITY_LABELS[value] }}
          </option>
        </select>
      </label>
    </div>

    <!-- Даты -->
    <div class="grid gap-4 md:grid-cols-2">
      <label class="flex flex-col gap-2">
        <span class="text-sm text-muted">Начало</span>
        <input
          v-model="startsAt"
          type="datetime-local"
          class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
          data-test="starts-at"
        />
      </label>

      <label class="flex flex-col gap-2">
        <span class="text-sm text-muted">Конец</span>
        <input
          v-model="endsAt"
          type="datetime-local"
          class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
          data-test="ends-at"
        />
      </label>
    </div>

    <p class="-mt-2 text-xs text-muted">
      Даты можно не заполнять, пока это идея. У решённого похода обе обязательны — по ним считается,
      идёт поход сейчас или уже прошёл.
    </p>

    <!-- Маршрут и требования -->
    <label class="flex flex-col gap-2">
      <span class="text-sm text-muted">Маршрут</span>
      <textarea
        v-model="routeText"
        rows="5"
        placeholder="Как идём, где ночуем, чем забрасываемся"
        class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
        data-test="route"
      />
    </label>

    <label class="flex flex-col gap-2">
      <span class="text-sm text-muted">Требования к участникам</span>
      <textarea
        v-model="requirements"
        rows="3"
        placeholder="Опыт, снаряжение, «нужны свои кошки»"
        class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
        data-test="requirements"
      />
    </label>

    <!-- Коммерция -->
    <div class="flex flex-col gap-3">
      <label class="flex cursor-pointer items-center gap-3">
        <input
          v-model="isCommercial"
          type="checkbox"
          class="h-5 w-5 cursor-pointer accent-[var(--theme-primary)]"
          data-test="commercial"
        />
        <span class="text-sm text-text">Коммерческий поход</span>
      </label>

      <template v-if="isCommercial">
        <label class="flex flex-col gap-2">
          <span class="text-sm text-muted">Цена участия, ₽</span>
          <input
            v-model="priceRub"
            type="number"
            min="1"
            step="1"
            class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none md:max-w-xs"
            data-test="price"
          />
        </label>

        <label class="flex flex-col gap-2">
          <span class="text-sm text-muted">Что входит в стоимость</span>
          <textarea
            v-model="priceNote"
            rows="2"
            placeholder="Заброска, питание, прокат"
            class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
            data-test="price-note"
          />
        </label>
      </template>

      <p v-else class="text-xs text-muted">
        У некоммерческого похода платы за участие нет — бывают расходы (заброска, продукты), но это
        другое, и о них договариваются в чате.
      </p>
    </div>

    <!-- Итог -->
    <div class="flex flex-col gap-3 border-t border-border pt-4">
      <p v-if="submitError" class="text-sm text-red-600" data-test="error">
        {{ submitError }}
      </p>
      <p v-else-if="validationProblem" class="text-sm text-muted" data-test="hint">
        {{ validationProblem }}
      </p>

      <button
        type="submit"
        :disabled="!canSubmit"
        class="cursor-pointer self-start rounded-xl border border-primary bg-primary px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        data-test="submit"
      >
        {{ isSubmitting ? 'Создаём…' : 'Создать поход' }}
      </button>
    </div>
  </form>
</template>
