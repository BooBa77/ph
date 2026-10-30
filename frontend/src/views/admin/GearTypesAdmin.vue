<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { ApiError } from '@/api/errors'
import {
  archiveGearType,
  archiveGearTypeAttribute,
  createGearAttributeOption,
  createGearType,
  createGearTypeAttribute,
  fetchAdminGearTypes,
  updateGearAttributeOption,
  updateGearType,
  updateGearTypeAttribute,
} from '@/api/gearTypes'
import {
  GEAR_CODE_ERROR,
  GEAR_CODE_HINT,
  GEAR_CODE_MAX_LENGTH,
  GEAR_FILL_MISSING_HINTS,
  GEAR_NAME_MAX_LENGTH,
  GEAR_OPTIONS_MAX,
  GEAR_UNIT_MAX_LENGTH,
  GEAR_VALUE_KINDS,
  GEAR_VALUE_KIND_LABELS,
  isGearCode,
} from '@/types/gearTypes'
import type {
  AdminGearAttributeOption,
  AdminGearType,
  AdminGearTypeAttribute,
  CreateGearAttributeOptionInput,
  GearValueKind,
} from '@/types/gearTypes'

/**
 * Справочник типов снаряжения — админка Stage A.
 *
 * Что здесь: плоский список типов и их характеристик, формы типа
 * и характеристики, варианты характеристики-списка, архив и возврат из него.
 * Чего нет и не будет до Stage B: групп у типов, экземпляров вещей и значений
 * характеристик.
 *
 * **Список вариантов (30.10.2026).** Четвёртый вид значения — `select`:
 * у характеристики появляются варианты («резьбовой», «цанговый») и флаг
 * «разрешить своё значение». Варианты заводятся **в форме создания
 * характеристики** — сразу вместе с ней, одной транзакцией на сервере,
 * чтобы не оставалось списка, в котором нечего выбирать. Дальше каждый
 * вариант правится отдельно: в строке характеристики — чипы, клик по чипу
 * открывает форму варианта (имя, порядок, архив). Так переименование
 * и архивация не превращаются в «пересобрать весь список».
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
 *
 * `options` — только создание: варианты списка уходят вместе с характеристикой
 * одним запросом. В правке набор вариантов не трогается (иначе пришлось бы
 * сравнивать «до и после» и гадать, что админ хотел архивировать), а каждый
 * вариант правится своей формой из строки характеристики.
 *
 * `optionNames` — названия активных вариантов уже существующего списка:
 * по ним проверяется замещающее значение, когда своё значение запрещено.
 */
interface OptionDraft {
  /** Ключ строки в форме: у нового варианта id ещё нет. */
  key: number
  code: string
  name: string
  sortOrder: string | number
}

interface AttributeForm {
  id: number | null
  typeId: number
  code: string
  name: string
  valueKind: GearValueKind
  unit: string
  isRequired: boolean
  allowCustomValue: boolean
  sortOrder: string | number
  isActive: boolean
  fillNumber: string
  fillText: string
  fillBool: boolean
  wasRequired: boolean
  options: OptionDraft[]
  optionNames: string[]
  /** Имя типа — для подсказок в форме («добавить в «Горелка»»). */
  typeName: string
}

/**
 * Черновик формы варианта списка.
 *
 * `id: null` — создание: код вводится и больше не меняется. У существующего
 * варианта `code` только для чтения, а `isActive` — это и есть архив:
 * снятая галочка убирает вариант из выбора, не удаляя строку.
 */
interface OptionForm {
  id: number | null
  typeId: number
  attributeId: number
  code: string
  name: string
  sortOrder: string | number
  isActive: boolean
}

const typeForm = ref<TypeForm | null>(null)
const typeFormError = ref<string | null>(null)
const attributeForm = ref<AttributeForm | null>(null)
const attributeFormError = ref<string | null>(null)
const optionForm = ref<OptionForm | null>(null)
const optionFormError = ref<string | null>(null)

/** Счётчик ключей строк вариантов: индекс в массиве для `v-for` не годится. */
let draftKey = 0

const SORT_ORDER_ERROR = 'Порядок — целое число от 0'
const NAME_EMPTY_ERROR = 'Название не может быть пустым'

/** Замещающее значение нужно только при включении обязательности. */
const needsFillMissing = computed(() => {
  const form = attributeForm.value

  return form !== null && form.isRequired && !form.wasRequired
})

/** В форме открыт вид «список вариантов»: от него зависят поля и проверки. */
const isSelectForm = computed(
  () => attributeForm.value !== null && attributeForm.value.valueKind === 'select',
)

/** Названия вариантов для подсказки о замещающем значении. */
const fillOptionNames = computed<string[]>(() => {
  const form = attributeForm.value
  if (form === null) return []

  // В правке варианты уже в базе, в создании — ещё в черновике.
  if (form.id !== null) return form.optionNames

  return form.options.map((option) => option.name.trim()).filter((name) => name !== '')
})

/** Подсказка под полем замещающего значения: одна и та же для всех видов. */
const fillMissingHint = computed<string>(() => {
  const form = attributeForm.value
  if (form === null) return ''

  const hint = GEAR_FILL_MISSING_HINTS[form.valueKind]
  if (form.valueKind !== 'select') return hint

  const names = fillOptionNames.value
  const list = names.length > 0 ? `: ${names.map((name) => `«${name}»`).join(', ')}` : ''
  if (form.allowCustomValue) return `название варианта${list} или своё значение`

  return `${hint}${list}`
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

/**
 * Строка характеристики: код, вид, единица, варианты, обязательность.
 *
 * У списка вместо единицы — сколько вариантов активно и разрешено ли своё
 * значение: «мест» и «см» рядом с «резьбовой» ничего не значат.
 */
function attributeMeta(attribute: AdminGearTypeAttribute): string {
  const parts = [attribute.code, GEAR_VALUE_KIND_LABELS[attribute.valueKind]]

  if (attribute.unit) parts.push(attribute.unit)
  if (attribute.valueKind === 'select') {
    const active = attribute.options.filter((option) => option.isActive).length
    parts.push(active === 1 ? '1 вариант' : `вариантов: ${active}`)
    parts.push(attribute.allowCustomValue ? 'можно своё' : 'только из списка')
  }
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
    typeName: type.name,
    code: '',
    name: '',
    valueKind: 'number',
    unit: '',
    isRequired: false,
    allowCustomValue: false,
    sortOrder: '0',
    isActive: true,
    fillNumber: '',
    fillText: '',
    fillBool: false,
    wasRequired: false,
    options: [],
    optionNames: [],
  }
}

function openAttributeEdit(type: AdminGearType, attribute: AdminGearTypeAttribute) {
  attributeFormError.value = null
  attributeForm.value = {
    id: attribute.id,
    typeId: type.id,
    typeName: type.name,
    code: attribute.code,
    name: attribute.name,
    valueKind: attribute.valueKind,
    unit: attribute.unit ?? '',
    isRequired: attribute.isRequired,
    allowCustomValue: attribute.allowCustomValue,
    sortOrder: String(attribute.sortOrder),
    isActive: attribute.isActive,
    fillNumber: '',
    fillText: '',
    fillBool: false,
    wasRequired: attribute.isRequired,
    // В правке набор не пересобирается: у каждого варианта своя форма.
    options: [],
    optionNames: attribute.options
      .filter((option) => option.isActive)
      .map((option) => option.name),
  }
}

function closeAttributeForm() {
  attributeForm.value = null
  attributeFormError.value = null
}

/**
 * Смена вида значения в форме.
 *
 * Список переключается на строку вариантов сразу: пустая форма без единого
 * варианта — это та самая «мёртвая» характеристика, которой заказчик просил
 * не допускать. При уходе с `select` черновики выбрасываются, чтобы вариант
 * не уехал в числовую характеристику (сервер ответил бы 400).
 */
function onAttributeKindChange() {
  const form = attributeForm.value
  if (form === null) return

  if (form.valueKind === 'select') {
    if (form.options.length === 0) addOptionDraft()
  } else {
    form.options = []
    form.allowCustomValue = false
  }
}

function addOptionDraft() {
  const form = attributeForm.value
  if (form === null || form.options.length >= GEAR_OPTIONS_MAX) return

  draftKey += 1
  form.options.push({ key: draftKey, code: '', name: '', sortOrder: '0' })
}

function removeOptionDraft(key: number) {
  const form = attributeForm.value
  if (form === null) return

  form.options = form.options.filter((option) => option.key !== key)
}

/**
 * Варианты из черновика — до запроса.
 *
 * Пустая строка (нет ни кода, ни имени) просто не заполнена и выбрасывается;
 * наполовину заполненная — ошибка, а не «забыли код». Повторы кода и имени
 * ловятся здесь же: сервер ответил бы 409, но админу полезнее увидеть это
 * до отправки и рядом с полем.
 */
function readOptionDrafts(form: AttributeForm): CreateGearAttributeOptionInput[] | null {
  const result: CreateGearAttributeOptionInput[] = []
  const codes = new Set<string>()
  const names = new Set<string>()

  for (const [index, draft] of form.options.entries()) {
    const code = draft.code.trim()
    const name = draft.name.trim()
    const sortOrder = parseSortOrder(draft.sortOrder)

    if (code === '' && name === '') continue
    if (code === '' || name === '') {
      attributeFormError.value = `У варианта ${index + 1} нужны и код, и название`
      return null
    }
    if (!isGearCode(code)) {
      attributeFormError.value = GEAR_CODE_ERROR
      return null
    }
    if (name.length > GEAR_NAME_MAX_LENGTH) {
      attributeFormError.value = `Название варианта не должно превышать ${GEAR_NAME_MAX_LENGTH} символов`
      return null
    }
    if (sortOrder === null) {
      attributeFormError.value = SORT_ORDER_ERROR
      return null
    }
    if (codes.has(code)) {
      attributeFormError.value = `Вариант с кодом «${code}» повторяется`
      return null
    }
    if (names.has(name.toLowerCase())) {
      attributeFormError.value = `Вариант с названием «${name}» повторяется: значения хранятся текстом, два одинаковых имени неразличимы`
      return null
    }

    codes.add(code)
    names.add(name.toLowerCase())
    result.push({ code, name, sortOrder })
  }

  if (result.length > GEAR_OPTIONS_MAX) {
    attributeFormError.value = `Вариантов не может быть больше ${GEAR_OPTIONS_MAX}`
    return null
  }

  return result
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

  if (form.valueKind === 'text' || form.valueKind === 'select') {
    const value = form.fillText.trim()
    if (value === '') {
      attributeFormError.value =
        form.valueKind === 'select'
          ? 'Для списка замещающее значение — название варианта или своё значение'
          : 'Для текстовой характеристики замещающее значение — непустая строка'
      return null
    }
    if (form.valueKind === 'select' && !form.allowCustomValue && !fillOptionNames.value.includes(value)) {
      attributeFormError.value = `Для списка замещающее значение — один из вариантов: ${fillOptionNames.value
        .map((optionName) => `«${optionName}»`)
        .join(', ')}. Своё значение не разрешено`
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

  // Список: варианты собираются до проверки замещающего значения —
  // его подсказка строится по тем же черновикам.
  const options = form.id === null && form.valueKind === 'select' ? readOptionDrafts(form) : null
  if (options === null && form.id === null && form.valueKind === 'select') return

  if (form.valueKind === 'select' && !form.allowCustomValue && (options?.length ?? 0) === 0 && form.id === null) {
    attributeFormError.value = 'Добавьте хотя бы один вариант или разрешите своё значение'
    return
  }

  // У списка единицы измерения нет: «резьбовой мест» ничего не значит.
  const unitValue = form.valueKind === 'select' || unit === '' ? null : unit

  // В Stage A значение никуда не пишется, но проверяется: правило ставим
  // сейчас, чтобы контракт не менялся в Stage B.
  const fillMissing = needsFillMissing.value ? readFillMissing(form) : undefined
  if (needsFillMissing.value && attributeFormError.value !== null) return

  try {
    if (form.id === null) {
      await createGearTypeAttribute(form.typeId, {
        code,
        name,
        valueKind: form.valueKind,
        unit: unitValue,
        isRequired: form.isRequired,
        sortOrder,
        ...(form.valueKind === 'select'
          ? { allowCustomValue: form.allowCustomValue, options: options ?? [] }
          : {}),
        ...(fillMissing === undefined ? {} : { fillMissing }),
      })
    } else {
      await updateGearTypeAttribute(form.typeId, form.id, {
        name,
        unit: unitValue,
        isRequired: form.isRequired,
        sortOrder,
        isActive: form.isActive,
        ...(form.valueKind === 'select' ? { allowCustomValue: form.allowCustomValue } : {}),
        ...(fillMissing === undefined ? {} : { fillMissing }),
      })
    }
    closeAttributeForm()
    await load()
  } catch (cause) {
    attributeFormError.value = messageOf(cause, 'Не удалось сохранить характеристику.')
  }
}

// ───────────────────────────── варианты списка ─────────────────────────────

function openOptionCreate(type: AdminGearType, attribute: AdminGearTypeAttribute) {
  optionFormError.value = null
  optionForm.value = {
    id: null,
    typeId: type.id,
    attributeId: attribute.id,
    code: '',
    name: '',
    sortOrder: '0',
    isActive: true,
  }
}

function openOptionEdit(
  type: AdminGearType,
  attribute: AdminGearTypeAttribute,
  option: AdminGearAttributeOption,
) {
  optionFormError.value = null
  optionForm.value = {
    id: option.id,
    typeId: type.id,
    attributeId: attribute.id,
    code: option.code,
    name: option.name,
    sortOrder: String(option.sortOrder),
    isActive: option.isActive,
  }
}

function closeOptionForm() {
  optionForm.value = null
  optionFormError.value = null
}

/**
 * Сохранение варианта.
 *
 * Создание и правка — разные ручки, поэтому и разное тело: `code` уходит
 * только при создании (после — 400), `isActive` только при правке (снятая
 * галочка = архив, но последний вариант списка так убрать нельзя — 409).
 */
async function submitOptionForm() {
  const form = optionForm.value
  if (form === null) return

  optionFormError.value = null

  const code = form.code.trim()
  const name = form.name.trim()
  const sortOrder = parseSortOrder(form.sortOrder)

  if (name === '') {
    optionFormError.value = NAME_EMPTY_ERROR
    return
  }
  if (sortOrder === null) {
    optionFormError.value = SORT_ORDER_ERROR
    return
  }
  if (form.id === null && !isGearCode(code)) {
    optionFormError.value = GEAR_CODE_ERROR
    return
  }

  try {
    if (form.id === null) {
      await createGearAttributeOption(form.typeId, form.attributeId, { code, name, sortOrder })
    } else {
      await updateGearAttributeOption(form.typeId, form.attributeId, form.id, {
        name,
        sortOrder,
        isActive: form.isActive,
      })
    }
    closeOptionForm()
    await load()
  } catch (cause) {
    optionFormError.value = messageOf(cause, 'Не удалось сохранить вариант.')
  }
}

// ──────────────────────────────── модалки ────────────────────────────────

/** Escape закрывает открытую форму: их не больше одной за раз. */
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return

  if (optionForm.value !== null) closeOptionForm()
  else if (typeForm.value !== null) closeTypeForm()
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
      и полотном, «Горелка» с соединением из списка «резьбовой / цанговый». Вещи пока живут
      по-старому — тип и значения характеристик появятся у них следующим шагом, поэтому здесь
      ничего не ломает личный каталог.
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

              <!-- Варианты списка: чип открывает форму варианта -->
              <div
                v-if="attribute.valueKind === 'select'"
                data-test="attribute-options"
                class="mt-1 flex flex-wrap items-center gap-1"
              >
                <button
                  v-for="option in attribute.options"
                  :key="option.id"
                  type="button"
                  data-test="option-chip"
                  class="cursor-pointer rounded-full border border-border px-2 py-0.5 text-xs text-text hover:border-primary"
                  :class="option.isActive ? '' : 'opacity-60 line-through'"
                  @click="openOptionEdit(type, attribute, option)"
                >
                  {{ option.name }}
                  <span v-if="!option.isActive" data-test="option-archived" class="ml-1 text-[10px] text-muted">
                    в архиве
                  </span>
                </button>
                <button
                  type="button"
                  data-test="option-add"
                  class="cursor-pointer rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted hover:border-primary hover:text-text"
                  @click="openOptionCreate(type, attribute)"
                >
                  + вариант
                </button>
              </div>
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
          @change="onAttributeKindChange"
        >
          <option v-for="kind in GEAR_VALUE_KINDS" :key="kind" :value="kind">
            {{ GEAR_VALUE_KIND_LABELS[kind] }}
          </option>
        </select>
        <p v-if="attributeForm.id !== null" class="mt-1 text-xs text-muted">
          Вид не меняется: смена означала бы перенос уже записанных значений. Исправление — архив
          и новая характеристика с новым кодом.
        </p>

        <!-- Список вариантов: создание — вместе с вариантами, правка — по чипам -->
        <template v-if="isSelectForm">
          <template v-if="attributeForm.id === null">
            <label class="mt-3 block text-sm text-muted">Варианты списка</label>
            <p class="mt-1 text-xs text-muted">
              Админ заводит список сразу с вариантами. Код — латиница и не меняется, название можно
              переименовать потом. Пустая строка не считается вариантом.
            </p>

            <div
              v-for="(option, index) in attributeForm.options"
              :key="option.key"
              data-test="option-draft"
              class="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-[1fr_1fr_4.5rem_auto]"
            >
              <input
                v-model="option.code"
                data-test="option-draft-code"
                type="text"
                :maxlength="GEAR_CODE_MAX_LENGTH"
                placeholder="код"
                :aria-label="`Код варианта ${index + 1}`"
                class="min-w-0 rounded-xl border border-border bg-field px-3 py-2 text-base text-text"
              />
              <input
                v-model="option.name"
                data-test="option-draft-name"
                type="text"
                :maxlength="GEAR_NAME_MAX_LENGTH"
                placeholder="название"
                :aria-label="`Название варианта ${index + 1}`"
                class="min-w-0 rounded-xl border border-border bg-field px-3 py-2 text-base text-text"
              />
              <input
                v-model="option.sortOrder"
                data-test="option-draft-sort"
                type="number"
                min="0"
                placeholder="порядок"
                :aria-label="`Порядок варианта ${index + 1}`"
                class="min-w-0 rounded-xl border border-border bg-field px-3 py-2 text-base text-text"
              />
              <button
                type="button"
                data-test="option-draft-remove"
                class="cursor-pointer rounded-xl border border-border px-2 py-2 text-xs text-muted hover:border-red-600 hover:text-red-600"
                @click="removeOptionDraft(option.key)"
              >
                Убрать
              </button>
            </div>

            <button
              type="button"
              data-test="option-draft-add"
              class="mt-2 cursor-pointer rounded-lg border border-dashed border-border px-3 py-1.5 text-sm text-muted hover:border-primary hover:text-text"
              @click="addOptionDraft"
            >
              Добавить вариант
            </button>
          </template>

          <p v-else class="mt-2 text-xs text-muted">
            Вариантов активно: {{ attributeForm.optionNames.length }}. Каждый правится из строки
            характеристики — нажмите на его чип, там же архив и возврат.
          </p>

          <label class="mt-3 flex cursor-pointer items-center gap-2 text-sm text-text">
            <input
              v-model="attributeForm.allowCustomValue"
              data-test="attr-form-allow-custom"
              type="checkbox"
              class="h-4 w-4 cursor-pointer"
            />
            Разрешить своё значение
          </label>
          <p class="mt-1 text-xs text-muted">
            Человек сможет вписать значение, которого нет в списке. У числа, строки и галочки этого
            флага нет — сервер отвечает 400. У списка без вариантов флаг обязателен, иначе выбрать
            нечего.
          </p>
        </template>

        <template v-if="!isSelectForm">
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
        </template>

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
            :data-test="attributeForm.valueKind === 'select' ? 'attr-form-fill-select' : 'attr-form-fill-text'"
            type="text"
            :placeholder="attributeForm.valueKind === 'select' ? 'резьбовой' : 'нет данных'"
            class="mt-1 w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text"
          />

          <p data-test="attr-form-fill-hint" class="mt-1 text-xs text-muted">
            Подойдёт {{ fillMissingHint }}. В Stage A не применяется — экземпляров вещей ещё нет;
            начнёт применяться в Stage B.
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

    <!-- Форма варианта списка -->
    <div
      v-if="optionForm"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gear-option-form-title"
      @click.self="closeOptionForm"
    >
      <form
        data-test="option-form"
        class="w-full max-w-md rounded-2xl bg-surface p-4 shadow-xl"
        @submit.prevent="submitOptionForm"
      >
        <h2 id="gear-option-form-title" class="text-lg font-semibold text-text">
          {{ optionForm.id === null ? 'Новый вариант' : 'Вариант' }}
        </h2>

        <label class="mt-3 block text-sm text-muted" for="gear-option-code">Код</label>
        <input
          id="gear-option-code"
          v-model="optionForm.code"
          data-test="option-form-code"
          type="text"
          :disabled="optionForm.id !== null"
          :maxlength="GEAR_CODE_MAX_LENGTH"
          placeholder="thread"
          class="mt-1 w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text disabled:opacity-60"
        />
        <p class="mt-1 text-xs text-muted">
          {{
            optionForm.id === null
              ? GEAR_CODE_HINT
              : 'Код не меняется: на него опираются фильтры. Исправление — архив и новый вариант с новым кодом.'
          }}
        </p>

        <label class="mt-3 block text-sm text-muted" for="gear-option-name">Название</label>
        <input
          id="gear-option-name"
          v-model="optionForm.name"
          data-test="option-form-name"
          type="text"
          :maxlength="GEAR_NAME_MAX_LENGTH"
          placeholder="резьбовой"
          class="mt-1 w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text"
        />
        <p class="mt-1 text-xs text-muted">
          Именно название человек увидит в списке. Значения экземпляров хранятся текстом имени —
          при переименовании бэкенд обновит и их.
        </p>

        <label class="mt-3 block text-sm text-muted" for="gear-option-sort">Порядок в списке</label>
        <input
          id="gear-option-sort"
          v-model="optionForm.sortOrder"
          data-test="option-form-sort"
          type="number"
          min="0"
          class="mt-1 w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text"
        />

        <label
          v-if="optionForm.id !== null"
          class="mt-3 flex cursor-pointer items-center gap-2 text-sm text-text"
        >
          <input
            v-model="optionForm.isActive"
            data-test="option-form-active"
            type="checkbox"
            class="h-4 w-4 cursor-pointer"
          />
          Активен
        </label>
        <p v-if="optionForm.id !== null" class="mt-1 text-xs text-muted">
          Снятая галочка — архив: вариант пропадает из выбора, но строка и код остаются. Последний
          вариант списка так убрать нельзя, пока не разрешено своё значение.
        </p>

        <p v-if="optionFormError" data-test="option-form-error" class="mt-3 text-sm text-red-600">
          {{ optionFormError }}
        </p>

        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            data-test="option-form-cancel"
            class="cursor-pointer rounded-lg border border-border bg-bg px-4 py-2 text-sm text-text"
            @click="closeOptionForm"
          >
            Отмена
          </button>
          <button
            type="submit"
            data-test="option-form-submit"
            class="cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white"
          >
            Сохранить
          </button>
        </div>
      </form>
    </div>
  </main>
</template>
