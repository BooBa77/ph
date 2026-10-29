<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type { Trip } from '@/types/trips'
import { shortDate } from '@/utils/calendar'

/**
 * Плашки ночёвок — **макет без данных** (29.10.2026).
 *
 * Заказчик попросил идти от фронта: «идёт от фронта, расставляем элементы,
 * оцениваем, приходит понимание и затем уже формируем данные». Поэтому здесь
 * нет ни одной ручки и ни одного запроса: варианты живут в памяти компонента
 * и никуда не сохраняются. Таблицы и API — следующий шаг, после того как
 * раскладка понравится.
 *
 * Что на плашке (слова заказчика):
 * - «Ночь 1 · 29 октября» — заголовок как «День 1 · 23 октября» в «Питании»
 *   (мелкий, дата серым после точки-разделителя): единообразие важнее
 *   собственной типографики;
 * - выпадающий список варианта ночёвки: палатка / гостиница / изба / машина /
 *   идём всю ночь / в пути;
 * - «идём всю ночь» и «в пути» — больше ничего не делается, и «гостиница»
 *   тоже: палатка, изба и машина спрашивают способ готовки (костёр/горелка).
 *
 * **Пустое считается как «идём всю ночь»** (29.10.2026: «Пустое пусть
 * выглядит пустым, а считаться будет как „идём всю ночь“»). Пустое — это
 * «ещё не выбрали», а не отдельный вариант: ночуют в ночном переходе, пока
 * не сказали иначе. Ведёт себя пустое так же, как ночной переход: готовку
 * не спрашивает и дополнительные секции не открывает (см. `effectiveKind`).
 *
 * Района ночёвки и распределения людей здесь намеренно нет: это следующий
 * слой, и он появится, когда станет ясно, как читается сама плашка.
 *
 * Откуда ночи берутся без бэка: из дат похода. Ночь — это отрезок день→день,
 * поэтому у похода 29–31 октября ночей две (29-го и 30-го). Если дат нет или
 * конец не задан, показываем три ночи от начала (или от сегодня) с подписью
 * «для примера»: макет должен быть виден и на «Мечте», у которой дат ещё нет.
 */
const props = defineProps<{ trip: Trip }>()

/** Вид ночёвки — словарь будущего CHECK-а: гостиница и изба разные. */
type NightKind = 'tent' | 'hotel' | 'hut' | 'car' | 'allnight' | 'transit'

type CookingKind = 'fire' | 'stove'

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
    rows.value = value.nights.map((night) => ({ ...night, kind: '', cooking: '' }))
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
 * Выбрали гостиницу, ночной переход или дорогу — способ готовки больше не
 * нужен. Без сброса значение осталось бы в памяти и вернулось при возврате
 * к «палатке», хотя человек его не подтверждал.
 */
function onKindChange(row: NightRow) {
  if (!needsCooking(row.kind)) row.cooking = ''
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
        <h3 class="text-sm font-medium text-text" data-test="route-night-title">
          Ночь {{ row.number }}
          <span class="text-muted"> · {{ row.label }}</span>
        </h3>

        <div class="flex flex-col gap-3 md:flex-row">
          <label class="flex flex-col gap-1 text-sm text-muted md:w-56">
            Где ночуем
            <select
              v-model="row.kind"
              class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none md:text-sm"
              data-test="route-night-kind"
              @change="onKindChange(row)"
            >
              <option value="">Не выбрано</option>
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
              <option value="">Не выбрано</option>
              <option v-for="(label, kind) in COOKING_LABELS" :key="kind" :value="kind">
                {{ label }}
              </option>
            </select>
          </label>
        </div>
      </article>
    </details>

    <!--
      «Палатки» и «Костровое» — заготовки следующих шагов: палатки приедут
      из «Снаряжения», дежурства — из «Питания». Пока это только место
      на экране, и открываются они по выбору в ночёвках.
    -->
    <details
      v-if="hasTent"
      open
      class="flex flex-col gap-3 rounded-2xl border border-emerald-300 bg-emerald-100 p-3"
      data-test="route-tents-section"
    >
      <summary class="cursor-pointer select-none text-sm text-emerald-900">Палатки</summary>

      <p class="text-sm text-muted" data-test="route-tents-empty">
        Кто в какой палатке спит и кто её несёт — палатки приедут сюда
        из «Снаряжения», когда в ночёвке выбрана «Палатка».
      </p>
    </details>

    <details
      v-if="hasCooking"
      open
      class="flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-100 p-3"
      data-test="route-cooking-section"
    >
      <summary class="cursor-pointer select-none text-sm text-amber-900">Костровое</summary>

      <p class="text-sm text-muted" data-test="route-cooking-empty">
        Кто дежурит у костра, что и на чём готовит — появится здесь, когда
        в ночёвке выбран способ готовки.
      </p>
    </details>
  </section>
</template>
