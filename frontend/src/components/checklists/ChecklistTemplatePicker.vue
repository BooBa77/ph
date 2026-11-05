<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { ApiError } from '@/api/errors'
import { listTemplates } from '@/api/checklists'
import type { Checklist, ChecklistItem } from '@/types/checklists'
import { formatWeight } from '@/utils/gearWeight'

/**
 * Выбор пунктов из личных чек-листов профиля (05.11.2026).
 *
 * Заказчик: «Чек-листы можно заполнять с нуля, а можно взять значения
 * из личных чек-листов (раздел Чек-листы)». Здесь он видит свои шаблоны
 * и выбирает **пункты**, а не шаблон целиком: из «Кострового для малых
 * групп» можно взять топор и пилу, не беря спички.
 *
 * **Преобразование делает сервер.** В личный список вещь едет конкретным
 * экземпляром («Топор Fixars 1243»), в общий и в рекомендацию — типом
 * («Топор»). Модалка лишь показывает, что человек выбирает, и передаёт
 * `itemIds`; вторая копия правила на клиенте разошлась бы с первой.
 *
 * Выбор не пишется в базу здесь: компонент отдаёт набор событием,
 * а список похода сохраняет `TripGearChecklist`. Так модалку можно
 * закрыть, не создав половину пунктов.
 */
const props = withDefaults(
  defineProps<{
    /** Подпись, чем станут пункты в этом списке. */
    note?: string
  }>(),
  { note: '' },
)

const emit = defineEmits<{ apply: [itemIds: string[]]; close: [] }>()

const templates = ref<Checklist[]>([])
const isLoading = ref(true)
const error = ref<string | null>(null)
const selected = ref<string[]>([])

/** Сколько пунктов в каждом шаблоне выбрано — для кнопки «все / снять». */
function selectedIn(checklist: Checklist): number {
  const ids = new Set(checklist.items.map((item) => item.id))
  return selected.value.filter((id) => ids.has(id)).length
}

const selectedCount = computed(() => selected.value.length)

function isSelected(item: ChecklistItem): boolean {
  return selected.value.includes(item.id)
}

function toggle(item: ChecklistItem) {
  selected.value = isSelected(item)
    ? selected.value.filter((id) => id !== item.id)
    : [...selected.value, item.id]
}

function toggleAll(checklist: Checklist) {
  const ids = checklist.items.map((item) => item.id)

  if (selectedIn(checklist) === ids.length) {
    const remove = new Set(ids)
    selected.value = selected.value.filter((id) => !remove.has(id))
    return
  }

  const already = new Set(selected.value)
  selected.value = [...selected.value, ...ids.filter((id) => !already.has(id))]
}

/** Подпись пункта-ссылки: вещь отличается от свободного текста. */
function subtitle(item: ChecklistItem): string {
  if (!item.gear) return 'свободный текст'

  return item.gear.weightGrams === null
    ? `${item.gear.typeName} · из снаряжения`
    : `${item.gear.typeName} · ${formatWeight(item.gear.weightGrams)} · из снаряжения`
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

async function load() {
  isLoading.value = true
  error.value = null

  try {
    templates.value = await listTemplates()
  } catch (cause) {
    error.value =
      cause instanceof ApiError ? cause.message : 'Не удалось загрузить чек-листы.'
  } finally {
    isLoading.value = false
  }
}

function apply() {
  if (selectedCount.value === 0) return
  emit('apply', [...selected.value])
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  await load()
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
    aria-labelledby="checklist-template-title"
    data-test="template-picker"
    @click.self="emit('close')"
  >
    <div
      class="flex w-full max-w-xl flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-xl"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="flex flex-col gap-1">
          <h3 id="checklist-template-title" class="text-base font-medium text-text">
            Из личных чек-листов
          </h3>
          <p class="text-xs text-muted">
            {{ props.note || 'Выберите пункты, которые нужно добавить в список похода.' }}
          </p>
        </div>
        <button
          type="button"
          class="shrink-0 cursor-pointer text-sm text-muted underline transition-colors hover:text-text"
          data-test="template-close"
          @click="emit('close')"
        >
          Закрыть
        </button>
      </div>

      <p v-if="isLoading" class="text-sm text-muted" data-test="template-loading">
        Загружаем чек-листы…
      </p>

      <p v-else-if="error" class="text-sm text-red-600" data-test="template-error">
        {{ error }}
      </p>

      <p
        v-else-if="templates.length === 0"
        class="rounded-xl border border-dashed border-border p-4 text-sm text-muted"
        data-test="template-empty"
      >
        Личных чек-листов пока нет. Заведите их в разделе «Чек-листы» профиля — и они
        появятся здесь.
      </p>

      <div
        v-else
        class="flex max-h-[55vh] flex-col gap-4 overflow-y-auto"
        data-test="template-list"
      >
        <section
          v-for="checklist in templates"
          :key="checklist.id"
          class="flex flex-col gap-1"
          :data-test="`template-card-${checklist.id}`"
        >
          <div class="flex items-center justify-between gap-2">
            <h4 class="min-w-0 truncate text-sm font-medium text-text">
              {{ checklist.title }}
            </h4>
            <button
              v-if="checklist.items.length > 0"
              type="button"
              class="shrink-0 cursor-pointer text-xs text-muted underline transition-colors hover:text-text"
              :data-test="`template-all-${checklist.id}`"
              @click="toggleAll(checklist)"
            >
              {{ selectedIn(checklist) === checklist.items.length ? 'Снять все' : 'Выбрать все' }}
            </button>
          </div>

          <p v-if="checklist.items.length === 0" class="text-xs text-muted">
            В шаблоне пока нет пунктов.
          </p>

          <label
            v-for="item in checklist.items"
            :key="item.id"
            class="flex cursor-pointer items-start gap-2 rounded-xl border border-border bg-bg px-3 py-2 transition-colors hover:border-primary"
            :data-test="`template-item-${item.id}`"
          >
            <input
              type="checkbox"
              class="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              :checked="isSelected(item)"
              @change="toggle(item)"
            />
            <span class="min-w-0 flex-1">
              <span class="block break-words text-sm text-text">
                {{ item.gear ? item.gear.title : item.title }}
              </span>
              <span class="block text-xs text-muted">{{ subtitle(item) }}</span>
            </span>
          </label>
        </section>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-xs text-muted" data-test="template-selected">
          Выбрано: {{ selectedCount }}
        </p>

        <div class="flex gap-2">
          <button
            type="button"
            class="cursor-pointer rounded-xl border border-border px-3 py-2 text-sm text-muted transition-colors hover:text-text"
            data-test="template-cancel"
            @click="emit('close')"
          >
            Отмена
          </button>
          <button
            type="button"
            :disabled="selectedCount === 0"
            class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            data-test="template-apply"
            @click="apply"
          >
            Добавить выбранные
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
