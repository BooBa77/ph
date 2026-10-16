<script setup lang="ts">
import { computed, ref } from 'vue'

import { ApiError } from '@/api/errors'
import { createTrip } from '@/api/trips'
import GeoObjectPicker from '@/components/ui/GeoObjectPicker.vue'
import MarkdownEditor from '@/components/ui/MarkdownEditor.vue'
import TripDateVariants from '@/views/trips/TripDateVariants.vue'
import {
  TRIP_STATUSES,
  TRIP_STATUS_LABELS,
  TRIP_VISIBILITIES,
  TRIP_VISIBILITY_LABELS,
  emptyVariantDraft,
  geoObjectLabel,
  type CreateTripRequest,
  type DateVariantDraft,
  type GeoObject,
  type Trip,
  type TripDateVariantInput,
  type TripStatus,
  type TripVisibility,
} from '@/types/trips'

/**
 * Создание похода — полноценная страница, а не панель в списке.
 *
 * **Порядок полей не случаен и повторяет то, как о походе думают.**
 * Сначала флаги: коммерческий или спортивный — это рамка, в которой всё
 * остальное читается. Потом готовность и видимость: «мечта, видна всем» —
 * это уже половина ответа о походе. И только потом цель, анонс, когда
 * и как идём.
 *
 * **Имя похода — это цель.** Три похода на Витязь в ленте — норма: народ
 * смотрит сначала на цель, потом на когда, потом на кого. Отдельное поле
 * называется «Анонс» и содержит короткий текст, а не имя.
 *
 * Организатором становится тот, кто заполнил форму: поля с организатором
 * нет намеренно, и бэкенд лишнее поле отбивает 400-м.
 *
 * **Правила проверяются здесь же, а не только на бэкенде.** Цель, даты
 * у решённого похода, цена у коммерческого — бэкенд ответит на это 400-м
 * с внятным текстом, но человек узнает об ошибке после запроса. Те же
 * условия на клиенте дают ответ сразу; сервер остаётся единственным, кто
 * решает окончательно.
 */

// ─── Рамка ───

const isCommercial = ref(false)
const isSport = ref(false)

// ─── Готовность и видимость ───

const status = ref<TripStatus>('idea')
const visibility = ref<TripVisibility>('public')

/** Пояснение к выбранной готовности: оно же объясняет, почему даты такие. */
const STATUS_HINTS: Record<TripStatus, string> = {
  idea: 'Мечта: элемент вишлиста. Даты может не быть вовсе — «когда-нибудь». Если знаете месяцы или число, укажите их, а продолжительность важнее даты.',
  planning:
    'Планирую: решение принято, срок ещё плавает — «следующим летом». Отметьте месяцы или точное число; конкретные даты появятся, когда поход станет решённым.',
  decided:
    'Решено: у похода есть начало и конец. По ним считается, идёт он сейчас или уже прошёл, — поэтому обе даты обязательны.',
}

// ─── Цель ───

const selectedGoal = ref<GeoObject | null>(null)

function chooseGoal(object: GeoObject) {
  selectedGoal.value = object
}

// ─── Анонс ───

const announcement = ref('')

// ─── Даты ───

const variants = ref<DateVariantDraft[]>([emptyVariantDraft(1)])
const startsAt = ref('')
const endsAt = ref('')

const isDateForecast = computed(() => status.value === 'idea' || status.value === 'planning')

// ─── Маршрут и требования ───

const routeText = ref('')
const requirements = ref('')

// ─── Коммерция ───

const priceRub = ref('')
const priceNote = ref('')

// ─── Отправка ───

const isSubmitting = ref(false)
const submitError = ref<string | null>(null)
const created = ref<Trip | null>(null)

/**
 * Что мешает отправить форму. `null` — можно.
 *
 * Порядок проверок — от обязательного к уточняющему, и показываем одну
 * причину за раз: список из трёх претензий к незаполненной форме читать
 * неприятно.
 */
const validationProblem = computed<string | null>(() => {
  if (!selectedGoal.value) return 'Выберите цель похода'

  if (isDateForecast.value) {
    for (const row of variants.value) {
      const days = row.durationDays ? Number(row.durationDays) : null
      const delta = row.durationDelta ? Number(row.durationDelta) : 0

      if (delta > 0 && !days) {
        return 'Запас нельзя указать без продолжительности: «5 дней + 2» — можно, «+2» — нет'
      }
      if (row.mode === 'exact' && row.day && !row.month) {
        return 'Число без месяца не бывает — выберите месяц'
      }
    }
  } else {
    if (!startsAt.value || !endsAt.value) {
      return 'У решённого похода должны быть обе даты — начало и конец'
    }
    if (new Date(endsAt.value) < new Date(startsAt.value)) {
      return 'Конец похода раньше начала'
    }
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

/**
 * Черновики вариантов в то, что принимает API.
 *
 * Прокликанные месяцы разворачиваются в отдельные варианты: «июнь, июль»
 * значит «старт в июне или в июле». Полностью пустой вариант не уезжает
 * вовсе — база такого не примет, да и смысла в нём нет: «мечта без даты»
 * это просто отсутствие вариантов.
 */ function buildVariants(): TripDateVariantInput[] {
  const result: TripDateVariantInput[] = []

  for (const row of variants.value) {
    const durationDays = row.durationDays ? Number(row.durationDays) : null
    const durationDelta = row.durationDelta ? Number(row.durationDelta) : 0

    if (row.mode === 'exact') {
      const month = row.month ? Number(row.month) : null
      const day = row.day ? Number(row.day) : null
      const year = row.year ? Number(row.year) : null

      if (month === null && durationDays === null) continue

      result.push({ year, month, day, durationDays, durationDelta })
      continue
    }

    if (row.periods.length > 0) {
      for (const period of row.periods) {
        // Год уезжает вместе с месяцем: без него «июнь» не значит ничего.
        result.push({
          year: period.year,
          month: period.month,
          durationDays,
          durationDelta,
        })
      }
      continue
    }

    // Ни месяца, ни числа, но продолжительность известна — «на неделю,
    // когда угодно». Это законный вариант.
    if (durationDays !== null) {
      result.push({ durationDays, durationDelta })
    }
  }

  return result
}

function buildPayload(): CreateTripRequest {
  const payload: CreateTripRequest = {
    goalObjectId: Number(selectedGoal.value!.id),
    announcement: announcement.value.trim() || null,
    routeText: routeText.value,
    requirementsText: requirements.value.trim() || null,
    visibility: visibility.value,
    status: status.value,
    isCommercial: isCommercial.value,
    isSport: isSport.value,
    priceRub: isCommercial.value ? Number(priceRub.value) : null,
    priceNote: isCommercial.value ? priceNote.value.trim() || null : null,
  }

  if (isDateForecast.value) {
    payload.startsAt = null
    payload.endsAt = null
    payload.dateVariants = buildVariants()
  } else {
    payload.startsAt = toIso(startsAt.value)
    payload.endsAt = toIso(endsAt.value)
    payload.dateVariants = []
  }

  return payload
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
  selectedGoal.value = null
  isCommercial.value = false
  isSport.value = false
  status.value = 'idea'
  visibility.value = 'public'
  announcement.value = ''
  variants.value = [emptyVariantDraft(1)]
  startsAt.value = ''
  endsAt.value = ''
  routeText.value = ''
  requirements.value = ''
  priceRub.value = ''
  priceNote.value = ''
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
    <p class="mt-2 text-sm text-text" data-test="created-name">
      {{ created.goalObject?.name ?? 'Без цели' }}
    </p>
    <p v-if="created.announcement" class="mt-1 text-sm text-muted">
      {{ created.announcement }}
    </p>
    <p class="mt-2 text-sm text-muted">
      {{ TRIP_STATUS_LABELS[created.status] }} ·
      {{ TRIP_VISIBILITY_LABELS[created.visibility] }}
      <template v-if="created.isCommercial"> · коммерческий</template>
      <template v-if="created.isSport"> · спортивное мероприятие</template>
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
    <!-- Рамка похода: флаги -->
    <div class="flex flex-col gap-3">
      <label class="flex cursor-pointer items-center gap-3">
        <input
          v-model="isCommercial"
          type="checkbox"
          class="h-5 w-5 cursor-pointer accent-[var(--theme-primary)]"
          data-test="commercial"
        />
        <span class="text-sm text-text">Коммерческий поход</span>
        <span class="text-xs text-muted">участие платное</span>
      </label>

      <label class="flex cursor-pointer items-center gap-3">
        <input
          v-model="isSport"
          type="checkbox"
          class="h-5 w-5 cursor-pointer accent-[var(--theme-primary)]"
          data-test="sport"
        />
        <span class="text-sm text-text">Спортивный поход</span>
        <span class="text-xs text-muted">зачётный поход, в основном некатегорийный</span>
      </label>
    </div>

    <!-- Готовность и видимость -->
    <div class="grid gap-4 md:grid-cols-2">
      <label class="flex flex-col gap-2">
        <span class="text-sm text-muted">Готовность</span>
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

    <!-- Цель -->
    <div class="flex flex-col gap-2">
      <div v-if="selectedGoal" class="flex flex-wrap items-center gap-3">
        <span class="text-sm text-muted">Цель</span>
        <span
          class="rounded-xl border border-primary bg-field px-3 py-2 text-base text-text"
          data-test="selected-goal"
        >
          {{ geoObjectLabel(selectedGoal) }}
        </span>
        <button
          type="button"
          class="cursor-pointer text-sm text-muted underline transition-colors hover:text-text"
          @click="selectedGoal = null"
        >
          Другая цель
        </button>
      </div>

      <GeoObjectPicker v-else label="Цель похода" @select="chooseGoal" />
    </div>

    <!-- Анонс -->
    <label class="flex flex-col gap-2">
      <span class="text-sm text-muted">Анонс</span>
      <input
        v-model="announcement"
        type="text"
        maxlength="120"
        placeholder="Коротко: «идём на майские, набор шесть человек»"
        class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
        data-test="announcement"
      />
      <span class="text-xs text-muted">
        Имя похода — цель. Анонс — подпись к ней в ленте, и он необязателен.
      </span>
    </label>

    <!-- Когда -->
    <div class="flex flex-col gap-3">
      <span class="text-sm text-muted">Когда</span>

      <p class="text-xs text-muted" data-test="status-hint">
        {{ STATUS_HINTS[status] }}
      </p>

      <TripDateVariants v-if="isDateForecast" v-model="variants" />

      <div v-else class="grid gap-4 md:grid-cols-2">
        <label class="flex flex-col gap-2">
          <span class="text-xs text-muted">Начало</span>
          <input
            v-model="startsAt"
            type="datetime-local"
            class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
            data-test="starts-at"
          />
        </label>

        <label class="flex flex-col gap-2">
          <span class="text-xs text-muted">Конец</span>
          <input
            v-model="endsAt"
            type="datetime-local"
            class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
            data-test="ends-at"
          />
        </label>
      </div>
    </div>

    <!-- Маршрут -->
    <div class="flex flex-col gap-2">
      <span class="text-sm text-muted">Маршрут</span>

      <MarkdownEditor
        v-model="routeText"
        :rows="6"
        placeholder="Как идём, где ночуем, чем забрасываемся. Объекты — кнопкой «Объект»"
        :objects="true"
        :emoji="false"
      />

      <span class="text-xs text-muted">
        В маршрут вставляются только объекты: смайлики и участники здесь ни к чему. В отчёте и
        дневнике набор будет другим — редактор один.
      </span>
    </div>

    <!-- Требования -->
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
    <div v-if="isCommercial" class="flex flex-col gap-3">
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
