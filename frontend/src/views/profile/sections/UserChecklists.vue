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
import type { Checklist, ChecklistItem } from '@/types/checklists'

/**
 * «Чек-листы» — шаблоны пользователя.
 *
 * **Шаблон живёт вне похода** и нужен, чтобы не писать список снаряжения
 * заново к каждому походу: в поход из шаблона попадает **копия**, поэтому
 * правка шаблона не переписывает прошедший поход, а удаление шаблона
 * не обнуляет список, по которому уже ходили (`docs/ph/trip-tabs.md`, Ф2).
 *
 * Списков похода здесь нет намеренно: им нужна вкладка похода, а вкладки
 * (Ф6–Ф7) ещё не собраны. Заводить «пока хоть где-то» — значит сделать
 * экран, который потом придётся выкинуть.
 *
 * Отметки в шаблонах — не «собранное», а «что вообще берём»: чек-лист
 * шаблона отмечают редко, но это тот же механизм, что и в походе, и второй
 * интерфейс для него не нужен.
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

async function addItem(checklist: Checklist) {
  const title = (itemDrafts.value[checklist.id] ?? '').trim()
  if (title.length === 0) return

  pendingItemId.value = checklist.id
  error.value = null

  try {
    const item = await addChecklistItem(checklist.id, title)
    checklist.items.push(item)
    itemDrafts.value[checklist.id] = ''
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось добавить пункт.')
  } finally {
    pendingItemId.value = null
  }
}

/**
 * Отметка пункта.
 *
 * Обновляем по ответу сервера, а не переключаем флаг на клиенте: он же
 * возвращает «кто и когда отметил», и локальная догадка разошлась бы
 * с правдой при отказе.
 */
async function toggleItem(item: ChecklistItem) {
  pendingItemId.value = item.id
  error.value = null

  try {
    const updated = await updateChecklistItem(item.id, { isDone: !item.isDone })
    item.isDone = updated.isDone
    item.doneByUserId = updated.doneByUserId
    item.doneAt = updated.doneAt
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось отметить пункт.')
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

onMounted(load)
</script>

<template>
  <section data-test="checklists">
    <h2 class="mb-2 text-xl font-semibold text-text">Чек-листы</h2>

    <p class="mb-4 text-sm text-muted">
      Шаблон — это заготовка списка: снаряжение, продукты, аптечка. В поход из него попадает
      копия, поэтому правка шаблона не меняет походы, в которые он уже уехал.
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
        <ul v-if="checklist.items.length > 0" class="mb-3 flex flex-col gap-1">
          <li
            v-for="item in checklist.items"
            :key="item.id"
            class="flex items-center gap-3"
            data-test="checklist-item"
          >
            <input
              :id="`item-${item.id}`"
              type="checkbox"
              :checked="item.isDone"
              :disabled="pendingItemId === item.id"
              class="h-5 w-5 shrink-0 cursor-pointer accent-[var(--theme-primary)]"
              data-test="item-toggle"
              @change="toggleItem(item)"
            />
            <label
              :for="`item-${item.id}`"
              class="min-w-0 flex-1 cursor-pointer text-sm"
              :class="item.isDone ? 'text-muted line-through' : 'text-text'"
            >
              {{ item.title }}
            </label>
            <button
              type="button"
              :disabled="pendingItemId === item.id"
              class="shrink-0 cursor-pointer text-xs text-muted underline transition-colors hover:text-text disabled:opacity-50"
              data-test="item-delete"
              @click="removeItem(checklist, item)"
            >
              Убрать
            </button>
          </li>
        </ul>

        <p v-else class="mb-3 text-sm text-muted" data-test="checklist-items-empty">
          Пунктов пока нет.
        </p>

        <!-- Новый пункт -->
        <form class="flex flex-wrap gap-2" @submit.prevent="addItem(checklist)">
          <input
            v-model="itemDrafts[checklist.id]"
            type="text"
            maxlength="200"
            placeholder="Добавить пункт: «Палатка на четверых»"
            class="min-w-0 flex-1 rounded-xl border border-border bg-field px-3 py-2 text-sm text-text transition-colors focus:border-primary focus:outline-none"
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
        </form>
      </li>
    </ul>
  </section>
</template>
