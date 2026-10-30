<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { ApiError } from '@/api/errors'
import {
  archiveGearType,
  archiveGearTypeAttribute,
  createGearType,
  createGearTypeAttribute,
  fetchAdminGearTypes,
  updateGearType,
  updateGearTypeAttribute,
} from '@/api/gearTypes'
import {
  GEAR_CODE_ERROR,
  GEAR_CODE_HINT,
  GEAR_FILL_MISSING_HINTS,
  GEAR_NAME_MAX_LENGTH,
  GEAR_UNIT_MAX_LENGTH,
  GEAR_VALUE_KINDS,
  GEAR_VALUE_KIND_LABELS,
  isGearCode,
} from '@/types/gearTypes'
import type {
  AdminGearType,
  AdminGearTypeAttribute,
  GearTypeAttribute,
  GearValueKind,
} from '@/types/gearTypes'

/**
 * Справочник типов снаряжения — админка Stage A.
 *
 * Что здесь: плоский список типов и их характеристик, формы типа
 * и характеристики, архив и возврат из него. Чего нет и не будет до Stage B:
 * групп у типов, экземпляров вещей, значений характеристик и прав кроме
 * администратора.
 *
 * **Права проверяет бэкенд** (`isAdminUser`, захардкоженный UUID): чужому
 * список отвечает 403 «Раздел только для администратора», и это сообщение
 * просто показывается сверху. Фронт проверку не повторяет — иначе она
 * разошлась бы с серверной, и админ видел бы пустой экран вместо причины.
 *
 * **Удаления нет, есть архив.** «В архив» ставит `is_active = false`
 * (архивный тип не попадает в публичный `GET /api/gear-types`, но остаётся
 * виден здесь), «Вернуть» возвращает. Физическое удаление выдернуло бы
 * в Stage B вещи, которые на тип ссылаются.
 *
 * **`code` и `valueKind` неизменяемы**, поэтому в правке поля только
 * для чтения, а под ними — совет: исправление это архив и новая строка
 * с новым кодом.
 */

const types = ref<AdminGearType[]>([])
const error = ref<string | null>(null)
const isLoading = ref(false)

/**
 * Черновик формы типа.
 *
 * `id: null` — создание: код вводится руками и больше не меняется.
 * `sortOrder` — `string | number`: поле ввода `type="number"` под `v-model`
 * Vue приводит к числу сам, а нам нужно различать пустое поле (это 0)
 * и мусор (это ошибка) до запроса, а не 400-м от сервера.
 */
interface TypeForm {
  id: number | null
  code: string
  name: string
  sortOrder: string | number
  isActive: boolean
}

/**
 * Черновик формы характеристики.
 *
 * `wasRequired` — состояние до правки: замещающее значение спрашивают только
 * при **включении** обязательности (создание или `false → true`), как и
 * требует API. Если характеристика уже обязательна, поле не показывается:
 * в Stage A значение всё равно нигде не хранится.
 */
interface AttributeForm {
  id: number | null
  typeId: number
  code: string
  name: string
  valueKind: GearValueKind
  unit: string
  isRequired: boolean
  sortOrder: string | number
  isActive: boolean
  fillNumber: string
  fillText: string
  fillBool: boolean
  wasRequired: boolean
}

const typeForm = ref<TypeForm | null>(null)
const typeFormError = ref<string | null>(null)
const attributeForm = ref<AttributeForm | null>(null)
const attributeFormError = ref<string | null>(null)

const SORT_ORDER_ERROR = 'Порядок — целое число от 0'
const NAME_EMPTY_ERROR = 'Название не может быть пустым'

/** Замещающее значение нужно только при включении обязательности. */
const needsFillMissing = computed(() => {
  const form = attributeForm.value

  return form !== null && form.isRequired && !form.wasRequired
})

/** Человеческое сообщение: текст бэкенда, если это ответ сервера. */
function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback
}

async function load() {
  isLoading.value = true
  error.value = null
  try {
    types.value = await fetchAdminGearTypes()
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось загрузить справочник.')
  } finally {
    isLoading.value = false
  }
}

/** Хвост заголовка типа: код, число характеристик, сколько в архиве. */
function typeMeta(type: AdminGearType): string {
  const active = type.attributes.filter((attribute) => attribute.isActive).length
  const archived = type.attributes.length - active
  const parts = [type.code, `характеристик: ${active}`]

  if (archived > 0) parts.push(`в архиве: ${archived}`)

  return parts.join(' · ')
}

/** Строка характеристики: код, вид, единица, обязательность. */
function attributeMeta(attribute: GearTypeAttribute): string {
  const parts = [attribute.code, GEAR_VALUE_KIND_LABELS[attribute.valueKind]]

  if (attribute.unit) parts.push(attribute.unit)
  parts.push(attribute.isRequired ? 'обязательная' : 'необязательная')

  return parts.join(' · ')
}

/** Порядок: пустое поле — 0, нечисло — ошибка (`null`). */
function parseSortOrder(raw: string | number): number | null {
  const trimmed = String(raw).trim()

  if (trimmed === '') return 0
  if (!/^\d+$/.test(trimmed)) return null

  return Number(trimmed)
}

/** Число из строки: запятая как разделитель — привычка русской раскладки. */
function parseNumberValue(raw: string): number | null {
  const trimmed = raw.trim()

  if (trimmed === '') return null

  const value = Number(trimmed.replace(',', '.'))

  return Number.isFinite(value) ? value : null
}

// ───────────────────────────── архив и возврат ─────────────────────────────

async function setTypeActive(type: AdminGearType, isActive: boolean) {
  try {
    if (isActive) await updateGearType(type.id, { isActive: true })
    else await archiveGearType(type.id)
    await load()
  } catch (cause) {
    error.value = messageOf(cause, 'Не получилось.')
  }
}

async function setAttributeActive(
  type: AdminGearType,
  attribute: AdminGearTypeAttribute,
  isActive: boolean,
) {
  try {
    if (isActive) await updateGearTypeAttribute(type.id, attribute.id, { isActive: true })
    else await archiveGearTypeAttribute(type.id, attribute.id)
    await load()
  } catch (cause) {
    error.value = messageOf(cause, 'Не получилось.')
  }
}

// ───────────────────────────────── тип ─────────────────────────────────

function openTypeCreate() {
  typeFormError.value = null
  typeForm.value = { id: null, code: '', name: '', sortOrder: '0', isActive: true }
}

function openTypeEdit(type: AdminGearType) {
  typeFormError.value = null
  typeForm.value = {
    id: type.id,
    code: type.code,
    name: type.name,
    sortOrder: String(type.sortOrder),
    isActive: type.isActive,
  }
}

function closeTypeForm() {
  typeForm.value = null
  typeFormError.value = null
}

async function submitTypeForm() {
  const form = typeForm.value
  if (form === null) return

  typeFormError.value = null

  const code = form.code.trim()
  const name = form.name.trim()
  const sortOrder = parseSortOrder(form.sortOrder)

  if (name === '') {
    typeFormError.value = NAME_EMPTY_ERROR
    return
  }
  if (sortOrder === null) {
    typeFormError.value = SORT_ORDER_ERROR
    return
  }
  // Код проверяется только при создании: в правке он не отправляется.
  if (form.id === null && !isGearCode(code)) {
    typeFormError.value = GEAR_CODE_ERROR
    return
  }

  try {
    if (form.id === null) {
      await createGearType({ code, name, sortOrder })
    } else {
      await updateGearType(form.id, { name, sortOrder, isActive: form.isActive })
    }
    closeTypeForm()
    await load()
  } catch (cause) {
    typeFormError.value = messageOf(cause, 'Не удалось сохранить тип.')
  }
}

// ──────────────────────────── характеристика ────────────────────────────

function openAttributeCreate(type: AdminGearType) {
  attributeFormError.value = null
  attributeForm.value = {
    id: null,
    typeId: type.id,
    code: '',
    name: '',
    valueKind: 'number',
    unit: '',
    isRequired: false,
    sortOrder: '0',
    isActive: true,
    fillNumber: '',
    fillText: '',
    fillBool: false,
    wasRequired: false,
  }
}

function openAttributeEdit(type: AdminGearType, attribute: AdminGearTypeAttribute) {
  attributeFormError.value = null
  attributeForm.value = {
    id: attribute.id,
    typeId: type.id,
    code: attribute.code,
    name: attribute.name,
    valueKind: attribute.valueKind,
    unit: attribute.unit ?? '',
    isRequired: attribute.isRequired,
    sortOrder: String(attribute.sortOrder),
    isActive: attribute.isActive,
    fillNumber: '',
    fillText: '',
    fillBool: false,
    wasRequired: attribute.isRequired,
  }
}

function closeAttributeForm() {
  attributeForm.value = null
  attributeFormError.value = null
}

/**
 * Замещающее значение из формы — по виду характеристики.
 *
 * Ошибка возвращается строкой: сообщения дословно те же, что у сервиса,
 * чтобы админ не видел два разных объяснения одного правила.
 */
function readFillMissing(form: AttributeForm): number | string | boolean | null {
  if (form.valueKind === 'number') {
    const value = parseNumberValue(form.fillNumber)
    if (value === null) {
      attributeFormError.value = 'Для числовой характеристики замещающее значение — число, например 0'
      return null
    }

    return value
  }

  if (form.valueKind === 'text') {
    const value = form.fillText.trim()
    if (value === '') {
      attributeFormError.value = 'Для текстовой характеристики замещающее значение — непустая строка'
      return null
    }

    return value
  }

  return form.fillBool
}

async function submitAttributeForm() {
  const form = attributeForm.value
  if (form === null) return

  attributeFormError.value = null

  const code = form.code.trim()
  const name = form.name.trim()
  const unit = form.unit.trim()
  const sortOrder = parseSortOrder(form.sortOrder)

  if (name === '') {
    attributeFormError.value = NAME_EMPTY_ERROR
    return
  }
  if (unit.length > GEAR_UNIT_MAX_LENGTH) {
    attributeFormError.value = `Единица не должна превышать ${GEAR_UNIT_MAX_LENGTH} символов`
    return
  }
  if (sortOrder === null) {
    attributeFormError.value = SORT_ORDER_ERROR
    return
  }
  if (form.id === null && !isGearCode(code)) {
    attributeFormError.value = GEAR_CODE_ERROR
    return
  }

  // В Stage A значение никуда не пишется, но проверяется: правило ставим
  // сейчас, чтобы контракт не менялся в Stage B.
  const fillMissing = needsFillMissing.value ? readFillMissing(form) : undefined
  if (needsFillMissing.value && attributeFormError.value !== null) return

  const unitValue = unit === '' ? null : unit

  try {
    if (form.id === null) {
      await createGearTypeAttribute(form.typeId, {
        code,
        name,
        valueKind: form.valueKind,
        unit: unitValue,
        isRequired: form.isRequired,
        sortOrder,
        ...(fillMissing === undefined ? {} : { fillMissing }),
      })
    } else {
      await updateGearTypeAttribute(form.typeId, form.id, {
        name,
        unit: unitValue,
        isRequired: form.isRequired,
        sortOrder,
        isActive: form.isActive,
        ...(fillMissing === undefined ? {} : { fillMissing }),
      })
    }
    closeAttributeForm()
    await load()
  } catch (cause) {
    attributeFormError.value = messageOf(cause, 'Не удалось сохранить характеристику.')
  }
}

// ──────────────────────────────── модалки ────────────────────────────────

/** Escape закрывает открытую форму: их не больше одной за раз. */
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return

  if (typeForm.value !== null) closeTypeForm()
  else if (attributeForm.value !== null) closeAttributeForm()
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
  <!-- Внешний контейнер даёт общий каркас приложения (App.vue) -->
  <main>
    <h1 class="text-2xl font-bold text-text">Типы снаряжения</h1>

    <p class="mt-2 text-sm text-muted">
      Справочник типов и их характеристик: «Палатка» с вместимостью и моделью, «Пила» с приводом
      и полотном. Вещи пока живут по-старому — тип и значения характеристик появятся у них
      следующим шагом, поэтому здесь ничего не ломает личный каталог.
    </p>

    <p v-if="error" data-test="gear-types-error" class="mt-3 text-sm text-red-600">{{ error }}</p>

    <div class="mt-4 flex flex-wrap items-center gap-2">
      <button
        type="button"
        data-test="add-type"
        class="cursor-pointer rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white"
        @click="openTypeCreate"
      >
        Добавить тип
      </button>
      <span v-if="isLoading" class="text-sm text-muted">Загружаем…</span>
    </div>

    <p v-if="!isLoading && types.length === 0" data-test="types-empty" class="mt-3 text-sm text-muted">
      Типов пока нет. Пять базовых — палатка, топор, пила, розжиг и газовый баллон — приезжают
      сидом <code>seed:gear-types</code>, остальные заводят здесь.
    </p>

    <ul v-else data-test="types-list" class="mt-4 space-y-3">
      <li
        v-for="type in types"
        :key="type.id"
        data-test="type-row"
        class="rounded-xl border border-border p-3"
        :class="type.isActive ? '' : 'opacity-60'"
      >
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 data-test="type-name" class="text-base font-semibold text-text">
              {{ type.name }}
              <span
                v-if="!type.isActive"
                data-test="type-archived"
                class="ml-1 rounded bg-bg px-1.5 py-0.5 text-[10px] font-normal text-muted"
              >
                в архиве
              </span>
            </h2>
            <p data-test="type-meta" class="text-xs text-muted">{{ typeMeta(type) }}</p>
          </div>

          <div class="flex flex-wrap gap-1">
            <button
              type="button"
              data-test="type-add-attribute"
              class="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs text-text hover:border-primary"
              @click="openAttributeCreate(type)"
            >
              Добавить характеристику
            </button>
            <button
              type="button"
              data-test="type-edit"
              class="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs text-text hover:border-primary"
              @click="openTypeEdit(type)"
            >
              Изменить
            </button>
            <button
              v-if="type.isActive"
              type="button"
              data-test="type-archive"
              class="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs text-text hover:border-red-600 hover:text-red-600"
              @click="setTypeActive(type, false)"
            >
              В архив
            </button>
            <button
              v-else
              type="button"
              data-test="type-restore"
              class="cursor-pointer rounded-lg bg-primary px-2 py-1 text-xs text-white"
              @click="setTypeActive(type, true)"
            >
              Вернуть
            </button>
          </div>
        </div>

        <ul v-if="type.attributes.length > 0" data-test="type-attributes" class="mt-2 divide-y divide-border">
          <li
            v-for="attribute in type.attributes"
            :key="attribute.id"
            data-test="attribute-row"
            class="flex flex-wrap items-start justify-between gap-2 py-1.5"
            :class="attribute.isActive ? '' : 'opacity-60'"
          >
            <div>
              <span data-test="attribute-name" class="text-sm text-text">{{ attribute.name }}</span>
              <span
                v-if="!attribute.isActive"
                data-test="attribute-archived"
                class="ml-1 rounded bg-bg px-1.5 py-0.5 text-[10px] text-muted"
              >
                в архиве
              </span>
              <p data-test="attribute-meta" class="text-xs text-muted">{{ attributeMeta(attribute) }}</p>
            </div>

            <div class="flex flex-wrap gap-1">
              <button
                type="button"
                data-test="attribute-edit"
                class="cursor-pointer rounded-lg border border-border px-2 py-0.5 text-xs text-text hover:border-primary"
                @click="openAttributeEdit(type, attribute)"
              >
                Изменить
              </button>
              <button
                v-if="attribute.isActive"
                type="button"
                data-test="attribute-archive"
                class="cursor-pointer rounded-lg border border-border px-2 py-0.5 text-xs text-text hover:border-red-600 hover:text-red-600"
                @click="setAttributeActive(type, attribute, false)"
              >
                В архив
              </button>
              <button
                v-else
                type="button"
                data-test="attribute-restore"
                class="cursor-pointer rounded-lg border border-border px-2 py-0.5 text-xs text-text hover:border-primary"
                @click="setAttributeActive(type, attribute, true)"
              >
                Вернуть
              </button>
            </div>
          </li>
        </ul>

        <p v-else data-test="attributes-empty" class="mt-2 text-xs text-muted">
          Характеристик нет — вещь этого типа описывается только названием.
        </p>
      </li>
    </ul>

    <!-- Форма типа -->
    <div
      v-if="typeForm"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gear-type-form-title"
      @click.self="closeTypeForm"
    >
      <form
        data-test="type-form"
        class="w-full max-w-md rounded-2xl bg-surface p-4 shadow-xl"
        @submit.prevent="submitTypeForm"
      >
        <h2 id="gear-type-form-title" class="text-lg font-semibold text-text">
          {{ typeForm.id === null ? 'Новый тип снаряжения' : 'Тип снаряжения' }}
        </h2>

        <label class="mt-3 block text-sm text-muted" for="gear-type-code">Код</label>
        <input
          id="gear-type-code"
          v-model="typeForm.code"
          data-test="type-form-code"
          type="text"
          :disabled="typeForm.id !== null"
          placeholder="backpack"
          class="mt-1 w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text disabled:opacity-60"
        />
        <p class="mt-1 text-xs text-muted">
          {{
            typeForm.id === null
              ? GEAR_CODE_HINT
              : 'Код не меняется: исправление — архив и новый тип с новым кодом.'
          }}
        </p>

        <label class="mt-3 block text-sm text-muted" for="gear-type-name">Название</label>
        <input
          id="gear-type-name"
          v-model="typeForm.name"
          data-test="type-form-name"
          type="text"
          :maxlength="GEAR_NAME_MAX_LENGTH"
          placeholder="Палатка"
          class="mt-1 w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text"
        />

        <label class="mt-3 block text-sm text-muted" for="gear-type-sort">Порядок в списке</label>
        <input
          id="gear-type-sort"
          v-model="typeForm.sortOrder"
          data-test="type-form-sort"
          type="number"
          min="0"
          class="mt-1 w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text"
        />

        <label v-if="typeForm.id !== null" class="mt-3 flex cursor-pointer items-center gap-2 text-sm text-text">
          <input
            v-model="typeForm.isActive"
            data-test="type-form-active"
            type="checkbox"
            class="h-4 w-4 cursor-pointer"
          />
          Активно
        </label>

        <p v-if="typeFormError" data-test="type-form-error" class="mt-3 text-sm text-red-600">
          {{ typeFormError }}
        </p>

        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            data-test="type-form-cancel"
            class="cursor-pointer rounded-lg border border-border bg-bg px-4 py-2 text-sm text-text"
            @click="closeTypeForm"
          >
            Отмена
          </button>
          <button
            type="submit"
            data-test="type-form-submit"
            class="cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white"
          >
            Сохранить
          </button>
        </div>
      </form>
    </div>

    <!-- Форма характеристики -->
    <div
      v-if="attributeForm"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gear-attribute-form-title"
      @click.self="closeAttributeForm"
    >
      <form
        data-test="attr-form"
        class="max-h-full w-full max-w-md overflow-y-auto rounded-2xl bg-surface p-4 shadow-xl"
        @submit.prevent="submitAttributeForm"
      >
        <h2 id="gear-attribute-form-title" class="text-lg font-semibold text-text">
          {{ attributeForm.id === null ? 'Новая характеристика' : 'Характеристика' }}
        </h2>

        <label class="mt-3 block text-sm text-muted" for="gear-attr-code">Код</label>
        <input
          id="gear-attr-code"
          v-model="attributeForm.code"
          data-test="attr-form-code"
          type="text"
          :disabled="attributeForm.id !== null"
          placeholder="volume"
          class="mt-1 w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text disabled:opacity-60"
        />
        <p class="mt-1 text-xs text-muted">
          {{
            attributeForm.id === null
              ? GEAR_CODE_HINT
              : 'Код не меняется: исправление — архив и новая характеристика с новым кодом.'
          }}
        </p>

        <label class="mt-3 block text-sm text-muted" for="gear-attr-name">Название</label>
        <input
          id="gear-attr-name"
          v-model="attributeForm.name"
          data-test="attr-form-name"
          type="text"
          :maxlength="GEAR_NAME_MAX_LENGTH"
          placeholder="Вместимость"
          class="mt-1 w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text"
        />

        <label class="mt-3 block text-sm text-muted" for="gear-attr-kind">Вид значения</label>
        <select
          id="gear-attr-kind"
          v-model="attributeForm.valueKind"
          data-test="attr-form-kind"
          :disabled="attributeForm.id !== null"
          class="mt-1 w-full cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-base text-text disabled:opacity-60"
        >
          <option v-for="kind in GEAR_VALUE_KINDS" :key="kind" :value="kind">
            {{ GEAR_VALUE_KIND_LABELS[kind] }}
          </option>
        </select>
        <p v-if="attributeForm.id !== null" class="mt-1 text-xs text-muted">
          Вид не меняется: смена означала бы перенос уже записанных значений. Исправление — архив
          и новая характеристика с новым кодом.
        </p>

        <label class="mt-3 block text-sm text-muted" for="gear-attr-unit">Единица измерения</label>
        <input
          id="gear-attr-unit"
          v-model="attributeForm.unit"
          data-test="attr-form-unit"
          type="text"
          :maxlength="GEAR_UNIT_MAX_LENGTH"
          placeholder="мест"
          class="mt-1 w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text"
        />
        <p class="mt-1 text-xs text-muted">
          Для числа — «мест», «см», «л»; у текста и галочки единицы обычно нет — оставьте пустым.
        </p>

        <label class="mt-3 flex cursor-pointer items-center gap-2 text-sm text-text">
          <input
            v-model="attributeForm.isRequired"
            data-test="attr-form-required"
            type="checkbox"
            class="h-4 w-4 cursor-pointer"
          />
          Обязательная характеристика
        </label>

        <!-- Замещающее значение: только при включении обязательности -->
        <template v-if="needsFillMissing">
          <label class="mt-3 block text-sm text-muted" for="gear-attr-fill">
            Замещающее значение
          </label>

          <select
            v-if="attributeForm.valueKind === 'bool'"
            id="gear-attr-fill"
            v-model="attributeForm.fillBool"
            data-test="attr-form-fill-bool"
            class="mt-1 w-full cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-base text-text"
          >
            <option :value="false">Нет (false)</option>
            <option :value="true">Да (true)</option>
          </select>

          <input
            v-else-if="attributeForm.valueKind === 'number'"
            id="gear-attr-fill"
            v-model="attributeForm.fillNumber"
            data-test="attr-form-fill-number"
            type="text"
            inputmode="decimal"
            placeholder="0"
            class="mt-1 w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text"
          />

          <input
            v-else
            id="gear-attr-fill"
            v-model="attributeForm.fillText"
            data-test="attr-form-fill-text"
            type="text"
            placeholder="нет данных"
            class="mt-1 w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text"
          />

          <p data-test="attr-form-fill-hint" class="mt-1 text-xs text-muted">
            Подойдёт {{ GEAR_FILL_MISSING_HINTS[attributeForm.valueKind] }}. В Stage A не
            применяется — экземпляров вещей ещё нет; начнёт применяться в Stage B.
          </p>
        </template>

        <label class="mt-3 block text-sm text-muted" for="gear-attr-sort">Порядок в форме</label>
        <input
          id="gear-attr-sort"
          v-model="attributeForm.sortOrder"
          data-test="attr-form-sort"
          type="number"
          min="0"
          class="mt-1 w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text"
        />

        <label
          v-if="attributeForm.id !== null"
          class="mt-3 flex cursor-pointer items-center gap-2 text-sm text-text"
        >
          <input
            v-model="attributeForm.isActive"
            data-test="attr-form-active"
            type="checkbox"
            class="h-4 w-4 cursor-pointer"
          />
          Активна
        </label>

        <p v-if="attributeFormError" data-test="attr-form-error" class="mt-3 text-sm text-red-600">
          {{ attributeFormError }}
        </p>

        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            data-test="attr-form-cancel"
            class="cursor-pointer rounded-lg border border-border bg-bg px-4 py-2 text-sm text-text"
            @click="closeAttributeForm"
          >
            Отмена
          </button>
          <button
            type="submit"
            data-test="attr-form-submit"
            class="cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white"
          >
            Сохранить
          </button>
        </div>
      </form>
    </div>
  </main>
</template>
