<script setup lang="ts">
import ActivityIcon from '@/components/ui/ActivityIcon.vue'
import type { TripTypeOption } from '@/types/trips'

/**
 * Выбор типа похода: крупные чипсы с иконками.
 *
 * **Почему чипсы, а не выпадающий список.** Типов на всю жизнь три-четыре
 * («Пеший поход», «Альпинизм», «Велосипед»), и человек выбирает их глазами
 * по значку, а не поиском в списке. Заказчик назвал это прямо: «крупные
 * чипсы-иконки, которые прокликиваются пальцем» (`trip-tabs.md`).
 * Список тут же пришлось бы делать двухуровневым — тип же лежит в группе
 * «Туризм» общего справочника, — а это лишний клик на три варианта.
 *
 * **Типов может быть несколько**: «пешка + сплав» — норма, а не ошибка
 * ввода. Поэтому это не радио-кнопки, а переключатели: каждое нажатие
 * добавляет или снимает тип.
 *
 * **Иконки берутся из справочника** (`icon`), а не из кода компонента:
 * новый тип заводят строкой в базе, и иконку ему ищут там же. Неизвестный
 * ключ рисуется заглушкой — вопросом в круге.
 *
 * Компонент ничего не знает ни про официальность, ни про «по умолчанию»:
 * правило «у официального тип обязателен» — это проверка формы, а какой
 * тип подставить неофициальному — решает бэкенд (`defaultTypeId`).
 * Здесь только выбор из готового списка.
 */
const props = withDefaults(
  defineProps<{
    /** Что можно выбрать. Пустой список — справочник не загрузился. */
    types: TripTypeOption[]
    /** Выбранные id. Пустой массив — не выбрано ничего. */
    modelValue: number[]
    /** Подпись поля. */
    label?: string
  }>(),
  { label: 'Тип похода' },
)

const emit = defineEmits<{
  'update:modelValue': [value: number[]]
}>()

/** Нажатие по чипсу добавляет тип к выбранным или убирает его. */
function toggle(id: number) {
  const selected = props.modelValue.includes(id)

  emit(
    'update:modelValue',
    selected
      ? props.modelValue.filter((value) => value !== id)
      : [...props.modelValue, id],
  )
}
</script>

<template>
  <fieldset class="flex flex-col gap-2 border-0 p-0" data-test="trip-types">
    <legend class="mb-2 text-sm text-muted">{{ label }}</legend>

    <p v-if="types.length === 0" class="text-xs text-muted" data-test="trip-types-empty">
      Справочник типов не загрузился — обновите страницу.
    </p>

    <div v-else class="flex flex-wrap gap-2">
      <button
        v-for="type in types"
        :key="type.id"
        type="button"
        class="flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors"
        :class="
          modelValue.includes(type.id)
            ? 'border-primary bg-primary/10 font-medium text-text'
            : 'border-border bg-field text-muted hover:border-primary hover:text-text'
        "
        :aria-pressed="modelValue.includes(type.id)"
        :data-test="`trip-type-${type.id}`"
        @click="toggle(type.id)"
      >
        <span class="h-5 w-5 shrink-0">
          <ActivityIcon :name="type.icon" />
        </span>
        {{ type.label }}
      </button>
    </div>

    <span class="text-xs text-muted">
      Можно несколько: «пеший поход + сплав» — обычное дело. У официального похода тип
      обязателен, у неофициального по умолчанию пеший.
    </span>
  </fieldset>
</template>
