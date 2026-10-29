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
 * Что на плашке (дословно заказчик):
 * - «Ночь 1. 29 октября» — номер и дата;
 * - выпадающий список варианта ночёвки: палатка / гостиница / изба / машина /
 *   идём всю ночь;
 * - «идём всю ночь» — больше ничего не делается;
 * - из оставшихся «гостиница» — тоже ничего, а палатка, изба и машина
 *   спрашивают способ готовки: костёр или горелка.
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
type NightKind = 'tent' | 'hotel' | 'hut' | 'car' | 'allnight'

type CookingKind = 'fire' | 'stove'

/**
 * Порядок ровно тот, в котором заказчик перечислил варианты. Подписи — его
 * слова: «изба», а не «зимовьё» из карты вкладок (это был открытый вопрос
 * `NEXT.md` §3, и заказчик ответил именно так).
 */
const NIGHT_KIND_LABELS: Record<NightKind, string> = {
  tent: 'Палатка',
  hotel: 'Гостиница',
  hut: 'Изба',
  car: 'Машина',
  allnight: 'Идём всю ночь',
}

const COOKING_LABELS: Record<CookingKind, string> = {
  fire: 'Костёр',
  stove: 'Горелка',
}

/**
 * Готовку спрашиваем у всех, кроме гостиницы и ночного перехода: в гостинице
 * готовит кухня, а в ночь идут без стоянки. Правило записано списком
 * «кому нужно», а не «кому нет»: если завтра появится баня или кафе, их
 * придётся добавить сюда осознанно.
 */
const COOKING_KINDS: readonly NightKind[] = ['tent', 'hut', 'car']

function needsCooking(kind: NightKind | ''): boolean {
  return kind !== '' && COOKING_KINDS.includes(kind)
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
 * Выбрали гостиницу или ночной переход — способ готовки больше не нужен.
 * Без сброса значение осталось бы в памяти и вернулось при возврате
 * к «палатке», хотя человек его не подтверждал.
 */
function onKindChange(row: NightRow) {
  if (!needsCooking(row.kind)) row.cooking = ''
}
</script>

<template>
  <section class="flex flex-col gap-3" data-test="route-nights">
    <p v-if="plan.note" class="text-sm text-muted" data-test="route-nights-note">
      {{ plan.note }}
    </p>

    <article
      v-for="row in rows"
      :key="row.number"
      class="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3"
      data-test="route-night"
    >
      <h3 class="text-base font-medium text-text" data-test="route-night-title">
        Ночь {{ row.number }}. {{ row.label }}
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

        <!-- «Идём всю ночь» и «Гостиница» дальше ничего не спрашивают. -->
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
  </section>
</template>
