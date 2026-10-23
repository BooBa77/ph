<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'

import { createProduct, searchProducts } from '@/api/meals'
import { PRODUCT_UNIT_LABELS, type Product } from '@/types/meals'

/**
 * Поиск продукта в справочнике: поле ввода и список найденного.
 *
 * Как у выбора объекта: **при пустом поле список пуст**. Справочник
 * не листают целиком — в нём десятки позиций, и простыня из них
 * не помогает выбрать, а мешает.
 *
 * **Своего продукта в справочнике может не быть** — шоколад, бабушкино
 * варенье, самодельный сухарь. «Ничего не нашлось» здесь было бы тупиком:
 * поэтому вместо него — «Добавить „Шоколад“», и продукт заводится с нулевым
 * весом (граммы по нему не считаются, но в раскладке он живёт).
 *
 * Компонент общий для блюда в кулинарной книге и для раскладки: там тот же
 * поиск, и копия разошлась бы задержкой и поведением.
 */
const props = withDefaults(
  defineProps<{
    /** Подсказка в поле ввода. */
    placeholder?: string
    /** Выбранный продукт: поле показывает его и сбрасывается вместе с ним. */
    product?: Product | null
  }>(),
  { placeholder: 'Введите название продукта', product: null },
)

const emit = defineEmits<{
  /** Выбран продукт. Поле показывает его название, чтобы выбор был виден. */
  select: [product: Product]
}>()

/** Пауза перед поиском: на каждую букву ходить в справочник незачем. */
const SEARCH_DELAY_MS = 300

const query = ref('')
const options = ref<Product[]>([])
const isLoading = ref(false)
const isCreating = ref(false)
const error = ref<string | null>(null)

let searchTimer: ReturnType<typeof setTimeout> | undefined
/** После выбора поле заполняется названием — искать его заново не надо. */
let skipNextSearch = false

async function search() {
  const text = query.value.trim()

  if (text.length === 0) {
    options.value = []
    error.value = null
    return
  }

  isLoading.value = true
  error.value = null

  try {
    options.value = await searchProducts(text)
  } catch {
    error.value = 'Не удалось загрузить справочник'
    options.value = []
  } finally {
    isLoading.value = false
  }
}

watch(query, () => {
  if (skipNextSearch) {
    skipNextSearch = false

    return
  }

  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(search, SEARCH_DELAY_MS)
})

watch(
  () => props.product,
  (product) => {
    if (!product) {
      query.value = ''
      options.value = []

      return
    }
    if (query.value !== product.name) {
      skipNextSearch = true
      query.value = product.name
      options.value = []
    }
  },
)

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

function choose(product: Product) {
  emit('select', product)
  skipNextSearch = true
  query.value = product.name
  options.value = []
}

/** Свой продукт: вес единицы 0, граммы по нему не считаются. */
async function createCustom() {
  const name = query.value.trim()
  if (name.length === 0) return

  isCreating.value = true
  error.value = null

  try {
    choose(await createProduct({ name, unit: 'piece' }))
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : 'Не удалось добавить продукт'
  } finally {
    isCreating.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <input
      v-model="query"
      type="search"
      :placeholder="props.placeholder"
      class="w-full rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors focus:border-primary focus:outline-none"
      data-test="product-search"
    />

    <p v-if="error" class="text-xs text-red-600">{{ error }}</p>

    <ul
      v-else-if="isLoading || options.length > 0"
      class="max-h-48 overflow-y-auto rounded-xl border border-border"
      data-test="product-options"
    >
      <li v-if="isLoading" class="px-3 py-1.5 text-xs text-muted">Ищем…</li>
      <li v-for="product in options" v-else :key="product.id">
        <button
          type="button"
          class="w-full cursor-pointer px-3 py-1.5 text-left text-sm text-text transition-colors hover:bg-bg"
          data-test="product-option"
          @click="choose(product)"
        >
          {{ product.name }}
          <span class="text-xs text-muted">
            · {{ PRODUCT_UNIT_LABELS[product.unit] }},
            {{ product.weightPerUnitGrams }} г
          </span>
        </button>
      </li>
    </ul>

    <button
      v-else-if="query.trim().length > 0"
      type="button"
      class="cursor-pointer rounded-xl border border-dashed border-border px-3 py-1.5 text-left text-xs text-muted transition-colors hover:border-primary hover:text-text"
      :disabled="isCreating"
      data-test="product-create"
      @click="createCustom"
    >
      {{ isCreating ? 'Добавляем…' : `Добавить «${query.trim()}» — нет в справочнике` }}
    </button>
  </div>
</template>
