<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { ApiError } from '@/api/errors'
import {
  archiveGearGroup,
  createGearGroup,
  fetchAdminGearGroups,
  updateGearGroup,
} from '@/api/gearGroups'
import { GEAR_CODE_HINT, GEAR_NAME_MAX_LENGTH, isGearCode } from '@/types/gearTypes'
import { GEAR_DEFAULT_GROUP_CODE } from '@/types/gear'
import type { AdminGearGroup } from '@/types/gear'

/**
 * Группы снаряжения — админка полок каталога (31.10.2026).
 *
 * Заказчик: «Группа — это полка в каталоге и в снаряжении похода
 * („Костровое“, „Ночлег“), а не тип: одна группа собирает топор, пилу
 * и розжиг, которые лежат в разных типах. Заводит и упорядочивает админ
 * в `/admin/gear` рядом с типами».
 *
 * Секция стоит под списком типов и живёт отдельным компонентом: типы
 * и группы — разные справочники, и держать два набора форм и модалок
 * в одном файле значило бы сделать его нечитаемым. Сюда же переехали
 * ограничения, которые общие с типами: `code` — латиница и неизменяем,
 * удаления нет (только архив), порядок задаёт админ, а не алфавит.
 *
 * **«Прочее» (`other`) не архивируется.** Это группа по умолчанию: вещь
 * без явной полки падает в неё, поэтому сервер отвечает 409, а кнопки
 * архива у строки нет вовсе — «нажать и получить отказ» хуже, чем её
 * отсутствие с подписью «умолчание».
 *
 * Права проверяет бэкенд (`isAdminUser`): 403 «Раздел только для
 * администратора» показывается строкой сверху, фронт проверку не повторяет.
 */
const groups = ref<AdminGearGroup[]>([])
const error = ref<string | null>(null)
const isLoading = ref(false)

/** Что сейчас меняется: повторное нажатие не шлёт второй запрос. */
const busyId = ref<number | null>(null)

/** Черновик формы группы. `id: null` — создание: код вводится руками. */
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

/** Имя группы по умолчанию — его код защищён от архива на сервере. */
const DEFAULT_CODE = GEAR_DEFAULT_GROUP_CODE

const activeCount = computed(() => groups.value.filter((group) => group.isActive).length)

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback
}

async function load() {
  isLoading.value = true
  error.value = null

  try {
    groups.value = await fetchAdminGearGroups()
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось загрузить группы снаряжения.')
  } finally {
    isLoading.value = false
  }
}

function openCreate() {
  formError.value = null
  form.value = { id: null, code: '', name: '', sortOrder: 10, isActive: true }
}

function openEdit(group: AdminGearGroup) {
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
 * что и на бэкенде (`isGearCode`), но только при создании: в правке он
 * только для чтения и меняться не может.
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
      await createGearGroup({ code: draft.code.trim().toLowerCase(), name, sortOrder })
    } else {
      await updateGearGroup(draft.id, {
        name,
        sortOrder,
        isActive: draft.isActive,
      })
    }

    closeForm()
    await load()
  } catch (cause) {
    formError.value = messageOf(cause, 'Не удалось сохранить группу.')
  } finally {
    isSaving.value = false
  }
}

async function setActive(group: AdminGearGroup, isActive: boolean) {
  if (busyId.value !== null) return

  busyId.value = group.id
  error.value = null

  try {
    if (isActive) await updateGearGroup(group.id, { isActive: true })
    else await archiveGearGroup(group.id)

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
    <h2 class="text-xl font-bold text-text">Группы снаряжения</h2>

    <p class="mt-2 text-sm text-muted">
      Полки каталога: «Кров» собирает палатку и тент, «Костровое» — топор, пилу и розжиг, хотя это
      разные типы. Порядок групп — этот, а порядок вещей внутри группы человек задаёт сам стрелками
      в своём каталоге. Группа у вещи обязательна, поэтому «Прочее» существует всегда и в архив
      не убирается.
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
      Групп пока нет. Четыре базовые — «Кров», «Костровое», «Кухня» и «Прочее» — приезжают миграцией
      и сидом <code>seed:gear-groups</code>, остальные заводят здесь.
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
              {{ group.code }} · порядок {{ group.sortOrder }} · вещей {{ group.itemsCount }}
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

    <!-- Форма группы -->
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
          {{ form.id === null ? 'Новая группа снаряжения' : 'Группа снаряжения' }}
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
            Код не меняется: на него опирается умолчание и фильтры. Исправление — архив и новый код.
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

        <label class="mt-3 block text-sm text-muted" for="gear-group-sort">Порядок полок</label>
        <input
          id="gear-group-sort"
          v-model="form.sortOrder"
          data-test="group-form-sort"
          type="number"
          min="0"
          class="mt-1 w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text"
        />
        <p class="mt-1 text-xs text-muted">
          Меньше число — выше секция в каталоге. «Прочее» стоит последним по смыслу, но порядок
          можно поставить любой.
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
