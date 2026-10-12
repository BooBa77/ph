<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { CalendarDayType, DayUpdate } from '@/api/calendar'
import { ApiError } from '@/api/errors'
import { useCalendarStore } from '@/stores/calendar'
import { fromIsoDate, toIsoDate } from '@/utils/calendar'

/**
 * Модалка производственного календаря.
 *
 * Два инструмента: диапазон рабочих дней (вахта, «работал в выходные»)
 * и диапазон нерабочих (отпуск, каникулы, межвахта). Диапазоны копятся
 * в списке — за один заход можно задать хоть десять отпусков, — а в базу
 * уходят разом по «Сохранить». Пока не сохранили, ничего не отправлено:
 * передумал — закрыл модалку, календарь не тронут.
 *
 * Причина спрашивается только у нерабочих дней: там она несёт смысл
 * («отпуск» и «каникулы» — разные вещи). У рабочих вопроса нет вовсе —
 * это нестандартный график, и что именно у человека (вахта, смены,
 * подработка) не угадать, поэтому метка одна: «работа». Переписать её
 * под себя можно в модалке дня.
 *
 * Крестик убирает диапазон из списка. Пересечения разрешаются по последней
 * записи: если второй диапазон накрыл часть первого, победит второй —
 * и в списке это видно порядком строк.
 */
const props = defineProps<{
  /** Год, к которому относятся диапазоны: выходить за него нельзя. */
  year: number
}>()

const emit = defineEmits<{ close: [] }>()

const store = useCalendarStore()

interface RangeDraft {
  from: string
  to: string
  dayType: CalendarDayType
  label: string | null
}

const tool = ref<'work' | 'off'>('off')
const from = ref('')
const to = ref('')
const reason = ref('')
const list = ref<RangeDraft[]>([])
const isSaving = ref(false)
const error = ref<string | null>(null)

/** Метка для диапазона рабочих дней: одна на все случаи. */
const WORK_LABEL = 'работа'

/**
 * Переключили инструмент — забыли причину.
 *
 * Иначе «отпуск», набранный для нерабочих дней, остался бы в поле при
 * переходе на рабочие и сбивал бы с толку (а для них поле и не нужно).
 */
watch(tool, () => {
  reason.value = ''
})

const yearStart = `${props.year}-01-01`
const yearEnd = `${props.year}-12-31`

/** «01.06 — 14.06» — год в подписи не нужен, он один на всю модалку. */
function formatRange(range: RangeDraft): string {
  const day = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`
  return range.from === range.to
    ? day(range.from)
    : `${day(range.from)} — ${day(range.to)}`
}

const dayTypeWord: Record<CalendarDayType, string> = {
  workday: 'рабочие',
  weekend: 'нерабочие',
  short_workday: 'сокращённые',
}

/** Сколько дней изменит сохранение: список с учётом перекрытий. */
const affectedDays = computed(() => expand(list.value).length)

function addRange() {
  error.value = null

  if (!from.value || !to.value) {
    error.value = 'Укажите начало и конец диапазона'
    return
  }
  if (from.value > to.value) {
    error.value = 'Конец диапазона раньше начала'
    return
  }
  if (from.value < yearStart || to.value > yearEnd) {
    error.value = `Диапазон должен быть внутри ${props.year} года`
    return
  }

  list.value = [
    ...list.value,
    {
      from: from.value,
      to: to.value,
      dayType: tool.value === 'work' ? 'workday' : 'weekend',
      // Для рабочих дней причина не спрашивается: метка одна и та же,
      // потому что «вахта», «смены» и «подработка» — это всё «работа».
      label: tool.value === 'work' ? WORK_LABEL : reason.value.trim() || null,
    },
  ]

  from.value = ''
  to.value = ''
}

function removeRange(index: number) {
  list.value = list.value.filter((_, position) => position !== index)
}

/**
 * Развернуть диапазоны в дни.
 *
 * Идём по списку по порядку и перезаписываем дату — так последний диапазон
 * и выигрывает, ровно как на сервере.
 */
function expand(ranges: RangeDraft[]): DayUpdate[] {
  const byDate = new Map<string, DayUpdate>()

  for (const range of ranges) {
    for (
      const cursor = fromIsoDate(range.from);
      toIsoDate(cursor) <= range.to;
      cursor.setDate(cursor.getDate() + 1)
    ) {
      const date = toIsoDate(cursor)
      byDate.set(date, { date, dayType: range.dayType, label: range.label })
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

async function save() {
  if (list.value.length === 0) {
    error.value = 'Добавьте хотя бы один диапазон'
    return
  }

  isSaving.value = true
  error.value = null
  try {
    await store.applyDays(expand(list.value))
    emit('close')
  } catch (cause) {
    error.value =
      cause instanceof ApiError
        ? cause.message
        : 'Не удалось сохранить. Попробуйте ещё раз.'
  } finally {
    isSaving.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !isSaving.value) emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="production-calendar-title"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-lg rounded-2xl bg-surface p-4 shadow-xl">
      <h2 id="production-calendar-title" class="text-lg font-semibold text-text">
        Производственный календарь {{ year }}
      </h2>

      <!-- Инструмент: рабочие или нерабочие дни -->
      <div class="mt-3 flex gap-1 rounded-lg bg-bg p-1">
        <button
          type="button"
          class="flex-1 cursor-pointer rounded px-3 py-1.5 text-sm transition-colors"
          :class="tool === 'off' ? 'bg-surface font-medium text-text' : 'text-muted'"
          @click="tool = 'off'"
        >
          Нерабочие дни
        </button>
        <button
          type="button"
          class="flex-1 cursor-pointer rounded px-3 py-1.5 text-sm transition-colors"
          :class="tool === 'work' ? 'bg-surface font-medium text-text' : 'text-muted'"
          @click="tool = 'work'"
        >
          Рабочие дни
        </button>
      </div>

      <p class="mt-2 text-xs text-muted">
        {{
          tool === 'off'
            ? 'Отпуск, каникулы, межвахта — всё, когда вы не работаете.'
            : 'Вахта, работа в выходные — дни, когда вы работаете.'
        }}
      </p>

      <!--
        Порядок в строке: даты, «Добавить», и только потом причина.
        Так кнопка стоит сразу за датами и не переезжает, когда поле
        причины скрывается (у рабочих дней его нет): если поставить причину
        перед кнопкой, она уезжает вправо при каждом переключении
        инструмента.
      -->
      <div class="mt-3 flex flex-wrap items-end gap-2">
        <label class="flex flex-col gap-1 text-xs text-muted">
          С
          <input
            v-model="from"
            type="date"
            :min="yearStart"
            :max="yearEnd"
            class="rounded border border-border bg-bg px-2 py-1 text-sm text-text"
          />
        </label>
        <label class="flex flex-col gap-1 text-xs text-muted">
          По
          <input
            v-model="to"
            type="date"
            :min="yearStart"
            :max="yearEnd"
            class="rounded border border-border bg-bg px-2 py-1 text-sm text-text"
          />
        </label>
        <button
          type="button"
          class="cursor-pointer rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-text transition-colors hover:border-primary"
          @click="addRange"
        >
          Добавить
        </button>
        <label
          v-if="tool === 'off'"
          class="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted"
        >
          Что это (необязательно)
          <input
            v-model="reason"
            type="text"
            maxlength="100"
            placeholder="отпуск, каникулы, межвахта"
            class="rounded border border-border bg-bg px-2 py-1 text-sm text-text"
          />
        </label>
      </div>

      <!-- Накопленные диапазоны -->
      <ul v-if="list.length > 0" class="mt-3 divide-y divide-border rounded-lg bg-bg">
        <li
          v-for="(range, index) in list"
          :key="`${range.from}-${range.to}-${index}`"
          class="flex items-center justify-between gap-2 px-3 py-2 text-sm"
        >
          <span class="text-text">
            {{ formatRange(range) }} · {{ dayTypeWord[range.dayType] }}
            <span v-if="range.label" class="text-muted">· {{ range.label }}</span>
          </span>
          <button
            type="button"
            class="cursor-pointer rounded px-2 text-muted transition-colors hover:text-red-600"
            :aria-label="`Убрать диапазон ${formatRange(range)}`"
            @click="removeRange(index)"
          >
            ×
          </button>
        </li>
      </ul>

      <p v-else class="mt-3 text-sm text-muted">
        Пока ничего не добавлено. Можно задать несколько диапазонов и сохранить
        их разом.
      </p>

      <p v-if="error" class="mt-3 text-sm text-red-600">{{ error }}</p>

      <div class="mt-4 flex items-center justify-between gap-2">
        <span class="text-xs text-muted">
          {{ list.length > 0 ? `Будет изменено дней: ${affectedDays}` : '' }}
        </span>
        <div class="flex gap-2">
          <button
            type="button"
            :disabled="isSaving"
            class="cursor-pointer rounded-lg border border-border bg-bg px-4 py-2 text-sm text-text transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            @click="emit('close')"
          >
            Отмена
          </button>
          <button
            type="button"
            :disabled="isSaving || list.length === 0"
            class="cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            @click="save"
          >
            {{ isSaving ? 'Сохраняем…' : 'Сохранить' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
