<script setup lang="ts">
import { onMounted, ref } from 'vue'

import {
  addChecklistItem,
  createTemplate,
  deleteChecklist,
  deleteChecklistItem,
  listTemplates,
  renameChecklist,
  updateChecklistItem,
} from '@/api/checklists'
import { ApiError } from '@/api/errors'
import ChecklistGearPicker from '@/components/checklists/ChecklistGearPicker.vue'
import type { Checklist, ChecklistItem } from '@/types/checklists'
import type { GearItem } from '@/types/gear'
import { formatWeight } from '@/utils/gearWeight'

/**
 * «Чек-листы» — личные списки-шаблоны пользователя.
 *
 * **Шаблон живёт вне похода** и нужен, чтобы не писать список снаряжения
 * заново к каждому походу: в поход из шаблона попадает **копия**, поэтому
 * правка шаблона не переписывает прошедший поход, а удаление шаблона
 * не обнуляет список, по которому уже ходили (`docs/ph/trip-tabs.md`, Ф2).
 *
 * **В шаблоне нет отметок.** Заказчик 31.10.2026: чек-лист — это список,
 * а «флаги выполнения» появляются, когда шаблон подгрузили в поход. Отметка
 * в заготовке означала бы «эту палатку я уже взял» ещё до похода.
 *
 * **Пункт — текст или вещь (31.10.2026).** Свободный текст («спички»)
 * и конкретный экземпляр из «Снаряжения» — два вида строки. У ссылки
 * показывается живое название вещи и её тип с весом; если вещь удалить,
 * сервер превратит пункт в текст имени типа, и строка останется.
 *
 * Списков похода здесь нет намеренно: им нужна вкладка похода, а вкладки
 * (Ф6–Ф7) ещё не собраны. Заводить «пока хоть где-то» — значит сделать
 * экран, который потом придётся выкинуть.
 */
const templates = ref<Checklist[]>([])
const isLoading = ref(true)
const error = ref<string | null>(null)

/** Заголовок нового шаблона. */
const newTitle = ref('')
const isCreating = ref(false)

/** Переименование: какая карточка в режиме правки и что в поле. */
const editingId = ref<string | null>(null)
const renameDraft = ref('')

/** Текст нового пункта по каждому списку — свой черновик. */
const itemDrafts = ref<Record<string, string>>({})

/** Правка текста пункта: какой пункт и что в поле. */
const editingItemId = ref<string | null>(null)
const itemTitleDraft = ref('')

/**
 * Выбор вещи: для какого списка открыт и что заменить.
 *
 * `pickerItem === null` — добавляем новый пункт, иначе заменяем вещь
 * у существующего. Один компонент на два действия: список вещей и поиск
 * в обоих случаях одинаковые.
 */
const pickerChecklistId = ref<string | null>(null)
const pickerItem = ref<ChecklistItem | null>(null)

/**
 * Ошибка привязки — своя, а не общая: она показывается **в модалке**,
 * иначе отказ сервера оказался бы под затемнением, а выбор — потерянным.
 */
const pickerError = ref<string | null>(null)

/** Какая карточка ждёт подтверждения удаления. */
const confirmingDeleteId = ref<string | null>(null)

/** Что сейчас в полёте: чтобы кнопки не жались дважды. */
const pendingItemId = ref<string | null>(null)
const isDeletingId = ref<string | null>(null)

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback
}

async function load() {
  isLoading.value = true
  error.value = null

  try {
    templates.value = await listTemplates()
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось загрузить чек-листы.')
  } finally {
    isLoading.value = false
  }
}

/** Заменить список в состоянии тем, что вернул сервер. */
function applyChecklist(updated: Checklist) {
  const index = templates.value.findIndex((checklist) => checklist.id === updated.id)
  if (index >= 0) templates.value[index] = updated
}

async function create() {
  const title = newTitle.value.trim()
  if (title.length === 0 || isCreating.value) return

  isCreating.value = true
  error.value = null

  try {
    const created = await createTemplate(title)
    templates.value.push(created)
    newTitle.value = ''
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось создать шаблон.')
  } finally {
    isCreating.value = false
  }
}

function startRename(checklist: Checklist) {
  editingId.value = checklist.id
  renameDraft.value = checklist.title
}

function cancelRename() {
  editingId.value = null
  renameDraft.value = ''
}

async function saveRename(checklist: Checklist) {
  const title = renameDraft.value.trim()

  // Пустое имя у шаблона бессмысленно: сервер ответит 400, но зачем
  // доводить до запроса — просто выходим из режима правки.
  if (title.length === 0) {
    cancelRename()
    return
  }

  error.value = null
  try {
    applyChecklist(await renameChecklist(checklist.id, title))
    cancelRename()
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось переименовать шаблон.')
  }
}

async function remove(checklist: Checklist) {
  isDeletingId.value = checklist.id
  error.value = null

  try {
    await deleteChecklist(checklist.id)
    templates.value = templates.value.filter((item) => item.id !== checklist.id)
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось удалить шаблон.')
  } finally {
    isDeletingId.value = null
    confirmingDeleteId.value = null
  }
}

/** Заменить пункт в состоянии тем, что вернул сервер. */
function applyItem(checklist: Checklist, updated: ChecklistItem) {
  const index = checklist.items.findIndex((row) => row.id === updated.id)
  if (index >= 0) checklist.items[index] = updated
  else checklist.items.push(updated)
}

async function addItem(checklist: Checklist) {
  const title = (itemDrafts.value[checklist.id] ?? '').trim()
  if (title.length === 0) return

  pendingItemId.value = checklist.id
  error.value = null

  try {
    const item = await addChecklistItem(checklist.id, { title })
    checklist.items.push(item)
    itemDrafts.value[checklist.id] = ''
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось добавить пункт.')
  } finally {
    pendingItemId.value = null
  }
}

function startEditItem(item: ChecklistItem) {
  editingItemId.value = item.id
  itemTitleDraft.value = item.title
}

function cancelEditItem() {
  editingItemId.value = null
  itemTitleDraft.value = ''
}

/**
 * Переименовать текстовый пункт.
 *
 * Пустой текст не отправляем: сервер ответит 400, но пункт без текста
 * нечем показать, и доводить до отказа незачем — выходим из правки.
 */
async function saveItemTitle(checklist: Checklist, item: ChecklistItem) {
  const title = itemTitleDraft.value.trim()
  if (title.length === 0) {
    cancelEditItem()
    return
  }

  pendingItemId.value = item.id
  error.value = null

  try {
    applyItem(checklist, await updateChecklistItem(item.id, { title }))
    cancelEditItem()
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось переименовать пункт.')
  } finally {
    pendingItemId.value = null
  }
}

/** Открыть выбор вещи: без пункта — новый, с пунктом — заменить вещь. */
function openPicker(checklist: Checklist, item: ChecklistItem | null = null) {
  pickerChecklistId.value = checklist.id
  pickerItem.value = item
  pickerError.value = null
}

function closePicker() {
  pickerChecklistId.value = null
  pickerItem.value = null
  pickerError.value = null
}

/**
 * Вещь выбрана.
 *
 * У пункта-ссылки текст не спрашивают: его подписывает сервер названием
 * вещи. Ошибку показываем строкой над списком и модалку не закрываем —
 * иначе человек потерял бы выбор из-за одного отказа.
 */
async function onGearSelected(gear: GearItem) {
  const checklistId = pickerChecklistId.value
  const checklist = templates.value.find((row) => row.id === checklistId)
  if (!checklist || pendingItemId.value !== null) return

  const replacing = pickerItem.value
  pendingItemId.value = replacing?.id ?? checklist.id
  error.value = null

  try {
    if (replacing) {
      applyItem(
        checklist,
        await updateChecklistItem(replacing.id, { gearItemId: Number(gear.id) }),
      )
    } else {
      checklist.items.push(
        await addChecklistItem(checklist.id, { gearItemId: Number(gear.id) }),
      )
    }

    closePicker()
  } catch (cause) {
    const message = messageOf(cause, 'Не удалось привязать вещь.')
    pickerError.value = message
    // И в общую строку тоже: модалку можно закрыть, а причина должна остаться.
    error.value = message
  } finally {
    pendingItemId.value = null
  }
}

async function removeItem(checklist: Checklist, item: ChecklistItem) {
  pendingItemId.value = item.id
  error.value = null

  try {
    await deleteChecklistItem(item.id)
    checklist.items = checklist.items.filter((row) => row.id !== item.id)
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось удалить пункт.')
  } finally {
    pendingItemId.value = null
  }
}

/** Подпись ссылки: «Палатка · 2,4 кг», без прочерка вместо неизвестного веса. */
function gearSubtitle(item: ChecklistItem): string {
  if (!item.gear) return ''

  return item.gear.weightGrams === null
    ? item.gear.typeName
    : `${item.gear.typeName} · ${formatWeight(item.gear.weightGrams)}`
}

onMounted(load)
</script>

<template>
  <section data-test="checklists">
    <h2 class="mb-2 text-xl font-semibold text-text">Чек-листы</h2>

    <p class="mb-4 text-sm text-muted">
      Шаблон — это заготовка списка: снаряжение, продукты, аптечка. В поход из него попадает
      копия, поэтому правка шаблона не меняет походы, в которые он уже уехал. Пункт бывает
      свободным текстом или конкретной вещью из «Снаряжения». Отметки «взял» появляются, когда
      шаблон подгрузили в поход.
    </p>

    <p v-if="error" class="mb-3 text-sm text-red-600" data-test="checklists-error">
      {{ error }}
    </p>

    <!-- Новый шаблон -->
    <form class="mb-6 flex flex-wrap gap-2" @submit.prevent="create">
      <input
        v-model="newTitle"
        type="text"
        maxlength="120"
        placeholder="Название шаблона: «Снаряжение, лето»"
        class="min-w-0 flex-1 rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
        data-test="new-template-title"
      />
      <button
        type="submit"
        :disabled="isCreating || newTitle.trim().length === 0"
        class="cursor-pointer rounded-xl border border-primary bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        data-test="create-template"
      >
        {{ isCreating ? 'Создаём…' : 'Создать шаблон' }}
      </button>
    </form>

    <p v-if="isLoading" class="text-sm text-muted" data-test="checklists-loading">
      Загружаем чек-листы…
    </p>

    <p
      v-else-if="templates.length === 0"
      class="rounded-xl border border-dashed border-border p-4 text-sm text-muted"
      data-test="checklists-empty"
    >
      Шаблонов пока нет. Заведите первый — и к следующему походу не придётся вспоминать, что
      брали в прошлый.
    </p>

    <ul v-else class="flex flex-col gap-4">
      <li
        v-for="checklist in templates"
        :key="checklist.id"
        class="rounded-xl border border-border bg-surface p-4"
        data-test="checklist-card"
      >
        <!-- Заголовок: чтение или переименование -->
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <form
            v-if="editingId === checklist.id"
            class="flex min-w-0 flex-1 gap-2"
            @submit.prevent="saveRename(checklist)"
          >
            <input
              v-model="renameDraft"
              type="text"
              maxlength="120"
              class="min-w-0 flex-1 rounded-xl border border-border bg-field px-3 py-1.5 text-base text-text focus:border-primary focus:outline-none"
              data-test="rename-input"
              @keydown.esc="cancelRename"
            />
            <button
              type="submit"
              class="cursor-pointer rounded-xl border border-primary px-3 py-1.5 text-sm text-primary transition-colors hover:bg-primary hover:text-white"
              data-test="rename-save"
            >
              Сохранить
            </button>
            <button
              type="button"
              class="cursor-pointer rounded-xl border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:text-text"
              data-test="rename-cancel"
              @click="cancelRename"
            >
              Отмена
            </button>
          </form>

          <h3 v-else class="min-w-0 flex-1 truncate text-base font-medium text-text" data-test="checklist-title">
            {{ checklist.title }}
          </h3>

          <div v-if="editingId !== checklist.id" class="flex items-center gap-2">
            <button
              type="button"
              class="cursor-pointer text-sm text-muted underline transition-colors hover:text-text"
              data-test="checklist-rename"
              @click="startRename(checklist)"
            >
              Переименовать
            </button>

            <template v-if="confirmingDeleteId === checklist.id">
              <span class="text-sm text-muted">Удалить?</span>
              <button
                type="button"
                :disabled="isDeletingId === checklist.id"
                class="cursor-pointer rounded-xl border border-red-600 px-3 py-1 text-sm text-red-600 transition-colors hover:bg-red-600 hover:text-white disabled:opacity-50"
                data-test="checklist-delete-confirm"
                @click="remove(checklist)"
              >
                Да
              </button>
              <button
                type="button"
                class="cursor-pointer rounded-xl border border-border px-3 py-1 text-sm text-muted transition-colors hover:text-text"
                data-test="checklist-delete-cancel"
                @click="confirmingDeleteId = null"
              >
                Нет
              </button>
            </template>

            <button
              v-else
              type="button"
              class="cursor-pointer text-sm text-muted underline transition-colors hover:text-text"
              data-test="checklist-delete"
              @click="confirmingDeleteId = checklist.id"
            >
              Удалить
            </button>
          </div>
        </div>

        <!-- Пункты -->
        <ul v-if="checklist.items.length > 0" class="mb-3 flex flex-col gap-2">
          <li
            v-for="item in checklist.items"
            :key="item.id"
            class="flex flex-col gap-1 border-b border-border/60 pb-2 last:border-b-0 last:pb-0"
            data-test="checklist-item"
          >
            <form
              v-if="editingItemId === item.id"
              class="flex flex-wrap gap-2"
              @submit.prevent="saveItemTitle(checklist, item)"
            >
              <input
                v-model="itemTitleDraft"
                type="text"
                maxlength="200"
                class="min-w-0 flex-1 rounded-xl border border-border bg-field px-3 py-1.5 text-base text-text focus:border-primary focus:outline-none"
                data-test="item-title-input"
                @keydown.esc="cancelEditItem"
              />
              <button
                type="submit"
                :disabled="pendingItemId === item.id"
                class="cursor-pointer rounded-xl border border-primary px-3 py-1.5 text-sm text-primary transition-colors hover:bg-primary hover:text-white disabled:opacity-50"
                data-test="item-title-save"
              >
                Сохранить
              </button>
              <button
                type="button"
                class="cursor-pointer rounded-xl border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:text-text"
                data-test="item-title-cancel"
                @click="cancelEditItem"
              >
                Отмена
              </button>
            </form>

            <div v-else class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <p class="break-words text-sm text-text" data-test="item-title">
                  {{ item.gear ? item.gear.title : item.title }}
                </p>
                <p v-if="item.gear" class="text-xs text-muted" data-test="item-gear">
                  {{ gearSubtitle(item) }} · из снаряжения
                </p>
              </div>

              <div class="flex shrink-0 items-center gap-2">
                <button
                  v-if="!item.gear"
                  type="button"
                  class="cursor-pointer text-xs text-muted underline transition-colors hover:text-text"
                  data-test="item-edit"
                  @click="startEditItem(item)"
                >
                  Править
                </button>
                <button
                  v-else
                  type="button"
                  :disabled="pendingItemId === item.id"
                  class="cursor-pointer text-xs text-muted underline transition-colors hover:text-text disabled:opacity-50"
                  data-test="item-replace"
                  @click="openPicker(checklist, item)"
                >
                  Заменить
                </button>
                <button
                  type="button"
                  :disabled="pendingItemId === item.id"
                  class="cursor-pointer text-xs text-muted underline transition-colors hover:text-text disabled:opacity-50"
                  data-test="item-delete"
                  @click="removeItem(checklist, item)"
                >
                  Убрать
                </button>
              </div>
            </div>
          </li>
        </ul>

        <p v-else class="mb-3 text-sm text-muted" data-test="checklist-items-empty">
          Пунктов пока нет.
        </p>

        <!-- Новый пункт: текст или вещь -->
        <form class="flex flex-wrap gap-2" @submit.prevent="addItem(checklist)">
          <input
            v-model="itemDrafts[checklist.id]"
            type="text"
            maxlength="200"
            placeholder="Добавить пункт: «Спички»"
            class="min-w-0 flex-1 rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
            data-test="new-item-input"
          />
          <button
            type="submit"
            :disabled="
              pendingItemId === checklist.id || (itemDrafts[checklist.id] ?? '').trim().length === 0
            "
            class="cursor-pointer rounded-xl border border-border px-3 py-2 text-sm text-text transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            data-test="add-item"
          >
            Добавить
          </button>
          <button
            type="button"
            :disabled="pendingItemId === checklist.id"
            class="cursor-pointer rounded-xl border border-border px-3 py-2 text-sm text-text transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
            data-test="add-from-gear"
            @click="openPicker(checklist)"
          >
            Из снаряжения
          </button>
        </form>
      </li>
    </ul>

    <ChecklistGearPicker
      v-if="pickerChecklistId"
      :error="pickerError"
      @select="onGearSelected"
      @close="closePicker"
    />
  </section>
</template>
