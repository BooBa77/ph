<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import MarkdownEditor from '@/components/ui/MarkdownEditor.vue'

/**
 * «Воспоминание» — инструмент-чат для записи в альманах (22.11.2026).
 *
 * Заказчик: «Запись создаётся/редактируется инструментом-чатом, календарик
 * и указание дня в нём не нужны». Отсюда два правила интерфейса:
 *
 * - **внутри нет выбора дня**. Место вставки человек выбрал кнопкой
 *   в секции (до похода / день / в конце), и сюда оно не переезжает:
 *   повторное «какой это день» только путало бы;
 * - **редактор как в чате**: одна рамка, поле ввода и «Отправить».
 *   Никаких форм с датами и заголовками.
 *
 * Модалка — как у чек-листа покупок: затемнение, Escape, клик мимо карточки.
 */
const props = defineProps<{
  /** Начальный текст: пусто — создание, иначе дописывание. */
  initialBody?: string
  /** Идёт отправка: кнопка гаснет, закрытие не мешает. */
  busy?: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  save: [body: string]
  close: []
}>()

const draft = ref(props.initialBody ?? '')

function save(): void {
  const body = draft.value.trim()
  if (body.length === 0 || props.busy) return

  emit('save', body)
}

/** Escape закрывает: привычка из остальных модалок проекта. */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="almanac-memory-title"
    data-test="almanac-memory-modal"
    @click.self="emit('close')"
  >
    <div class="flex w-full max-w-lg flex-col gap-3 rounded-2xl bg-surface p-4 shadow-xl">
      <div class="flex items-baseline justify-between gap-2">
        <h2 id="almanac-memory-title" class="text-lg font-semibold text-text">
          Воспоминание
        </h2>

        <button
          type="button"
          class="cursor-pointer text-xs text-muted underline transition-colors hover:text-text"
          data-test="almanac-memory-close"
          @click="emit('close')"
        >
          Закрыть
        </button>
      </div>

      <p v-if="error" class="text-sm text-red-600" data-test="almanac-memory-error">
        {{ error }}
      </p>

      <form class="flex flex-col gap-2" @submit.prevent="save">
        <MarkdownEditor
          v-model="draft"
          :objects="false"
          :emoji="true"
          min-height="8rem"
          placeholder="Как это было…"
          data-test="almanac-memory-input"
        />

        <button
          type="button"
          class="self-end cursor-pointer rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!draft.trim() || busy"
          data-test="almanac-memory-save"
          @click="save"
        >
          {{ initialBody ? 'Дописать' : 'Отправить' }}
        </button>
      </form>
    </div>
  </div>
</template>
