<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { ApiError } from '@/api/errors'
import {
  archiveGearGroupTemplate,
  createGearGroupTemplate,
  fetchAdminGearGroupTemplates,
  updateGearGroupTemplate,
} from '@/api/gearGroups'
import { GEAR_CODE_HINT, GEAR_NAME_MAX_LENGTH, isGearCode } from '@/types/gearTypes'
import { GEAR_DEFAULT_GROUP_CODE } from '@/types/gear'
import type { AdminGearGroupTemplate } from '@/types/gear'

/**
 * Рекомендуемые группы снаряжения — админка шаблонов (02.11.2026).
 *
 * Заказчик: «Заводим рекомендуемые группы, они управляются админом,
 * приходят новым пользователям и с новыми типами, но пользователь в праве
 * сам менять их под себя».
 *
 * Шаблон — **образец**, а не рабочая группа: человек получает его копию
 * (`gear_groups`), которую переименовывает, переставляет и удаляет сам.
 * Поэтому здесь нет числа вещей: вещи живут в личных группах, а шаблон
 * отвечает на два вопроса — «что придёт новому пользователю» и «в какую
 * группу попадёт тип, для которого эта рекомендация указана».
 *
 * **`code` — контракт и неизменяем**: по нему личная копия находит
 * «Прочее» (`other`) и понимает, куда положить новый тип. Ошибку
 * исправляют архивом и новой строкой с новым кодом.
 *
 * **Удаления нет, есть архив.** Архивный шаблон не приходит новым
 * пользователям и не предлагается в выборе рекомендуемой группы, но копии
 * у существующих людей остаются. «Прочее» не архивируется (409).
 *
 * Права проверяет бэкенд (`isAdminUser`): 403 «Раздел только для
 * администратора» показывается строкой сверху.
 */
const groups = ref<AdminGearGroupTemplate[]>([])
const error = ref<string | null>(null)
const isLoading = ref(false)

/** Что сейчас меняется: повторное нажатие не шлёт второй запрос. */
const busyId = ref<number | null>(null)

/** Черновик формы шаблона. `id: null` — создание: код вводится руками. */
interface GroupForm {
  id: number | null
  code: string
  name: string
  sortOrder: string | number
  isActive: boolean
}

const form = ref<GroupForm | null>(null)
const formError = ref<string | null>(null)
const isSaving = ref(false)

/** Код умолчания: его сервер не даёт убрать в архив. */
const DEFAULT_CODE = GEAR_DEFAULT_GROUP_CODE

const activeCount = computed(() => groups.value.filter((group) => group.isActive).length)

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback
}

async function load() {
  isLoading.value = true
  error.value = null

  try {
    groups.value = await fetchAdminGearGroupTemplates()
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось загрузить рекомендуемые группы.')
  } finally {
    isLoading.value = false
  }
}

function openCreate() {
  formError.value = null
  form.value = { id: null, code: '', name: '', sortOrder: 10, isActive: true }
}

function openEdit(group: AdminGearGroupTemplate) {
  formError.value = null
  form.value = {
    id: group.id,
    code: group.code,
    name: group.name,
    sortOrder: group.sortOrder,
    isActive: group.isActive,
  }
}

function closeForm() {
  form.value = null
  formError.value = null
}

/**
 * Сохранить форму: создать или изменить.
 *
 * `sortOrder` разбирается до запроса: пустое поле — это 0, а мусор и минус —
 * ошибка в форме, а не 400 от сервера. Код проверяется той же регуляркой,
 * что и на бэкенде (`isGearCode`), но только при создании.
 */
async function submit(): Promise<void> {
  const draft = form.value
  if (draft === null || isSaving.value) return

  const name = draft.name.trim()
  if (name.length === 0) {
    formError.value = 'У группы должно быть название'
    return
  }

  const rawSort = String(draft.sortOrder).trim()
  const sortOrder = rawSort === '' ? 0 : Number(rawSort)
  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    formError.value = 'Порядок — целое неотрицательное число'
    return
  }

  if (draft.id === null) {
    const code = draft.code.trim().toLowerCase()
    if (!isGearCode(code)) {
      formError.value = GEAR_CODE_HINT
      return
    }
  }

  isSaving.value = true
  formError.value = null

  try {
    if (draft.id === null) {
      await createGearGroupTemplate({
        code: draft.code.trim().toLowerCase(),
        name,
        sortOrder,
      })
    } else {
      await updateGearGroupTemplate(draft.id, {
        name,
        sortOrder,
        isActive: draft.isActive,
      })
    }

    closeForm()
    await load()
  } catch (cause) {
    formError.value = messageOf(cause, 'Не удалось сохранить рекомендуемую группу.')
  } finally {
    isSaving.value = false
  }
}

async function setActive(group: AdminGearGroupTemplate, isActive: boolean) {
  if (busyId.value !== null) return

  busyId.value = group.id
  error.value = null

  try {
    if (isActive) await updateGearGroupTemplate(group.id, { isActive: true })
    else await archiveGearGroupTemplate(group.id)

    await load()
  } catch (cause) {
    error.value = messageOf(
      cause,
      isActive ? 'Не удалось вернуть группу из архива.' : 'Не удалось убрать группу в архив.',
    )
  } finally {
    busyId.value = null
  }
}

/** Escape закрывает форму — как в остальных модалках админки. */
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (form.value === null) return

  closeForm()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  void load()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <section class="mt-10" data-test="gear-groups-admin">
    <h2 class="text-xl font-bold text-text">Рекомендуемые группы снаряжения</h2>

    <p class="mt-2 text-sm text-muted">
      Шаблоны, которые получает новый пользователь: «Кров» собирает палатку и тент,
      «Костровое» — топор, пилу и розжиг, хотя это разные типы. Человек вправе переименовать,
      переставить и удалить свою копию, а также переложить типы между группами — шаблон от этого
      не меняется. Рекомендуемую группу выбирают у типа в справочнике выше: новый тип попадёт
      в неё. «Прочее» — умолчание, оно существует всегда и в архив не убирается.
    </p>

    <p v-if="error" data-test="gear-groups-error" class="mt-3 text-sm text-red-600">{{ error }}</p>

    <div class="mt-4 flex flex-wrap items-center gap-2">
      <button
        type="button"
        data-test="add-group"
        class="cursor-pointer rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white"
        @click="openCreate"
      >
        Добавить группу
      </button>
      <span v-if="isLoading" class="text-sm text-muted">Загружаем…</span>
      <span v-else data-test="groups-count" class="text-sm text-muted">
        Действующих: {{ activeCount }} из {{ groups.length }}
      </span>
    </div>

    <p v-if="!isLoading && groups.length === 0" data-test="groups-empty" class="mt-3 text-sm text-muted">
      Групп пока нет. Пять базовых — «Кров», «Костровое», «Кухня», «Посуда» и «Прочее» —
      приезжают миграцией и сидом <code>seed:gear-groups</code>, остальные заводят здесь.
    </p>

    <ul v-else data-test="groups-list" class="mt-4 space-y-2">
      <li
        v-for="group in groups"
        :key="group.id"
        data-test="group-row"
        class="rounded-xl border border-border p-3"
        :class="group.isActive ? '' : 'opacity-60'"
      >
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 data-test="group-name" class="text-sm font-semibold text-text">
              {{ group.name }}
              <span
                v-if="!group.isActive"
                data-test="group-archived"
                class="ml-1 rounded bg-bg px-1.5 py-0.5 text-[10px] font-normal text-muted"
              >
                в архиве
              </span>
              <span
                v-if="group.code === DEFAULT_CODE"
                data-test="group-default"
                class="ml-1 rounded bg-bg px-1.5 py-0.5 text-[10px] font-normal text-muted"
              >
                умолчание
              </span>
            </h3>
            <p data-test="group-meta" class="text-xs text-muted">
              {{ group.code }} · порядок {{ group.sortOrder }} · рекомендованных типов
              {{ group.typesCount }}
            </p>
          </div>

          <div class="flex flex-wrap gap-1">
            <button
              type="button"
              data-test="group-edit"
              class="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs text-text hover:border-primary"
              @click="openEdit(group)"
            >
              Изменить
            </button>
            <button
              v-if="group.isActive && group.code !== DEFAULT_CODE"
              type="button"
              data-test="group-archive"
              :disabled="busyId !== null"
              class="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs text-text hover:border-red-600 hover:text-red-600 disabled:opacity-50"
              @click="setActive(group, false)"
            >
              В архив
            </button>
            <button
              v-else-if="!group.isActive"
              type="button"
              data-test="group-restore"
              :disabled="busyId !== null"
              class="cursor-pointer rounded-lg bg-primary px-2 py-1 text-xs text-white disabled:opacity-50"
              @click="setActive(group, true)"
            >
              Вернуть
            </button>
          </div>
        </div>
      </li>
    </ul>

    <!-- Форма шаблона -->
    <div
      v-if="form"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gear-group-form-title"
      @click.self="closeForm"
    >
      <form
        data-test="group-form"
        class="w-full max-w-md rounded-2xl bg-surface p-4 shadow-xl"
        @submit.prevent="submit"
      >
        <h2 id="gear-group-form-title" class="text-lg font-semibold text-text">
          {{ form.id === null ? 'Новая рекомендуемая группа' : 'Рекомендуемая группа' }}
        </h2>

        <label class="mt-3 block text-sm text-muted" for="gear-group-code">Код</label>
        <input
          id="gear-group-code"
          v-model="form.code"
          data-test="group-form-code"
          type="text"
          maxlength="40"
          :readonly="form.id !== null"
          placeholder="campfire"
          class="mt-1 w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text"
          :class="form.id !== null ? 'opacity-60' : ''"
        />
        <p class="mt-1 text-xs text-muted">
          <template v-if="form.id === null">{{ GEAR_CODE_HINT }}</template>
          <template v-else>
            Код не меняется: на него опирается умолчание и раскладка типов. Исправление — архив
            и новый код.
          </template>
        </p>

        <label class="mt-3 block text-sm text-muted" for="gear-group-name">Название</label>
        <input
          id="gear-group-name"
          v-model="form.name"
          data-test="group-form-name"
          type="text"
          :maxlength="GEAR_NAME_MAX_LENGTH"
          placeholder="Костровое"
          class="mt-1 w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text"
        />

        <label class="mt-3 block text-sm text-muted" for="gear-group-sort">Порядок</label>
        <input
          id="gear-group-sort"
          v-model="form.sortOrder"
          data-test="group-form-sort"
          type="number"
          min="0"
          class="mt-1 w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text"
        />
        <p class="mt-1 text-xs text-muted">
          Меньше число — выше секция в каталоге. «Прочее» по смыслу последнее, и его копия
          у человека всегда остаётся внизу.
        </p>

        <label
          v-if="form.id !== null"
          class="mt-3 flex cursor-pointer items-center gap-2 text-sm text-text"
        >
          <input
            v-model="form.isActive"
            data-test="group-form-active"
            type="checkbox"
            class="h-4 w-4 cursor-pointer"
          />
          Активна
        </label>

        <p v-if="formError" data-test="group-form-error" class="mt-3 text-sm text-red-600">
          {{ formError }}
        </p>

        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            data-test="group-form-cancel"
            class="cursor-pointer rounded-lg border border-border bg-bg px-4 py-2 text-sm text-text"
            @click="closeForm"
          >
            Отмена
          </button>
          <button
            type="submit"
            data-test="group-form-submit"
            :disabled="isSaving"
            class="cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            Сохранить
          </button>
        </div>
      </form>
    </div>
  </section>
</template>
