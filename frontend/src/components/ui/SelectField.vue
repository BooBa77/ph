<script setup lang="ts" generic="T extends string">
import { computed, useId } from 'vue'

/**
 * Строка «подпись — выпадающий список» для профиля.
 *
 * Для отображения спортивного опыта: девятнадцать одинаковых строк,
 * и копировать разметку с классами девятнадцать раз — гарантированные
 * расхождения. Разметка та же, что у `EditableField`: подпись слева,
 * поле справа, тот же ритм отступов.
 *
 * Отличие в моменте сохранения: `EditableField` ждёт Enter или потери
 * фокуса, а список сохраняет сразу на `change` — выбирать из списка
 * значит уже подтвердить выбор, отдельной кнопки «сохранить» нет нигде
 * в профиле.
 *
 * Компонент generic: списки вариантов типизированы (`AlpinismRank`,
 * `MountainCategory`), и `change` отдаёт ровно тот же union, а не `string`.
 */
const props = withDefaults(
  defineProps<{
    /** Подпись слева. */
    label: string
    /** Текущее значение: вариант из `options` или null («нет»). */
    modelValue: T | null
    /** Список вариантов. Значение — оно же подпись: это разряды и категории. */
    options: readonly T[]
    /** Подпись пустого варианта. */
    emptyLabel?: string
  }>(),
  {
    emptyLabel: '— нет —',
  },
)

const emit = defineEmits<{
  /** Пользователь выбрал значение. null — вернулся к пустому варианту. */
  change: [value: T | null]
}>()

/**
 * id связывает `<label>` со `<select>`.
 *
 * useId(), а не счётчик: компонент рендерится в цикле, и одинаковые id
 * у девятнадцати списков сломали бы и клик по подписи, и тесты.
 */
const id = useId()

/**
 * v-model для списка. У `<select>` пустой вариант — пустая строка,
 * а наружу уходит null: бэкенд различает «очистить поле» и «не трогать».
 */
const value = computed({
  get: () => props.modelValue ?? '',
  set: (next: string) => emit('change', next === '' ? null : (next as T)),
})
</script>

<template>
  <div class="flex flex-col gap-1 py-3 md:flex-row md:items-center md:gap-6">
    <label :for="id" class="text-sm text-muted md:w-48 md:shrink-0">
      {{ label }}
    </label>

    <select
      :id="id"
      v-model="value"
      class="w-full cursor-pointer rounded-xl border border-border bg-bg px-3 py-2 text-base text-text transition-colors hover:border-primary focus:border-primary focus:outline-none md:max-w-sm"
    >
      <option value="">{{ emptyLabel }}</option>
      <option v-for="option in options" :key="option" :value="option">
        {{ option }}
      </option>
    </select>
  </div>
</template>
