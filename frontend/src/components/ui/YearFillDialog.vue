<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import type { CalendarMode, YearState } from '@/api/calendar'
import { ApiError } from '@/api/errors'
import { useCalendarStore } from '@/stores/calendar'

/**
 * Диалог «производственный календарь не заполнен».
 *
 * Появляется при первом заходе в год, на который у пользователя календаря
 * нет. Дерево простое: «работаешь?» → да (5/2 по государственному шаблону)
 * или нет (декрет, пенсия, учёба, свободный график). Каждый вариант —
 * это одно и то же действие с разным режимом, поэтому и живёт оно в одном
 * компоненте.
 *
 * Если шаблона на год ещё нет (например, 2030-й), предупреждаем об этом
 * прямо в вопросе: год заполнится по 5/2 без праздников, и расставлять их
 * придётся самому. Заполненный год мы больше не трогаем — ни когда выйдет
 * государственный календарь, ни когда пользователь зайдёт в него снова.
 *
 * Закрыл, не заполнив, — при следующем заходе спросим снова. Внутри одной
 * сессии страницы второй раз не всплываем: это выглядело бы как навязчивость.
 */
const props = defineProps<{
  year: number
  state: YearState
  /** Текущий год — по нему выбирается формулировка вопроса. */
  currentYear: number
  /** Режим, который пользователь выбирал раньше. null — ещё не выбирал. */
  previousMode: CalendarMode | null
}>()

const emit = defineEmits<{ close: [] }>()

const store = useCalendarStore()

const step = ref<'question' | 'reason' | 'done'>('question')
const isSaving = ref(false)
const error = ref<string | null>(null)
const resultMessage = ref('')

/** Варианты на «нет»: режим и подпись кнопки. */
const REASONS: { mode: CalendarMode; label: string }[] = [
  { mode: 'parental', label: 'Декрет' },
  { mode: 'retired', label: 'Пенсия' },
  { mode: 'study', label: 'Учусь' },
  { mode: 'free', label: 'Свободный график' },
]

/**
 * Формулировка вопроса.
 *
 * Про будущий год, если режим уже известен, спрашиваем не «планируешь
 * работать?», а по делу: пенсионера — «ты ещё на пенсии?», родителя
 * в декрете — «не планируешь выходить?». Это тот случай, ради которого
 * режим вообще хранится.
 */
const question = computed(() => {
  const { year, currentYear, previousMode } = props

  if (year > currentYear && previousMode) {
    switch (previousMode) {
      case 'parental':
        return 'Из декрета не планируешь выходить?'
      case 'retired':
        return 'Ты ещё на пенсии?'
      case 'study':
        return 'Продолжаешь учёбу?'
      case 'free':
        return 'Свободный график сохраняется?'
      default:
        return `Работать в ${year} планируешь так же — 5/2?`
    }
  }

  if (year < currentYear) return 'Ты работал тогда?'
  if (year > currentYear) return `Ты планируешь работать в ${year}?`
  return 'Ты работаешь?'
})

/** Что сказать после заполнения — по режиму и наличию шаблона. */
function resultText(mode: CalendarMode): string {
  if (mode === 'cycle') {
    return props.state.stateAvailable
      ? 'Календарь заполнен стандартными 5/2. Его всегда можно скорректировать под свой график и добавить отпуск. Государственный производственный календарь применён.'
      : `Календарь заполнен стандартными 5/2. Государственный производственный календарь на ${props.year} год ещё не утверждён, поэтому праздников в нём нет — отметь их сам.`
  }
  if (mode === 'study') {
    return 'Календарь заполнен по школьному учебному календарю. Скорректируй его под график своего учебного заведения.'
  }
  if (mode === 'free') {
    return 'Календарь заполнен выходными. Его всегда можно скорректировать под свой график.'
  }
  return 'Календарь заполнен выходными: год отмечен как нерабочий.'
}

async function fill(mode: CalendarMode) {
  isSaving.value = true
  error.value = null
  try {
    await store.createYear(props.year, mode)
    resultMessage.value = resultText(mode)
    step.value = 'done'
  } catch (cause) {
    error.value =
      cause instanceof ApiError
        ? cause.message
        : 'Не удалось создать календарь. Попробуйте ещё раз.'
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
    aria-labelledby="year-fill-title"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-md rounded-2xl bg-surface p-4 shadow-xl">
      <h2 id="year-fill-title" class="text-lg font-semibold text-text">
        Производственный календарь на {{ year }} год не заполнен
      </h2>

      <!-- Вопрос -->
      <template v-if="step === 'question'">
        <p v-if="!state.stateAvailable" class="mt-2 text-sm text-muted">
          Государственный производственный календарь на {{ year }} год ещё не
          утверждён. Праздники придётся расставить самому.
        </p>

        <p class="mt-3 text-base text-text">{{ question }}</p>

        <div class="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            :disabled="isSaving"
            class="cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            @click="fill('cycle')"
          >
            Да
          </button>
          <button
            type="button"
            :disabled="isSaving"
            class="cursor-pointer rounded-lg border border-border bg-bg px-4 py-2 text-sm text-text transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            @click="step = 'reason'"
          >
            Нет
          </button>
        </div>
      </template>

      <!-- «Нет» — выбираем, чем занят год -->
      <template v-else-if="step === 'reason'">
        <p class="mt-3 text-sm text-muted">
          Тогда весь год будет выходными. Что подходит?
        </p>

        <div class="mt-3 grid grid-cols-2 gap-2">
          <button
            v-for="reason in REASONS"
            :key="reason.mode"
            type="button"
            :disabled="isSaving"
            class="cursor-pointer rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            @click="fill(reason.mode)"
          >
            {{ reason.label }}
          </button>
        </div>

        <div class="mt-4 flex justify-end">
          <button
            type="button"
            :disabled="isSaving"
            class="cursor-pointer rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:text-text"
            @click="step = 'question'"
          >
            Назад
          </button>
        </div>
      </template>

      <!-- Готово -->
      <template v-else>
        <p class="mt-3 text-sm text-text">{{ resultMessage }}</p>

        <div class="mt-4 flex justify-end">
          <button
            type="button"
            class="cursor-pointer rounded-lg border border-border bg-bg px-4 py-2 text-sm text-text transition-colors hover:border-primary"
            @click="emit('close')"
          >
            Понятно
          </button>
        </div>
      </template>

      <p v-if="isSaving" class="mt-3 text-sm text-muted">Заполняем…</p>
      <p v-if="error" class="mt-3 text-sm text-red-600">{{ error }}</p>
    </div>
  </div>
</template>
