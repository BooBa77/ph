<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import {
  addChecklistItem,
  deleteChecklistItem,
  updateChecklistItem,
} from '@/api/checklists'
import { ApiError } from '@/api/errors'
import {
  createTripChecklist,
  importChecklistItems,
  setRecommendationMark,
} from '@/api/tripChecklists'
import ChecklistTemplatePicker from '@/components/checklists/ChecklistTemplatePicker.vue'
import type { Checklist, ChecklistItem } from '@/types/checklists'
import { formatWeight } from '@/utils/gearWeight'

/**
 * Чек-лист внутри вкладки «Снаряжение» похода (05.11.2026).
 *
 * Один компонент на все четыре роли списка:
 *
 * - **общественное снаряжение** (`trip`) — ведёт и отмечает тот, кому
 *   матрица дала вкладку `gear`; остальные видят список без галочек;
 * - **личный список** (`personal`) — правит и отмечает только владелец;
 * - **рекомендация организатора** (`recommendation`) в отдельной секции
 *   между общественным и личным снаряжением — её правит ведущий
 *   «Снаряжения», галочек в ней нет;
 * - **та же рекомендация** в личной секции — галочки есть, но они личные:
 *   `isDone` сервер считает по отметке смотрящего, и организатору она
 *   не возвращается.
 *
 * **«Заполнить с нуля или из личных чек-листов».** Пункт добавляется
 * текстом; кнопка «Из чек-листа» открывает выбор пунктов шаблонов профиля.
 * Сервер сам решает, станет вещь экземпляром или типом — см.
 * `ImportChecklistItemsDto`.
 *
 * **Список приходит пропом, а состояние живёт здесь.** Родителю не нужно
 * знать, как правится пункт: компонент меняет свой снимок и отдаёт новый
 * объект событием `updated`. Так вкладка хранит три списка в одном месте,
 * а компонент остаётся переиспользуемым.
 */
const props = withDefaults(
  defineProps<{
    tripId: string
    checklist: Checklist | null
    scope: 'trip' | 'personal' | 'recommendation'
    heading?: string
    subtitle?: string
    emptyText?: string
    addPlaceholder?: string
    /** Править состав: создавать список, добавлять, менять и удалять пункты. */
    canManage?: boolean
    /** Показывать галочки выполнения. */
    canMark?: boolean
    /** Показывать кнопку «Из чек-листа». */
    canImport?: boolean
    /** Зелёный блок рекомендации над личными пунктами. */
    variant?: 'default' | 'recommended'
    /** Что произойдёт с вещами из шаблона — подпись в модалке. */
    importNote?: string
    /**
     * Кнопка «Скрыть инструменты»: свернуть правку, оставив только чтение
     * и галочки. Заказчик 05.11.2026: «в „Мои личные вещи“ лучше бы добавить
     * кнопку скрытия инструментов редактирования чек-листа», затем —
     * «добавь кнопку „Показать инструменты“ и для списка общественного
     * снаряжения». Поэтому флаг общий, а не привязан к личному списку.
     */
    toolsToggle?: boolean
  }>(),
  {
    heading: '',
    subtitle: '',
    emptyText: 'Список ещё не заведён.',
    addPlaceholder: 'Добавить пункт',
    canManage: false,
    canMark: false,
    canImport: false,
    variant: 'default',
    importNote: '',
    toolsToggle: false,
  },
)

const emit = defineEmits<{ updated: [checklist: Checklist | null] }>()

const local = ref<Checklist | null>(props.checklist)

watch(
  () => props.checklist,
  (value) => {
    local.value = value
  },
)

const error = ref<string | null>(null)
const busyId = ref<string | null>(null)
const isCreating = ref(false)
const isImporting = ref(false)

const draft = ref('')
const editingItemId = ref<string | null>(null)
const titleDraft = ref('')
const isPickerOpen = ref(false)

/**
 * Инструменты правки скрыты кнопкой. Состояние живёт в компоненте,
 * а не в localStorage: это способ посмотреть список «как его видят люди»,
 * и при следующем открытии вкладки человек снова получает редактор.
 */
const toolsHidden = ref(false)

const editToolsVisible = computed(() => props.canManage && !toolsHidden.value)

const isRecommended = computed(() => props.variant === 'recommended')

/**
 * «1/3» — сколько пунктов закрыто из скольких. Заказчик 05.11.2026:
 * «убирай количества в заголовках секций… у списков можно закрытые пункты
 * обозначать „1/3“». У секций счётчиков больше нет, а у списка прогресс
 * полезен: видно, собрался ли поход. Пока не закрыт ни один пункт, числа
 * нет — иначе это опять количество, а не прогресс.
 */
const progress = computed(() => {
  const items = local.value?.items ?? []
  const done = items.filter((item) => item.isDone).length

  return done > 0 ? `${done}/${items.length}` : ''
})

function toggleTools(): void {
  toolsHidden.value = !toolsHidden.value

  // Инструменты прячем — незаконченная правка текста тоже уходит:
  // иначе поле осталось бы висеть без кнопок «Сохранить».
  if (toolsHidden.value) cancelEdit()
}

const sectionClass = computed(() =>
  isRecommended.value
    ? 'flex flex-col gap-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3'
    : 'flex flex-col gap-2',
)

const addPlaceholder = computed(
  () =>
    props.addPlaceholder ||
    (props.scope === 'trip' ? 'Добавить в список: «Котёл»' : 'Добавить пункт'),
)

const createLabel = computed(() =>
  props.scope === 'personal' ? 'Создать мой список' : 'Создать список',
)

/** Подпись пункта-ссылки: «Палатка · 2,4 кг». */
function gearSubtitle(item: ChecklistItem): string {
  if (!item.gear) return ''

  return item.gear.weightGrams === null
    ? item.gear.typeName
    : `${item.gear.typeName} · ${formatWeight(item.gear.weightGrams)}`
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback
}

function applyItems(items: ChecklistItem[]) {
  local.value = { ...local.value!, items }
  emit('updated', local.value)
}

function applyItem(updated: ChecklistItem) {
  if (!local.value) return

  applyItems(
    local.value.items.map((item) => (item.id === updated.id ? updated : item)),
  )
}

async function create(): Promise<void> {
  if (isCreating.value) return

  isCreating.value = true
  error.value = null

  try {
    local.value = await createTripChecklist(props.tripId, props.scope)
    emit('updated', local.value)
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось создать список.')
  } finally {
    isCreating.value = false
  }
}

async function addItem(): Promise<void> {
  const title = draft.value.trim()
  if (title.length === 0 || busyId.value !== null || !local.value) return

  busyId.value = local.value.id
  error.value = null

  try {
    const item = await addChecklistItem(local.value.id, { title })
    applyItems([...local.value.items, item])
    draft.value = ''
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось добавить пункт.')
  } finally {
    busyId.value = null
  }
}

/**
 * Галочка. У рекомендации отметка личная и живёт отдельной ручкой:
 * `isDone` общего пункта у каждого свой.
 */
async function toggle(item: ChecklistItem, event: Event): Promise<void> {
  const isDone = (event.target as HTMLInputElement).checked

  busyId.value = item.id
  error.value = null

  try {
    if (props.scope === 'recommendation') {
      const mark = await setRecommendationMark(props.tripId, item.id, isDone)
      applyItem({
        ...item,
        isDone: mark.isDone,
        doneAt: mark.doneAt,
        doneByUserId: mark.isDone ? item.doneByUserId : null,
      })
    } else {
      applyItem(await updateChecklistItem(item.id, { isDone }))
    }
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось сохранить отметку.')
    // `:checked` не изменился в данных, поэтому браузерная галочка осталась
    // бы нажатой. Перерисовываем список из прежнего состояния.
    local.value = local.value ? { ...local.value } : null
  } finally {
    busyId.value = null
  }
}

function startEdit(item: ChecklistItem) {
  editingItemId.value = item.id
  titleDraft.value = item.title
}

function cancelEdit() {
  editingItemId.value = null
  titleDraft.value = ''
}

async function saveTitle(item: ChecklistItem): Promise<void> {
  const title = titleDraft.value.trim()
  if (title.length === 0) {
    cancelEdit()
    return
  }

  busyId.value = item.id
  error.value = null

  try {
    applyItem(await updateChecklistItem(item.id, { title }))
    cancelEdit()
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось переименовать пункт.')
  } finally {
    busyId.value = null
  }
}

async function removeItem(item: ChecklistItem): Promise<void> {
  busyId.value = item.id
  error.value = null

  try {
    await deleteChecklistItem(item.id)
    applyItems(local.value!.items.filter((row) => row.id !== item.id))
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось убрать пункт.')
  } finally {
    busyId.value = null
  }
}

/**
 * Добавили выбранные пункты шаблонов. Сервер возвращает список целиком —
 * с преобразованием «вещь → тип» там, где оно нужно.
 */
async function onImport(itemIds: string[]): Promise<void> {
  if (itemIds.length === 0 || isImporting.value || !local.value) return

  isImporting.value = true
  error.value = null

  try {
    local.value = await importChecklistItems(props.tripId, {
      scope: props.scope,
      itemIds: itemIds.map(Number),
    })
    emit('updated', local.value)
    isPickerOpen.value = false
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось добавить пункты из чек-листа.')
  } finally {
    isImporting.value = false
  }
}
</script>

<template>
  <section :class="sectionClass" data-test="trip-checklist" :data-scope="scope">
    <div
      v-if="heading || isRecommended || (toolsToggle && canManage)"
      class="flex flex-wrap items-baseline gap-2"
    >
      <h3
        v-if="heading"
        class="text-sm font-medium"
        :class="isRecommended ? 'text-emerald-900' : 'text-text'"
        data-test="checklist-heading"
      >
        {{ heading }}<span
          v-if="progress"
          class="ml-1 text-xs font-normal"
          :class="isRecommended ? 'text-emerald-700' : 'text-muted'"
          data-test="checklist-progress"
        >{{ progress }}</span>
      </h3>

      <span
        v-if="isRecommended"
        class="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white"
        data-test="checklist-recommended-badge"
      >
        рекомендация
      </span>

      <button
        v-if="toolsToggle && canManage"
        type="button"
        class="ml-auto cursor-pointer text-xs text-muted underline transition-colors hover:text-text"
        :aria-pressed="toolsHidden"
        data-test="checklist-tools-toggle"
        @click="toggleTools"
      >
        {{ toolsHidden ? 'Показать инструменты' : 'Скрыть инструменты' }}
      </button>
    </div>

    <p v-if="subtitle" class="text-xs" :class="isRecommended ? 'text-emerald-900' : 'text-muted'">
      {{ subtitle }}
    </p>

    <p v-if="error" class="text-sm text-red-600" data-test="checklist-error">{{ error }}</p>

    <template v-if="local">
      <p
        v-if="local.items.length === 0"
        class="text-sm"
        :class="isRecommended ? 'text-emerald-900' : 'text-muted'"
        data-test="checklist-empty"
      >
        Пунктов пока нет.
      </p>

      <ul v-else class="flex flex-col gap-1.5">
        <li
          v-for="item in local.items"
          :key="item.id"
          class="flex items-start justify-between gap-2 border-b pb-1.5 last:border-b-0 last:pb-0"
          :class="isRecommended ? 'border-emerald-200' : 'border-border/60'"
          :data-test="`checklist-item-${item.id}`"
        >
          <form
            v-if="editingItemId === item.id"
            class="flex min-w-0 flex-1 flex-wrap gap-2"
            @submit.prevent="saveTitle(item)"
          >
            <input
              v-model="titleDraft"
              type="text"
              maxlength="200"
              class="min-w-0 flex-1 rounded-xl border border-border bg-field px-3 py-1.5 text-base text-text focus:border-primary focus:outline-none"
              data-test="checklist-item-title-input"
              @keydown.esc="cancelEdit"
            />
            <button
              type="submit"
              :disabled="busyId === item.id"
              class="cursor-pointer rounded-xl border border-primary px-3 py-1.5 text-sm text-primary transition-colors hover:bg-primary hover:text-white disabled:opacity-50"
              data-test="checklist-item-title-save"
            >
              Сохранить
            </button>
            <button
              type="button"
              class="cursor-pointer rounded-xl border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:text-text"
              data-test="checklist-item-title-cancel"
              @click="cancelEdit"
            >
              Отмена
            </button>
          </form>

          <label
            v-else-if="canMark"
            class="flex min-w-0 flex-1 cursor-pointer items-start gap-2"
          >
            <input
              type="checkbox"
              class="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              :checked="item.isDone"
              :disabled="busyId === item.id"
              :data-test="`checklist-item-check-${item.id}`"
              @change="toggle(item, $event)"
            />
            <span class="min-w-0 flex-1">
              <span
                class="block break-words text-sm"
                :class="item.isDone ? 'text-muted line-through' : isRecommended ? 'text-emerald-950' : 'text-text'"
                data-test="checklist-item-title"
              >
                {{ item.title }}
              </span>
              <span v-if="item.gear" class="block text-xs text-muted" data-test="checklist-item-gear">
                {{ gearSubtitle(item) }} · из снаряжения
              </span>
            </span>
          </label>

          <div v-else class="min-w-0 flex-1">
            <p
              class="break-words text-sm"
              :class="item.isDone ? 'text-muted line-through' : isRecommended ? 'text-emerald-950' : 'text-text'"
              data-test="checklist-item-title"
            >
              {{ item.title }}
            </p>
            <p v-if="item.gear" class="text-xs text-muted" data-test="checklist-item-gear">
              {{ gearSubtitle(item) }} · из снаряжения
            </p>
          </div>

          <div v-if="editToolsVisible && editingItemId !== item.id" class="flex shrink-0 items-center gap-2">
            <button
              v-if="!item.gear"
              type="button"
              class="cursor-pointer text-xs text-muted underline transition-colors hover:text-text"
              data-test="checklist-item-edit"
              @click="startEdit(item)"
            >
              Править
            </button>
            <button
              type="button"
              :disabled="busyId === item.id"
              class="cursor-pointer text-xs text-muted underline transition-colors hover:text-red-600 disabled:opacity-50"
              data-test="checklist-item-remove"
              @click="removeItem(item)"
            >
              Убрать
            </button>
          </div>
        </li>
      </ul>

      <form v-if="editToolsVisible" class="flex flex-wrap gap-2" @submit.prevent="addItem">
        <input
          v-model="draft"
          type="text"
          maxlength="200"
          :placeholder="addPlaceholder"
          class="min-w-0 flex-1 rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
          data-test="checklist-new-item"
        />
        <button
          type="submit"
          :disabled="busyId !== null || draft.trim().length === 0"
          class="cursor-pointer rounded-xl border border-border px-3 py-2 text-sm text-text transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
          data-test="checklist-add-item"
        >
          Добавить
        </button>
        <button
          v-if="canImport"
          type="button"
          :disabled="isImporting"
          class="cursor-pointer rounded-xl border border-border px-3 py-2 text-sm text-text transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
          data-test="checklist-import"
          @click="isPickerOpen = true"
        >
          Из чек-листа
        </button>
      </form>
    </template>

    <template v-else>
      <p class="text-sm" :class="isRecommended ? 'text-emerald-900' : 'text-muted'" data-test="checklist-missing">
        {{ emptyText }}
      </p>

      <button
        v-if="canManage"
        type="button"
        :disabled="isCreating"
        class="cursor-pointer self-start rounded-xl border border-primary px-3 py-1.5 text-sm text-primary transition-colors hover:bg-primary hover:text-white disabled:opacity-50"
        data-test="checklist-create"
        @click="create"
      >
        {{ isCreating ? 'Создаём…' : createLabel }}
      </button>
    </template>

    <ChecklistTemplatePicker
      v-if="isPickerOpen"
      :note="importNote"
      @apply="onImport"
      @close="isPickerOpen = false"
    />
  </section>
</template>
