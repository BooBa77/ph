<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  createGearItem,
  deleteGearItem,
  listGear,
  updateGearItem,
} from '@/api/gear'
import { fetchGearTypes } from '@/api/gearTypes'
import { ApiError } from '@/api/errors'
import type { GearItem } from '@/types/gear'
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
import {
  buildGearAttributes,
  gearAttributeDrafts,
  gearAttributesSummary,
  type GearAttributeDrafts,
} from '@/utils/gearAttributes'
import { formatWeight, formatWeightTotal } from '@/utils/gearWeight'

/**
 * «Снаряжение» — личный каталог предметов с весом.
 *
 * **Зачем каталог, если есть чек-листы.** Чек-лист отвечает «что взять
 * в этот поход», каталог — «что у меня есть и сколько это весит». Второй
 * нужен вкладке «Снаряжение» похода (Ф7): участники предлагают предметы
 * из своих каталогов, а вес рюкзака считается из этих чисел.
 *
 * **Тип вместо вида (Stage B, 30.10.2026).** Вид был списком в коде: восемь
 * категорий, и «топор» в него не влезал — приходилось писать «Техника».
 * Теперь типами правит админ (`/admin/gear`), и вместе с типом приходят
 * **характеристики**: у палатки вместимость и модель, у горелки соединение
 * и мощность. Поэтому форма собрана из двух частей — выбор типа и поля
 * его характеристик под ним, — а список сгруппирован по типам.
 *
 * **Обязательные спрашиваются сразу.** Поле, без которого вещь не описать
 * (у палатки — вместимость), помечено звёздочкой, и отправка без него
 * не уходит на сервер: человек узнаёт про пустое поле до запроса, а текст
 * ошибки совпадает с серверным. Правило теперь одно для всех клиентов —
 * старая прослойка, где обязательные проверялись только при присланном
 * `typeId`, умирает вместе с видом.
 *
 * **Вес правится на месте.** Самая частая правка — «взвесил позже»:
 * поэтому вес в строке — поле ввода, которое сохраняется по `change`
 * (то есть по потере фокуса, если значение изменилось). Отдельного режима
 * правки нет: он нужен ради одной цифры.
 *
 * **Характеристики правятся в раскрывающемся блоке под строкой.** Их
 * бывает до четырёх, у каждой свой вид поля (число, текст, галочка, список),
 * и держать это в строке рядом с названием и весом значило бы превратить
 * строку в ещё одну форму. Правка открывается кнопкой, тип в ней меняется
 * там же: смена типа стирает значения прежнего типа, и это делает сервер.
 *
 * **Итог считается на клиенте** из уже загруженных предметов. Бэкенд отдаёт
 * те же два числа, но после каждой правки перечитывать список ради суммы
 * значит лишний запрос на каждое взвешивание.
 */
const items = ref<GearItem[]>([])
const isLoading = ref(true)
const error = ref<string | null>(null)

/**
 * Справочник типов: из него собраны выбор типа и поля характеристик.
 *
 * Справочник маленький и меняется редко, поэтому грузится целиком и один
 * раз. Ошибка загрузки — не повод прятать каталог: список вещей покажется,
 * а форма нового предмета скажет словами, чего не хватает.
 */
const types = ref<GearType[]>([])
const typesError = ref<string | null>(null)

/** Форма нового предмета. */
const newTypeId = ref<number | null>(null)
const newTitle = ref('')
const newWeight = ref('')
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

/** Что сейчас сохраняется: id предмета, чтобы не дёргать его дважды. */
const savingId = ref<string | null>(null)

/**
 * Что ждёт подтверждения удаления.
 *
 * Удаление предмета необратимо, поэтому спрашиваем — тем же способом, что
 * у блюд и шаблонов: кнопка превращается в «Да»/«Нет». Предметы и техника
 * нумеруются в разных списках, поэтому и «ждёт» у них своё.
 */
const confirmingItemId = ref<string | null>(null)
const confirmingVehicleId = ref<string | null>(null)

/**
 * Итог: сумма известных весов и число невзвешенных.
 *
 * Считаем здесь, а не берём из ответа, — иначе после каждой правки
 * пришлось бы перечитывать список. Формулы ровно те же, что на бэкенде.
 */
const totalWeightGrams = computed(() =>
  items.value.reduce((sum, item) => sum + (item.weightGrams ?? 0), 0),
)
const itemsWithoutWeight = computed(
  () => items.value.filter((item) => item.weightGrams === null).length,
)

/**
 * Предметы по типам: название группы — имя типа из справочника.
 *
 * Порядок групп — порядок справочника (его задаёт админ), а типы, которых
 * в действующем справочнике нет (вещь в архивном типе), идут после и по
 * имени: молча потерять такую вещь нельзя, она правдоподобно исчезла бы
 * из каталога.
 */
const groups = computed(() => {
  const order = new Map(types.value.map((type, index) => [type.code, index]))
  const byCode = new Map<string, { code: string; label: string; items: GearItem[] }>()

  for (const item of items.value) {
    const group = byCode.get(item.typeCode) ?? {
      code: item.typeCode,
      label: item.typeName,
      items: [],
    }
    group.items.push(item)
    byCode.set(item.typeCode, group)
  }

  return [...byCode.values()].sort((left, right) => {
    const leftOrder = order.get(left.code) ?? Number.MAX_SAFE_INTEGER
    const rightOrder = order.get(right.code) ?? Number.MAX_SAFE_INTEGER

    if (leftOrder !== rightOrder) return leftOrder - rightOrder

    return left.label.localeCompare(right.label, 'ru')
  })
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
 * выбрать действующий тип — молча показать пустую форму значило бы
 * «сохранить» и стереть значения, ничего не объяснив.
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
    // Первый тип по умолчанию: пустой список типов оставлял бы форму
    // в состоянии «выберите тип», которое нечем исправить.
    if (newTypeId.value === null && types.value.length > 0) {
      newTypeId.value = types.value[0]?.id ?? null
    }
  } catch (cause) {
    typesError.value = messageOf(cause, 'Не удалось загрузить типы снаряжения.')
  }
}

/**
 * Вес из поля: пусто — «не указан», мусор — `undefined` (и ошибка).
 *
 * Принимает и строку, и число: `v-model` на `<input type="number">`
 * во Vue 3 отдаёт **число**, а `<input>` через `:value` — строку. Проверка
 * одна, поэтому приводим к строке внутри, а не в двух местах снаружи.
 */
function parseWeight(value: string | number): number | null | undefined {
  const text = String(value).trim()
  if (text === '') return null

  const grams = Number(text)
  if (!Number.isInteger(grams) || grams <= 0) return undefined

  return grams
}

async function add() {
  const title = newTitle.value.trim()
  const type = newType.value

  if (type === null) {
    error.value = 'Выберите тип снаряжения: характеристики вещи задаёт тип.'
    return
  }
  if (title.length === 0 || isAdding.value) return

  const weightGrams = parseWeight(newWeight.value)
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
      note: newNote.value.trim() || null,
      attributes: built.attributes,
    })
    items.value.push(created)
    newTitle.value = ''
    newWeight.value = ''
    newNote.value = ''
    newDrafts.value = {}
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
 * и вещь с дырой в обязательной характеристике (значение появилось раньше,
 * чем обязательность) правится свободно, как и записано в правилах бэкенда.
 * При смене типа сервер стирает значения прежнего типа и заново спрашивает
 * обязательные — поэтому пустые поля здесь проверяются и на клиенте.
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
    // Значения в форме могли разойтись с базой — перечитываем список.
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
  const weightGrams = parseWeight(input.value)

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

async function save(
  item: GearItem,
  patch: { title?: string; weightGrams?: number | null; note?: string | null },
) {
  savingId.value = item.id
  error.value = null

  try {
    const updated = await updateGearItem(item.id, patch)
    Object.assign(item, updated)
  } catch (cause) {
    error.value = messageOf(cause, 'Не удалось сохранить предмет.')
    // Значение в поле могло разойтись с базой — перечитываем список.
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

onMounted(load)
onMounted(loadTypes)
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
 * **Вместимости здесь нет** (28.10.2026). Места считаются у карточки
 * перемещения: одна и та же машина едет то с вещами, то без, и держать
 * в каталоге цифру, которая врёт половину поездок, незачем. Поле в API
 * осталось — прежние записи не портятся, — но экран его не спрашивает
 * и не показывает.
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

    <!-- Новый предмет: сначала тип, потом его характеристики -->
    <form
      class="grid gap-2 sm:grid-cols-[11rem_1fr_6rem_1fr_auto] sm:items-end"
      @submit.prevent="add"
    >
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

      <button
        type="submit"
        :disabled="isAdding || newTitle.trim().length === 0 || newType === null"
        class="cursor-pointer rounded-xl border border-primary bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        data-test="gear-add"
      >
        {{ isAdding ? 'Добавляем…' : 'Добавить' }}
      </button>
    </form>

    <p v-if="typesError" class="mt-2 text-sm text-red-600" data-test="gear-types-error">
      {{ typesError }}
    </p>

    <!-- Характеристики выбранного типа: их набор задаёт справочник -->
    <div
      v-if="newAttributes.length > 0"
      class="mt-3 rounded-xl border border-border bg-surface p-3"
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

    <p v-if="isLoading" class="mt-4 text-sm text-muted" data-test="gear-loading">
      Загружаем снаряжение…
    </p>

    <p
      v-else-if="items.length === 0"
      class="mt-4 rounded-xl border border-dashed border-border p-4 text-sm text-muted"
      data-test="gear-empty"
    >
      Список пуст. Начните с того, что точно поедет в следующий поход: палатка, спальник, рюкзак.
    </p>

    <div v-else class="mt-5 flex flex-col gap-5">
      <section v-for="group in groups" :key="group.code" data-test="gear-group">
        <h3 class="mb-1 text-sm font-medium text-text">{{ group.label }}</h3>

        <ul class="flex flex-col">
          <li
            v-for="item in group.items"
            :key="item.id"
            class="border-t border-border py-2"
            data-test="gear-item"
          >
            <div class="grid gap-2 sm:grid-cols-[1fr_6rem_1fr_auto] sm:items-center">
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

            <!-- Характеристики: подпись словами и кнопка правки -->
            <div class="mt-1 flex flex-wrap items-center justify-between gap-2 px-2">
              <p class="text-xs text-muted" data-test="item-attributes-summary">
                {{ gearAttributesSummary(item) || 'Характеристики не заполнены' }}
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
