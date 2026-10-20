<script setup lang="ts">
import { computed, ref } from 'vue'

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
 * Форма похода: одна на создание и на правку.
 *
 * **Почему общая.** Создание и правка — те же поля, тот же порядок и те же
 * правила; двумя копиями они разошлись бы на первой же новой колонке
 * (ровно так и появились «место сбора» и «заброска» — их надо было
 * добавить в две формы). Компонент знает только про поля: запрос делает
 * родитель, потому что `POST` и `PATCH` — разные истории.
 *
 * **Порядок полей не случаен и повторяет то, как о походе думают.**
 * Сначала флаги: коммерческий или официальный — это рамка, в которой всё
 * остальное читается. Потом готовность и видимость: «мечта, видна всем» —
 * это уже половина ответа о походе. И только потом цель, анонс, когда,
 * как собираемся и как идём.
 *
 * **Имя похода — это цель.** Три похода на Витязь в ленте — норма: народ
 * смотрит сначала на цель, потом на когда, потом на кого. Отдельное поле
 * называется «Анонс» и содержит короткий текст, а не имя.
 *
 * **Правила проверяются здесь же, а не только на бэкенде.** Цель, даты
 * у решённого похода, цена у коммерческого — бэкенд ответит на это 400-м
 * с внятным текстом, но человек узнает об ошибке после запроса. Те же
 * условия на клиенте дают ответ сразу; сервер остаётся единственным, кто
 * решает окончательно.
 */
const props = withDefaults(
  defineProps<{
    /** Поход для правки. `null` — форма создания. */
    initial?: Trip | null
    /** Подпись кнопки: «Создать поход» или «Сохранить». */
    submitLabel?: string
    /** Запрос в полёте: кнопка гаснет, подпись меняется. */
    isSubmitting?: boolean
    /** Текст ошибки от сервера. Показывается как есть. */
    error?: string | null
  }>(),
  {
    initial: null,
    submitLabel: 'Создать поход',
    isSubmitting: false,
    error: null,
  },
)

const emit = defineEmits<{
  /** Форма собрана и проверена. Запрос делает родитель. */
  submit: [payload: CreateTripRequest]
}>()

/**
 * Момент времени в значение `<input type="datetime-local">`.
 *
 * `toISOString()` тут не годится: он отдаёт UTC, а поле ждёт местное время
 * — в Иркутске поход «в 8:00» показывался бы как «в 00:00», и сохранение
 * сдвинуло бы время сбора на восемь часов.
 */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''

  const at = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')

  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

const initial = props.initial

// ─── Рамка ───

const isCommercial = ref(initial?.isCommercial ?? false)
const isOfficial = ref(initial?.isOfficial ?? false)

// ─── Готовность и видимость ───

const status = ref<TripStatus>(initial?.status ?? 'idea')
const visibility = ref<TripVisibility>(initial?.visibility ?? 'public')

/** Пояснение к выбранной готовности: оно же объясняет, почему даты такие. */
const STATUS_HINTS: Record<TripStatus, string> = {
  idea: 'Мечта: элемент вишлиста. Даты может не быть вовсе — «когда-нибудь». Если знаете месяцы или число, укажите их, а продолжительность важнее даты.',
  planning:
    'Планирую: решение принято, срок ещё плавает — «следующим летом». Отметьте месяцы или точное число; конкретные даты появятся, когда поход станет решённым.',
  decided:
    'Решено: у похода есть начало и конец. По ним считается, идёт он сейчас или уже прошёл, — поэтому обе даты обязательны.',
}

// ─── Цель ───

/**
 * Цель в правке известна заранее — из похода. Отдельный объект справочника
 * за ней не тянется: для подписи хватает имени, типа и родителя, которые
 * уже пришли в ответе.
 */
const selectedGoal = ref<GeoObject | null>(
  initial?.goalObject
    ? {
        id: initial.goalObject.id,
        name: initial.goalObject.name,
        type: initial.goalObject.type,
        url: initial.goalObject.url,
        parentId: null,
        parentName: null,
      }
    : null,
)

function chooseGoal(object: GeoObject) {
  selectedGoal.value = object
}

// ─── Анонс ───

const announcement = ref(initial?.announcement ?? '')

// ─── Даты ───

/**
 * Варианты дат в правке не предзаполняются: их нет в ответе API (`GET
 * /api/trips/:id` отдаёт решение, а не прогноз). Пустой список означает
 * «не трогали», и патч их не тронет — см. `buildTripPatch`.
 */
const variants = ref<DateVariantDraft[]>([emptyVariantDraft(1)])
const startsAt = ref(toLocalInput(initial?.startsAt ?? null))
const endsAt = ref(toLocalInput(initial?.endsAt ?? null))

const isDateForecast = computed(() => status.value === 'idea' || status.value === 'planning')

// ─── Маршрут, требования, сбор ───

const routeText = ref(initial?.routeText ?? '')
const requirements = ref(initial?.requirementsText ?? '')
const meetingPlace = ref(initial?.meetingPlace ?? '')
const meetingAt = ref(toLocalInput(initial?.meetingAt ?? null))
const transfer = ref(initial?.transferText ?? '')

// ─── Коммерция ───

const priceRub = ref(initial?.priceRub ? String(initial.priceRub) : '')
const priceNote = ref(initial?.priceNote ?? '')

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

const canSubmit = computed(() => validationProblem.value === null && !props.isSubmitting)

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
 */
function buildVariants(): TripDateVariantInput[] {
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

/** Собрать тело запроса из формы. Полное: что с ним делать, решает родитель. */
function buildPayload(): CreateTripRequest {
  const payload: CreateTripRequest = {
    goalObjectId: Number(selectedGoal.value!.id),
    announcement: announcement.value.trim() || null,
    routeText: routeText.value,
    requirementsText: requirements.value.trim() || null,
    meetingPlace: meetingPlace.value.trim() || null,
    meetingAt: toIso(meetingAt.value),
    transferText: transfer.value.trim() || null,
    visibility: visibility.value,
    status: status.value,
    isCommercial: isCommercial.value,
    isOfficial: isOfficial.value,
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

function submit() {
  if (validationProblem.value) return
  emit('submit', buildPayload())
}

/** Для тестов и для родителя: форма умеет рассказать, чего ей не хватает. */
defineExpose({ validationProblem })
</script>

<template>
  <form
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
          v-model="isOfficial"
          type="checkbox"
          class="h-5 w-5 cursor-pointer accent-[var(--theme-primary)]"
          data-test="official"
        />
        <span class="text-sm text-text">Официальный поход</span>
        <span class="text-xs text-muted">зачётный выход по правилам, открывает вкладку «Спорт»</span>
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

    <!-- Сбор и заброска -->
    <div class="flex flex-col gap-3">
      <span class="text-sm text-muted">Сбор и заброска</span>

      <p class="text-xs text-muted">
        То, что нужно знать в день выхода: где встречаемся, во сколько и как добираемся.
      </p>

      <label class="flex flex-col gap-2">
        <span class="text-xs text-muted">Место сбора</span>
        <input
          v-model="meetingPlace"
          type="text"
          maxlength="200"
          placeholder="Иркутск, автовокзал, у первой платформы"
          class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
          data-test="meeting-place"
        />
      </label>

      <label class="flex flex-col gap-2 md:max-w-xs">
        <span class="text-xs text-muted">Время сбора</span>
        <input
          v-model="meetingAt"
          type="datetime-local"
          class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
          data-test="meeting-at"
        />
      </label>

      <label class="flex flex-col gap-2">
        <span class="text-xs text-muted">Заброска: как добираемся</span>
        <textarea
          v-model="transfer"
          rows="2"
          placeholder="Электричка 6:40 от вокзала, дальше пешком 4 км"
          class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
          data-test="transfer"
        />
      </label>
    </div>

    <!-- Маршрут -->
    <div class="flex flex-col gap-2">
      <span class="text-sm text-muted">Маршрут</span>

      <MarkdownEditor
        v-model="routeText"
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
    <div class="flex flex-col gap-2">
      <span class="text-sm text-muted">Требования к участникам</span>

      <MarkdownEditor
        v-model="requirements"
        min-height="5rem"
        placeholder="Опыт, снаряжение, «нужны свои кошки»"
        :objects="false"
        :emoji="false"
      />

      <span class="text-xs text-muted">
        Базовый набор: оформление текста, ссылка и дата. Объекты сюда не вставляются — они в
        маршруте.
      </span>
    </div>

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
      <p v-if="error" class="text-sm text-red-600" data-test="error">
        {{ error }}
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
        {{ isSubmitting ? 'Сохраняем…' : submitLabel }}
      </button>
    </div>
  </form>
</template>
