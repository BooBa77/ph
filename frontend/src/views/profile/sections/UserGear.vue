<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import {
  createGearItem,
  deleteGearItem,
  fetchGearGroups,
  listGear,
  moveGearItem,
  updateGearItem,
} from '@/api/gear'
import { fetchGearTypes } from '@/api/gearTypes'
import { ApiError } from '@/api/errors'
import type { GearGroup, GearItem } from '@/types/gear'
import type { GearType, GearTypeAttribute } from '@/types/gearTypes'
import {
  createVehicle,
  fetchVehicles,
  removeVehicle,
  updateVehicle,
} from '@/api/vehicles'
import {
  VEHICLE_KINDS,
  VEHICLE_KIND_LABELS,
  type Vehicle,
  type VehicleKind,
} from '@/types/trips'
import GearAttributeFields from '@/components/gear/GearAttributeFields.vue'
import GearGroupingModal from '@/components/gear/GearGroupingModal.vue'
import {
  buildGearAttributes,
  gearAttributeDrafts,
  gearAttributesSummary,
  type GearAttributeDrafts,
} from '@/utils/gearAttributes'
import { formatWeight, formatWeightTotal, parseWeightGrams } from '@/utils/gearWeight'

/**
 * «Снаряжение» — личный каталог предметов с весом.
 *
 * **Тип вместо вида (Stage B, 30.10.2026).** Типами правит админ
 * (`/admin/gear`), и вместе с типом приходят **характеристики**: у палатки
 * вместимость и модель, у горелки соединение и мощность. Поэтому форма
 * собрана из двух частей — выбор типа и поля его характеристик.
 *
 * **Секции — по личным группам (02.11.2026).** Заказчик: «Типы, по-прежнему,
 * создаёт админ… А группировать их разрешим самостоятельно». Группа больше
 * не полка отдельной вещи: человек раскладывает **типы** в инструменте
 * «Настройка группировки снаряжения», и вещь показывается в группе своего
 * типа. Поэтому в форме вещи выбора группы нет — иначе было бы два
 * источника правды.
 *
 * **Пустые группы и типы не показываем.** Секция рисуется, только если
 * в ней есть вещи (после фильтра — тоже). Сами группы живут в настройке:
 * только что созданную группу видно там, пока в неё не переложили тип.
 *
 * **Местоположение — свободный текст с подсказками (02.11.2026).**
 * Заказчик: «У юзера снаряга лежит на балконе и в гараже… кликает на поле
 * местоположения, поле, посмотрев все объекты, предлагает „Гараж“ и
 * „Балкон“, либо пустое поле, где он сам может вписать, например, „дача“».
 * Подсказки собираются из уже введённых значений (`<datalist>`), отдельного
 * справочника мест нет.
 *
 * **Фильтр — два поля, фильтруют сразу.** Наименование и местоположение:
 * пустое поле не фильтрует, регистр не важен.
 *
 * **Группы сворачиваются** — как в «Питании»: у каждой секции своя кнопка,
 * а одна общая сворачивает все.
 *
 * **Вес правится на месте.** Самая частая правка — «взвесил позже»:
 * поэтому вес в строке — поле ввода, которое сохраняется по `change`.
 *
 * **Характеристики правятся в раскрывающемся блоке под строкой** — их
 * бывает до четырёх, и держать это в строке рядом с названием и весом
 * значило бы превратить строку в ещё одну форму.
 */
const items = ref<GearItem[]>([])
const isLoading = ref(true)
const error = ref<string | null>(null)

/** Справочник типов: из него собраны выбор типа и поля характеристик. */
const types = ref<GearType[]>([])
const typesError = ref<string | null>(null)

/** Справочник личных групп вместе с их типами. */
const groupsList = ref<GearGroup[]>([])
const groupsError = ref<string | null>(null)

/** Форма нового предмета раскрывается кнопкой «Добавить объект». */
const isAddOpen = ref(false)

/** Настройка группировки: диалог, а не отдельная страница. */
const isGroupingOpen = ref(false)

const newTypeId = ref<number | null>(null)
const newTitle = ref('')
const newWeight = ref('')
const newLocation = ref('')
const newNote = ref('')
const newDrafts = ref<GearAttributeDrafts>({})
const isAdding = ref(false)

/** Выбранный тип и его характеристики — из них собираются поля формы. */
const newType = computed(
  () => types.value.find((type) => type.id === newTypeId.value) ?? null,
)
const newAttributes = computed<readonly GearTypeAttribute[]>(
  () => newType.value?.attributes ?? [],
)

/**
 * Группа, в которую попадёт новая вещь: она следует из типа.
 *
 * Это подсказка, а не выбор: заказчик просил группировать типы, поэтому
 * «полка» вещи задаётся настройкой группировки.
 */
const newTypeGroup = computed<GearGroup | null>(() => {
  if (newTypeId.value === null) return null

  return (
    groupsList.value.find((group) =>
      group.types.some((type) => type.id === newTypeId.value),
    ) ?? null
  )
})

/** Что сейчас сохраняется: id предмета, чтобы не дёргать его дважды. */
const savingId = ref<string | null>(null)

/** Что ждёт подтверждения удаления. */
const confirmingItemId = ref<string | null>(null)
const confirmingVehicleId = ref<string | null>(null)

/**
 * Итог: сумма известных весов и число невзвешенных.
 *
 * Считаем здесь, а не берём из ответа, — иначе после каждой правки
 * пришлось бы перечитывать список ради суммы.
 */
const totalWeightGrams = computed(() =>
  items.value.reduce((sum, item) => sum + (item.weightGrams ?? 0), 0),
)
const itemsWithoutWeight = computed(
  () => items.value.filter((item) => item.weightGrams === null).length,
)

// ───────────────────────────── фильтр ─────────────────────────────

const filterTitle = ref('')
const filterLocation = ref('')

const hasFilter = computed(
  () => filterTitle.value.trim().length > 0 || filterLocation.value.trim().length > 0,
)

/** Отфильтрованные вещи: оба поля работают одновременно и сразу. */
const filteredItems = computed(() => {
  const title = filterTitle.value.trim().toLowerCase()
  const location = filterLocation.value.trim().toLowerCase()

  return items.value.filter((item) => {
    const titleMatches = title.length === 0 || item.title.toLowerCase().includes(title)
    const locationMatches =
      location.length === 0 || (item.location ?? '').toLowerCase().includes(location)

    return titleMatches && locationMatches
  })
})

/**
 * Подсказки местоположения — из уже введённых значений.
 *
 * Справочник мест не заводим: заказчик называл «балкон», «гараж», «дачу»,
 * и любое новое место должно приниматься сразу, без отдельной настройки.
 */
const locationHints = computed(() => {
  const unique = new Set<string>()
  for (const item of items.value) {
    if (typeof item.location === 'string' && item.location.length > 0) unique.add(item.location)
  }

  return [...unique].sort((left, right) => left.localeCompare(right, 'ru'))
})

// ─────────────────────── секции и порядок ───────────────────────

/** Внутри секции — личный порядок `sortOrder`; `id` разрешает ничьи. */
function sortItems(rows: GearItem[]): GearItem[] {
  return [...rows].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || Number(left.id) - Number(right.id),
  )
}

/** Полная раскладка вещей по группам — для стрелок, без фильтра. */
const allItemsByGroup = computed(() => {
  const map = new Map<number, GearItem[]>()
  for (const item of items.value) {
    const rows = map.get(item.groupId) ?? []
    rows.push(item)
    map.set(item.groupId, rows)
  }
  for (const [id, rows] of map) map.set(id, sortItems(rows))

  return map
})

interface GroupView {
  id: number
  name: string
  isDefault: boolean
  items: GearItem[]
}

/**
 * Секции каталога: порядок групп — личный, пустые секции не рисуются.
 *
 * Группа, которой нет в справочнике (теоретически при гонке), не теряется:
 * она показывается после известных и по имени вещи.
 */
const visibleGroups = computed<GroupView[]>(() => {
  const views: GroupView[] = []
  const known = new Set<number>()

  for (const group of groupsList.value) {
    known.add(group.id)
    const rows = allItemsByGroup.value.get(group.id) ?? []
    const filtered = sortItems(
      rows.filter((item) => filteredItems.value.some((row) => row.id === item.id)),
    )
    if (filtered.length > 0) {
      views.push({ id: group.id, name: group.name, isDefault: group.isDefault, items: filtered })
    }
  }

  for (const [id, rows] of allItemsByGroup.value) {
    if (known.has(id)) continue
    const filtered = sortItems(
      rows.filter((item) => filteredItems.value.some((row) => row.id === item.id)),
    )
    if (filtered.length > 0) {
      views.push({
        id,
        name: rows[0]?.groupName ?? 'Без группы',
        isDefault: false,
        items: filtered,
      })
    }
  }

  return views
})

/** Свёрнутые группы: режим просмотра, а не настройка. */
const collapsedGroups = ref<Set<number>>(new Set())

function isCollapsed(groupId: number): boolean {
  return collapsedGroups.value.has(groupId)
}

function toggleGroup(groupId: number): void {
  const next = new Set(collapsedGroups.value)
  if (next.has(groupId)) next.delete(groupId)
  else next.add(groupId)
  collapsedGroups.value = next
}

/** Все показанные группы свёрнуты — тогда общая кнопка разворачивает. */
const allCollapsed = computed(
  () =>
    visibleGroups.value.length > 0 &&
    visibleGroups.value.every((group) => collapsedGroups.value.has(group.id)),
)

function toggleAllGroups(): void {
  const collapse = !allCollapsed.value
  const next = new Set<number>()
  if (collapse) for (const group of visibleGroups.value) next.add(group.id)
  collapsedGroups.value = next
}

/** Смена фильтра не должна оставлять «свёрнутым» то, что теперь видно. */
watch(visibleGroups, (groups) => {
  const next = new Set([...collapsedGroups.value].filter((id) => groups.some((g) => g.id === id)))
  if (next.size !== collapsedGroups.value.size) collapsedGroups.value = next
})

/** Правка характеристик: id предмета, тип и черновик значений. */
const editingItemId = ref<string | null>(null)
const editTypeId = ref<number | null>(null)
const editDrafts = ref<GearAttributeDrafts>({})

const editingItem = computed(
  () => items.value.find((item) => item.id === editingItemId.value) ?? null,
)
const editType = computed(
  () => types.value.find((type) => type.id === editTypeId.value) ?? null,
)
const editAttributes = computed<readonly GearTypeAttribute[]>(
  () => editType.value?.attributes ?? [],
)

/**
 * Тип вещи, которого нет в действующем справочнике.
 *
 * Так бывает, когда админ отправил тип в архив: значения у вещи остались,
 * а полей для них взять негде. Экран говорит это словами и предлагает
 * выбрать действующий тип.
 */
const editTypeArchived = computed(
  () => editingItem.value !== null && editType.value === null,
)

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback
}

async function load() {
  isLoading.value = true
  error.value = null

  try {
    items.value = (await listGear()).items
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось загрузить снаряжение.')
  } finally {
    isLoading.value = false
  }
}

async function loadTypes() {
  typesError.value = null

  try {
    types.value = await fetchGearTypes()
    if (newTypeId.value === null && types.value.length > 0) {
      newTypeId.value = types.value[0]?.id ?? null
    }
  } catch (cause) {
    typesError.value = messageOf(cause, 'Не удалось загрузить типы снаряжения.')
  }
}

async function loadGroups() {
  groupsError.value = null

  try {
    groupsList.value = await fetchGearGroups()
  } catch (cause) {
    groupsError.value = messageOf(cause, 'Не удалось загрузить группы снаряжения.')
  }
}

/**
 * После настройки группировки перечитываем и группы, и вещи.
 *
 * Тип переехал в другую группу — у его вещей изменился `groupId`, а такой
 * связи в памяти экрана нет: её знает только сервер.
 */
async function onGroupingUpdated(next: GearGroup[]) {
  groupsList.value = next
  await load()
}

function toggleAdd(): void {
  isAddOpen.value = !isAddOpen.value
  error.value = null
}

async function add() {
  const title = newTitle.value.trim()
  const type = newType.value

  if (type === null) {
    error.value = 'Выберите тип снаряжения: характеристики вещи задаёт тип.'
    return
  }
  if (title.length === 0 || isAdding.value) return

  const weightGrams = parseWeightGrams(newWeight.value)
  if (weightGrams === undefined) {
    error.value = 'Вес — целое число граммов, больше нуля. Или оставьте поле пустым.'
    return
  }

  const built = buildGearAttributes(type.attributes, newDrafts.value)
  if (built.error !== null) {
    error.value = built.error
    return
  }

  isAdding.value = true
  error.value = null

  try {
    const created = await createGearItem({
      typeId: type.id,
      title,
      weightGrams,
      location: newLocation.value.trim() || null,
      note: newNote.value.trim() || null,
      attributes: built.attributes,
    })
    items.value.push(created)
    newTitle.value = ''
    newWeight.value = ''
    newLocation.value = ''
    newNote.value = ''
    newDrafts.value = {}
    isAddOpen.value = false
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось добавить предмет.')
  } finally {
    isAdding.value = false
  }
}

/** Открыть правку характеристик: тип и уже сохранённые значения. */
function startEditAttributes(item: GearItem) {
  error.value = null
  confirmingItemId.value = null
  editingItemId.value = item.id
  editTypeId.value = item.typeId
  editDrafts.value = gearAttributeDrafts(item.attributes)
}

function cancelEditAttributes() {
  editingItemId.value = null
  editTypeId.value = null
  editDrafts.value = {}
}

/**
 * Сохранить характеристики и (если поменяли) тип.
 *
 * `typeId` уходит только при смене типа: без него `PATCH` — обычная правка,
 * и вещь с дырой в обязательной характеристике правится свободно.
 */
async function saveAttributes(item: GearItem) {
  const type = editType.value
  if (type === null) {
    error.value = 'Выберите действующий тип снаряжения: тип вещи в архиве.'
    return
  }

  const built = buildGearAttributes(type.attributes, editDrafts.value)
  if (built.error !== null) {
    error.value = built.error
    return
  }

  savingId.value = item.id
  error.value = null

  try {
    const updated = await updateGearItem(item.id, {
      ...(type.id === item.typeId ? {} : { typeId: type.id }),
      attributes: built.attributes,
    })
    Object.assign(item, updated)
    editingItemId.value = null
    editTypeId.value = null
    editDrafts.value = {}
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось сохранить характеристики.')
    await load()
  } finally {
    savingId.value = null
  }
}

/**
 * Сохранить поле на месте.
 *
 * `change` срабатывает только при реальном изменении, поэтому проверка
 * «изменилось ли» здесь не нужна — кроме пустого названия: имя стирать
 * нечем, и пустую строку просто возвращаем обратно.
 */
async function saveTitle(item: GearItem, event: Event) {
  const input = event.target as HTMLInputElement
  const title = input.value.trim()

  if (title.length === 0) {
    input.value = item.title
    return
  }
  if (title === item.title) return

  await save(item, { title })
}

async function saveWeight(item: GearItem, event: Event) {
  const input = event.target as HTMLInputElement
  const weightGrams = parseWeightGrams(input.value)

  if (weightGrams === undefined) {
    input.value = item.weightGrams === null ? '' : String(item.weightGrams)
    error.value = 'Вес — целое число граммов, больше нуля. Пустое поле — «не знаю».'
    return
  }
  if (weightGrams === item.weightGrams) return

  await save(item, { weightGrams })
}

async function saveNote(item: GearItem, event: Event) {
  const input = event.target as HTMLInputElement
  const note = input.value.trim()

  if ((note || null) === item.note) return

  await save(item, { note: note || null })
}

/** Местоположение: пустое поле стирает значение (`null`), не оставляет «». */
async function saveLocation(item: GearItem, event: Event) {
  const input = event.target as HTMLInputElement
  const location = input.value.trim()
  const next = location.length === 0 ? null : location

  if (next === item.location) return

  await save(item, { location: next })
}

async function save(
  item: GearItem,
  patch: { title?: string; weightGrams?: number | null; note?: string | null; location?: string | null },
) {
  savingId.value = item.id
  error.value = null

  try {
    const updated = await updateGearItem(item.id, patch)
    Object.assign(item, updated)
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось сохранить предмет.')
    await load()
  } finally {
    savingId.value = null
  }
}

async function remove(item: GearItem) {
  confirmingItemId.value = null
  if (editingItemId.value === item.id) cancelEditAttributes()
  savingId.value = item.id
  error.value = null

  try {
    await deleteGearItem(item.id)
    items.value = items.value.filter((row) => row.id !== item.id)
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось удалить предмет.')
  } finally {
    savingId.value = null
  }
}

// ───────────────────────────── личный порядок ─────────────────────────────

/** Что сейчас переставляется: второе нажатие стрелки не шлёт второй запрос. */
const movingId = ref<string | null>(null)

/** Соседи вещи в её группе — в том порядке, в каком они нарисованы. */
function canMove(item: GearItem, direction: 'up' | 'down'): boolean {
  const siblings = allItemsByGroup.value.get(item.groupId) ?? []
  const index = siblings.findIndex((row) => row.id === item.id)

  if (index === -1) return false

  return direction === 'up' ? index > 0 : index < siblings.length - 1
}

/**
 * Переставить вещь на позицию выше или ниже.
 *
 * Сервер отвечает списком целиком: после перестановки изменились две строки,
 * и склеивать их на клиенте значило бы повторять правило сервера.
 */
async function move(item: GearItem, direction: 'up' | 'down') {
  if (movingId.value !== null || !canMove(item, direction)) return

  movingId.value = item.id
  error.value = null

  try {
    const list = await moveGearItem(item.id, direction)
    items.value = list.items
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось переставить предмет.')
  } finally {
    movingId.value = null
  }
}

onMounted(load)
onMounted(loadTypes)
onMounted(loadGroups)
onMounted(loadVehicles)

// ───────────────────────────── моя техника ─────────────────────────────

/**
 * «Моя техника» — отдельная секция каталога, а не строки в таблице
 * снаряжения: у техники своя структура (тип, марка, номер), и одна таблица
 * с весом рюкзака только запутала бы.
 *
 * На вкладке «Трансфер» эта техника выбирается из списка, поэтому заводится
 * она здесь, рядом с тем, что человек и так ведёт.
 *
 * **Вместимости здесь нет** (28.10.2026): места считаются у карточки
 * перемещения.
 */
const vehicles = ref<Vehicle[]>([])
const vehiclesError = ref<string | null>(null)

const newVehicleKind = ref<VehicleKind>('car')
const newVehicleBrand = ref('')
const newVehiclePlate = ref('')
const isAddingVehicle = ref(false)

/** Что правим: `null` — заводим новое, иначе id техники в форме. */
const editingVehicleId = ref<string | null>(null)

function startEditVehicle(vehicle: Vehicle) {
  vehiclesError.value = null
  confirmingVehicleId.value = null
  editingVehicleId.value = vehicle.id
  newVehicleKind.value = vehicle.kind
  newVehicleBrand.value = vehicle.brand
  newVehiclePlate.value = vehicle.plate ?? ''
}

function cancelEditVehicle() {
  editingVehicleId.value = null
  newVehicleBrand.value = ''
  newVehiclePlate.value = ''
}

async function loadVehicles() {
  try {
    vehicles.value = await fetchVehicles()
  } catch (problem) {
    vehiclesError.value = messageOf(problem, 'Не удалось загрузить технику')
  }
}

async function addVehicle() {
  const brand = newVehicleBrand.value.trim()

  if (!brand) {
    vehiclesError.value = 'Марка нужна — по ней техника выбирается в «Трансфере»'
    return
  }

  isAddingVehicle.value = true
  vehiclesError.value = null

  try {
    const input = {
      kind: newVehicleKind.value,
      brand,
      plate: newVehiclePlate.value.trim() || null,
    }

    if (editingVehicleId.value !== null) {
      const updated = await updateVehicle(editingVehicleId.value, input)
      vehicles.value = vehicles.value.map((item) =>
        item.id === updated.id ? updated : item,
      )
      cancelEditVehicle()
    } else {
      const created = await createVehicle(input)
      vehicles.value = [...vehicles.value, created]
    }

    newVehicleBrand.value = ''
    newVehiclePlate.value = ''
  } catch (problem) {
    vehiclesError.value = messageOf(problem, 'Не удалось сохранить технику')
  } finally {
    isAddingVehicle.value = false
  }
}

async function removeVehicleById(vehicle: Vehicle) {
  confirmingVehicleId.value = null
  vehiclesError.value = null

  try {
    await removeVehicle(vehicle.id)
    vehicles.value = vehicles.value.filter((item) => item.id !== vehicle.id)
  } catch (problem) {
    vehiclesError.value = messageOf(problem, 'Не удалось убрать технику')
  }
}
</script>

<template>
  <section data-test="gear">
    <h2 class="mb-2 text-xl font-semibold text-text">Снаряжение</h2>

    <p class="mb-3 text-sm text-muted">
      Свой список предметов и их вес. Из него в походе собирается общественное снаряжение, а вес
      рюкзака считается по этим числам — поэтому взвешенное лучше невзвешенного.
    </p>

    <p v-if="error" class="mb-3 text-sm text-red-600" data-test="gear-error">{{ error }}</p>

    <p class="mb-4 text-sm font-medium text-text" data-test="gear-total">
      {{ formatWeightTotal(totalWeightGrams, itemsWithoutWeight) }}
    </p>

    <div class="mb-4 flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="cursor-pointer rounded-xl border border-primary bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        :aria-expanded="isAddOpen"
        data-test="gear-add-toggle"
        @click="toggleAdd"
      >
        {{ isAddOpen ? 'Скрыть форму' : 'Добавить объект' }}
      </button>

      <button
        type="button"
        class="cursor-pointer rounded-xl border border-border px-4 py-2 text-sm text-text transition-colors hover:border-primary"
        data-test="grouping-open"
        @click="isGroupingOpen = true"
      >
        Настройка группировки снаряжения
      </button>
    </div>

    <!-- Новый предмет: тип задаёт характеристики и группу -->
    <form
      v-if="isAddOpen"
      class="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-surface p-3"
      data-test="gear-add-form"
      @submit.prevent="add"
    >
      <div class="grid gap-2 sm:grid-cols-[9rem_1fr_5rem_1fr_auto] sm:items-end">
        <label class="flex flex-col gap-1">
          <span class="text-xs text-muted">Тип</span>
          <select
            v-model="newTypeId"
            :disabled="types.length === 0"
            class="w-full cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none disabled:opacity-60"
            data-test="gear-type"
            @change="newDrafts = {}"
          >
            <option v-if="types.length === 0" :value="null">—</option>
            <option v-for="type in types" :key="type.id" :value="type.id">{{ type.name }}</option>
          </select>
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-xs text-muted">Название</span>
          <input
            v-model="newTitle"
            type="text"
            maxlength="120"
            placeholder="Палатка на четверых"
            class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
            data-test="gear-title"
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-xs text-muted">Вес, г</span>
          <input
            v-model="newWeight"
            type="number"
            min="1"
            step="1"
            placeholder="2400"
            class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
            data-test="gear-weight"
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-xs text-muted">Местоположение</span>
          <input
            v-model="newLocation"
            type="text"
            maxlength="120"
            list="gear-locations"
            placeholder="балкон, гараж, дача"
            class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
            data-test="gear-location"
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-xs text-muted">Заметка</span>
          <input
            v-model="newNote"
            type="text"
            maxlength="500"
            placeholder="проклеена, течёт по шву"
            class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
            data-test="gear-note"
          />
        </label>
      </div>

      <p class="text-xs text-muted" data-test="gear-new-group-hint">
        <template v-if="newTypeGroup">
          Попадёт в группу «{{ newTypeGroup.name }}» — группу типа меняют в «Настройке
          группировки».
        </template>
        <template v-else>
          Тип задаёт характеристики и группу вещи: группу меняют в «Настройке группировки».
        </template>
      </p>

      <button
        type="submit"
        :disabled="isAdding || newTitle.trim().length === 0 || newType === null"
        class="self-start cursor-pointer rounded-xl border border-primary bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        data-test="gear-add"
      >
        {{ isAdding ? 'Добавляем…' : 'Добавить' }}
      </button>

      <!-- Характеристики выбранного типа: их набор задаёт справочник -->
      <div
        v-if="newAttributes.length > 0"
        class="rounded-xl border border-border bg-base p-3"
        data-test="gear-attributes"
      >
        <h3 class="mb-2 text-sm font-medium text-text">
          Характеристики типа «{{ newType?.name }}»
        </h3>
        <GearAttributeFields
          v-model="newDrafts"
          :attributes="newAttributes"
          prefix="new"
          :disabled="isAdding"
        />
      </div>
    </form>

    <datalist id="gear-locations">
      <option v-for="place in locationHints" :key="place" :value="place" />
    </datalist>

    <p v-if="typesError" class="mt-2 text-sm text-red-600" data-test="gear-types-error">
      {{ typesError }}
    </p>

    <p v-if="groupsError" class="mt-2 text-sm text-red-600" data-test="gear-groups-error">
      {{ groupsError }}
    </p>

    <p v-if="isLoading" class="mt-4 text-sm text-muted" data-test="gear-loading">
      Загружаем снаряжение…
    </p>

    <template v-else>
      <p
        v-if="items.length === 0"
        class="mt-4 rounded-xl border border-dashed border-border p-4 text-sm text-muted"
        data-test="gear-empty"
      >
        Список пуст. Начните с того, что точно поедет в следующий поход: палатка, спальник, рюкзак.
      </p>

      <template v-else>
        <!-- Фильтр: оба поля фильтруют список сразу, без кнопки «найти» -->
        <div
          class="mb-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          data-test="gear-filter"
        >
          <label class="flex flex-col gap-1">
            <span class="text-xs text-muted">Наименование</span>
            <input
              v-model="filterTitle"
              type="search"
              placeholder="Палатка"
              class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
              data-test="gear-filter-title"
            />
          </label>

          <label class="flex flex-col gap-1">
            <span class="text-xs text-muted">Местоположение</span>
            <input
              v-model="filterLocation"
              type="search"
              list="gear-locations"
              placeholder="Гараж"
              class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none"
              data-test="gear-filter-location"
            />
          </label>

          <button
            v-if="hasFilter"
            type="button"
            class="cursor-pointer rounded-xl border border-border px-4 py-2 text-sm text-muted transition-colors hover:text-text"
            data-test="gear-filter-reset"
            @click="filterTitle = ''; filterLocation = ''"
          >
            Сбросить
          </button>
        </div>

        <p
          v-if="visibleGroups.length === 0"
          class="rounded-xl border border-dashed border-border p-4 text-sm text-muted"
          data-test="gear-filter-empty"
        >
          Ничего не найдено. Измените фильтр или
          <button
            type="button"
            class="cursor-pointer text-primary underline"
            @click="filterTitle = ''; filterLocation = ''"
          >
            сбросьте его
          </button>
          .
        </p>

        <div v-else class="mt-2 flex flex-col gap-5">
          <div class="flex justify-end">
            <button
              type="button"
              class="cursor-pointer rounded-xl border border-border px-3 py-1 text-xs text-muted transition-colors hover:border-primary hover:text-text"
              data-test="groups-collapse-all"
              @click="toggleAllGroups"
            >
              {{ allCollapsed ? 'Развернуть все группы' : 'Свернуть все группы' }}
            </button>
          </div>

          <section
            v-for="group in visibleGroups"
            :key="group.id"
            data-test="gear-group"
          >
            <div class="mb-1 flex items-center justify-between gap-2">
              <h3 class="text-sm font-medium text-text" data-test="gear-group-name">
                {{ group.name }}
                <span class="text-xs font-normal text-muted">
                  · {{ group.items.length }}
                </span>
              </h3>

              <button
                type="button"
                class="cursor-pointer rounded-lg border border-border px-2 py-0.5 text-xs text-muted transition-colors hover:border-primary hover:text-text"
                :aria-expanded="!isCollapsed(group.id)"
                :data-test="`group-toggle-${group.id}`"
                @click="toggleGroup(group.id)"
              >
                {{ isCollapsed(group.id) ? 'Развернуть группу' : 'Свернуть группу' }}
              </button>
            </div>

            <ul v-if="!isCollapsed(group.id)" class="flex flex-col">
              <li
                v-for="item in group.items"
                :key="item.id"
                class="border-t border-border py-2"
                data-test="gear-item"
              >
                <div class="grid gap-2 sm:grid-cols-[1fr_6rem_10rem_1fr_auto] sm:items-center">
                  <input
                    :value="item.title"
                    type="text"
                    maxlength="120"
                    :disabled="savingId === item.id"
                    class="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm text-text transition-colors hover:border-border focus:border-primary focus:bg-field focus:outline-none disabled:opacity-60"
                    aria-label="Название предмета"
                    data-test="item-title"
                    @change="saveTitle(item, $event)"
                  />

                  <div class="flex items-center gap-1">
                    <input
                      :value="item.weightGrams ?? ''"
                      type="number"
                      min="1"
                      step="1"
                      placeholder="—"
                      :disabled="savingId === item.id"
                      class="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-right text-sm text-text transition-colors hover:border-border focus:border-primary focus:bg-field focus:outline-none disabled:opacity-60"
                      aria-label="Вес в граммах"
                      data-test="item-weight"
                      @change="saveWeight(item, $event)"
                    />
                    <span class="shrink-0 text-xs text-muted">{{ formatWeight(item.weightGrams) }}</span>
                  </div>

                  <input
                    :value="item.location ?? ''"
                    type="text"
                    maxlength="120"
                    list="gear-locations"
                    placeholder="где лежит"
                    :disabled="savingId === item.id"
                    class="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm text-muted transition-colors hover:border-border focus:border-primary focus:bg-field focus:outline-none disabled:opacity-60"
                    aria-label="Местоположение"
                    data-test="item-location"
                    @change="saveLocation(item, $event)"
                  />

                  <input
                    :value="item.note ?? ''"
                    type="text"
                    maxlength="500"
                    placeholder="заметка"
                    :disabled="savingId === item.id"
                    class="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-xs text-muted transition-colors hover:border-border focus:border-primary focus:bg-field focus:outline-none disabled:opacity-60"
                    aria-label="Заметка"
                    data-test="item-note"
                    @change="saveNote(item, $event)"
                  />

                  <div class="flex flex-wrap items-center gap-2 justify-self-start">
                    <!--
                      Личный порядок внутри полки — стрелками, а не перетаскиванием:
                      на телефоне стрелка работает так же, как мышью.
                    -->
                    <div class="flex items-center gap-1">
                      <button
                        type="button"
                        :disabled="movingId !== null || !canMove(item, 'up')"
                        class="cursor-pointer rounded-lg border border-border px-2 py-0.5 text-xs text-muted transition-colors hover:border-primary hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
                        title="Выше в группе"
                        data-test="item-move-up"
                        @click="move(item, 'up')"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        :disabled="movingId !== null || !canMove(item, 'down')"
                        class="cursor-pointer rounded-lg border border-border px-2 py-0.5 text-xs text-muted transition-colors hover:border-primary hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
                        title="Ниже в группе"
                        data-test="item-move-down"
                        @click="move(item, 'down')"
                      >
                        ↓
                      </button>
                    </div>

                    <template v-if="confirmingItemId === item.id">
                      <span class="text-xs text-muted">Удалить?</span>
                      <button
                        type="button"
                        :disabled="savingId === item.id"
                        class="cursor-pointer rounded-xl border border-red-600 px-2 py-1 text-xs text-red-600 transition-colors hover:bg-red-600 hover:text-white disabled:opacity-50"
                        data-test="item-delete-confirm"
                        @click="remove(item)"
                      >
                        Да
                      </button>
                      <button
                        type="button"
                        class="cursor-pointer rounded-xl border border-border px-2 py-1 text-xs text-muted transition-colors hover:text-text"
                        data-test="item-delete-cancel"
                        @click="confirmingItemId = null"
                      >
                        Нет
                      </button>
                    </template>

                    <button
                      v-else
                      type="button"
                      :disabled="savingId === item.id"
                      class="cursor-pointer rounded-xl border border-border px-2 py-1 text-xs text-muted transition-colors hover:border-red-600 hover:text-red-600 disabled:opacity-50"
                      data-test="item-delete"
                      @click="confirmingItemId = item.id"
                    >
                      Удалить
                    </button>
                  </div>
                </div>

                <!-- Характеристики: тип, подпись словами и кнопка правки -->
                <div class="mt-1 flex flex-wrap items-center justify-between gap-2 px-2">
                  <p class="text-xs text-muted" data-test="item-attributes-summary">
                    <span class="text-text" data-test="item-type-name">{{ item.typeName }}</span>
                    <template v-if="gearAttributesSummary(item)">
                      · {{ gearAttributesSummary(item) }}
                    </template>
                    <template v-else> · характеристики не заполнены</template>
                    <span class="text-muted"> · {{ group.name }}</span>
                  </p>

                  <button
                    type="button"
                    class="cursor-pointer rounded-xl border border-border px-2 py-1 text-xs text-muted transition-colors hover:border-primary hover:text-text"
                    data-test="item-attributes"
                    @click="editingItemId === item.id ? cancelEditAttributes() : startEditAttributes(item)"
                  >
                    {{ editingItemId === item.id ? 'Скрыть' : 'Характеристики' }}
                  </button>
                </div>

                <div
                  v-if="editingItemId === item.id"
                  class="mt-2 flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
                  data-test="item-attributes-editor"
                >
                  <label class="flex flex-col gap-1">
                    <span class="text-xs text-muted">Тип</span>
                    <select
                      v-model="editTypeId"
                      :disabled="savingId === item.id"
                      class="w-full cursor-pointer rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none disabled:opacity-60 sm:max-w-xs"
                      data-test="item-type"
                      @change="editDrafts = {}"
                    >
                      <option v-for="type in types" :key="type.id" :value="type.id">
                        {{ type.name }}
                      </option>
                      <option v-if="editTypeArchived" :value="item.typeId">
                        {{ item.typeName }} — в архиве
                      </option>
                    </select>
                  </label>

                  <p class="text-xs text-muted" data-test="item-group-hint">
                    Группа: {{ group.name }} — задаётся типом в «Настройке группировки».
                  </p>

                  <p
                    v-if="editTypeArchived"
                    class="text-xs text-muted"
                    data-test="item-type-archived"
                  >
                    Тип вещи в архиве справочника: выберите действующий. При смене типа значения прежнего
                    типа стираются.
                  </p>

                  <GearAttributeFields
                    v-else-if="editAttributes.length > 0"
                    v-model="editDrafts"
                    :attributes="editAttributes"
                    prefix="edit"
                    :disabled="savingId === item.id"
                  />

                  <p v-else class="text-xs text-muted" data-test="item-attributes-empty">
                    У выбранного типа нет характеристик.
                  </p>

                  <div class="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      :disabled="savingId === item.id || editTypeArchived"
                      class="cursor-pointer rounded-xl border border-primary bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                      data-test="item-attributes-save"
                      @click="saveAttributes(item)"
                    >
                      Сохранить
                    </button>
                    <button
                      type="button"
                      class="cursor-pointer rounded-xl border border-border px-4 py-2 text-sm text-muted transition-colors hover:text-text"
                      data-test="item-attributes-cancel"
                      @click="cancelEditAttributes"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              </li>
            </ul>
          </section>
        </div>
      </template>
    </template>

    <GearGroupingModal
      v-if="isGroupingOpen"
      :groups="groupsList"
      @close="isGroupingOpen = false"
      @updated="onGroupingUpdated"
    />

    <!-- Моя техника: своя структура, поэтому отдельной секцией -->
    <section class="mt-8 flex flex-col gap-3" data-test="vehicles">
      <h2 class="text-xl font-semibold text-text">Моя техника</h2>

      <p class="text-sm text-muted">
        Автомобиль, снегоход, квадроцикл, мотоцикл, велосипед или лодка. На вкладке
        «Трансфер» техника выбирается из этого списка — тип транспорта подставится сам.
        Сколько мест в машине, спрашивают в карточке перемещения: в каталоге это
        «что у меня есть», а не «сколько сегодня влезет». Велосипед в «Трансфере»
        не выбирают — он не возит группу.
      </p>

      <p v-if="vehiclesError" class="text-sm text-red-600" data-test="vehicles-error">
        {{ vehiclesError }}
      </p>

      <div class="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface p-3">
        <label class="flex flex-col gap-1 text-xs text-muted">
          Тип
          <select
            v-model="newVehicleKind"
            class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
            data-test="vehicle-kind"
          >
            <option v-for="kind in VEHICLE_KINDS" :key="kind" :value="kind">
              {{ VEHICLE_KIND_LABELS[kind] }}
            </option>
          </select>
        </label>

        <label class="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted">
          Марка
          <input
            v-model="newVehicleBrand"
            type="text"
            maxlength="100"
            placeholder="«Нива»"
            class="rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
            data-test="vehicle-brand"
          />
        </label>

        <label class="flex flex-col gap-1 text-xs text-muted">
          Госномер
          <input
            v-model="newVehiclePlate"
            type="text"
            maxlength="20"
            placeholder="А123ВС38"
            class="w-32 rounded-xl border border-border bg-field px-3 py-2 text-base text-text focus:border-primary focus:outline-none"
            data-test="vehicle-plate"
          />
        </label>

        <button
          type="button"
          :disabled="isAddingVehicle"
          class="cursor-pointer rounded-xl border border-primary bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          data-test="vehicle-add"
          @click="addVehicle"
        >
          {{ editingVehicleId === null ? 'Добавить' : 'Сохранить' }}
        </button>

        <button
          v-if="editingVehicleId !== null"
          type="button"
          class="cursor-pointer rounded-xl border border-border px-4 py-2 text-sm text-muted transition-colors hover:text-text"
          data-test="vehicle-edit-cancel"
          @click="cancelEditVehicle"
        >
          Отмена
        </button>
      </div>

      <p v-if="vehicles.length === 0" class="text-sm text-muted" data-test="vehicles-empty">
        Пока ничего не заведено.
      </p>

      <ul v-else class="flex flex-col gap-2" data-test="vehicles-list">
        <li
          v-for="vehicle in vehicles"
          :key="vehicle.id"
          class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface p-3"
          data-test="vehicle-item"
        >
          <span class="text-sm text-text">
            <span class="font-medium" data-test="vehicle-item-brand">{{ vehicle.brand }}</span>
            · {{ VEHICLE_KIND_LABELS[vehicle.kind] }}
            <template v-if="vehicle.plate">
              · <span class="text-muted">{{ vehicle.plate }}</span>
            </template>
          </span>

          <span class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="cursor-pointer rounded-xl border border-border px-2 py-1 text-xs text-text transition-colors hover:border-primary"
              data-test="vehicle-edit"
              @click="startEditVehicle(vehicle)"
            >
              Править
            </button>

            <template v-if="confirmingVehicleId === vehicle.id">
              <span class="text-xs text-muted">Удалить?</span>
              <button
                type="button"
                class="cursor-pointer rounded-xl border border-red-600 px-2 py-1 text-xs text-red-600 transition-colors hover:bg-red-600 hover:text-white"
                data-test="vehicle-delete-confirm"
                @click="removeVehicleById(vehicle)"
              >
                Да
              </button>
              <button
                type="button"
                class="cursor-pointer rounded-xl border border-border px-2 py-1 text-xs text-muted transition-colors hover:text-text"
                data-test="vehicle-delete-cancel"
                @click="confirmingVehicleId = null"
              >
                Нет
              </button>
            </template>

            <button
              v-else
              type="button"
              class="cursor-pointer rounded-xl border border-border px-2 py-1 text-xs text-muted transition-colors hover:border-red-600 hover:text-red-600"
              data-test="vehicle-delete"
              @click="confirmingVehicleId = vehicle.id"
            >
              Удалить
            </button>
          </span>
        </li>
      </ul>
    </section>
  </section>
</template>
