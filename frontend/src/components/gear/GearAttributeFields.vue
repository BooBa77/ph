<script setup lang="ts">
import { useId } from 'vue'

import type { GearAttributeDrafts } from '@/utils/gearAttributes'
import type { GearTypeAttribute } from '@/types/gearTypes'

/**
 * Поля характеристик выбранного типа снаряжения.
 *
 * Характеристики — **данные**: их набор задаёт админ в `/admin/gear`, поэтому
 * форма собирается из ответа `GET /api/gear-types`, а не из списка в коде.
 * Один компонент на два места — форма нового предмета и правка значений
 * у существующего: поле, нарисованное дважды, разошлось бы на первой правке
 * (например, галочка в одном месте ставилась бы, а в другом нет).
 *
 * **Вид значения задаёт поле**: число — `type="number"`, строка — текст,
 * галочка — чекбокс, список — `select` с вариантами. У списка, которому
 * разрешено своё значение, рядом стоит текстовое поле — и список, и текст
 * пишут в одно значение: у списка хранится не код варианта, а его имя
 * (так решил бэкенд в Stage B), и различать «выбрал» и «вписал» незачем.
 *
 * Наружу компонент отдаёт **черновик**: строки и `boolean`, без разбора
 * чисел. Разбор и проверка обязательных — в `buildGearAttributes`, потому
 * что там же собирается карта для запроса.
 */
const props = withDefaults(
  defineProps<{
    /** Характеристики выбранного типа в порядке показа. */
    attributes: readonly GearTypeAttribute[]
    /** Текущие значения: код характеристики → строка или галочка. */
    modelValue: GearAttributeDrafts
    /**
     * Префикс id и `data-test`.
     *
     * Нужен потому, что форма на странице не одна: при открытой правке
     * в дереве стоят поля и нового предмета, и правки, а одинаковые id
     * сломали бы и подписи, и тесты.
     */
    prefix: string
    disabled?: boolean
  }>(),
  { disabled: false },
)

const emit = defineEmits<{
  'update:modelValue': [value: GearAttributeDrafts]
}>()

/**
 * id полей — через `useId()`, как в `SelectField`.
 *
 * Порядковый номер внутри компонента был бы проще, но при двух формах
 * на странице счётчики не связаны между собой.
 */
const uid = useId()

function fieldId(code: string): string {
  return `${props.prefix}-${code}-${uid}`
}

function text(code: string): string {
  const value = props.modelValue[code]

  return typeof value === 'boolean' ? '' : (value ?? '')
}

function flag(code: string): boolean {
  return props.modelValue[code] === true
}

/**
 * Значение для `<select>`: только известный вариант, иначе пустая строка.
 *
 * У списка с разрешённым своим значением в поле может лежать текст, которого
 * в вариантах нет — тогда список показывает пустой пункт, а текст остаётся
 * в соседнем поле ввода и не теряется.
 */
function optionOf(attribute: GearTypeAttribute): string {
  const value = text(attribute.code)
  const names = attribute.options.map((option) => option.name)

  return names.includes(value) ? value : ''
}

function set(code: string, value: string | boolean): void {
  emit('update:modelValue', { ...props.modelValue, [code]: value })
}

function setText(code: string, event: Event): void {
  set(code, (event.target as HTMLInputElement).value)
}

function setChecked(code: string, event: Event): void {
  set(code, (event.target as HTMLInputElement).checked)
}
</script>

<template>
  <div class="grid gap-3 sm:grid-cols-2" data-test="attribute-fields">
    <div v-for="attribute in attributes" :key="attribute.code" class="flex flex-col gap-1">
      <!--
        Список рисуем отдельно от подписи: у него поле ввода — `select`,
        а для галочки подпись справа от поля, а не сверху (иначе чекбокс
        отрывается от своего названия).
      -->
      <template v-if="attribute.valueKind === 'bool'">
        <label class="flex items-center gap-2 text-sm text-text">
          <input
            :id="fieldId(attribute.code)"
            type="checkbox"
            :checked="flag(attribute.code)"
            :disabled="disabled"
            class="h-4 w-4 cursor-pointer accent-primary disabled:cursor-not-allowed"
            :data-test="`${prefix}-${attribute.code}`"
            @change="setChecked(attribute.code, $event)"
          />
          <span>
            {{ attribute.name }}
            <span v-if="attribute.isRequired" class="text-red-600" title="обязательно">*</span>
          </span>
        </label>
      </template>

      <template v-else>
        <label :for="fieldId(attribute.code)" class="text-xs text-muted">
          {{ attribute.name }}
          <span v-if="attribute.unit" class="text-muted">({{ attribute.unit }})</span>
          <span v-if="attribute.isRequired" class="text-red-600" title="обязательно">*</span>
        </label>

        <select
          v-if="attribute.valueKind === 'select'"
          :id="fieldId(attribute.code)"
          :value="optionOf(attribute)"
          :disabled="disabled"
          class="w-full cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors hover:border-primary focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          :data-test="`${prefix}-${attribute.code}`"
          @change="setText(attribute.code, $event)"
        >
          <option value="">—</option>
          <option v-for="option in attribute.options" :key="option.id" :value="option.name">
            {{ option.name }}
          </option>
        </select>

        <input
          v-else
          :id="fieldId(attribute.code)"
          :type="attribute.valueKind === 'number' ? 'number' : 'text'"
          :value="text(attribute.code)"
          :disabled="disabled"
          :inputmode="attribute.valueKind === 'number' ? 'decimal' : undefined"
          class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors hover:border-primary focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          :data-test="`${prefix}-${attribute.code}`"
          @input="setText(attribute.code, $event)"
        />

        <!--
          Своё значение у списка: тот же смысл, что у выбранного варианта
          (бэкенд хранит имя), поэтому оба поля пишут в одно значение.
        -->
        <input
          v-if="attribute.valueKind === 'select' && attribute.allowCustomValue"
          type="text"
          :value="text(attribute.code)"
          :disabled="disabled"
          placeholder="или своё значение"
          class="w-full rounded-xl border border-dashed border-border bg-field px-3 py-2 text-base text-text transition-colors hover:border-primary focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          :data-test="`${prefix}-${attribute.code}-custom`"
          @input="setText(attribute.code, $event)"
        />
      </template>

      <p v-if="attribute.valueKind === 'bool' && attribute.isRequired" class="text-xs text-muted">
        Галочка: «нет» — тоже ответ.
      </p>
    </div>
  </div>
</template>
