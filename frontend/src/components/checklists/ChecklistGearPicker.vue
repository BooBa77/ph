<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

import { ApiError } from '@/api/errors'
import { listGear } from '@/api/gear'
import type { GearItem } from '@/types/gear'
import { formatWeight } from '@/utils/gearWeight'

/**
 * Выбор вещи из личного снаряжения для пункта чек-листа (31.10.2026).
 *
 * Заказчик: «В списки можно добавлять свободный текст и, что усложняет,
 * указание конкретного экземпляра снаряжения». Список вещей человек уже
 * видел в «Снаряжении», поэтому здесь он не заводит вещь заново, а выбирает
 * ту, которая у него есть: тип и вес приедут из каталога, а в походе пункт
 * будет ссылаться на экземпляр, а не на слова.
 *
 * **Полки — как в каталоге.** Секции собраны по группам и в порядке ответа
 * `GET /api/gear`: второй порядок сортировки разошёлся бы с каталогом,
 * и человек искал бы рюкзак не там, где привык.
 *
 * **Поиск по трём словам**: название вещи, имя типа и имя полки. Названия
 * люди пишут по-своему («Палатка Анны», «Рюкзак 60 л»), и искать только
 * по `title` значило бы заставлять вспоминать чужую формулировку.
 *
 * Компонент ничего не пишет: он отдаёт выбранную вещь событием, а решение
 * (новый пункт или замена прежнего) принимает раздел «Чек-листы».
 *
 * **Ошибку привязки показывает модалка, а не страница под затемнением.**
 * `error` приходит пропом от раздела: если сервер отказал, человек должен
 * увидеть причину там, где нажимал, и не терять выбор из-за одного отказа.
 */
const props = defineProps<{ error?: string | null }>()

const emit = defineEmits<{ select: [gear: GearItem]; close: [] }>()

const items = ref<GearItem[]>([])
const isLoading = ref(true)
const error = ref<string | null>(null)
const search = ref('')

const searchInput = ref<HTMLInputElement | null>(null)

/** Вещи после поиска. Пустой запрос — всё, как пришло из каталога. */
const filtered = computed<GearItem[]>(() => {
  const query = search.value.trim().toLowerCase()
  if (query.length === 0) return items.value

  return items.value.filter((item) =>
    [item.title, item.typeName, item.groupName].some((word) =>
      word.toLowerCase().includes(query),
    ),
  )
})

/**
 * Секции по полкам. Порядок полок — порядок первого появления в ответе:
 * сервер уже отдал каталог сгруппированным, и пересортировка здесь
 * развела бы этот список с «Снаряжением».
 */
const sections = computed<Array<{ name: string; items: GearItem[] }>>(() => {
  const order: string[] = []
  const byGroup = new Map<string, GearItem[]>()

  for (const item of filtered.value) {
    const bucket = byGroup.get(item.groupName)
    if (bucket) {
      bucket.push(item)
      continue
    }

    byGroup.set(item.groupName, [item])
    order.push(item.groupName)
  }

  return order.map((name) => ({ name, items: byGroup.get(name) ?? [] }))
})

function subtitle(item: GearItem): string {
  return item.weightGrams === null
    ? item.typeName
    : `${item.typeName} · ${formatWeight(item.weightGrams)}`
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

async function load() {
  isLoading.value = true
  error.value = null

  try {
    items.value = (await listGear()).items
  } catch (cause) {
    error.value =
      cause instanceof ApiError ? cause.message : 'Не удалось загрузить снаряжение.'
  } finally {
    isLoading.value = false
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  await load()
  await nextTick()
  searchInput.value?.focus()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="checklist-gear-title"
    data-test="gear-picker"
    @click.self="emit('close')"
  >
    <div
      class="flex w-full max-w-lg flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-xl"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="flex flex-col gap-1">
          <h3 id="checklist-gear-title" class="text-base font-medium text-text">
            Вещь из снаряжения
          </h3>
          <p class="text-xs text-muted">
            Пункт будет ссылаться на этот экземпляр: тип и вес не придётся писать словами.
            Если вещь удалить из снаряжения, пункт останется текстом её типа.
          </p>
        </div>
        <button
          type="button"
          class="shrink-0 cursor-pointer text-sm text-muted underline transition-colors hover:text-text"
          data-test="gear-close"
          @click="emit('close')"
        >
          Закрыть
        </button>
      </div>

      <p v-if="props.error" class="text-sm text-red-600" data-test="gear-attach-error">
        {{ props.error }}
      </p>

      <input
        ref="searchInput"
        v-model="search"
        type="search"
        placeholder="Поиск: название, тип или полка"
        class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
        data-test="gear-search"
      />

      <p v-if="isLoading" class="text-sm text-muted" data-test="gear-loading">
        Загружаем снаряжение…
      </p>

      <p v-else-if="error" class="text-sm text-red-600" data-test="gear-error">
        {{ error }}
      </p>

      <p
        v-else-if="items.length === 0"
        class="rounded-xl border border-dashed border-border p-4 text-sm text-muted"
        data-test="gear-catalog-empty"
      >
        В снаряжении пока ничего нет. Заведите вещь в
        <RouterLink to="/profile/gear" class="text-primary underline">«Снаряжении»</RouterLink>
        — и она появится здесь.
      </p>

      <p
        v-else-if="filtered.length === 0"
        class="rounded-xl border border-dashed border-border p-4 text-sm text-muted"
        data-test="gear-not-found"
      >
        По запросу «{{ search.trim() }}» ничего не нашлось.
      </p>

      <div v-else class="flex max-h-[60vh] flex-col gap-4 overflow-y-auto" data-test="gear-list">
        <section v-for="section in sections" :key="section.name" class="flex flex-col gap-1">
          <h4 class="text-xs font-medium uppercase tracking-wide text-muted">
            {{ section.name }}
          </h4>

          <button
            v-for="item in section.items"
            :key="item.id"
            type="button"
            class="flex w-full cursor-pointer flex-col gap-0.5 rounded-xl border border-border bg-bg px-3 py-2 text-left transition-colors hover:border-primary"
            data-test="gear-option"
            @click="emit('select', item)"
          >
            <span class="min-w-0 break-words text-sm text-text">{{ item.title }}</span>
            <span class="text-xs text-muted" data-test="gear-option-subtitle">
              {{ subtitle(item) }}
            </span>
          </button>
        </section>
      </div>
    </div>
  </div>
</template>
