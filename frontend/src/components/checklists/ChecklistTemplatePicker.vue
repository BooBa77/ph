<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { ApiError } from '@/api/errors'
import { listTemplates } from '@/api/checklists'
import type { Checklist, ChecklistItem } from '@/types/checklists'
import { formatWeight } from '@/utils/gearWeight'

/**
 * Выбор чек-листа из личных шаблонов профиля (05.11.2026).
 *
 * Заказчик: «Чек-листы можно заполнять с нуля, а можно взять значения
 * из личных чек-листов (раздел Чек-листы)».
 *
 * **Выбирается чек-лист, а не отдельные пункты** (05.11.2026). Заказчик:
 * «чек-листы должны быть раскрываемыми. И по умолчанию модалка отображает
 * свёрнутые чек-листы… Выбираем чек-лист, а не позиции, можно частично
 * прочеканный, но из одного чек-листа». Поэтому: все чек-листы свёрнуты,
 * чекбокс в заголовке выбирает чек-лист **целиком**, а развернув его, можно
 * снять лишние пункты. Чек-лист всегда один: выбор другого снимает прежний —
 * иначе «взять из чек-листа» стало бы «набрать из нескольких», а это уже
 * другой экран с другими правилами (повторы, порядок, чужие наименования).
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

/** Выбранный чек-лист: он может быть только один. */
const selectedChecklistId = ref<string | null>(null)

/** Выбранные пункты — всегда из выбранного чек-листа. */
const selected = ref<string[]>([])

/** Развёрнутые чек-листы; по умолчанию все свёрнуты. */
const expandedIds = ref<string[]>([])

/** Выбранный чек-лист — для подписи «Выбрано: 2 · „Костровое“». */
const chosen = computed(
  () => templates.value.find((checklist) => checklist.id === selectedChecklistId.value) ?? null,
)

const selectedCount = computed(() => selected.value.length)

function isExpanded(checklist: Checklist): boolean {
  return expandedIds.value.includes(checklist.id)
}

function isChosen(checklist: Checklist): boolean {
  return selectedChecklistId.value === checklist.id
}

/** Сколько пунктов этого чек-листа выбрано. */
function selectedIn(checklist: Checklist): number {
  const ids = new Set(checklist.items.map((item) => item.id))
  return selected.value.filter((id) => ids.has(id)).length
}

/** Чек-лист выбран целиком: галочка в заголовке стоит. */
function isFull(checklist: Checklist): boolean {
  return (
    isChosen(checklist) &&
    checklist.items.length > 0 &&
    selectedIn(checklist) === checklist.items.length
  )
}

/** Часть пунктов снята: галочка в заголовке «неполная». */
function isPartial(checklist: Checklist): boolean {
  if (!isChosen(checklist)) return false

  const count = selectedIn(checklist)
  return count > 0 && count < checklist.items.length
}

function isSelected(item: ChecklistItem): boolean {
  return selected.value.includes(item.id)
}

/** Выбрать чек-лист целиком: все его пункты становятся отмеченными. */
function chooseAll(checklist: Checklist): void {
  selectedChecklistId.value = checklist.id
  selected.value = checklist.items.map((item) => item.id)
}

function clearSelection(): void {
  selectedChecklistId.value = null
  selected.value = []
}

/** Чекбокс в заголовке: выбрал — все пункты, снял — пусто. */
function toggleChecklist(checklist: Checklist): void {
  if (isChosen(checklist)) clearSelection()
  else chooseAll(checklist)
}

/**
 * Развернуть чек-лист. Разворот означает выбор: заказчик сказал «выбираешь
 * чек-лист, все позиции в true», и отдельное «развернул, но не выбрал»
 * заставляло бы нажимать дважды.
 */
function toggleExpanded(checklist: Checklist): void {
  if (isExpanded(checklist)) {
    expandedIds.value = expandedIds.value.filter((id) => id !== checklist.id)
    return
  }

  expandedIds.value = [...expandedIds.value, checklist.id]

  // Пустой шаблон развернуть можно, выбрать — нечего.
  if (!isChosen(checklist) && checklist.items.length > 0) chooseAll(checklist)
}

/** Снял отдельный пункт — чек-лист остаётся выбранным частично. */
function toggleItem(item: ChecklistItem, checklist: Checklist): void {
  if (!isChosen(checklist)) {
    // Пункт могли снять все, и выбор чек-листа уже погас: тогда
    // отмечаем только этот пункт, а не весь список заново.
    selectedChecklistId.value = checklist.id
    selected.value = [item.id]
    return
  }

  selected.value = isSelected(item)
    ? selected.value.filter((id) => id !== item.id)
    : [...selected.value, item.id]

  if (selected.value.length === 0) selectedChecklistId.value = null
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
            {{ props.note || 'Выбери чек-лист, пункты которого нужно добавить в список похода.' }}
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
        Личных чек-листов пока нет. Заведи их в разделе «Чек-листы» профиля — и они
        появятся здесь.
      </p>

      <div
        v-else
        class="flex max-h-[55vh] flex-col gap-2 overflow-y-auto"
        data-test="template-list"
      >
        <p class="text-xs text-muted" data-test="template-hint">
          Пункты берутся из одного чек-листа: выбери его целиком, а развернув —
          сними лишние. Другой чек-лист заменит выбор.
        </p>

        <section
          v-for="checklist in templates"
          :key="checklist.id"
          class="flex flex-col rounded-xl border border-border bg-bg"
          :data-test="`template-card-${checklist.id}`"
        >
          <div class="flex items-center gap-2 px-3 py-2">
            <input
              type="checkbox"
              class="h-4 w-4 shrink-0 accent-primary"
              :checked="isFull(checklist)"
              :indeterminate="isPartial(checklist)"
              :disabled="checklist.items.length === 0"
              :aria-label="`Выбрать чек-лист «${checklist.title}»`"
              :data-test="`template-choose-${checklist.id}`"
              @change="toggleChecklist(checklist)"
            />

            <button
              type="button"
              class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
              :aria-expanded="isExpanded(checklist)"
              :data-test="`template-expand-${checklist.id}`"
              @click="toggleExpanded(checklist)"
            >
              <span class="min-w-0 flex-1 truncate text-sm font-medium text-text">
                {{ checklist.title }}
              </span>
              <span class="shrink-0 text-xs text-muted">
                {{ isExpanded(checklist) ? 'Свернуть' : 'Развернуть' }}
              </span>
            </button>
          </div>

          <div
            v-if="isExpanded(checklist)"
            class="flex flex-col gap-1 border-t border-border px-3 py-2"
            :data-test="`template-items-${checklist.id}`"
          >
            <p v-if="checklist.items.length === 0" class="text-xs text-muted">
              В шаблоне пока нет пунктов.
            </p>

            <label
              v-for="item in checklist.items"
              :key="item.id"
              class="flex cursor-pointer items-start gap-2 rounded-xl border border-border bg-surface px-3 py-2 transition-colors hover:border-primary"
              :data-test="`template-item-${item.id}`"
            >
              <input
                type="checkbox"
                class="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                :checked="isSelected(item)"
                @change="toggleItem(item, checklist)"
              />
              <span class="min-w-0 flex-1">
                <span class="block break-words text-sm text-text">
                  {{ item.gear ? item.gear.title : item.title }}
                </span>
                <span class="block text-xs text-muted">{{ subtitle(item) }}</span>
              </span>
            </label>
          </div>
        </section>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-xs text-muted" data-test="template-selected">
          Выбрано: {{ selectedCount }}<template v-if="chosen"> · «{{ chosen.title }}»</template>
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
