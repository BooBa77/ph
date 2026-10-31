<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { listTripGear } from '@/api/gear'
import { ApiError } from '@/api/errors'
import { fetchTripRoute, fetchTripTransfer, saveRouteNights } from '@/api/trips'
import { GEAR_TYPE_CODES } from '@/types/gear'
import type { TripGearItem } from '@/types/gear'
import type {
  CookingKind,
  NightKind,
  RouteNight,
  RouteNightInput,
  RouteOptionInput,
  Trip,
  TripRoute,
  TripTransferLeg,
} from '@/types/trips'
import {
  COOKING_KIND_LABELS,
  COOKING_NIGHT_KINDS,
  NIGHT_KIND_LABELS,
  PLACE_NIGHT_KINDS,
  SOLO_NIGHT_KINDS,
} from '@/types/trips'
import { shortDate } from '@/utils/calendar'
import TripRouteCooking from '@/views/trips/TripRouteCooking.vue'
import TripRouteTents from '@/views/trips/TripRouteTents.vue'

/**
 * Таблица ночёвок — на ручках бэкенда (31.10.2026).
 *
 * Экран был макетом: выбор варианта, готовки и места жил в памяти компонента
 * и после перезагрузки исчезал. Теперь данные приходят из `GET /route`,
 * а правка уходит таблицей целиком через `PUT /route/nights`.
 *
 * **Почему кнопка «Сохранить», а не сохранение на каждое изменение.**
 * Половина состояний сетки — промежуточные и недопустимые: выбрали «Палатку»,
 * а палатку из снаряжения ещё не выбрали; поставили в ночь «идём всю ночь»
 * рядом с гостиницей. Сервер такое отбивает 400-м, и автосохранение
 * превратило бы набор ночей в поток ошибок. Поэтому таблица собирается
 * черновиком и уходит одной транзакцией, а кнопка активна только когда
 * черновик разошёлся с сохранённым.
 *
 * **Что на плашке** (слова заказчика 29.10.2026, в силе):
 * - «Ночь 1 · 29 октября» — номер обычным текстом, дата серым после
 *   разделителя: единообразие с «День 1 · 23 октября» в «Питании»;
 * - справа в той же строке — поле «Место»: район ночёвки словами. Его
 *   спрашивают все варианты, кроме «В пути» и «Идём всю ночь»
 *   (30.10.2026): без стоянки района не бывает;
 * - выпадающий список варианта; пустой пункт — **пустой строкой**, без
 *   подписи «Не выбрано»: незаполненная ночь бросается в глаза. Пустое
 *   считается как «идём всю ночь» — ночуют в переходе, пока не сказали
 *   иначе;
 * - «идём всю ночь», «в пути» и «гостиница» готовку не спрашивают,
 *   палатка, изба и машина — спрашивают: костёр, горелка или оба.
 *
 * **Вариантов в ночи несколько** (комбинированная ночь: часть группы
 * в палатке, часть в гостинице). Поэтому каждая ночь — список строк
 * «вариант», и «Ещё вариант» добавляет строку. Правила сервера помогают
 * не делать ошибок: «идём всю ночь» и «в пути» вытесняют остальные строки,
 * готовка и место сбрасываются, когда вариант перестал их спрашивать.
 *
 * **Палатка и машина — ссылки, а не текст:** палатка выбирается из
 * снаряжения похода (тип `tent`), машина — из карточек своего ТС
 * в «Трансфере». Текст «палатка Васи» разошёлся бы с палаткой Васи
 * в снаряжении, поэтому экран загружает оба списка рядом с вкладкой.
 *
 * **Права — из ответа сервера** (`canEdit`): правят таблицу те, у кого право
 * вкладки `route`. Остальные видят её, но поля заблокированы.
 *
 * Ночи, которые ещё не записаны, показываются по датам похода — как раньше:
 * иначе у похода с датами вкладка выглядела бы пустой. Три ночи «для
 * примера» остались для похода без дат («Мечта»): экран должен быть виден
 * и до того, как человек решил, когда идёт.
 */
const props = defineProps<{ trip: Trip }>()

/** Вид ночёвки — словарь бэкенда (`NIGHT_KINDS`), здесь только для строк. */
type Kind = NightKind

/** Вариант ночи в черновике: все поля строками, чтобы жить с `v-model`. */
interface OptionDraft {
  kind: Kind | ''
  /** Палатка из снаряжения похода: пустая строка — не выбрали. */
  tentGearId: string
  /** Карточка своего ТС из «Трансфера». */
  carLegId: string
  cooking: CookingKind | ''
}

/** Ночь в черновике: то, что видит и правит человек до «Сохранить». */
interface NightDraft {
  position: number
  /** Дата `ГГГГ-ММ-ДД`; `null` — дат у похода нет. */
  date: string | null
  /** Район ночёвки словами. */
  place: string
  options: OptionDraft[]
}

/** Сколько ночей показывать, когда дат похода нет вовсе. */
const DEMO_NIGHTS = 3

const plan = ref<TripRoute | null>(null)

/** Снаряжение похода: варианту «Палатка» нужно выбрать вещь. */
const gear = ref<TripGearItem[]>([])
/** Своё ТС из «Трансфера»: варианту «Машина» нужна карточка. */
const cars = ref<TripTransferLeg[]>([])

const isLoading = ref(true)
const error = ref<string | null>(null)
const gearError = ref<string | null>(null)
const carsError = ref<string | null>(null)

const isSaving = ref(false)
const saveError = ref<string | null>(null)
const justSaved = ref(false)

const rows = ref<NightDraft[]>([])

/** Правит ли смотрящий таблицу — решает сервер, фронт не считает права сам. */
const canEdit = computed(() => plan.value?.canEdit === true)

// ───────────────────────────── ночи и даты ─────────────────────────────

/**
 * Число дня без времени суток: даты похода приходят строкой ISO, и разница
 * «конец минус начало» в днях — это и есть число ночей.
 */
function dayNumber(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/** Дата ночи строкой `ГГГГ-ММ-ДД` по местному дню, а не по UTC. */
function isoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * Ночи по датам похода — то, что показывается, пока таблица пуста.
 *
 * Ночь — это отрезок день→день: у похода 29–31 октября ночей две (29-е
 * и 30-е). Если дат нет или конец не задан, три ночи показываются
 * «для примера»: у «Мечты» дат ещё нет, а вкладку человек уже открыл.
 */
const planned = computed<{
  nights: { position: number; date: string }[]
  note: string | null
}>(() => {
  const start = props.trip.startsAt ? new Date(props.trip.startsAt) : null
  const end = props.trip.endsAt ? new Date(props.trip.endsAt) : null
  const total = start !== null && end !== null ? dayNumber(end) - dayNumber(start) : 0

  if (start !== null && total > 0) {
    return {
      nights: Array.from({ length: total }, (_, index) => ({
        position: index + 1,
        date: isoDay(addDays(start, index)),
      })),
      note: null,
    }
  }

  const base = start ?? new Date()
  const note =
    start === null
      ? 'Дат похода ещё нет — три ночи показаны для примера.'
      : 'Конец похода не задан — три ночи показаны для примера.'

  return {
    nights: Array.from({ length: DEMO_NIGHTS }, (_, index) => ({
      position: index + 1,
      date: isoDay(addDays(base, index)),
    })),
    note,
  }
})

/** Пустая строка варианта: пункт «не выбрали» и заготовка нового варианта. */
function emptyOption(): OptionDraft {
  return { kind: '', tentGearId: '', carLegId: '', cooking: '' }
}

/**
 * Варианты ночи в черновике. У записанной ночи без вариантов (это «идём всю
 * ночь») на экране всё равно одна пустая строка: иначе ночь выглядела бы
 * сломанной, и выбрать в ней было бы нечего.
 */
function optionDrafts(night: RouteNight): OptionDraft[] {
  if (night.options.length === 0) return [emptyOption()]

  return night.options.map((option) => ({
    kind: option.kind,
    tentGearId: option.tentGearId ?? '',
    carLegId: option.carLegId ?? '',
    cooking: option.cooking ?? '',
  }))
}

/**
 * Черновик из ответа сервера. Пустая таблица — не «нет ночей», а «ещё
 * не записаны»: показываем ночи по датам и подпись «для примера», если
 * дат нет. Одна и та же функция собирает и загруженный черновик, и точку
 * сравнения для «есть несохранённые изменения» — иначе кнопка «Сохранить»
 * горела бы сразу после загрузки.
 */
function draftsOf(value: TripRoute): { rows: NightDraft[]; note: string | null } {
  if (value.nights.length > 0) {
    return {
      rows: value.nights.map((night) => ({
        position: night.position,
        date: night.date,
        place: night.place ?? '',
        options: optionDrafts(night),
      })),
      note: null,
    }
  }

  return {
    rows: planned.value.nights.map((night) => ({
      position: night.position,
      date: night.date,
      place: '',
      options: [emptyOption()],
    })),
    note: planned.value.note,
  }
}

const savedRows = computed<NightDraft[]>(() =>
  plan.value === null ? [] : draftsOf(plan.value).rows,
)

/** Подпись «три ночи для примера» — только пока таблица пуста. */
const note = computed(() => (plan.value === null ? null : draftsOf(plan.value).note))

/** Разошёлся ли черновик с сохранённым: от этого зависит кнопка «Сохранить». */
const dirty = computed(() => JSON.stringify(rows.value) !== JSON.stringify(savedRows.value))

watch(dirty, (value) => {
  if (value) justSaved.value = false
})

/** Подпись даты на плашке: «29 октября»; дат нет — подписи нет. */
function dateLabel(row: NightDraft): string | null {
  if (row.date === null || row.date === '') return null

  return shortDate(new Date(`${row.date}T00:00:00`))
}

// ───────────────────────────── правильные списки ─────────────────────────────

/** Палатки похода: только тип `tent` и только «берём». */
const tentChoices = computed(() =>
  gear.value
    .filter((item) => item.typeCode === GEAR_TYPE_CODES.tent && item.status !== 'declined')
    .map((item) => ({ id: item.id, title: item.title })),
)

/** Машины — только своё ТС: автобус и поезд ночлегом не считаются. */
const carChoices = computed(() =>
  cars.value.map((leg) => ({ id: leg.id, title: `${leg.fromPlace} → ${leg.toPlace}` })),
)

// ───────────────────────────── правила плашки ─────────────────────────────

/**
 * Что вариант значит на самом деле. Пустой — «идём всю ночь»: человек ещё
 * не выбрал, а молчание в этом поле означает, что стоянки нет.
 */
function effectiveKind(kind: Kind | ''): Kind {
  return kind === '' ? 'allnight' : kind
}

function needsCooking(kind: Kind | ''): boolean {
  return COOKING_NIGHT_KINDS.includes(effectiveKind(kind))
}

/**
 * Место спрашивают все варианты, кроме дороги и ночного перехода
 * (заказчик 30.10.2026). Пустое поле считается как ночной переход, поэтому
 * место в нём тоже не спрашивается: пока варианта нет, района тоже нет.
 */
function needsPlace(row: NightDraft): boolean {
  return row.options.some(
    (option) => option.kind !== '' && PLACE_NIGHT_KINDS.includes(option.kind),
  )
}

function isSolo(kind: Kind | ''): boolean {
  return kind !== '' && SOLO_NIGHT_KINDS.includes(kind)
}

/** Что считается костром и что горелкой: «оба» — это и то и другое сразу. */
function isFireCooking(cooking: CookingKind | ''): boolean {
  return cooking === 'fire' || cooking === 'both'
}

function isStoveCooking(cooking: CookingKind | ''): boolean {
  return cooking === 'stove' || cooking === 'both'
}

/**
 * Сменили вариант строки — подчищаем то, что новый вариант не спрашивает.
 * Без сброса значения остались бы в памяти и вернулись при возврате
 * к палатке, хотя человек их не подтверждал.
 *
 * «Идём всю ночь» и «в пути» вытесняют остальные строки ночи: смешать их
 * с палаткой значит ответить на вопрос ночи дважды, и сервер такое отбивает.
 */
function onKindChange(row: NightDraft, option: OptionDraft): void {
  if (!needsCooking(option.kind)) option.cooking = ''
  if (option.kind !== 'tent') option.tentGearId = ''
  if (option.kind !== 'car') option.carLegId = ''

  if (isSolo(option.kind)) row.options = [option]
  if (!needsPlace(row)) row.place = ''
}

function addOption(row: NightDraft): void {
  row.options = [...row.options, emptyOption()]
}

/** Убрать строку варианта: последнюю не убираем — пустая строка и есть «нет». */
function removeOption(row: NightDraft, index: number): void {
  if (row.options.length <= 1) return

  row.options = row.options.filter((_, position) => position !== index)
  if (!needsPlace(row)) row.place = ''
}

// ───────────────────────────── загрузка ─────────────────────────────

/**
 * Счётчик запросов: человек может переключить поход, пока ответ ещё едет.
 * Без него поздний ответ первого похода перетёр бы уже показанный второй.
 */
let requestId = 0

async function load(): Promise<void> {
  const current = ++requestId
  isLoading.value = true
  error.value = null
  saveError.value = null
  justSaved.value = false

  try {
    const [route, list, transfer] = await Promise.all([
      fetchTripRoute(props.trip.id),
      /**
       * Снаряжение и «Трансфер» нужны только выпадающим спискам палатки
       * и машины. Их падение не должно закрывать таблицу: ночи читаются
       * и без них, а человек увидит объяснение, почему список пуст.
       */
      listTripGear(props.trip.id).catch(() => null),
      fetchTripTransfer(props.trip.id).catch(() => null),
    ])

    if (current !== requestId) return

    plan.value = route
    gear.value = list?.items ?? []
    cars.value = (transfer?.legs ?? []).filter((leg) => leg.isOwnVehicle)
    gearError.value = list === null ? 'Снаряжение похода не загрузилось' : null
    carsError.value =
      transfer === null ? '«Трансфер» не загрузился — машину выбрать не из чего' : null
    rows.value = draftsOf(route).rows
  } catch (problem) {
    if (current !== requestId) return

    error.value =
      problem instanceof ApiError ? problem.message : 'Не удалось загрузить ночёвки'
  } finally {
    if (current === requestId) isLoading.value = false
  }
}

watch(() => props.trip.id, load, { immediate: true })

/**
 * Даты похода поменялись, а таблица пуста — плашки рисуются заново
 * по датам. Записанные ночи не трогаем: у них свои даты.
 */
watch(planned, () => {
  if (plan.value !== null && plan.value.nights.length === 0) {
    rows.value = draftsOf(plan.value).rows
  }
})

// ───────────────────────────── сохранение ─────────────────────────────

/** Ночь из черновика в тело запроса: пустые строки не уходят. */
function payloadOf(row: NightDraft): RouteNightInput {
  const options = row.options
    .filter((option) => option.kind !== '')
    .map((option): RouteOptionInput => {
      const input: RouteOptionInput = { kind: option.kind as Kind }

      if (option.kind === 'tent') {
        input.tentGearId = option.tentGearId === '' ? null : option.tentGearId
      }
      if (option.kind === 'car') {
        input.carLegId = option.carLegId === '' ? null : option.carLegId
      }
      if (needsCooking(option.kind)) {
        input.cooking = option.cooking === '' ? null : option.cooking
      }

      return input
    })

  const place = row.place.trim()

  return {
    position: row.position,
    date: row.date,
    place: place === '' ? null : place,
    options,
  }
}

/**
 * Сохранить таблицу целиком. Ответ — вкладка вместе с `lodgers`, поэтому
 * «кто где живёт» на экране не приходится переживать отдельно.
 *
 * Ошибка сервера показывается текстом, а черновик остаётся: сервер отвечает
 * 400 с человеческим текстом («У „Палатки“ выберите палатку из снаряжения
 * похода»), и терять из-за этого набор ночей нельзя.
 */
async function save(): Promise<void> {
  if (!canEdit.value || isSaving.value || !dirty.value) return

  isSaving.value = true
  saveError.value = null

  try {
    const updated = await saveRouteNights(
      props.trip.id,
      rows.value.map((row) => payloadOf(row)),
    )

    plan.value = updated
    rows.value = draftsOf(updated).rows
    justSaved.value = true
  } catch (problem) {
    saveError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось сохранить ночёвки'
  } finally {
    isSaving.value = false
  }
}

/** Отменить несохранённое и вернуться к тому, что лежит на сервере. */
function revert(): void {
  if (plan.value === null) return

  rows.value = draftsOf(plan.value).rows
  saveError.value = null
}

/**
 * «Палатки» ответили вкладкой целиком — забираем её как есть.
 *
 * Ночи, которые человек правит в черновике, не трогаем: посадка в палатку
 * не должна стирать несохранённые изменения в таблице. Ответ сервера
 * обновляет только точку сравнения.
 */
function onRouteUpdated(updated: TripRoute): void {
  plan.value = updated
}

/** «Палатки» добавили или убрали вещь — список палаток для выбора обновляем. */
function onGearChanged(items: TripGearItem[]): void {
  gear.value = items
}

// ───────────────────── подсказки «Кострового» ─────────────────────

/**
 * Две следующие секции живут по тому, что выбрано в черновике: «Палатки» —
 * если хоть в одной ночи выбрана палатка, «Костровое» — если хоть где-то
 * выбран способ готовки. Пока ничего не выбрано, обеих секций нет: пустые
 * заготовки на экране только мешают.
 */
const hasTent = computed(() =>
  rows.value.some((row) => row.options.some((option) => option.kind === 'tent')),
)

const hasCooking = computed(() =>
  rows.value.some((row) => row.options.some((option) => option.cooking !== '')),
)

/** Есть костёр хоть в одной ночи — повод взять топор, пилу и розжиг. */
const hasFire = computed(() =>
  rows.value.some((row) => row.options.some((option) => isFireCooking(option.cooking))),
)

const hasStove = computed(() =>
  rows.value.some((row) => row.options.some((option) => isStoveCooking(option.cooking))),
)

/**
 * Готовки на горелках считаются только по «горелочным» ночам (уточнение
 * заказчика 29.10.2026): ужин и завтрак — по два на ночь. Раньше брались все
 * ночи похода, и поход, где газ нужен один раз из шести, показывал двенадцать
 * готовок.
 */
const stoveCookingCount = computed(
  () =>
    rows.value.reduce(
      (total, row) =>
        total + row.options.filter((option) => isStoveCooking(option.cooking)).length,
      0,
    ) * 2,
)

/**
 * «2 готовки», «4 готовки», «6 готовок» — склонение по числу. Число всегда
 * чётное (ужин и завтрак), но правило общее: если однажды готовкой станет
 * один приём, подсказка должна читаться «1 готовка».
 */
function cookingWord(count: number): string {
  const lastTwo = count % 100
  const last = count % 10

  if (last === 1 && lastTwo !== 11) return 'готовка'
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return 'готовки'

  return 'готовок'
}

const stoveHint = computed(() => {
  const count = stoveCookingCount.value
  const verb = count === 1 ? 'Запланирована' : 'Запланированы'

  return `${verb} ${count} ${cookingWord(count)} на горелках`
})
</script>

<template>
  <section class="flex flex-col gap-4" data-test="route-nights">
    <p v-if="isLoading" class="text-sm text-muted" data-test="route-nights-loading">
      Загружаем ночёвки…
    </p>

    <p v-else-if="error" class="text-sm text-muted" data-test="route-nights-load-error">
      {{ error }}
    </p>

    <template v-else>
      <p v-if="note" class="text-sm text-muted" data-test="route-nights-note">
        {{ note }}
      </p>

      <!--
        Секция ночёвок — чёрная: это главная плашка вкладки, и цвет отделяет
        её от секций ниже. Сворачивается, как «Раскладка» в «Питании»: длинный
        список ночей не должен закрывать чат табора под ним.
      -->
      <details
        open
        class="flex flex-col gap-3 rounded-2xl border border-neutral-700 bg-neutral-900 p-3"
        data-test="route-nights-section"
      >
        <summary class="cursor-pointer select-none text-sm text-neutral-100">Ночёвки</summary>

        <article
          v-for="row in rows"
          :key="row.position"
          class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3"
          data-test="route-night"
        >
          <!--
            Заголовок и место: «где спим» относится ко всей ночи и спрашивается
            раньше варианта. Самого поля нет у «В пути» и «Идём всю ночь»
            (30.10.2026): без стоянки района не бывает.

            На телефоне они в столбик (снимок 360, 31.10.2026): в одну строку
            полю оставалась треть карточки, а район ночёвки — до 120 знаков.
            С `md` снова в строке, как и было задумано.
          -->
          <div
            class="flex flex-col gap-2 md:flex-row md:items-center"
            data-test="route-night-head"
          >
            <h3 class="shrink-0 text-sm font-medium text-text" data-test="route-night-title">
              Ночь {{ row.position }}
              <span v-if="dateLabel(row)" class="text-muted"> · {{ dateLabel(row) }}</span>
            </h3>

            <label
              v-if="needsPlace(row)"
              class="flex min-w-0 items-center gap-2 text-sm text-muted md:flex-1 md:justify-end"
            >
              Место
              <input
                v-model="row.place"
                type="text"
                maxlength="120"
                :disabled="!canEdit"
                class="min-w-0 flex-1 rounded-xl border border-border bg-field px-2 py-1 text-base text-text transition-colors focus:border-primary focus:outline-none disabled:opacity-60 md:max-w-56 md:text-sm"
                data-test="route-night-place"
                aria-label="Место ночёвки"
              />
            </label>
          </div>

          <!--
            Варианты ночи: комбинированная ночь — несколько строк. Первая
            строка есть всегда, «Ещё вариант» добавляет следующую.
          -->
          <div
            v-for="(option, index) in row.options"
            :key="index"
            class="flex flex-col gap-3 md:flex-row md:items-end"
            data-test="route-night-option"
          >
            <label class="flex flex-col gap-1 text-sm text-muted md:w-56">
              Где ночуем
              <select
                v-model="option.kind"
                :disabled="!canEdit"
                class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none disabled:opacity-60 md:text-sm"
                data-test="route-night-kind"
                @change="onKindChange(row, option)"
              >
                <!--
                  Пустой пункт — пустой строкой: заказчик 29.10.2026: «давай
                  сделаем пустое поле не выбранной ночёвки — так лучше в глаза
                  бросается». Подпись «Не выбрано» убрана совсем.
                -->
                <option value=""></option>
                <option v-for="(label, kind) in NIGHT_KIND_LABELS" :key="kind" :value="kind">
                  {{ label }}
                </option>
              </select>
            </label>

            <!--
              «Палатка» — ссылка на вещь из снаряжения похода, а не текст:
              текст «палатка Васи» разошёлся бы с палаткой Васи в снаряжении.
            -->
            <label
              v-if="option.kind === 'tent'"
              class="flex flex-col gap-1 text-sm text-muted md:w-56"
            >
              Палатка
              <select
                v-model="option.tentGearId"
                :disabled="!canEdit"
                class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none disabled:opacity-60 md:text-sm"
                data-test="route-night-tent"
              >
                <option value="">выберите…</option>
                <option v-for="tent in tentChoices" :key="tent.id" :value="tent.id">
                  {{ tent.title }}
                </option>
              </select>
            </label>

            <!--
              «Машина» — карточка своего ТС из «Трансфера»: автобус и поезд
              ночлегом не считаются, поэтому список короткий.
            -->
            <label
              v-if="option.kind === 'car'"
              class="flex flex-col gap-1 text-sm text-muted md:w-56"
            >
              Машина
              <select
                v-model="option.carLegId"
                :disabled="!canEdit"
                class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none disabled:opacity-60 md:text-sm"
                data-test="route-night-car"
              >
                <option value="">выберите…</option>
                <option v-for="car in carChoices" :key="car.id" :value="car.id">
                  {{ car.title }}
                </option>
              </select>
            </label>

            <!-- «Идём всю ночь», «в пути» и «гостиница» готовку не спрашивают. -->
            <label
              v-if="needsCooking(option.kind)"
              class="flex flex-col gap-1 text-sm text-muted md:w-44"
              data-test="route-night-cooking-field"
            >
              Готовка
              <select
                v-model="option.cooking"
                :disabled="!canEdit"
                class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none disabled:opacity-60 md:text-sm"
                data-test="route-night-cooking"
              >
                <option value=""></option>
                <option v-for="(label, kind) in COOKING_KIND_LABELS" :key="kind" :value="kind">
                  {{ label }}
                </option>
              </select>
            </label>

            <!--
              Крестик строки варианта: убрать одну часть комбинированной ночи.
              У единственной строки его нет — там пустой вариант в списке.
            -->
            <button
              v-if="canEdit && row.options.length > 1"
              type="button"
              class="cursor-pointer self-start rounded-xl border border-border bg-field px-2 py-1 text-sm text-muted transition-colors hover:border-red-600 hover:text-red-700 md:self-end"
              title="Убрать вариант"
              data-test="route-night-option-remove"
              @click="removeOption(row, index)"
            >
              ×
            </button>
          </div>

          <!--
            Комбинированная ночь: часть группы в палатке, часть в гостинице.
            Кнопка есть только у тех, кто правит таблицу.
          -->
          <button
            v-if="canEdit"
            type="button"
            class="cursor-pointer self-start border-0 bg-transparent p-0 text-sm text-primary underline transition-opacity hover:opacity-80"
            data-test="route-night-add-option"
            @click="addOption(row)"
          >
            Ещё вариант
          </button>
        </article>

        <!--
          Сохранение таблицы целиком. Кнопка активна только когда черновик
          разошёлся с сохранённым: «Сохранить» впустую — ложное действие.
        -->
        <div class="flex flex-wrap items-center gap-2" data-test="route-nights-actions">
          <template v-if="canEdit">
            <button
              type="button"
              class="cursor-pointer rounded-xl border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              :class="
                dirty
                  ? 'border-primary bg-primary text-white hover:opacity-90'
                  : 'border-border bg-field text-text'
              "
              :disabled="!dirty || isSaving"
              data-test="route-nights-save"
              @click="save"
            >
              {{ isSaving ? 'Сохраняем…' : 'Сохранить' }}
            </button>

            <button
              v-if="dirty"
              type="button"
              class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="isSaving"
              data-test="route-nights-revert"
              @click="revert"
            >
              Отменить
            </button>

            <span v-if="dirty" class="text-xs text-muted" data-test="route-nights-dirty">
              Есть несохранённые изменения
            </span>
            <span v-else-if="justSaved" class="text-xs text-muted" data-test="route-nights-saved">
              Сохранено
            </span>
          </template>

          <span v-else class="text-xs text-muted" data-test="route-nights-readonly">
            Ночёвки правит тот, кто ведёт вкладку.
          </span>
        </div>

        <p v-if="saveError" class="text-sm text-red-600" data-test="route-nights-error">
          {{ saveError }}
        </p>

        <!--
          Снаряжение нужно выпадающему списку палатки, «Трансфер» — списку
          машины. Их падение таблицу не закрывает, но объяснить его надо:
          пустой список палаток иначе выглядел бы как «палаток нет».
        -->
        <p v-if="gearError" class="text-xs text-muted" data-test="route-nights-gear-error">
          {{ gearError }} — палатку выбрать не из чего.
        </p>
        <p v-if="carsError" class="text-xs text-muted" data-test="route-nights-cars-error">
          {{ carsError }}.
        </p>
      </details>

      <!--
        «Палатки» — распределение участников: плашки палаток из «Снаряжения»
        похода и своя палатка из личного каталога. Открывается выбором
        «Палатка» хоть в одной ночи; распределение действует на все ночёвки.
        «Кто где живёт» живёт на сервере (`lodgers`), поэтому секция
        показывает то, что пришло в ответе, а не помнит своё.
      -->
      <details
        v-if="hasTent"
        open
        class="flex flex-col gap-3 rounded-2xl border border-emerald-300 bg-emerald-100 p-3"
        data-test="route-tents-section"
      >
        <summary class="cursor-pointer select-none text-sm text-emerald-900">Палатки</summary>

        <TripRouteTents
          :trip="trip"
          :gear="gear"
          :gear-error="gearError"
          :lodgers="plan?.lodgers ?? []"
          :travelers="plan?.travelers ?? []"
          :can-edit="canEdit"
          @route="onRouteUpdated"
          @gear="onGearChanged"
        />
      </details>

      <details
        v-if="hasCooking"
        open
        class="flex flex-col gap-3 rounded-2xl border border-red-300 bg-red-100 p-3"
        data-test="route-cooking-section"
      >
        <summary class="cursor-pointer select-none text-sm text-red-900">Костровое</summary>

        <!--
          Подсказки по тому, что уже выбрано в ночёвках: костёр — повод взять
          топор и пилу, горелка — газ. Число готовок на горелках — по
          горелочным ночам × 2 (ужин и завтрак).
        -->
        <div class="flex flex-col gap-1" data-test="route-cooking-hints">
          <p v-if="hasFire" class="text-sm text-text" data-test="route-fire-hint">
            Запланирован костёр.
          </p>

          <p v-if="hasStove" class="text-sm text-text" data-test="route-stove-hint">
            {{ stoveHint }}
          </p>
        </div>

        <!--
          Черта отделяет подсказки от вещей (29.10.2026): «Запланирован
          костёр» и пилюля «Горелка - 130 гр. (Анна)» — разные слои.
        -->
        <hr class="border-red-300" data-test="route-cooking-divider" />

        <!--
          Кнопки «Добавить топор/пилу/розжиг/таган/горелку/баллон» и пилюли
          предложенного: участники предлагают своё снаряжение нужного типа.
          Кнопки видны по плану ночёвок, поэтому секция получает fire и stove.
        -->
        <TripRouteCooking :trip="trip" :fire="hasFire" :stove="hasStove" />
      </details>
    </template>
  </section>
</template>
