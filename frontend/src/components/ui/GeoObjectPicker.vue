<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'

import { listObjects } from '@/api/objects'
import { geoObjectLabel, type GeoObject } from '@/types/trips'

/**
 * Поиск объекта в справочнике: поле ввода и список найденного.
 *
 * **При пустом поле список пуст.** Показывать весь справочник нельзя:
 * в нём сотни объектов, они не помещаются на экран, и выбрать из них
 * невозможно — это не выбор, а простыня. Пустой запрос означает отсутствие
 * ответа, а не «покажи всё»; подсказка под полем говорит, что делать.
 *
 * Общий компонент для двух мест формы: выбора цели и вставки объекта
 * в маршрут. Разметка и поведение там одинаковые, а копия через месяц
 * разойдётся — в одном месте появится задержка поиска, в другом нет.
 */
withDefaults(
  defineProps<{
    /** Подпись поля. */
    label?: string
    /** Подсказка в поле ввода. */
    placeholder?: string
  }>(),
  {
    label: '',
    placeholder: 'Начните вводить название — например, Витязь',
  },
)

const emit = defineEmits<{
  /** Выбран объект. Поле после выбора очищается. */
  select: [object: GeoObject]
}>()

/** Пауза перед поиском: на каждую букву ходить в справочник незачем. */
const SEARCH_DELAY_MS = 300

const query = ref('')
const options = ref<GeoObject[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)

let searchTimer: ReturnType<typeof setTimeout> | undefined

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
    options.value = await listObjects(text)
  } catch {
    error.value = 'Не удалось загрузить справочник'
    options.value = []
  } finally {
    isLoading.value = false
  }
}

watch(query, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(search, SEARCH_DELAY_MS)
})

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

/** Выбрали объект: отдаём наружу и очищаем поле. */
function choose(object: GeoObject) {
  emit('select', object)
  query.value = ''
  options.value = []
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <label v-if="label" class="text-sm text-muted">{{ label }}</label>

    <input
      v-model="query"
      type="search"
      :placeholder="placeholder"
      class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
      data-test="object-search"
    />

    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

    <ul
      v-else-if="isLoading || options.length > 0"
      class="max-h-64 overflow-y-auto rounded-xl border border-border"
      data-test="object-options"
    >
      <li v-if="isLoading" class="px-3 py-2 text-sm text-muted">Ищем…</li>
      <li v-for="object in options" v-else :key="object.id">
        <button
          type="button"
          class="w-full cursor-pointer px-3 py-2 text-left text-sm text-text transition-colors hover:bg-bg"
          data-test="object-option"
          @click="choose(object)"
        >
          {{ geoObjectLabel(object) }}
          <span class="text-muted">· {{ object.type }}</span>
        </button>
      </li>
    </ul>

    <p
      v-else-if="query.trim().length > 0 && !isLoading"
      class="text-sm text-muted"
      data-test="object-nothing"
    >
      Ничего не нашлось
    </p>
  </div>
</template>
