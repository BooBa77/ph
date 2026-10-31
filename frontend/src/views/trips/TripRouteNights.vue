<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type { Trip } from '@/types/trips'
import { shortDate } from '@/utils/calendar'
import TripRouteCooking from '@/views/trips/TripRouteCooking.vue'
import TripRouteTents from '@/views/trips/TripRouteTents.vue'

/**
 * Плашки ночёвок — **макет без данных** (29.10.2026).
 *
 * Заказчик попросил идти от фронта: «идёт от фронта, расставляем элементы,
 * оцениваем, приходит понимание и затем уже формируем данные». Поэтому у самой
 * ночёвки — вариант, способ готовки и место — **ни одной ручки**: выбор живёт
 * в памяти компонента и никуда не уходит. Запросы делает только секция
 * «Палатки», и то существующими ручками (состав похода, снаряжение похода):
 * таблицы ночёвок ещё нет, это следующий шаг.
 *
 * Что на плашке (слова заказчика):
 * - «Ночь 1 · 29 октября» — заголовок как «День 1 · 23 октября» в «Питании»
 *   (мелкий, дата серым после точки-разделителя): единообразие важнее
 *   собственной типографики; справа в той же строке — поле «Место» (район
 *   ночёвки, текст). Место спрашивают все варианты, кроме «В пути» и
 *   «Идём всю ночь» (30.10.2026): без стоянки района не бывает;
 * - выпадающий список варианта ночёвки: палатка / гостиница / изба / машина /
 *   идём всю ночь / в пути; пустой пункт — **пустой строкой**, без подписи
 *   «Не выбрано»: так незаполненная ночь бросается в глаза (29.10.2026);
 * - «идём всю ночь» и «в пути» — больше ничего не делается, и «гостиница»
 *   тоже: палатка, изба и машина спрашивают способ готовки — костёр,
 *   горелка или костёр+горелка.
 *
 * **Пустое считается как «идём всю ночь»** (29.10.2026: «Пустое пусть
 * выглядит пустым, а считаться будет как „идём всю ночь“»). Пустое — это
 * «ещё не выбрали», а не отдельный вариант: ночуют в ночном переходе, пока
 * не сказали иначе. Ведёт себя пустое так же, как ночной переход: готовку
 * не спрашивает и дополнительные секции не открывает (см. `effectiveKind`).
 *
 * Район ночёвки — поле «Место» в строке заголовка (29.10.2026). Людей
 * на плашке по-прежнему нет: распределение живёт в секции «Палатки».
 *
 * Откуда ночи берутся без бэка: из дат похода. Ночь — это отрезок день→день,
 * поэтому у похода 29–31 октября ночей две (29-го и 30-го). Если дат нет или
 * конец не задан, показываем три ночи от начала (или от сегодня) с подписью
 * «для примера»: макет должен быть виден и на «Мечте», у которой дат ещё нет.
 */
const props = defineProps<{ trip: Trip }>()

/** Вид ночёвки — словарь будущего CHECK-а: гостиница и изба разные. */
type NightKind = 'tent' | 'hotel' | 'hut' | 'car' | 'allnight' | 'transit'

type CookingKind = 'fire' | 'stove' | 'both'

/**
 * Порядок ровно тот, в котором заказчик перечислил варианты, «в пути» —
 * в конце (дописано 29.10.2026). Подписи — его слова: «изба», а не
 * «зимовьё» из карты вкладок (это был открытый вопрос `NEXT.md` §3).
 */
const NIGHT_KIND_LABELS: Record<NightKind, string> = {
  tent: 'Палатка',
  hotel: 'Гостиница',
  hut: 'Изба',
  car: 'Машина',
  allnight: 'Идём всю ночь',
  transit: 'В пути',
}

const COOKING_LABELS: Record<CookingKind, string> = {
  fire: 'Костёр',
  stove: 'Горелка',
  both: 'Костёр+Горелка',
}

/**
 * Что считается костром и что горелкой. «Костёр+Горелка» — это и то и другое
 * сразу: в такую ночь нужны и топор с пилой, и газ (подсказки «Кострового»).
 */
function isFireCooking(cooking: CookingKind | ''): boolean {
  return cooking === 'fire' || cooking === 'both'
}

function isStoveCooking(cooking: CookingKind | ''): boolean {
  return cooking === 'stove' || cooking === 'both'
}

/**
 * Готовку спрашиваем у всех, кроме гостиницы, ночного перехода и дороги:
 * в гостинице готовит кухня, в ночь идут без стоянки, в пути — тем более.
 * Правило записано списком «кому нужно», а не «кому нет»: если завтра
 * появится баня или кафе, их придётся добавить сюда осознанно.
 */
const COOKING_KINDS: readonly NightKind[] = ['tent', 'hut', 'car']

/**
 * Что вариант значит на самом деле. Пустой — «идём всю ночь»: человек ещё
 * не выбрал, а молчание в этом поле означает, что стоянки нет.
 */
function effectiveKind(kind: NightKind | ''): NightKind {
  return kind === '' ? 'allnight' : kind
}

function needsCooking(kind: NightKind | ''): boolean {
  return COOKING_KINDS.includes(effectiveKind(kind))
}

/**
 * Место спрашивают все варианты, кроме дороги и ночного перехода (заказчик
 * 30.10.2026: «Место ночёвки у всех вариантов, кроме „В пути“ и „Идём всю
 * ночь“»). Пустое поле считается как ночной переход, поэтому место в нём
 * тоже не спрашивается: пока варианта нет, района тоже нет.
 */
function needsPlace(kind: NightKind | ''): boolean {
  const actual = effectiveKind(kind)

  return actual !== 'allnight' && actual !== 'transit'
}

/** Сколько ночей показывать, когда дат похода нет вовсе. */
const DEMO_NIGHTS = 3

interface NightPlan {
  /** Номер ночи по порядку: 1, 2, 3… */
  number: number
  date: Date
  /** Подпись даты: «29 октября». */
  label: string
}

interface NightRow extends NightPlan {
  kind: NightKind | ''
  cooking: CookingKind | ''
  /** Район ночёвки словами: «Слюдянка», «у Голоустного». */
  place: string
}

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

function planNights(trip: Pick<Trip, 'startsAt' | 'endsAt'>): {
  nights: NightPlan[]
  note: string | null
} {
  const start = trip.startsAt ? new Date(trip.startsAt) : null
  const end = trip.endsAt ? new Date(trip.endsAt) : null
  const total = start !== null && end !== null ? dayNumber(end) - dayNumber(start) : 0

  if (start !== null && total > 0) {
    return {
      nights: Array.from({ length: total }, (_, index) => {
        const date = addDays(start, index)
        return { number: index + 1, date, label: shortDate(date) }
      }),
      note: null,
    }
  }

  /**
   * Дат нет — рисуем пример. Для «Мечты» это нормальное состояние: человек
   * ещё не решил, когда идёт, а вкладку уже открыл.
   */
  const base = start ?? new Date()
  const note =
    start === null
      ? 'Дат похода ещё нет — три ночи показаны для примера.'
      : 'Конец похода не задан — три ночи показаны для примера.'

  return {
    nights: Array.from({ length: DEMO_NIGHTS }, (_, index) => {
      const date = addDays(base, index)
      return { number: index + 1, date, label: shortDate(date) }
    }),
    note,
  }
}

const plan = computed(() => planNights(props.trip))

/**
 * Выбор — это черновик экрана, а не модель. `rows` пересобираются, когда
 * меняются даты похода: ночей станет больше или меньше, и старый выбор
 * к ним уже не относится.
 */
const rows = ref<NightRow[]>([])

watch(
  plan,
  (value) => {
    rows.value = value.nights.map((night) => ({ ...night, kind: '', cooking: '', place: '' }))
  },
  { immediate: true },
)

/**
 * Две следующие секции живут по тому, что выбрано в ночёвках: «Палатки» —
 * если хоть в одной ночи выбрана палатка, «Костровое» — если хоть где-то
 * выбран способ готовки. Пока ничего не выбрано, обеих секций нет: пустые
 * заготовки на экране только мешают.
 */
const hasTent = computed(() => rows.value.some((row) => row.kind === 'tent'))

const hasCooking = computed(() => rows.value.some((row) => row.cooking !== ''))

/**
 * Подсказки «Кострового» (29.10.2026, слова заказчика):
 * - есть костёр хоть в одной ночи — «Запланирован костёр. Топор, пила, розжиг»;
 * - есть горелка — «Запланированы N готовок на горелках», где N — число
 *   ночей **с готовкой на горелке** × 2: ужин и завтрак на каждую такую ночь.
 */
const hasFire = computed(() => rows.value.some((row) => isFireCooking(row.cooking)))

const hasStove = computed(() => rows.value.some((row) => isStoveCooking(row.cooking)))

/**
 * Готовки на горелках считаются только по «горелочным» ночам (29.10.2026,
 * уточнение заказчика). Раньше брались все ночи похода — и поход, где газ
 * нужен один раз из шести, показывал двенадцать готовок. «Костёр+Горелка»
 * считается горелочной ночью: газ в ней тоже достают.
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

/**
 * Выбрали вариант, который больше не спрашивает готовку или место, — чистим
 * введённое. Без сброса значения остались бы в памяти и вернулись при
 * возврате к палатке, хотя человек их не подтверждал: способ готовки вернулся
 * бы к палатке, а район — к ночи, которой он не подходит.
 */
function onKindChange(row: NightRow) {
  if (!needsCooking(row.kind)) row.cooking = ''
  if (!needsPlace(row.kind)) row.place = ''
}
</script>

<template>
  <section class="flex flex-col gap-4" data-test="route-nights">
    <p v-if="plan.note" class="text-sm text-muted" data-test="route-nights-note">
      {{ plan.note }}
    </p>

    <!--
      Секция ночёвок — чёрная: это главная плашка вкладки, и цвет отделяет
      её от будущих секций. Сворачивается, как «Раскладка» в «Питании»
      и все секции «Трансфера»: длинный список ночей не должен закрывать
      чат табора под ним.
    -->
    <details
      open
      class="flex flex-col gap-3 rounded-2xl border border-neutral-700 bg-neutral-900 p-3"
      data-test="route-nights-section"
    >
      <summary class="cursor-pointer select-none text-sm text-neutral-100">Ночёвки</summary>

      <article
        v-for="row in rows"
        :key="row.number"
        class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3"
        data-test="route-night"
      >
        <!--
          Заголовок и место — одной строкой: «где спим» относится ко всей
          ночи и спрашивается раньше варианта. Поле узкое и тянется на
          телефоне, поэтому подпись стоит перед ним, а не над ним: вторая
          строка оторвала бы место от «Ночь 1 · 24 октября».
          Самого поля нет у «В пути» и «Идём всю ночь» (30.10.2026): без
          стоянки района не бывает, и пустое поле там только мешает.
        -->
        <div class="flex items-center gap-2" data-test="route-night-head">
          <h3 class="shrink-0 text-sm font-medium text-text" data-test="route-night-title">
            Ночь {{ row.number }}
            <span class="text-muted"> · {{ row.label }}</span>
          </h3>

          <label
            v-if="needsPlace(row.kind)"
            class="flex min-w-0 flex-1 items-center justify-end gap-2 text-sm text-muted"
          >
            Место
            <input
              v-model="row.place"
              type="text"
              maxlength="120"
              class="min-w-0 flex-1 rounded-xl border border-border bg-field px-2 py-1 text-base text-text transition-colors focus:border-primary focus:outline-none md:max-w-56 md:text-sm"
              data-test="route-night-place"
              aria-label="Место ночёвки"
            />
          </label>
        </div>

        <div class="flex flex-col gap-3 md:flex-row">
          <label class="flex flex-col gap-1 text-sm text-muted md:w-56">
            Где ночуем
            <select
              v-model="row.kind"
              class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none md:text-sm"
              data-test="route-night-kind"
              @change="onKindChange(row)"
            >
              <option value=""></option>
              <option
                v-for="(label, kind) in NIGHT_KIND_LABELS"
                :key="kind"
                :value="kind"
              >
                {{ label }}
              </option>
            </select>
          </label>

          <!-- «Идём всю ночь», «в пути» и «Гостиница» дальше ничего не спрашивают. -->
          <label
            v-if="needsCooking(row.kind)"
            class="flex flex-col gap-1 text-sm text-muted md:w-44"
            data-test="route-night-cooking-field"
          >
            Готовка
            <select
              v-model="row.cooking"
              class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none md:text-sm"
              data-test="route-night-cooking"
            >
              <!--
                Пустой пункт — пустой строкой: заказчик 29.10.2026: «давай
                сделаем пустое поле не выбранной ночёвки — так лучше в глаза
                бросается». Подпись «Не выбрано» убрана совсем.
              -->
              <option value=""></option>
              <option v-for="(label, kind) in COOKING_LABELS" :key="kind" :value="kind">
                {{ label }}
              </option>
            </select>
          </label>
        </div>
      </article>
    </details>

    <!--
      «Палатки» — распределение участников: плашки палаток из «Снаряжения»
      похода и своя палатка из личного каталога. Открывается выбором
      «Палатка» хоть в одной ночи; распределение действует на все ночёвки.
    -->
    <details
      v-if="hasTent"
      open
      class="flex flex-col gap-3 rounded-2xl border border-emerald-300 bg-emerald-100 p-3"
      data-test="route-tents-section"
    >
      <summary class="cursor-pointer select-none text-sm text-emerald-900">Палатки</summary>

      <TripRouteTents :trip="trip" />
    </details>

    <details
      v-if="hasCooking"
      open
      class="flex flex-col gap-3 rounded-2xl border border-red-300 bg-red-100 p-3"
      data-test="route-cooking-section"
    >
      <summary class="cursor-pointer select-none text-sm text-red-900">Костровое</summary>

      <!--
        Слова «Костровое снаряжение» здесь больше нет (29.10.2026): секция
        не видна пустой, а что она про костровое — видно из названия.
      -->

      <!--
        Подсказки по тому, что уже выбрано в ночёвках: костёр — повод взять
        топор и пилу, горелка — газ. Заказчик 29.10.2026 продиктовал их
        словами; число готовок на горелках — по горелочным ночам × 2.
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
        Черта отделяет подсказки от вещей (29.10.2026): «Запланирован костёр»
        и пилюля «Горелка - 130 гр. (Анна)» — разные слои, и без разделителя
        они слипались в один текст.
      -->
      <hr class="border-red-300" data-test="route-cooking-divider" />

      <!--
        Кнопки «Добавить топор/пилу/розжиг/таган/горелку/баллон» и пилюли
        предложенного: участники предлагают своё снаряжение нужного типа.
        Кнопки видны по плану ночёвок, поэтому секция получает fire и stove.
      -->
      <TripRouteCooking :trip="trip" :fire="hasFire" :stove="hasStove" />
    </details>
  </section>
</template>
