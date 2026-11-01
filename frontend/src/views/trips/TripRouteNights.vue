<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { listTripGear } from '@/api/gear'
import { ApiError } from '@/api/errors'
import { fetchTripRoute, saveRouteNights } from '@/api/trips'
import type { TripGearItem } from '@/types/gear'
import type {
  CookingKind,
  NightKind,
  RouteNightInput,
  Trip,
  TripRoute,
} from '@/types/trips'
import {
  COOKING_KIND_LABELS,
  COOKING_NIGHT_KINDS,
  NIGHT_KIND_LABELS,
  PLACE_NIGHT_KINDS,
  SLEEPING_NIGHT_KINDS,
} from '@/types/trips'
import { shortDate } from '@/utils/calendar'
import TripRouteCooking from '@/views/trips/TripRouteCooking.vue'
import TripRouteSleeping from '@/views/trips/TripRouteSleeping.vue'
import TripRouteTents from '@/views/trips/TripRouteTents.vue'

/**
 * Таблица ночёвок — **один вариант на ночь и сохранение на лету**
 * (01.11.2026).
 *
 * Заказчик прошёл по живому экрану и отменил три вещи прежнего шага:
 *
 * 1. **Комбинированные ночи.** «Сколько не объяснял, ты всё равно по своему
 *    сделал… Меняем! На одну ночь один вариант ночёвки». Строк-вариантов
 *    больше нет: у ночи один `select` «Где ночуем», а «Ещё вариант»
 *    и крестики строк удалены.
 * 2. **Выбор палатки в ночи.** «В секции Ночёвки уходит выбор палатки,
 *    распределение по палаткам действует на весь поход». Палатка живёт
 *    в секции «Палатки» и одна на поход; ночь её больше не спрашивает.
 *    Машины с «Трансфером» тоже не связаны — решение заказчика.
 * 3. **Кнопки «Сохранить» и «Отменить».** «Не нужно, применяй на лету».
 *    Каждое изменение уходит тем же `PUT /route/nights`, черновика
 *    и подписи «Есть несохранённые изменения» нет. Текст «Место»
 *    сохраняется с задержкой, чтобы не отправлять запрос на каждую букву;
 *    выпадающие списки — сразу.
 *
 * **Почему сохранение целиком не мешает «на лету».** Ручка принимает все
 * ночи по номерам, поэтому экран собирает таблицу из `rows` при каждом
 * изменении. Промежуточных недопустимых состояний больше нет: палатку
 * выбирать не нужно, машина ссылкой не является, а место и готовка просто
 * прячутся у вариантов, которым они не положены.
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
 * **Права — из ответа сервера** (`canEdit`): правят таблицу те, у кого право
 * вкладки `route`. Остальные видят её, но поля заблокированы. Личные
 * спальники при этом правит каждый сам — это не таблица вкладки.
 *
 * Ночи, которые ещё не записаны, показываются по датам похода — как раньше:
 * иначе у похода с датами вкладка выглядела бы пустой. Три ночи «для
 * примера» остались для похода без дат («Мечта»): экран должен быть виден
 * и до того, как человек решил, когда идёт.
 */
const props = defineProps<{ trip: Trip }>()

/** Вид ночёвки — словарь бэкенда (`NIGHT_KINDS`), здесь только для строк. */
type Kind = NightKind

/** Ночь в памяти экрана: все поля строками, чтобы жить с `v-model`. */
interface NightDraft {
  position: number
  /** Дата `ГГГГ-ММ-ДД`; `null` — дат у похода нет. */
  date: string | null
  /** Район ночёвки словами. */
  place: string
  /** Один вариант ночи; пустая строка — не выбрали. */
  kind: Kind | ''
  cooking: CookingKind | ''
}

/** Сколько ночей показывать, когда дат похода нет вовсе. */
const DEMO_NIGHTS = 3

/**
 * Задержка сохранения текста. Выпадающие списки уходят сразу: человек
 * закончил выбор, ждать нечего. Текст — через полсекунды, иначе «Ольхон»
 * отправило бы шесть запросов подряд.
 */
const TEXT_SAVE_DELAY_MS = 500

const plan = ref<TripRoute | null>(null)

/** Снаряжение похода: секция «Палатки» берёт из него плашки палаток. */
const gear = ref<TripGearItem[]>([])
const isLoading = ref(true)
const error = ref<string | null>(null)
const gearError = ref<string | null>(null)

const isSaving = ref(false)
const saveError = ref<string | null>(null)

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

/**
 * Черновик из ответа сервера. Пустая таблица — не «нет ночей», а «ещё
 * не записаны»: показываем ночи по датам и подпись «для примера», если
 * дат нет.
 */
function draftsOf(value: TripRoute): { rows: NightDraft[]; note: string | null } {
  if (value.nights.length > 0) {
    return {
      rows: value.nights.map((night) => ({
        position: night.position,
        date: night.date,
        place: night.place ?? '',
        kind: night.kind ?? '',
        cooking: night.cooking ?? '',
      })),
      note: null,
    }
  }

  return {
    rows: planned.value.nights.map((night) => ({
      position: night.position,
      date: night.date,
      place: '',
      kind: '',
      cooking: '',
    })),
    note: planned.value.note,
  }
}

/** Подпись «три ночи для примера» — только пока таблица пуста. */
const note = computed(() => (plan.value === null ? null : draftsOf(plan.value).note))

/** Подпись даты на плашке: «29 октября»; дат нет — подписи нет. */
function dateLabel(row: NightDraft): string | null {
  if (row.date === null || row.date === '') return null

  return shortDate(new Date(`${row.date}T00:00:00`))
}

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
function needsPlace(kind: Kind | ''): boolean {
  return kind !== '' && PLACE_NIGHT_KINDS.includes(kind)
}

/** Что считается костром и что горелкой: «оба» — это и то и другое сразу. */
function isFireCooking(cooking: CookingKind | ''): boolean {
  return cooking === 'fire' || cooking === 'both'
}

function isStoveCooking(cooking: CookingKind | ''): boolean {
  return cooking === 'stove' || cooking === 'both'
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

  try {
    const [route, list] = await Promise.all([
      fetchTripRoute(props.trip.id),
      /**
       * Снаряжение похода нужно секции «Палатки» (её плашки — вещи похода).
       * Его падение таблицу не закрывает: ночи читаются и без него,
       * а человек увидит объяснение, почему список пуст.
       */
      listTripGear(props.trip.id).catch(() => null),
    ])

    if (current !== requestId) return

    plan.value = route
    gear.value = list?.items ?? []
    gearError.value = list === null ? 'Снаряжение похода не загрузилось' : null
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

// ───────────────────────────── сохранение на лету ─────────────────────────────

/** Таймер задержки текста: одно поле — один запрос после паузы. */
let saveTimer: ReturnType<typeof setTimeout> | null = null

/** Идёт ли запрос и не попросили ли сохранить ещё раз во время него. */
let isFlushing = false
let isPending = false

/** Ночь из памяти в тело запроса: пустые строки не уходят. */
function payloadOf(row: NightDraft): RouteNightInput {
  const place = row.place.trim()

  return {
    position: row.position,
    date: row.date,
    place: place === '' ? null : place,
    kind: row.kind === '' ? null : row.kind,
    cooking: needsCooking(row.kind) && row.cooking !== '' ? row.cooking : null,
  }
}

/**
 * Попросить сохранить. Задержка только у текста; у списков — сразу.
 *
 * Повторный вызов во время запроса не теряется: `isPending` заставляет
 * `flush` отправить ещё один запрос после текущего. Иначе правка, сделанная
 * пока летел предыдущий `PUT`, осталась бы только на экране.
 */
function queueSave(delayMs = 0): void {
  if (!canEdit.value) return

  if (saveTimer !== null) clearTimeout(saveTimer)

  saveTimer = setTimeout(() => {
    saveTimer = null
    void flush()
  }, delayMs)
}

async function flush(): Promise<void> {
  if (!canEdit.value) return

  if (isFlushing) {
    isPending = true
    return
  }

  isFlushing = true
  isSaving.value = true

  try {
    do {
      isPending = false

      const updated = await saveRouteNights(
        props.trip.id,
        rows.value.map((row) => payloadOf(row)),
      )

      /**
       * Ответ сервера обновляет вкладку, но **не** перетирает `rows`:
       * человек может продолжать печатать, пока летел запрос. Места
       * жительства и личные вещи тоже не трогаем: пока летел `PUT` ночей,
       * «Палатки» или «Спальник» могли ответить свежее, и старый ответ
       * ночей не должен откатить их на экране.
       */
      plan.value = {
        ...updated,
        sleeping: plan.value?.sleeping ?? updated.sleeping,
        lodgers: plan.value?.lodgers ?? updated.lodgers,
        travelers: plan.value?.travelers ?? updated.travelers,
      }
      saveError.value = null
    } while (isPending)
  } catch (problem) {
    saveError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось сохранить ночёвки'
  } finally {
    isFlushing = false
    isSaving.value = false
  }
}

/**
 * Сменили вариант строки — подчищаем то, что новый вариант не спрашивает.
 * Без сброса значения остались бы в памяти и вернулись при возврате
 * к палатке, хотя человек их не подтверждал. Сервер такое отбивает 400-м,
 * а с сохранением на лету это был бы поток ошибок.
 */
function onKindChange(row: NightDraft): void {
  if (!needsCooking(row.kind)) row.cooking = ''
  if (!needsPlace(row.kind)) row.place = ''

  queueSave()
}

/** Сменили готовку — уходит сразу: выбор закончен. */
function onCookingChange(): void {
  queueSave()
}

/** Текст «Место» — после паузы: запрос на каждую букву не нужен. */
function onPlaceInput(): void {
  queueSave(TEXT_SAVE_DELAY_MS)
}

onBeforeUnmount(() => {
  if (saveTimer !== null) clearTimeout(saveTimer)
})

/**
 * «Палатки» или «Спальник» ответили вкладкой целиком — забираем её.
 *
 * Ночи не трогаем: `rows` — источник правды экрана, а сохранение ночей
 * может ещё лететь. Ответ дочерней секции обновляет места жительства
 * и личные вещи, но не откатывает правку ночей.
 */
function onRouteUpdated(updated: TripRoute): void {
  plan.value = {
    ...updated,
    nights: plan.value?.nights ?? updated.nights,
  }
}

/** «Палатки» добавили или убрали вещь — список плашек обновляем. */
function onGearChanged(items: TripGearItem[]): void {
  gear.value = items
}

// ───────────────────── подсказки «Кострового» ─────────────────────

/**
 * Секции ниже живут по тому, что выбрано в таблице: «Палатки» — если хоть
 * в одной ночи палатка, «Костровое» — если хоть где-то способ готовки,
 * «Спальник» — если хоть одна ночь без гостиницы и дороги.
 */
const hasTent = computed(() => rows.value.some((row) => row.kind === 'tent'))

const hasCooking = computed(() => rows.value.some((row) => row.cooking !== ''))

/** Есть костёр хоть в одной ночи — повод взять топор, пилу и розжиг. */
const hasFire = computed(() => rows.value.some((row) => isFireCooking(row.cooking)))

const hasStove = computed(() => rows.value.some((row) => isStoveCooking(row.cooking)))

/**
 * Спальник и коврик нужны при палатке, избе и машине. Заказчик 01.11.2026:
 * секция видна «при всех вариантах ночёвки кроме „Гостиница“, „Идём всю
 * ночь“ и „В пути“».
 */
const sleepingVisible = computed(() =>
  rows.value.some(
    (row) => row.kind !== '' && SLEEPING_NIGHT_KINDS.includes(row.kind),
  ),
)

/**
 * Готовки на горелках считаются только по «горелочным» ночам (уточнение
 * заказчика 29.10.2026): ужин и завтрак — по два на ночь. Раньше брались все
 * ночи похода, и поход, где газ нужен один раз из шести, показывал двенадцать
 * готовок.
 */
const stoveCookingCount = computed(
  () => rows.value.filter((row) => isStoveCooking(row.cooking)).length * 2,
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
              v-if="needsPlace(row.kind)"
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
                @input="onPlaceInput"
              />
            </label>
          </div>

          <!--
            Один вариант ночи (01.11.2026). Раньше здесь был список строк
            с кнопкой «Ещё вариант»: заказчик отменил комбинированные ночи.
          -->
          <div class="flex flex-col gap-3 md:flex-row md:items-end" data-test="route-night-option">
            <label class="flex flex-col gap-1 text-sm text-muted md:w-56">
              Где ночуем
              <select
                v-model="row.kind"
                :disabled="!canEdit"
                class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none disabled:opacity-60 md:text-sm"
                data-test="route-night-kind"
                @change="onKindChange(row)"
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

            <!-- «Идём всю ночь», «в пути» и «гостиница» готовку не спрашивают. -->
            <label
              v-if="needsCooking(row.kind)"
              class="flex flex-col gap-1 text-sm text-muted md:w-44"
              data-test="route-night-cooking-field"
            >
              Готовка
              <select
                v-model="row.cooking"
                :disabled="!canEdit"
                class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none disabled:opacity-60 md:text-sm"
                data-test="route-night-cooking"
                @change="onCookingChange"
              >
                <option value=""></option>
                <option v-for="(label, kind) in COOKING_KIND_LABELS" :key="kind" :value="kind">
                  {{ label }}
                </option>
              </select>
            </label>
          </div>
        </article>

        <!--
          Сохранение на лету: кнопок и подписи «есть несохранённые изменения»
          больше нет (01.11.2026). Внизу — только «Сохраняем…», чтобы человек
          видел, что правка ушла, и текст ошибки, если сервер её не принял.
        -->
        <div class="flex flex-wrap items-center gap-2" data-test="route-nights-actions">
          <span v-if="isSaving" class="text-xs text-muted" data-test="route-nights-saving">
            Сохраняем…
          </span>

          <span v-else-if="!canEdit" class="text-xs text-muted" data-test="route-nights-readonly">
            Ночёвки правит тот, кто ведёт вкладку.
          </span>
        </div>

        <p v-if="saveError" class="text-sm text-red-600" data-test="route-nights-error">
          {{ saveError }}
        </p>

        <p v-if="gearError" class="text-xs text-muted" data-test="route-nights-gear-error">
          {{ gearError }} — плашки палаток могут быть неполными.
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

      <!--
        «Спальник» — личная секция (01.11.2026): синяя, как «Палатки» зелёные,
        а «Костровое» красное. Видна при палатке, избе и машине: в гостинице
        постель своя, а в дороге спать негде. У каждого участника своё
        содержимое, виртуальных здесь нет.
      -->
      <details
        v-if="sleepingVisible"
        open
        class="flex flex-col gap-3 rounded-2xl border border-blue-300 bg-blue-100 p-3"
        data-test="route-sleeping-section"
      >
        <summary class="cursor-pointer select-none text-sm text-blue-900">Спальник</summary>

        <TripRouteSleeping
          :trip="trip"
          :sleeping="plan?.sleeping ?? []"
          @route="onRouteUpdated"
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
