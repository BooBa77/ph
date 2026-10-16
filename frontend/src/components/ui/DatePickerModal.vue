<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * Модалка выбора даты.
 *
 * Появляется по центру экрана, с крестиком и «Отменой», и закрывается
 * кликом по затемнению или по Escape — как остальные модалки проекта.
 *
 * **Почему не встроенный календарь браузера.** Первая версия показывала
 * `<input type="date">` и звала `showPicker()`: календарь открывался где-то
 * в углу окна, а на странице оставался висеть текст с датой и «Отменой».
 * Плюс вид и поведение встроенного календаря в разных браузерах разные,
 * и повлиять на них нельзя. Своя сетка выглядит одинаково везде.
 *
 * Сетка начинается с понедельника: в России неделя с него, и календарь,
 * начинающийся с воскресенья, читается как чужой.
 *
 * Компонент универсальный: он не знает ни про редактор, ни про походы —
 * отдаёт выбранную дату строкой `YYYY-MM-DD` и закрывается.
 */
const props = defineProps<{
  /** Показанная дата в формате `YYYY-MM-DD`. По умолчанию — сегодня. */
  value?: string
}>()

const emit = defineEmits<{
  /** Дата выбрана: строка `YYYY-MM-DD`. */
  select: [iso: string]
  /** Модалку закрыли, ничего не выбрав. */
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

/** Понедельник первый — так принято в России. */
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

const today = new Date()

/** Разбор `YYYY-MM-DD` без часовых поясов: иначе дата уезжает на день назад. */
function parseIso(iso: string | undefined): Date {
  if (!iso) return today
  const [year, month, day] = iso.split('-').map(Number)
  if (!year || !month || !day) return today
  return new Date(year, month - 1, day)
}

const shown = ref(parseIso(props.value))

const year = computed(() => shown.value.getFullYear())
const month = computed(() => shown.value.getMonth())

/** Выбранный день, если он в показанном месяце. */
const selectedDay = computed(() => {
  const value = parseIso(props.value)
  return value.getFullYear() === year.value && value.getMonth() === month.value
    ? value.getDate()
    : -1
})

const todayDay = computed(() =>
  today.getFullYear() === year.value && today.getMonth() === month.value ? today.getDate() : -1,
)

/**
 * Клетки месяца: числа и пустышки.
 *
 * Пустышки нужны, чтобы первое число встало под своим днём недели:
 * без них сетка поехала бы и «1» оказалось бы, например, в среду.
 */
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

/** Дата в `YYYY-MM-DD` — без времени и без часовых поясов. */
function toIso(day: number): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${year.value}-${pad(month.value + 1)}-${pad(day)}`
}

function dayClass(day: number): string {
  const base =
    'flex h-9 cursor-pointer items-center justify-center rounded-lg text-sm transition-colors'

  if (day === selectedDay.value) {
    return `${base} bg-primary/15 font-semibold text-primary`
  }
  if (day === todayDay.value) {
    return `${base} border border-border text-text hover:bg-bg`
  }
  return `${base} text-text hover:bg-bg`
}

/** Подпись для скринридера: в клетке только число. */
function dayLabel(day: number): string {
  const parts = [`${day} ${MONTH_NAMES[month.value]?.toLowerCase()} ${year.value}`]
  if (day === selectedDay.value) parts.push('выбрана')
  if (day === todayDay.value) parts.push('сегодня')
  return parts.join(', ')
}

const STEP_BUTTON =
  'flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded text-base leading-none text-muted transition-colors hover:bg-bg hover:text-text'

const card = ref<HTMLElement | null>(null)

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
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
    role="dialog"
    aria-modal="true"
    aria-labelledby="date-picker-title"
    data-test="date-modal"
    @click.self="emit('close')"
  >
    <div
      ref="card"
      tabindex="-1"
      class="w-full max-w-xs rounded-2xl bg-surface p-4 shadow-xl outline-none"
    >
      <div class="mb-3 flex items-center justify-between gap-2">
        <h2 id="date-picker-title" class="text-lg font-semibold text-text">Выбор даты</h2>

        <button
          type="button"
          class="-mr-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded text-muted transition-colors hover:bg-bg hover:text-text"
          aria-label="Закрыть"
          data-test="date-close"
          @click="emit('close')"
        >
          <svg
            class="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div class="mb-2 flex items-center justify-between gap-1">
        <button
          type="button"
          :class="STEP_BUTTON"
          aria-label="Предыдущий месяц"
          data-test="date-prev"
          @click="stepMonth(-1)"
        >
          <span aria-hidden="true">‹</span>
        </button>

        <span class="text-base font-medium text-text" data-test="date-title">
          {{ MONTH_NAMES[month] }} {{ year }}
        </span>

        <button
          type="button"
          :class="STEP_BUTTON"
          aria-label="Следующий месяц"
          data-test="date-next"
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
            :data-test="`date-day-${day}`"
            @click="emit('select', toIso(day))"
          >
            {{ day }}
          </button>
        </template>
      </div>

      <div class="mt-4 flex justify-end">
        <button
          type="button"
          class="cursor-pointer rounded-lg border border-border bg-bg px-4 py-2 text-sm text-text transition-colors hover:border-primary"
          data-test="date-cancel"
          @click="emit('close')"
        >
          Отмена
        </button>
      </div>
    </div>
  </div>
</template>
