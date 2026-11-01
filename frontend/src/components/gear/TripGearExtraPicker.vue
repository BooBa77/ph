<script setup lang="ts">
import { computed, ref } from 'vue'

import type { GearItem } from '@/types/gear'
import { weightInGrams } from '@/utils/gearWeight'

/**
 * Выбор вещи для кнопки «Добавить ещё» (01.11.2026).
 *
 * Заказчик: «Добавить на всех секциях (Палатки, Готовка (3 шт), Спальник)
 * кнопку „Добавить ещё“. По этой кнопке выбор из личного снаряжения или
 * добавка вручную незабинденного снаряжения. Например, вкладыш в спальник,
 * грелка, губка для мытья посуды. Предлагать в фильтре выбора сначала
 * соответствующую группу, но вообще, может хоть лодку выбрать. Кнопка
 * всегда белая».
 *
 * Отсюда три правила компонента:
 *
 * 1. **Список — весь личный каталог**, а не только типы секции: фильтра
 *    по типу здесь нет вовсе («может хоть лодку выбрать»). Вещь, которая
 *    уже в походе, не предлагается: второй раз её не добавят (409).
 * 2. **Сначала — соответствующая полка.** `preferredGroupCodes` — полки
 *    секции (у «Палаток» это «Кров», у «Кострового» — «Костровое»);
 *    остальные идут после, и внутри полки первыми стоят вещи типов секции.
 *    Порядок влияет только на показ: выбрать можно что угодно.
 * 3. **Компонент не сохраняет.** Выбранную вещь и «Указать вручную» он
 *    отдаёт событиями: сохраняет секция, потому что у «Палаток» это
 *    снаряжение похода, а у «Спальника» — личная строка ночёвки, и пути
 *    у них разные.
 *
 * Поиск — по названию, типу и полке: каталог бывает длинным, а человек
 * помнит слово («котёл», «спальник»), а не полку.
 */
const props = defineProps<{
  /** Весь личный каталог: `GET /api/gear`. */
  items: readonly GearItem[]
  /** Что уже в походе: повторно не предлагаем. */
  excludeIds?: readonly string[]
  /** Полки секции — их показываем первыми, в этом порядке. */
  preferredGroupCodes?: readonly string[]
  /** Типы секции — они стоят первыми внутри любой полки. */
  preferredTypeCodes?: readonly string[]
  /** Заголовок модалки: «Добавить ещё» у всех секций один и тот же. */
  title?: string
  /** Каталог ещё едет: показываем «Загружаем…», а не пустой список. */
  loading?: boolean
}>()

const emit = defineEmits<{
  /** Вещь выбрали: сохраняет родитель. */
  pick: [item: GearItem]
  /** Вещи нет в каталоге — открываем «Указать вручную». */
  manual: []
  close: []
}>()

const search = ref('')

/** Что можно предложить: всё, кроме уже добавленного в поход. */
const available = computed(() => {
  const taken = new Set(props.excludeIds ?? [])

  return props.items.filter((item) => !taken.has(item.id))
})

/** Полка в списке: её имя и вещи в нужном порядке. */
interface PickerGroup {
  code: string
  name: string
  items: GearItem[]
}

/**
 * Порядок полок: сначала «свои» полки секции, потом остальные.
 *
 * `indexOf` по двум спискам, а не `sort` по имени: порядок, который задал
 * заказчик («сначала соответствующую группу»), важнее алфавита.
 */
function groupRank(code: string): number {
  const preferred = props.preferredGroupCodes ?? []
  const index = preferred.indexOf(code)

  return index === -1 ? preferred.length : index
}

function typeRank(typeCode: string): number {
  const preferred = props.preferredTypeCodes ?? []
  const index = preferred.indexOf(typeCode)

  return index === -1 ? preferred.length : index
}

/** Отфильтровано поиском: название, тип и полка — три слова человека. */
const filtered = computed<GearItem[]>(() => {
  const query = search.value.trim().toLowerCase()

  if (query === '') return [...available.value]

  return available.value.filter((item) =>
    [item.title, item.typeName, item.groupName].some((field) =>
      field.toLowerCase().includes(query),
    ),
  )
})

/** Каталог полками — как «Снаряжение» в профиле и выбор вещи в чек-листах. */
const groups = computed<PickerGroup[]>(() => {
  const byCode = new Map<string, PickerGroup>()

  for (const item of filtered.value) {
    const group = byCode.get(item.groupCode) ?? {
      code: item.groupCode,
      name: item.groupName,
      items: [],
    }

    group.items.push(item)
    byCode.set(item.groupCode, group)
  }

  return [...byCode.values()]
    .sort(
      (left, right) =>
        groupRank(left.code) - groupRank(right.code) ||
        left.name.localeCompare(right.name, 'ru'),
    )
    .map((group) => ({
      ...group,
      items: [...group.items].sort(
        (left, right) =>
          typeRank(left.typeCode) - typeRank(right.typeCode) ||
          left.title.localeCompare(right.title, 'ru'),
      ),
    }))
})

/** Строка вещи: «Котёл 5 л · Котёл · 900 гр.». */
function itemText(item: GearItem): string {
  const weight = weightInGrams(item.weightGrams)
  const head = item.title === item.typeName ? item.title : `${item.title} · ${item.typeName}`

  return weight === null ? head : `${head} · ${weight}`
}

/** Нажали на вещь: выбор отдаём секции. */
function pick(item: GearItem): void {
  emit('pick', item)
}
</script>

<template>
  <div
    class="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4"
    data-test="route-extra-picker"
  >
    <div
      class="flex w-full max-w-lg flex-col gap-3 rounded-xl border border-border bg-surface p-4"
    >
      <div class="flex flex-col gap-1">
        <h3 class="text-base font-medium text-text">{{ title ?? 'Добавить ещё' }}</h3>
        <p class="text-xs text-muted">
          Любая вещь из личного снаряжения или новая вручную — сначала показаны
          подходящие полки.
        </p>
      </div>

      <label class="flex flex-col gap-1 text-xs text-muted">
        Поиск
        <input
          v-model="search"
          type="search"
          class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
          placeholder="Название, тип или полка"
          data-test="route-extra-search"
        />
      </label>

      <p v-if="loading" class="text-sm text-muted" data-test="route-extra-loading">
        Загружаем снаряжение…
      </p>

      <p
        v-else-if="available.length === 0"
        class="text-sm text-muted"
        data-test="route-extra-empty"
      >
        В личном снаряжении ничего не осталось — заведите вещь вручную.
      </p>

      <p
        v-else-if="filtered.length === 0"
        class="text-sm text-muted"
        data-test="route-extra-not-found"
      >
        Поиск ничего не нашёл — попробуйте другое слово или заведите вещь вручную.
      </p>

      <div v-else class="flex flex-col gap-3">
        <div
          v-for="group in groups"
          :key="group.code"
          class="flex flex-col gap-1"
          :data-test="`route-extra-group-${group.code}`"
        >
          <span class="text-xs text-muted">{{ group.name }}</span>

          <button
            v-for="item in group.items"
            :key="item.id"
            type="button"
            class="cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-left text-sm text-text transition-colors hover:border-primary"
            :data-test="`route-extra-item-${item.id}`"
            @click="pick(item)"
          >
            {{ itemText(item) }}
          </button>
        </div>
      </div>

      <!--
        Вещи нет в каталоге — тот же путь, что «Указать вручную» в диалогах
        кнопок: губка для посуды, вкладыш в спальник. Форма общая.
      -->
      <button
        type="button"
        class="cursor-pointer self-start border-0 bg-transparent p-0 text-sm text-primary underline transition-opacity hover:opacity-80"
        data-test="route-extra-manual"
        @click="emit('manual')"
      >
        Указать вручную
      </button>

      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary"
          data-test="route-extra-cancel"
          @click="emit('close')"
        >
          Отмена
        </button>
      </div>
    </div>
  </div>
</template>
