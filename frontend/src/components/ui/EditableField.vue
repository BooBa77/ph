<script setup lang="ts">
import { nextTick, onUnmounted, ref } from 'vue'
import { useAppStore } from '@/stores/app'

const props = withDefaults(
  defineProps<{
    /** Метка поля («Имя пользователя», «Город»). */
    label: string
    /** Текущее значение. Пустая строка — показываем placeholder. */
    modelValue: string
    /** Можно ли редактировать. Если false — поле выглядит как обычный текст. */
    editable?: boolean
    /** Подсказка в input, когда значение пустое. */
    placeholder?: string
    /** Минимальная длина (валидация на клиенте перед отправкой). */
    minLength?: number
    /** Максимальная длина. */
    maxLength?: number
  }>(),
  {
    editable: true,
    placeholder: '',
  },
)

const emit = defineEmits<{
  /** Юзер ввёл новое значение и подтвердил (Enter / blur). */
  save: [value: string]
}>()

/**
 * Счётчик занятости. Пока он больше нуля, PWA не применяет обновление:
 * перезагрузка страницы посреди правки стёрла бы введённое.
 * Разбор — в stores/app.ts и composables/useSwUpdate.ts.
 */
const appStore = useAppStore()

/** Находимся ли в режиме редактирования. */
const isEditing = ref(false)

/** Что в input. Инициализируется при входе в режим редактирования. */
const draftValue = ref('')

/** Ссылка на input — чтобы вызвать .focus() после активации. */
const inputRef = ref<HTMLInputElement | null>(null)

/**
 * Начать редактирование.
 * Сохраняем текущее значение в draft, включаем режим,
 * на следующем тике фокусируемся на input.
 */
async function startEdit() {
  if (!props.editable) return
  draftValue.value = props.modelValue
  isEditing.value = true
  appStore.setBusy(true)

  // nextTick — ждём, пока Vue отрисует input (он появляется через v-if).
  // Без nextTick inputRef будет null.
  await nextTick()
  inputRef.value?.focus()
  inputRef.value?.select()
}

/**
 * Отменить редактирование.
 * Возврат к исходному значению без сохранения.
 */
function cancelEdit() {
  isEditing.value = false
  draftValue.value = ''
  appStore.setBusy(false)
}

/**
 * Сохранить.
 * Валидируем, эмитим save. Родитель решает, что делать (звать API или нет).
 *
 * Не выходим из режима редактирования сразу — родитель должен
 * подтвердить успех. Но у нас нет «спиннера ожидания», поэтому
 * выходим сразу: если родитель вернёт ошибку — она покажется в родителе.
 * (Позже можно переделать на controlled-режим.)
 */
function saveEdit() {
  const trimmed = draftValue.value.trim()

  // Не сохраняем, если значение не изменилось — экономим запрос.
  if (trimmed === props.modelValue) {
    cancelEdit()
    return
  }

  // Клиентская валидация — быстрая проверка до отправки на бэк.
  if (props.minLength !== undefined && trimmed.length < props.minLength) {
    // Не выходим из редактирования — юзер увидит проблему сразу.
    // Просто не сохраняем, оставляем в input.
    return
  }
  if (props.maxLength !== undefined && trimmed.length > props.maxLength) {
    return
  }

  // Пустую строку — не отправляем. Для location это значит «не менять»,
  // для displayName — «нельзя очистить». Отправка пустой строки — ошибка.
  if (trimmed === '' && props.modelValue !== '') {
    return
  }

  emit('save', trimmed)
  isEditing.value = false
  appStore.setBusy(false)
}

/**
 * Страховка от «залипшего» счётчика.
 *
 * Если компонент размонтируют прямо во время правки (например, ушли
 * на другой роут), освободить занятость больше некому — а пока счётчик
 * больше нуля, PWA-обновление не применится никогда.
 */
onUnmounted(() => {
  if (isEditing.value) appStore.setBusy(false)
})

/** Enter — сохранить, Escape — отменить. */
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    saveEdit()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    cancelEdit()
  }
}
</script>

<template>
  <div class="flex flex-col gap-1 py-3 md:flex-row md:items-start md:gap-6">
    <div class="text-sm text-muted md:w-48 md:shrink-0 md:pt-2">
      {{ label }}
    </div>

    <div class="min-w-0 flex-1">
      <!-- Режим просмотра -->
      <button
        v-if="!isEditing"
        type="button"
        :disabled="!editable"
        class="w-full cursor-pointer rounded-xl border border-border bg-bg px-3 py-2 text-left text-base text-text transition-colors hover:border-primary disabled:cursor-default disabled:hover:border-border"
        @click="startEdit"
      >
        <span v-if="modelValue">{{ modelValue }}</span>
        <span v-else class="text-muted">—</span>
      </button>

      <!-- Режим редактирования -->
      <input
        v-else
        ref="inputRef"
        v-model="draftValue"
        type="text"
        :placeholder="placeholder"
        :maxlength="maxLength"
        class="w-full rounded border border-primary bg-surface px-3 py-2 text-base text-text outline-none"
        @keydown="onKeydown"
        @blur="saveEdit"
      />
    </div>
  </div>
</template>