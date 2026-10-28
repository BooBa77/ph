<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * Модалка выбора даты **и времени**.
 *
 * Заказчик 28.10.2026: «Мне нужна кнопка „ОК“ на календарике, между
 * „Удалить“ и „Сегодня“, на всех календарях сайта с выбором часов/минут —
 * неудобно кликать мимо формы для принятия выбора». Встроенный пикер
 * `<input type="datetime-local">` нарисован браузером: своих кнопок в него
 * не добавить, а «клик мимо» — это его штатное закрытие. Поэтому здесь
 * своя сетка и три кнопки внизу.
 *
 * Отличия от `DatePickerModal`: день не закрывает окно (иначе часы выбрать
 * не успеть), время выбирается отдельно, а решение принимает «ОК».
 */
const props = defineProps<{
  /** Значение в формате `YYYY-MM-DDTHH:mm` (местное). */
  value?: string
  /** Нижняя граница — тот же формат. */
  min?: string
  /** Верхняя граница — тот же формат. */
  max?: string
}>()

const emit = defineEmits<{
  /** Выбрали: `YYYY-MM-DDTHH:mm`, или пустая строка — «Очистить». */
  select: [value: string]
  /** Закрыли, ничего не меняя. */
  close: []
}>()

const MONTH_NAMES = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
]

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

const pad = (value: number) => String(value).padStart(2, '0')

const now = new Date()

/** Разбор значения без часовых поясов: иначе дата уезжает на день назад. */
function parse(value: string | undefined): Date {
  if (!value) return now

  const [datePart, timePart = '00:00'] = value.split('T')
  const [year, month, day] = (datePart ?? '').split('-').map(Number)
  const [hours, minutes] = timePart.split(':').map(Number)

  if (!year || !month || !day) return now

  return new Date(year, month - 1, day, hours || 0, minutes || 0)
}

const shown = ref(parse(props.value))
const picked = ref(parse(props.value))
const hours = ref(picked.value.getHours())
const minutes = ref(picked.value.getMinutes())

const year = computed(() => shown.value.getFullYear())
const month = computed(() => shown.value.getMonth())

/** Выбранный день — в показанном месяце он подсвечивается. */
const selectedDay = computed(() =>
  picked.value.getFullYear() === year.value && picked.value.getMonth() === month.value
    ? picked.value.getDate()
    : -1,
)

const todayDay = computed(() =>
  now.getFullYear() === year.value && now.getMonth() === month.value ? now.getDate() : -1,
)

/** Клетки месяца: числа и пустышки, чтобы первое встало под своим днём. */
const cells = computed<(number | null)[]>(() => {
  const first = new Date(year.value, month.value, 1)
  const leading = (first.getDay() + 6) % 7
  const total = new Date(year.value, month.value + 1, 0).getDate()

  const result: (number | null)[] = Array.from({ length: leading }, () => null)
  for (let day = 1; day <= total; day += 1) result.push(day)
  while (result.length % 7 !== 0) result.push(null)

  return result
})

function stepMonth(delta: number) {
  shown.value = new Date(year.value, month.value + delta, 1)
}

/** День выбран, но окно не закрывается: ещё часы и «ОК». */
function pickDay(day: number) {
  if (isDayDisabled(day)) return
  picked.value = new Date(year.value, month.value, day, hours.value, minutes.value)
}

function pickToday() {
  const current = new Date()

  picked.value = current
  shown.value = new Date(current.getFullYear(), current.getMonth(), 1)
  hours.value = current.getHours()
  minutes.value = current.getMinutes()
}

function valueOf(date: Date, hour: number, minute: number): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    hour,
  )}:${pad(minute)}`
}

/**
 * День вне окна: его нельзя даже нажать.
 *
 * Раньше вне окна была только кнопка «ОК», и человек спокойно выбирал
 * недопустимый день, а потом упирался в отказ. Заказчик 28.10.2026:
 * «не должен брать дату уже в модалке, так же как и за рамками похода».
 */
function isDayDisabled(day: number): boolean {
  const iso = `${year.value}-${pad(month.value + 1)}-${pad(day)}`

  if (props.min !== undefined && iso < props.min.slice(0, 10)) return true
  if (props.max !== undefined && iso > props.max.slice(0, 10)) return true

  return false
}

/** Выбранный момент — уже с часами и минутами. */
const prepared = computed(() =>
  valueOf(picked.value, Number(hours.value), Number(minutes.value)),
)

/** Не выходит ли выбор за рамки похода: кнопка «ОК» тогда не сработает. */
const outOfRange = computed(() => {
  if (props.min !== undefined && prepared.value < props.min) return true
  if (props.max !== undefined && prepared.value > props.max) return true
  return false
})

function confirm() {
  if (outOfRange.value) return
  emit('select', prepared.value)
}

function clear() {
  emit('select', '')
}

function dayClass(day: number): string {
  const base =
    'flex h-9 w-full items-center justify-center rounded-lg text-sm transition-colors'

  if (isDayDisabled(day)) {
    return `${base} cursor-not-allowed text-muted opacity-40`
  }

  if (day === selectedDay.value) {
    return `${base} cursor-pointer bg-primary/15 font-semibold text-primary`
  }
  if (day === todayDay.value) {
    return `${base} cursor-pointer border border-border text-text hover:bg-bg`
  }
  return `${base} cursor-pointer text-text hover:bg-bg`
}

function dayLabel(day: number): string {
  const parts = [`${day} ${MONTH_NAMES[month.value]?.toLowerCase()} ${year.value}`]
  if (day === selectedDay.value) parts.push('выбрана')
  if (day === todayDay.value) parts.push('сегодня')
  return parts.join(', ')
}

const STEP_BUTTON =
  'flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded text-base leading-none text-muted transition-colors hover:bg-bg hover:text-text'

const ROW_BUTTON =
  'cursor-pointer rounded-lg px-3 py-2 text-sm transition-colors hover:border-primary'

const card = ref<HTMLElement | null>(null)

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
  if (event.key === 'Enter' && !outOfRange.value) confirm()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  card.value?.focus()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    data-test="datetime-picker"
    @click.self="emit('close')"
  >
    <div
      ref="card"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-labelledby="datetime-picker-title"
      class="w-full max-w-sm rounded-xl border border-border bg-surface p-4 shadow-xl focus:outline-none"
    >
      <div class="mb-2 flex items-center justify-between">
        <h3 id="datetime-picker-title" class="text-base font-semibold text-text">
          {{ MONTH_NAMES[month] }} {{ year }}
        </h3>
        <button
          type="button"
          class="cursor-pointer rounded p-1 text-muted transition-colors hover:bg-bg hover:text-text"
          aria-label="Закрыть"
          data-test="datetime-close"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>

      <div class="mb-2 flex items-center justify-between">
        <button
          type="button"
          :class="STEP_BUTTON"
          aria-label="Предыдущий месяц"
          data-test="datetime-prev"
          @click="stepMonth(-1)"
        >
          <span aria-hidden="true">‹</span>
        </button>
        <span class="text-xs text-muted">выберите день, затем время</span>
        <button
          type="button"
          :class="STEP_BUTTON"
          aria-label="Следующий месяц"
          data-test="datetime-next"
          @click="stepMonth(1)"
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>

      <div class="grid grid-cols-7 gap-0.5">
        <span
          v-for="weekday in WEEKDAYS"
          :key="weekday"
          class="flex h-7 items-center justify-center text-xs text-muted"
        >
          {{ weekday }}
        </span>

        <template v-for="(day, index) in cells" :key="index">
          <span v-if="day === null" />
          <button
            v-else
            type="button"
            :class="dayClass(day)"
            :aria-label="dayLabel(day)"
            :disabled="isDayDisabled(day)"
            :data-test="`datetime-day-${day}`"
            @click="pickDay(day)"
          >
            {{ day }}
          </button>
        </template>
      </div>

      <div class="mt-3 flex items-center gap-2">
        <label class="flex items-center gap-1 text-sm text-muted">
          Часы
          <select
            v-model.number="hours"
            class="rounded-lg border border-border bg-field px-2 py-1 text-base text-text focus:border-primary focus:outline-none"
            data-test="datetime-hours"
          >
            <option v-for="hour in 24" :key="hour" :value="hour - 1">
              {{ pad(hour - 1) }}
            </option>
          </select>
        </label>

        <label class="flex items-center gap-1 text-sm text-muted">
          Минуты
          <select
            v-model.number="minutes"
            class="rounded-lg border border-border bg-field px-2 py-1 text-base text-text focus:border-primary focus:outline-none"
            data-test="datetime-minutes"
          >
            <option v-for="minute in 60" :key="minute" :value="minute - 1">
              {{ pad(minute - 1) }}
            </option>
          </select>
        </label>

        <span class="ml-auto text-sm text-muted" data-test="datetime-value">
          {{ prepared.replace('T', ' ') }}
        </span>
      </div>

      <p v-if="outOfRange" class="mt-2 text-xs text-red-600" data-test="datetime-range">
        Эта дата вне похода — выберите день между выездом и возвращением
      </p>

      <div class="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          :class="[ROW_BUTTON, 'text-muted']"
          data-test="datetime-clear"
          @click="clear"
        >
          Очистить
        </button>
        <button
          type="button"
          :class="[ROW_BUTTON, 'text-primary']"
          data-test="datetime-today"
          @click="pickToday"
        >
          Сегодня
        </button>
        <button
          type="button"
          :class="[ROW_BUTTON, 'border border-border bg-bg text-text']"
          data-test="datetime-ok"
          :disabled="outOfRange"
          @click="confirm"
        >
          ОК
        </button>
      </div>
    </div>
  </div>
</template>
