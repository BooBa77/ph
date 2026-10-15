<script setup lang="ts">
import {
  MONTH_SHORT_NAMES,
  emptyVariantDraft,
  type DateVariantDraft,
} from '@/types/trips'

/**
 * Прогноз дат: «когда-нибудь» вместо календаря.
 *
 * Для мечты и плана обычный календарь не годится. Мечта может быть
 * на следующее лето или вообще без даты, а план — «следующим летом пойду».
 * Поэтому здесь два взаимоисключающих способа сказать «когда»:
 *
 * - **прокликать месяцы** — «июнь, июль или август»: это один вариант
 *   на каждый выбранный месяц, поездка может случиться в любой из них;
 * - **точное число** — день, месяц и, если известен, год.
 *
 * Одновременно и то и другое смысла не имеет: если знаешь число, месяцы
 * перечислять нечего. Поэтому режим переключается, а не дополняется.
 *
 * **Даты окончания тут нет.** Она не выбирается календарём, а считается:
 * задаётся продолжительность в днях и возможный запас вверх — «два-три
 * дня, может затянуться». Для прогноза этого достаточно, а конкретные
 * начало и конец появляются, когда поход решён.
 */
const rows = defineModel<DateVariantDraft[]>({ required: true })

const DAYS = Array.from({ length: 31 }, (_, index) => index + 1)

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
function setMode(row: DateVariantDraft, mode: 'months' | 'exact') {
  row.mode = mode
  if (mode === 'months') {
    row.year = ''
    row.month = ''
    row.day = ''
  } else {
    row.months = []
  }
}

/** Прокликать или отжать месяц. */
function toggleMonth(row: DateVariantDraft, month: number) {
  row.months = row.months.includes(month)
    ? row.months.filter((item) => item !== month)
    : [...row.months, month].sort((left, right) => left - right)
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div
      v-for="row in rows"
      :key="row.id"
      class="flex flex-col gap-3 rounded-xl border border-border p-3"
      data-test="variant-row"
    >
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="cursor-pointer rounded-lg border px-3 py-1 text-sm transition-colors"
          :class="
            row.mode === 'months'
              ? 'border-primary text-primary'
              : 'border-border text-muted hover:text-text'
          "
          data-test="mode-months"
          @click="setMode(row, 'months')"
        >
          Месяцы
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

      <!-- Месяцы: можно прокликать несколько -->
      <div v-if="row.mode === 'months'" class="flex flex-wrap gap-1">
        <button
          v-for="(name, index) in MONTH_SHORT_NAMES"
          :key="name"
          type="button"
          class="cursor-pointer rounded-lg border px-2.5 py-1 text-sm transition-colors"
          :class="
            row.months.includes(index + 1)
              ? 'border-primary bg-field text-text'
              : 'border-border text-muted hover:text-text'
          "
          :data-test="`month-${index + 1}`"
          @click="toggleMonth(row, index + 1)"
        >
          {{ name }}
        </button>
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
              v-for="(name, index) in MONTH_SHORT_NAMES"
              :key="name"
              :value="String(index + 1)"
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
            placeholder="любой"
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

        <p class="text-xs text-muted">
          «5 дней + 2» — это от пяти до семи.
        </p>
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
