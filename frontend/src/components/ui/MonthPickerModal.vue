<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { MONTH_NAMES } from '@/utils/calendar'

/**
 * Модалка выбора месяца.
 *
 * Вызывается кликом по названию месяца в календаре. Внутри — свой счётчик
 * года и сетка из двенадцати месяцев: чтобы попасть, скажем, в май 2027,
 * не нужно двенадцать раз жать «следующий месяц».
 *
 * Год внутри модалки — собственное состояние, а не тот, что показан
 * в календаре: пользователь может полистать годы, передумать и закрыть
 * модалку, и календарь от этого уехать не должен. Наружу год уходит
 * только вместе с выбранным месяцем.
 */
const props = defineProps<{
  /** Год, показанный в календаре. */
  year: number
  /** Месяц, показанный в календаре: 0 — январь. */
  month: number
}>()

const emit = defineEmits<{
  /** Выбран месяц: год и номер месяца (0 — январь). */
  select: [year: number, month: number]
  /** Пользователь закрыл модалку, ничего не выбрав. */
  close: []
}>()

const pickerYear = ref(props.year)

/**
 * Номер месяца, показанного в календаре, — но только когда в модалке
 * выставлен тот же год: «Октябрь» в 2027 году это не тот октябрь,
 * который сейчас в календаре.
 */
const selectedIndex = computed(() => (pickerYear.value === props.year ? props.month : -1))

/** Текущий месяц отмечаем точкой: глазами видно, куда вернуться. */
const currentIndex = computed(() => {
  const now = new Date()
  return pickerYear.value === now.getFullYear() ? now.getMonth() : -1
})

function monthClass(index: number): string {
  const base =
    'relative flex h-10 cursor-pointer items-center justify-center rounded-lg text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary'

  return selectedIndex.value === index
    ? `${base} bg-primary/15 font-semibold text-primary`
    : `${base} text-text hover:bg-bg`
}

/** Подпись для скринридера: в клетке только название месяца. */
function monthLabel(index: number): string {
  const parts = [`${MONTH_NAMES[index] ?? ''} ${pickerYear.value}`]
  if (selectedIndex.value === index) parts.push('показан в календаре')
  if (currentIndex.value === index) parts.push('текущий месяц')
  return parts.join(', ')
}

/** Классы стрелок у счётчика года. */
const STEP_BUTTON =
  'flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded text-base leading-none text-muted transition-colors hover:bg-bg hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary'

const selectedButton = ref<HTMLButtonElement | null>(null)
const card = ref<HTMLElement | null>(null)

/**
 * Ссылка на клетку показанного месяца — чтобы поставить туда фокус.
 *
 * Ref-колбэк, а не массив ссылок: нужна ровно одна клетка, и вычислять
 * её индекс в обработчике нечего.
 */
function setMonthRef(el: unknown, index: number) {
  if (index === selectedIndex.value && el instanceof HTMLButtonElement) {
    selectedButton.value = el
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)

  // Фокус — на показанном месяце: это текущее положение календаря. Если
  // в счётчике выставлен другой год, такого месяца нет — тогда фокус
  // уходит на карточку, чтобы Escape и Tab работали всё равно.
  if (selectedButton.value) selectedButton.value.focus()
  else card.value?.focus()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="month-picker-title"
    @click.self="emit('close')"
  >
    <div
      ref="card"
      tabindex="-1"
      class="w-full max-w-sm rounded-2xl bg-surface p-4 shadow-xl outline-none"
    >
      <h2 id="month-picker-title" class="mb-3 text-lg font-semibold text-text">Выбор месяца</h2>

      <div class="mb-3 flex items-center justify-between gap-1">
        <button
          type="button"
          :class="STEP_BUTTON"
          aria-label="Предыдущий год"
          @click="pickerYear -= 1"
        >
          <span aria-hidden="true">‹</span>
        </button>

        <span class="text-base font-medium text-text" aria-live="polite">{{ pickerYear }}</span>

        <button
          type="button"
          :class="STEP_BUTTON"
          aria-label="Следующий год"
          @click="pickerYear += 1"
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>

      <div class="grid grid-cols-3 gap-1">
        <button
          v-for="(name, index) in MONTH_NAMES"
          :key="name"
          :ref="(el) => setMonthRef(el, index)"
          type="button"
          :class="monthClass(index)"
          :aria-label="monthLabel(index)"
          @click="emit('select', pickerYear, index)"
        >
          {{ name }}
          <span
            v-if="currentIndex === index"
            class="absolute bottom-1 h-1 w-1 rounded-full bg-primary"
            aria-hidden="true"
          />
        </button>
      </div>

      <div class="mt-4 flex justify-end">
        <button
          type="button"
          class="cursor-pointer rounded-lg border border-border bg-bg px-4 py-2 text-sm text-text transition-colors hover:border-primary"
          @click="emit('close')"
        >
          Отмена
        </button>
      </div>
    </div>
  </div>
</template>
