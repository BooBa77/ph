<script setup lang="ts">
import { computed } from 'vue'

import {
  MONTH_SHORT_NAMES,
  emptyVariantDraft,
  type DatePeriod,
  type DateVariantDraft,
} from '@/types/trips'

/**
 * Прогноз дат: «когда-нибудь» вместо календаря.
 *
 * Для мечты и плана обычный календарь не годится. Мечта может быть
 * на следующее лето или вообще без даты, а план — «следующим летом пойду».
 * Поэтому здесь два взаимоисключающих способа сказать «когда»:
 *
 * - **примерный период** — прокликать месяцы: «июнь, июль или август».
 *   Это один вариант на каждый выбранный месяц, поездка может случиться
 *   в любой из них;
 * - **точное число** — день, месяц и, если известен, год.
 *
 * Одновременно и то и другое смысла не имеет: если знаешь число, месяцы
 * перечислять нечего. Поэтому режим переключается, а не дополняется.
 *
 * **Месяцы показаны двумя рядами с годами** — оставшиеся месяцы текущего
 * года и все месяцы следующего. Без года «июнь» не значит ничего: это
 * и ближайший июнь, и следующий. Глубже двух лет мечты не заглядывают,
 * а кому надо — у того есть режим точного числа с полем года.
 *
 * **Даты окончания тут нет.** Она не выбирается календарём, а считается:
 * задаётся продолжительность в днях и возможный запас вверх — «два-три
 * дня, может затянуться». Для прогноза этого достаточно, а конкретные
 * начало и конец появляются, когда поход решён.
 */
const rows = defineModel<DateVariantDraft[]>({ required: true })

const DAYS = Array.from({ length: 31 }, (_, index) => index + 1)

/**
 * Текущий и следующий год.
 *
 * Считаем один раз при создании компонента, а не в computed: если форма
 * открыта в новогоднюю ночь, пересчёт на лету поменял бы подписи под
 * руками у человека.
 */
const TODAY = new Date()
const CURRENT_YEAR = TODAY.getFullYear()

/**
 * Оставшиеся месяцы текущего года — с текущего по декабрь.
 *
 * Прошедшие месяцы не показываем: поход в марте, когда на дворе октябрь,
 * — это не прогноз, а ошибка. Следующий год показан целиком.
 */
const CURRENT_YEAR_MONTHS = MONTH_SHORT_NAMES.slice(TODAY.getMonth())

/** Ряды месяцев: сначала следующий год, ниже — остаток текущего. */
const MONTH_ROWS = [
  { year: CURRENT_YEAR + 1, months: MONTH_SHORT_NAMES.map((_, i) => i + 1) },
  {
    year: CURRENT_YEAR,
    months: CURRENT_YEAR_MONTHS.map((_, i) => TODAY.getMonth() + i + 1),
  },
]

/** Следующий свободный id: он же ключ в списке, он же метка в тестах. */
function nextId(): number {
  return rows.value.reduce((max, row) => Math.max(max, row.id), 0) + 1
}

function addRow() {
  rows.value.push(emptyVariantDraft(nextId()))
}

function removeRow(id: number) {
  // Последний вариант не удаляем: пустой список — это не «нет прогноза»,
  // а «форма сломалась». Убрать дату совсем можно, оставив вариант пустым.
  if (rows.value.length <= 1) return
  rows.value = rows.value.filter((row) => row.id !== id)
}

/** Переключение режима: он взаимоисключающий, поэтому чистим чужое. */
function setMode(row: DateVariantDraft, mode: 'periods' | 'exact') {
  row.mode = mode
  if (mode === 'periods') {
    row.year = ''
    row.month = ''
    row.day = ''
  } else {
    row.periods = []
  }
}

/** Выбран ли такой месяц такого года. */
function isChosen(row: DateVariantDraft, period: DatePeriod): boolean {
  return row.periods.some((item) => item.year === period.year && item.month === period.month)
}

/** Прокликать или отжать месяц. */
function togglePeriod(row: DateVariantDraft, period: DatePeriod) {
  row.periods = isChosen(row, period)
    ? row.periods.filter((item) => !(item.year === period.year && item.month === period.month))
    : [...row.periods, period].sort(
        (left, right) => left.year - right.year || left.month - right.month,
      )
}

/** Подписи выбранного: «июн 2027, июл 2027» — чтобы видеть, что выбрано. */
const chosenLabels = computed(() =>
  rows.value.map((row) =>
    row.periods.map((period) => `${MONTH_SHORT_NAMES[period.month - 1]} ${period.year}`).join(', '),
  ),
)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div
      v-for="(row, index) in rows"
      :key="row.id"
      class="flex flex-col gap-3 rounded-xl border border-border p-3"
      data-test="variant-row"
    >
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="cursor-pointer rounded-lg border px-3 py-1 text-sm transition-colors"
          :class="
            row.mode === 'periods'
              ? 'border-primary text-primary'
              : 'border-border text-muted hover:text-text'
          "
          data-test="mode-periods"
          @click="setMode(row, 'periods')"
        >
          Примерный период
        </button>

        <button
          type="button"
          class="cursor-pointer rounded-lg border px-3 py-1 text-sm transition-colors"
          :class="
            row.mode === 'exact'
              ? 'border-primary text-primary'
              : 'border-border text-muted hover:text-text'
          "
          data-test="mode-exact"
          @click="setMode(row, 'exact')"
        >
          Точное число
        </button>

        <button
          v-if="rows.length > 1"
          type="button"
          class="ml-auto cursor-pointer text-sm text-muted underline transition-colors hover:text-text"
          data-test="remove-variant"
          @click="removeRow(row.id)"
        >
          Убрать вариант
        </button>
      </div>

      <!-- Примерный период: два ряда месяцев, каждый со своим годом -->
      <div v-if="row.mode === 'periods'" class="flex flex-col gap-3">
        <div
          v-for="monthRow in MONTH_ROWS"
          :key="monthRow.year"
          class="flex flex-wrap items-center gap-1"
        >
          <span class="w-16 text-sm text-muted" :data-test="`year-${monthRow.year}`">
            {{ monthRow.year }}
          </span>

          <button
            v-for="month in monthRow.months"
            :key="month"
            type="button"
            class="cursor-pointer rounded-lg border px-2.5 py-1 text-sm transition-colors"
            :class="
              isChosen(row, { year: monthRow.year, month })
                ? 'border-primary bg-field text-text'
                : 'border-border text-muted hover:text-text'
            "
            :data-test="`month-${monthRow.year}-${month}`"
            @click="togglePeriod(row, { year: monthRow.year, month })"
          >
            {{ MONTH_SHORT_NAMES[month - 1] }}
          </button>
        </div>

        <p v-if="row.periods.length" class="text-xs text-text">
          Выбрано: {{ chosenLabels[index] }}
        </p>
      </div>

      <!-- Точное число -->
      <div v-else class="flex flex-wrap items-end gap-3">
        <label class="flex flex-col gap-1">
          <span class="text-xs text-muted">Число</span>
          <select
            v-model="row.day"
            class="cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
            data-test="exact-day"
          >
            <option value="">—</option>
            <option v-for="day in DAYS" :key="day" :value="String(day)">
              {{ day }}
            </option>
          </select>
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-xs text-muted">Месяц</span>
          <select
            v-model="row.month"
            class="cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
            data-test="exact-month"
          >
            <option value="">—</option>
            <option
              v-for="(name, monthIndex) in MONTH_SHORT_NAMES"
              :key="name"
              :value="String(monthIndex + 1)"
            >
              {{ name }}
            </option>
          </select>
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-xs text-muted">Год</span>
          <input
            v-model="row.year"
            type="number"
            min="2000"
            max="2100"
            :placeholder="String(CURRENT_YEAR)"
            class="w-28 rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
            data-test="exact-year"
          />
        </label>
      </div>

      <!-- Продолжительность и запас -->
      <div class="flex flex-wrap items-end gap-3">
        <label class="flex flex-col gap-1">
          <span class="text-xs text-muted">Дней</span>
          <input
            v-model="row.durationDays"
            type="number"
            min="1"
            max="365"
            class="w-24 rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
            data-test="duration-days"
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-xs text-muted">Запас, дней</span>
          <input
            v-model="row.durationDelta"
            type="number"
            min="0"
            max="365"
            placeholder="0"
            class="w-24 rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
            data-test="duration-delta"
          />
        </label>

        <p class="text-xs text-muted">«5 дней + 2» — это от пяти до семи.</p>
      </div>
    </div>

    <button
      type="button"
      class="cursor-pointer self-start rounded-xl border border-border bg-field px-4 py-2 text-sm text-text transition-colors hover:border-primary"
      data-test="add-variant"
      @click="addRow"
    >
      Добавить вариант
    </button>
  </div>
</template>
