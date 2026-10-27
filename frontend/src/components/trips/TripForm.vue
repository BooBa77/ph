<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { listTripTypes } from '@/api/trips'
import GeoObjectPicker from '@/components/ui/GeoObjectPicker.vue'
import MarkdownEditor from '@/components/ui/MarkdownEditor.vue'
import TripTypesPicker from '@/components/trips/TripTypesPicker.vue'
import TripDateVariants from '@/views/trips/TripDateVariants.vue'
import {
  TRIP_STATUSES,
  TRIP_STATUS_LABELS,
  TRIP_VISIBILITIES,
  TRIP_VISIBILITY_LABELS,
  emptyVariantDraft,
  geoObjectLabel,
  type CreateTripRequest,
  type DatePeriod,
  type DateVariantDraft,
  type GeoObject,
  type Trip,
  type TripDateVariantInput,
  type TripStatus,
  type TripTypeOption,
  type TripVisibility,
} from '@/types/trips'

/**
 * Форма похода: одна на создание и на правку.
 *
 * **Почему общая.** Создание и правка — те же поля, тот же порядок и те же
 * правила; двумя копиями они разошлись бы на первой же новой колонке
 * (ровно так и появились «место сбора» и «типы похода» — их надо было
 * добавить в две формы). Компонент знает только про поля: запрос делает
 * родитель, потому что `POST` и `PATCH` — разные истории.
 *
 * **Порядок полей не случаен и повторяет то, как о походе думают.**
 * Сначала флаги: коммерческий или официальный — это рамка, в которой всё
 * остальное читается. Сразу за ними тип похода: от официальности зависит,
 * обязателен ли он. Потом готовность и видимость: «мечта, видна всем» —
 * это уже половина ответа о походе. И только потом цель, анонс, когда,
 * где собираемся и как идём. «Будет гитара» — в самом конце: это обещание
 * вечера, а не свойство маршрута.
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

// ─── Типы похода ───

/**
 * Типы похода: чипсы из группы «Туризм» общего справочника активностей.
 *
 * Список приходит с бэкенда, а не собирается в коде: новый тип — это
 * строка в справочнике, и форма обязана узнать о ней без деплоя фронта.
 *
 * `isTypesLoaded` — не украшение: если словарь не загрузился, форма
 * **не отправляет** `activityTypeIds` вовсе. Иначе правка похода без сети
 * стёрла бы типы: пустой список в `PATCH` — это «типов больше нет»,
 * а не «я их не видел».
 */
const tripTypes = ref<TripTypeOption[]>([])
const selectedTypeIds = ref<number[]>([...(initial?.activityTypeIds ?? [])])
const isTypesLoaded = ref(false)

onMounted(async () => {
  try {
    const { types, defaultTypeId } = await listTripTypes()
    tripTypes.value = types
    isTypesLoaded.value = true

    /**
     * Неофициальному походу подставляется пеший — но только при создании
     * и только если человек ещё ничего не выбрал. У официального типа
     * по умолчанию нет намеренно: там он несёт смысл (вид спорта и зачёт),
     * и подставлять его за человека значит делать проверку «тип обязателен»
     * бессмысленной.
     */
    if (initial === null && !isOfficial.value && selectedTypeIds.value.length === 0) {
      if (defaultTypeId !== null) selectedTypeIds.value = [defaultTypeId]
    }
  } catch {
    // Справочник не загрузился — чипсов не будет, и типы не уедут в запрос.
    // Ронять форму из-за этого незачем: всё остальное заполняется и
    // сохраняется как обычно.
  }
})

// ─── Готовность и видимость ───

const status = ref<TripStatus>(initial?.status ?? 'idea')
const visibility = ref<TripVisibility>(initial?.visibility ?? 'public')

/**
 * Мечта — вишлист, а не поход (`tabs.md` §7): место сбора, требования
 * к участникам и гитара — поля подготовки, у мечты их нет.
 */
const isIdea = computed(() => status.value === 'idea')

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
 * Собрать черновики из вариантов, которые пришли в ответе похода.
 *
 * Месяцы с одинаковой продолжительностью собираются в одну строку
 * «примерного периода» и становятся отдельными вариантами при отправке;
 * варианты с конкретным числом — по строке на каждый. Так форма правки
 * показывает то же, что человек ввёл когда-то, и смена готовности
 * не теряет продолжительность.
 */
function draftsFromVariants(source: TripDateVariantInput[]): DateVariantDraft[] {
  const drafts: DateVariantDraft[] = []
  let nextId = 0

  const months = new Map<
    string,
    { durationDays: string; durationDelta: string; periods: DatePeriod[] }
  >()
  const exact: TripDateVariantInput[] = []

  for (const variant of source) {
    if (variant.day != null) {
      exact.push(variant)
      continue
    }

    const key = `${variant.durationDays ?? ''}|${variant.durationDelta ?? 0}`
    const group = months.get(key) ?? {
      durationDays: variant.durationDays ? String(variant.durationDays) : '',
      durationDelta: variant.durationDelta ? String(variant.durationDelta) : '',
      periods: [],
    }
    if (variant.month != null) {
      group.periods.push({
        // Месяц без года в форме не выразить: подставляем текущий год,
        // чтобы строка не пропала. Данные приложения всегда с годом.
        year: variant.year ?? new Date().getFullYear(),
        month: variant.month,
      })
    }
    months.set(key, group)
  }

  for (const group of months.values()) {
    drafts.push({
      ...emptyVariantDraft(++nextId),
      periods: group.periods,
      durationDays: group.durationDays,
      durationDelta: group.durationDelta,
    })
  }

  for (const variant of exact) {
    drafts.push({
      ...emptyVariantDraft(++nextId),
      mode: 'exact',
      year: variant.year ? String(variant.year) : '',
      month: variant.month ? String(variant.month) : '',
      day: String(variant.day),
      durationDays: variant.durationDays ? String(variant.durationDays) : '',
      durationDelta: variant.durationDelta ? String(variant.durationDelta) : '',
    })
  }

  return drafts.length > 0 ? drafts : [emptyVariantDraft(1)]
}

/**
 * Варианты дат приходят в ответе похода (`dateVariants`) и предзаполняются:
 * иначе смена готовности с «Мечты» на «Планирую» теряла бы введённую
 * продолжительность — форма отправляла бы пустой прогноз.
 */
const variants = ref<DateVariantDraft[]>(
  draftsFromVariants(initial?.dateVariants ?? []),
)
const startsAt = ref(toLocalInput(initial?.startsAt ?? null))
const endsAt = ref(toLocalInput(initial?.endsAt ?? null))

const isDateForecast = computed(() => status.value === 'idea' || status.value === 'planning')

// ─── Маршрут, требования ───

const routeText = ref(initial?.routeText ?? '')
const requirements = ref(initial?.requirementsText ?? '')

// ─── Гитара ───

/**
 * «Будет гитара» — флаг, который решают в конце формы.
 *
 * Стоит последним намеренно: это не свойство похода, а обещание вечера,
 * и спрашивать о нём в начале формы рано. У гитары нет пары полей — она
 * либо едет, либо нет.
 */
const guitar = ref(initial?.hasGuitar ?? false)

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

  /**
   * Тип обязателен только у официального и только если справочник
   * загрузился: без него чипсов нет, и требовать выбор не из чего.
   */
  if (isOfficial.value && isTypesLoaded.value && selectedTypeIds.value.length === 0) {
    return 'У официального похода выберите тип — от него зависит вид спорта и зачёт'
  }

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

    // «Планировать без продолжительности нельзя» (решение 21.10.2026):
    // продолжительность — обязательное поле кнопки «Создать поход».
    // Даты при этом необязательны: «на неделю, когда угодно» — законная мечта.
    const hasDuration = variants.value.some((row) => Number(row.durationDays) > 0)
    if (!hasDuration) {
      return 'Укажите продолжительность: без неё поход не планируется'
    }

    // «Планирую» без даты не бывает: месяц или конкретное число обязательны.
    // У мечты дат может не быть вовсе — это вишлист.
    if (status.value === 'planning') {
      const hasDate = variants.value.some((row) =>
        row.mode === 'exact' ? Boolean(row.month) : row.periods.length > 0,
      )
      if (!hasDate) {
        return 'Укажите месяц или конкретное число: «Планирую» без даты не бывает'
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
    hasGuitar: guitar.value,
    visibility: visibility.value,
    status: status.value,
    isCommercial: isCommercial.value,
    isOfficial: isOfficial.value,
    priceRub: isCommercial.value ? Number(priceRub.value) : null,
    priceNote: isCommercial.value ? priceNote.value.trim() || null : null,
  }

  /**
   * Типы уходят только если словарь загрузился: иначе `undefined` в теле
   * означает «я их не видел», и `PATCH` не тронет то, что уже выбрано
   * в походе (см. `buildTripPatch`).
   */
  if (isTypesLoaded.value) {
    payload.activityTypeIds = [...selectedTypeIds.value]
  }

  if (isDateForecast.value) {
    /**
     * Даты не теряем: «Решено → Планирую» разрешено, и решённые даты
     * остаются (`tabs.md` §7). У создания черновика нет — там null.
     */
    payload.startsAt = initial?.startsAt ?? null
    payload.endsAt = initial?.endsAt ?? null
    payload.dateVariants = buildVariants()
  } else {
    payload.startsAt = toIso(startsAt.value)
    payload.endsAt = toIso(endsAt.value)
    payload.dateVariants = []
  }

  // У мечты полей подготовки нет — и в теле им делать нечего.
  if (isIdea.value) {
    payload.requirementsText = null
    payload.hasGuitar = false
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

    <!-- Тип похода: чипсы из группы «Туризм» -->
    <TripTypesPicker v-model="selectedTypeIds" :types="tripTypes" />

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

    <!-- Сбор: только у настоящего похода, у мечты его нет -->
    <div v-if="!isIdea" class="flex flex-col gap-3">
      <span class="text-sm text-muted">Сбор</span>

      <p class="text-xs text-muted">
        Где встречаемся в день выхода, — поле «Трансфера» (вкладка появится в Ф7).
        Здесь его нет: «где встречаемся» не часть анонса, а часть логистики.
      </p>
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

    <!-- Требования: подготовка, у мечты их нет -->
    <div v-if="!isIdea" class="flex flex-col gap-2">
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

    <!-- Гитара: вопрос на конец формы, только у настоящего похода -->
    <label
      v-if="!isIdea"
      class="flex cursor-pointer items-center gap-3 border-t border-border pt-4"
      data-test="guitar-label"
    >
      <input
        v-model="guitar"
        type="checkbox"
        class="h-5 w-5 cursor-pointer accent-[var(--theme-primary)]"
        data-test="guitar"
      />
      <span class="text-sm text-text">Будет гитара</span>
      <span class="text-xs text-muted">вечер у костра без неё не считается</span>
    </label>

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
