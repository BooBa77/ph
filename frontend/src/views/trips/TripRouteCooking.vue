<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { listGear, listTripGear, proposeTripGear, removeTripGear } from '@/api/gear'
import { ApiError } from '@/api/errors'
import { listParticipants } from '@/api/trips'
import { useAuthStore } from '@/stores/auth'
import TripGearExtraPicker from '@/components/gear/TripGearExtraPicker.vue'
import TripGearManualModal from '@/components/gear/TripGearManualModal.vue'
import {
  CAMPFIRE_TYPE_CODES,
  DISHES_TYPE_CODES,
  GEAR_TYPE_CODES,
  STOVE_TYPE_CODES,
} from '@/types/gear'
import type {
  GearItem,
  TripGearItem,
  TripGearRouteSection,
} from '@/types/gear'
import type { Trip, TripParticipant } from '@/types/trips'
import { weightInGrams } from '@/utils/gearWeight'

/**
 * «Готовка» — снаряжение для еды, тремя группами (01.11.2026).
 *
 * Заказчик переделал прежнюю секцию «Костровое» целиком:
 *
 * > «Переименуй секцию „Костровое“ в „Готовка“ и расширяем её. Теперь в ней
 * > три группы снаряжения „Посуда“, „Костровое“ и „Горелки“, раздели их
 * > полосками и в каждой группе свои кнопки и свой список. В новой „Посуда“ —
 * > кнопки „Добавить котёл“, „Добавить половник“, „Добавить нож“, это всё
 * > забинденные типы снаряжения».
 *
 * Отсюда устройство: **три группы, и у каждой своё** — заголовок, список
 * пилюль, ряд кнопок и кнопка «Добавить ещё». Группы разделены полосками,
 * чтобы вещи разных компаний не читались одним списком.
 *
 * **Кнопка задаёт тип** (правило 29.10.2026, в силе). Участник нажимает
 * «Добавить топор» — вещь этого типа уходит в снаряжение похода
 * (`POST /api/trips/:id/gear`) и появляется пилюлей. Цвет кнопки —
 * состояние группы: цветная, пока такой вещи нет; белая, когда есть.
 *
 * **Кнопки видны по плану ночёвок:** костровые — если хоть в одной ночи
 * костёр, горелки — если горелка. Посуда нужна при любой готовке, поэтому
 * её кнопки видны всегда, когда видна секция. План приходит пропсами:
 * своей модели у секции нет, и второй раз считать ночи здесь значило бы
 * разойтись с плашками.
 *
 * **«Добавить ещё» (01.11.2026).** Слова заказчика: «выбор из личного
 * снаряжения или добавка вручную незабинденного снаряжения… губка для мытья
 * посуды… может хоть лодку выбрать. Кнопка всегда белая». Поэтому у каждой
 * группы своя белая кнопка: она открывает общий выбор
 * (`TripGearExtraPicker`) с полками секции первыми и позволяет завести вещь
 * руками. Вещь запоминает секцию (`routeSection`) и показывается там, где её
 * добавили, — по типу губка не попала бы ни в одну группу.
 *
 * **Пилюля** — «{тип} - {вес} гр. ({хозяин})», слова заказчика 29.10.2026:
 * «Горелка - 150 гр. (Анна)». У вещи, добавленной «Добавить ещё», вместо
 * типа стоит её название: «Губка для посуды - 20 гр. (Анна)» — тип у такой
 * вещи общий («Прочее»), и человек узнал бы её только по названию.
 *
 * **Крестик — настоящий `DELETE`** (31.10.2026): у владельца и у того, кто
 * ведёт вкладку. Права проверяет сервер, его текст показывается строкой.
 */
const props = defineProps<{
  trip: Trip
  /** Запланирован костёр хоть в одной ночи — видны костровые кнопки. */
  fire: boolean
  /** Запланирована горелка хоть в одной ночи — видны газовые кнопки. */
  stove: boolean
  /** Подпись «Запланированы N готовок на горелках» — её считает таблица ночей. */
  stoveHint?: string
}>()

const auth = useAuthStore()

/**
 * Кнопка группы: код типа, слова для человека и план ночёвок.
 *
 * `code` — контракт: он приходит у вещи полем `typeCode`, и по нему же
 * фильтруется личный каталог при выборе. `label` и `button` — слова
 * заказчика (30.10.2026); в справочнике тип зовётся «Газовый баллон»,
 * а кнопка — «Добавить газовый баллон».
 */
interface CookingType {
  code: string
  label: string
  button: string
  /** Какой план ночёвок показывает кнопку. */
  plan: 'cooking' | 'fire' | 'stove'
}

/**
 * Группа секции на экране. `code` — тот же код, что уходит в `routeSection`
 * и в словарь API: группа «Посуда» — `dishes`, «Костровое» — `campfire`,
 * «Горелки» — `stove`.
 */
interface CookingGroupView {
  code: Extract<TripGearRouteSection, 'dishes' | 'campfire' | 'stove'>
  title: string
  /** Типы группы — в порядке слов заказчика, а не по алфавиту. */
  types: readonly CookingType[]
  /** Вещи группы: свои плюс те, что «Добавить ещё» положила именно сюда. */
  rows: CookingRow[]
  /** Кнопки, которые сейчас видны: у костра и горелки — по плану ночёвок. */
  visibleTypes: readonly CookingType[]
  /** Полка каталога, которую выбор показывает первой. */
  preferredGroupCode: string
}

/**
 * Порядок групп — слова заказчика: посуда, костровое, горелки.
 *
 * Посуда — первая: котёл и половник нужны при любой готовке, и человек
 * ищет их раньше, чем топор.
 */
const DISHES_TYPES: readonly CookingType[] = [
  {
    code: GEAR_TYPE_CODES.kettle,
    label: 'Котёл',
    button: 'Добавить котёл',
    plan: 'cooking',
  },
  {
    code: GEAR_TYPE_CODES.ladle,
    label: 'Половник',
    button: 'Добавить половник',
    plan: 'cooking',
  },
  {
    code: GEAR_TYPE_CODES.knife,
    label: 'Нож',
    button: 'Добавить нож',
    plan: 'cooking',
  },
]

const CAMPFIRE_TYPES: readonly CookingType[] = [
  {
    code: GEAR_TYPE_CODES.axe,
    label: 'Топор',
    button: 'Добавить топор',
    plan: 'fire',
  },
  {
    code: GEAR_TYPE_CODES.saw,
    label: 'Пила',
    button: 'Добавить пилу',
    plan: 'fire',
  },
  {
    code: GEAR_TYPE_CODES.firestarter,
    label: 'Розжиг',
    button: 'Добавить розжиг',
    plan: 'fire',
  },
  {
    code: GEAR_TYPE_CODES.tagan,
    label: 'Таган',
    button: 'Добавить таган',
    plan: 'fire',
  },
]

const STOVE_TYPES: readonly CookingType[] = [
  {
    code: GEAR_TYPE_CODES.stove,
    label: 'Горелка',
    button: 'Добавить горелку',
    plan: 'stove',
  },
  {
    code: GEAR_TYPE_CODES.gas,
    label: 'Газовый баллон',
    button: 'Добавить газовый баллон',
    plan: 'stove',
  },
]

/** Полка каталога, которую выбор показывает первой: «своя» для группы. */
const DISHES_GROUP_CODE = 'kitchen'
const CAMPFIRE_GROUP_CODE = 'campfire'
const STOVE_GROUP_CODE = 'kitchen'

/**
 * Кнопка одна на два состояния: цветная — такой вещи в группе ещё нет,
 * белая — уже есть. Разметку держим литералами: Tailwind собирает классы
 * из исходников, и склейка через переменные его бы обманула.
 */
const COLORED_BUTTON =
  'cursor-pointer rounded-xl border border-red-600 bg-red-600 px-3 py-1.5 text-sm text-white transition-colors hover:opacity-90'
const WHITE_BUTTON =
  'cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-red-600'

/**
 * «Добавить ещё» — всегда белая (слова заказчика). Она есть в каждой
 * группе, и её цвет не зависит от содержимого: это не «главное действие»,
 * а дверь в каталог.
 */
const EXTRA_BUTTON =
  'cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-red-600'

/** Вещи похода и состав: имя хозяина берём из состава, как в «Палатках». */
const items = ref<TripGearItem[]>([])
const people = ref<TripParticipant[]>([])

const isLoading = ref(true)
const error = ref<string | null>(null)

const meId = computed(() => auth.user?.id ?? '')

const isOrganizer = computed(
  () => meId.value !== '' && props.trip.organizerUserId === meId.value,
)

/** Тип вещи по коду из справочника: угадывать по названию больше не нужно. */
function typeOf(item: TripGearItem): CookingType | null {
  return ALL_TYPES.find((type) => type.code === item.typeCode) ?? null
}

const ALL_TYPES: readonly CookingType[] = [
  ...DISHES_TYPES,
  ...CAMPFIRE_TYPES,
  ...STOVE_TYPES,
]

/**
 * Группа вещи. **Пометка секции важнее типа** (01.11.2026): вещь,
 * добавленную «Добавить ещё» в «Горелки», показывает «Горелки», даже если
 * её тип — топор. Иначе она появилась бы в двух группах сразу.
 */
function groupOf(item: TripGearItem): TripGearRouteSection | null {
  if (item.routeSection != null) return item.routeSection

  if (DISHES_TYPE_CODES.includes(item.typeCode)) return 'dishes'
  if (CAMPFIRE_TYPE_CODES.includes(item.typeCode)) return 'campfire'
  if (STOVE_TYPE_CODES.includes(item.typeCode)) return 'stove'

  return null
}

interface CookingRow {
  item: TripGearItem
  type: CookingType | null
}

function typeOrder(type: CookingType): number {
  return ALL_TYPES.findIndex((row) => row.code === type.code)
}

/** Вещи группы: по порядку типов, внутри типа — по названию. */
function rowsOf(code: CookingGroupView['code']): CookingRow[] {
  return items.value
    .filter((item) => item.status !== 'declined' && groupOf(item) === code)
    .map((item) => ({ item, type: typeOf(item) }))
    .sort(
      (left, right) =>
        (left.type === null ? ALL_TYPES.length : typeOrder(left.type)) -
          (right.type === null ? ALL_TYPES.length : typeOrder(right.type)) ||
        left.item.title.localeCompare(right.item.title, 'ru'),
    )
}

const groups = computed<CookingGroupView[]>(() => [
  {
    code: 'dishes',
    title: 'Посуда',
    types: DISHES_TYPES,
    rows: rowsOf('dishes'),
    visibleTypes: DISHES_TYPES,
    preferredGroupCode: DISHES_GROUP_CODE,
  },
  {
    code: 'campfire',
    title: 'Костровое',
    types: CAMPFIRE_TYPES,
    rows: rowsOf('campfire'),
    visibleTypes: props.fire ? CAMPFIRE_TYPES : [],
    preferredGroupCode: CAMPFIRE_GROUP_CODE,
  },
  {
    code: 'stove',
    title: 'Горелки',
    types: STOVE_TYPES,
    rows: rowsOf('stove'),
    visibleTypes: props.stove ? STOVE_TYPES : [],
    preferredGroupCode: STOVE_GROUP_CODE,
  },
])

/**
 * Есть ли в группе вещь этого типа — от этого цвет кнопки.
 *
 * Считаем по вещам группы, а не по всему походу: топор, добавленный
 * «Добавить ещё» в «Палатки», в «Костровом» не показывается, и кнопка
 * «Добавить топор» остаётся цветной — там его действительно нет.
 */
function hasType(group: CookingGroupView, type: CookingType): boolean {
  return group.rows.some((row) => row.item.typeCode === type.code)
}

function buttonClass(group: CookingGroupView, type: CookingType): string {
  return hasType(group, type) ? WHITE_BUTTON : COLORED_BUTTON
}

/**
 * Подпись группы: что запланировано в ночёвках. Число готовок на горелках
 * считает таблица ночей (ужин и завтрак — по два) и отдаёт готовой строкой:
 * второй счёт здесь разошёлся бы с плашками.
 */
function groupHint(code: CookingGroupView['code']): string | null {
  if (code === 'campfire') return props.fire ? 'Запланирован костёр.' : null
  if (code === 'stove') return props.stove ? (props.stoveHint ?? 'Запланирована горелка.') : null

  return null
}

function nameOf(userId: string): string {
  return people.value.find((person) => person.userId === userId)?.displayName ?? 'Участник'
}

/** Строка в списке выбора: «Топор Fiskars X7 · 900 гр.». */
function gearOptionText(item: GearItem): string {
  const weight = weightInGrams(item.weightGrams)

  return weight === null ? item.title : `${item.title} · ${weight}`
}

/**
 * Пилюля предложенной вещи: «Горелка - 130 гр. (Анна)».
 *
 * Слово типа — из справочника (`typeName`): там оно и живёт, а сид называет
 * типы теми же словами, что заказчик. У вещи из «Добавить ещё» вместо типа
 * стоит название: её тип — общий («Прочее»), и по нему вещь не узнать.
 * Вес — из каталога, формат «гр.» общий с заголовком палатки. Веса нет —
 * пилюля без «- 130 гр»: прочерк читался бы как ошибка.
 */
function pillText(row: CookingRow): string {
  const weight = weightInGrams(row.item.weightGrams)
  const head = row.item.routeSection != null ? row.item.title : row.item.typeName
  const shown = weight === null ? head : `${head} - ${weight}`

  return `${shown} (${nameOf(row.item.ownerUserId)})`
}

// ───────────────────────────── удаление ─────────────────────────────

/** Что сейчас убирается: повторное нажатие крестика не шлёт второй запрос. */
const removingId = ref<string | null>(null)

/** Ошибка удаления — отдельно от загрузки: упавшее удаление не прячет секцию. */
const removalError = ref<string | null>(null)

function isMine(ownerUserId: string): boolean {
  return meId.value !== '' && ownerUserId === meId.value
}

/** Крестик виден владельцу и организатору — больше никому. */
function canRemove(item: TripGearItem): boolean {
  return isMine(item.ownerUserId) || isOrganizer.value
}

/**
 * Убрать вещь из похода настоящим `DELETE` (31.10.2026).
 *
 * Раньше действие жило в памяти: убранная вещь возвращалась после
 * перезагрузки, а организатор мог только предложить убрать. Теперь строка
 * `trip_gear` удаляется на сервере, одноразовая вещь уходит вместе с ней,
 * вещь каталога остаётся у владельца. Права проверяет сервер, и его текст
 * (403 «чужую вещь убирает владелец или тот, кто ведёт снаряжение»)
 * показывается на экране.
 */
async function removeItem(row: CookingRow): Promise<void> {
  if (removingId.value !== null) return

  removingId.value = row.item.id
  removalError.value = null

  try {
    await removeTripGear(props.trip.id, row.item.id)
    items.value = items.value.filter((item) => item.id !== row.item.id)
  } catch (problem) {
    removalError.value =
      problem instanceof ApiError
        ? problem.message
        : 'Не удалось убрать вещь из похода'
  } finally {
    removingId.value = null
  }
}

function removeHint(): string {
  return 'Убрать из похода'
}

/** Пилюля предложенной вещи — жёлтая, как в макете заказчика. */
function pillClass(): string {
  return 'border-amber-300 bg-amber-100 text-amber-900'
}

// ───────────────────────────── загрузка ─────────────────────────────

async function load(): Promise<void> {
  isLoading.value = true
  error.value = null

  try {
    const [members, list] = await Promise.all([
      listParticipants(props.trip.id),
      listTripGear(props.trip.id),
    ])

    people.value = members
    items.value = list.items
  } catch (problem) {
    error.value =
      problem instanceof ApiError ? problem.message : 'Не удалось загрузить снаряжение для готовки'
  } finally {
    isLoading.value = false
  }
}

watch(() => props.trip.id, load, { immediate: true })

// ───────────────────────────── «добавить топор» ─────────────────────────────

const isDialogOpen = ref(false)
const isGearLoading = ref(false)
const isSaving = ref(false)
const dialogError = ref<string | null>(null)

/** Кнопка, которую нажали: её тип и есть тип предложения. */
const activeType = ref<CookingType | null>(null)
const myGear = ref<GearItem[]>([])
const draftGearItemId = ref('')

/** Что уже в походе: второй раз ту же вещь не предложить. */
function takenGearIds(): Set<string> {
  return new Set(items.value.map((item) => item.gearItemId))
}

async function openDialog(type: CookingType): Promise<void> {
  activeType.value = type
  extraGroup.value = null
  isDialogOpen.value = true
  dialogError.value = null
  draftGearItemId.value = ''
  isGearLoading.value = true

  try {
    const list = await listGear()
    const inTrip = takenGearIds()

    myGear.value = list.items.filter(
      (item) => item.typeCode === type.code && !inTrip.has(item.id),
    )
  } catch (problem) {
    dialogError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось загрузить снаряжение'
  } finally {
    isGearLoading.value = false
  }
}

async function saveItem(): Promise<void> {
  if (isSaving.value || draftGearItemId.value === '' || activeType.value === null) return

  isSaving.value = true
  dialogError.value = null

  try {
    const item = await proposeTripGear(props.trip.id, draftGearItemId.value)

    items.value = [...items.value, item]
    isDialogOpen.value = false
  } catch (problem) {
    // Ошибка — в модалке, а не строкой под затемнением (правило «Трансфера»).
    dialogError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось предложить снаряжение'
  } finally {
    isSaving.value = false
  }
}

// ───────────────────────────── «добавить ещё» ─────────────────────────────

/** Группа, из которой открыли «Добавить ещё»: её секция и полки. */
const extraGroup = ref<CookingGroupView | null>(null)
const isExtraOpen = ref(false)
const isExtraLoading = ref(false)
const isExtraSaving = ref(false)
const extraError = ref<string | null>(null)
const extraCatalog = ref<GearItem[]>([])

async function openExtra(group: CookingGroupView): Promise<void> {
  extraGroup.value = group
  isExtraOpen.value = true
  extraError.value = null
  isExtraLoading.value = true

  try {
    extraCatalog.value = (await listGear()).items
  } catch (problem) {
    extraError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось загрузить снаряжение'
  } finally {
    isExtraLoading.value = false
  }
}

/**
 * Вещь из каталога уходит в поход с пометкой секции группы: «Добавить ещё»
 * показывает вещь там, где её добавили, а не там, куда её отнёс тип.
 */
async function pickExtra(item: GearItem): Promise<void> {
  if (isExtraSaving.value || extraGroup.value === null) return

  isExtraSaving.value = true
  extraError.value = null

  try {
    const added = await proposeTripGear(
      props.trip.id,
      item.id,
      extraGroup.value.code,
    )

    items.value = [...items.value, added]
    isExtraOpen.value = false
  } catch (problem) {
    extraError.value =
      problem instanceof ApiError ? problem.message : 'Не удалось добавить вещь'
  } finally {
    isExtraSaving.value = false
  }
}

// ───────────────────────────── «указать вручную» ─────────────────────────────

const isManualOpen = ref(false)

/** Типы для модалки: тот, который задала нажатая кнопка, или все у «ещё». */
const manualTypeCodes = computed<readonly string[]>(() => {
  if (activeType.value !== null) return [activeType.value.code]

  return []
})

const manualDefaultTypeCode = computed(() => activeType.value?.code ?? '')

/** Секция для вещи, заведённой вручную из «Добавить ещё» этой группы. */
const manualRouteSection = computed<TripGearRouteSection | undefined>(
  () => extraGroup.value?.code,
)

/**
 * Хозяин выбирается организатором и только если в походе есть люди без
 * аккаунта: другому настоящему участнику вещь не добавляют.
 */
const manualOwnerOptions = computed(() => {
  if (meId.value === '' || props.trip.organizerUserId !== meId.value) return []

  const virtuals = people.value.filter((person) => person.isVirtual)
  if (virtuals.length === 0) return []

  return [
    { userId: meId.value, displayName: `${auth.user?.displayName ?? 'Я'} (я)` },
    ...virtuals.map((person) => ({
      userId: person.userId,
      displayName: `${person.displayName} (без аккаунта)`,
    })),
  ]
})

/** «Указать вручную» из диалога кнопки: тип задан кнопкой. */
function openManual(): void {
  if (activeType.value === null) return

  extraGroup.value = null
  isDialogOpen.value = false
  isManualOpen.value = true
}

/** «Добавить вручную» из «Добавить ещё»: тип выбирает сам человек. */
function openExtraManual(): void {
  activeType.value = null
  // Выбор не закрываем: форма открывается поверх него, и «Отмена» вернёт
  // к тому же каталогу с тем же поиском и группой.
  isManualOpen.value = true
}

/**
 * Закрыли форму без сохранения.
 *
 * Если её открыли из «Добавить ещё», `extraGroup` остался — за формой лежит
 * тот же выбор, и он снова виден. Если из диалога кнопки, диалог уже закрыт,
 * и человек возвращается в секцию.
 */
function cancelManual(): void {
  isManualOpen.value = false
  activeType.value = null

  if (extraGroup.value === null) isExtraOpen.value = false
}

/** Вещь создана: закрываем и форму, и выбор за ней. */
function finishManual(): void {
  isManualOpen.value = false
  isExtraOpen.value = false
  activeType.value = null
  extraGroup.value = null
}

function onManualCreated(item: TripGearItem): void {
  items.value = [...items.value, item]
  finishManual()
}
</script>

<template>
  <section class="flex flex-col gap-3" data-test="route-cooking">
    <p v-if="isLoading" class="text-sm text-muted" data-test="route-cooking-loading">
      Загружаем снаряжение…
    </p>

    <p v-else-if="error" class="text-sm text-muted" data-test="route-cooking-error">
      {{ error }}
    </p>

    <template v-else>
      <p
        v-if="removalError"
        class="text-sm text-red-600"
        data-test="route-cooking-remove-error"
      >
        {{ removalError }}
      </p>

      <p
        v-if="extraError"
        class="text-sm text-red-600"
        data-test="route-cooking-extra-error"
      >
        {{ extraError }}
      </p>

      <!--
        Три группы с полосками между ними (01.11.2026): у каждой свой
        заголовок, свой список пилюль и свои кнопки. Подсказка о плане
        ночёвок стоит в шапке группы — отдельно от вещей: «Запланирован
        костёр» и «Топор - 900 гр.» это разные слои.
      -->
      <template v-for="(group, index) in groups" :key="group.code">
        <hr
          v-if="index > 0"
          class="border-red-300"
          :data-test="`route-cooking-divider-${group.code}`"
        />

        <div class="flex flex-col gap-2" :data-test="`route-cooking-group-${group.code}`">
          <div class="flex flex-col gap-0.5">
            <h4 class="text-sm font-medium text-red-900" :data-test="`route-cooking-title-${group.code}`">
              {{ group.title }}
            </h4>

            <p
              v-if="groupHint(group.code)"
              class="text-sm text-text"
              :data-test="
                group.code === 'campfire' ? 'route-fire-hint' : 'route-stove-hint'
              "
            >
              {{ groupHint(group.code) }}
            </p>
          </div>

          <div
            v-if="group.rows.length > 0"
            class="flex flex-wrap items-center gap-2"
            :data-test="`route-cooking-items-${group.code}`"
          >
            <span
              v-for="row in group.rows"
              :key="row.item.id"
              class="flex items-center gap-1 rounded-full border px-2 py-1 text-sm"
              :class="pillClass()"
              :title="row.item.title"
              data-test="route-cooking-item"
            >
              <span>{{ pillText(row) }}</span>

              <!--
                Крестик убирает вещь из похода настоящим DELETE: владелец
                свою, организатор любую (права проверяет сервер). Чужому
                участнику крестика нет.
              -->
              <button
                v-if="canRemove(row.item)"
                type="button"
                :disabled="removingId !== null"
                class="cursor-pointer border-0 bg-transparent p-0 text-amber-700 transition-colors hover:text-amber-900 disabled:cursor-not-allowed disabled:opacity-40"
                :title="removeHint()"
                :data-test="`route-cooking-remove-${row.item.id}`"
                @click="removeItem(row)"
              >
                ×
              </button>
            </span>
          </div>

          <p
            v-else
            class="text-sm text-muted"
            :data-test="`route-cooking-empty-${group.code}`"
          >
            Пока пусто.
          </p>

          <!--
            Кнопки группы. Ряд переносится: на телефоне это две-три строки,
            и это нормально. «Добавить ещё» — всегда последней и всегда
            белой (слова заказчика): она не спорит с цветными кнопками.
          -->
          <div class="flex flex-wrap items-center gap-2" :data-test="`route-cooking-buttons-${group.code}`">
            <button
              v-for="type in group.visibleTypes"
              :key="type.code"
              type="button"
              :class="buttonClass(group, type)"
              :data-test="`route-cooking-add-${type.code}`"
              @click="openDialog(type)"
            >
              {{ type.button }}
            </button>

            <button
              type="button"
              :class="EXTRA_BUTTON"
              :data-test="`route-cooking-extra-${group.code}`"
              @click="openExtra(group)"
            >
              Добавить ещё
            </button>
          </div>
        </div>
      </template>
    </template>

    <!-- Предложение: тип выбран кнопкой, вещь выбирает человек -->
    <div
      v-if="isDialogOpen"
      class="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4"
      data-test="route-cooking-dialog"
    >
      <div
        class="flex w-full max-w-md flex-col gap-2 rounded-xl border border-border bg-surface p-4"
      >
        <h3 class="text-base font-medium text-text">{{ activeType?.label }}</h3>

        <label class="flex flex-col gap-1 text-sm text-muted">
          Своё снаряжение
          <select
            v-model="draftGearItemId"
            class="w-full rounded-xl border border-border bg-field px-3 py-2 text-base text-text transition-colors focus:border-primary focus:outline-none md:text-sm"
            :disabled="isGearLoading"
            data-test="route-cooking-gear"
          >
            <option value="">выберите…</option>
            <option v-for="item in myGear" :key="item.id" :value="item.id">
              {{ gearOptionText(item) }}
            </option>
          </select>
        </label>

        <p
          v-if="!isGearLoading && myGear.length === 0"
          class="text-xs text-muted"
          data-test="route-cooking-no-gear"
        >
          Подходящей вещи в личном снаряжении нет — заведите её в профиле,
          на вкладке «Снаряжение», или укажите вручную.
        </p>

        <!--
          Одноразовая вещь: её нет в каталоге, и в профиль она не поедет.
          Тип уже задан кнопкой — модалка спрашивает характеристики, вес
          и хозяина.
        -->
        <button
          type="button"
          class="cursor-pointer self-start border-0 bg-transparent p-0 text-sm text-primary underline transition-opacity hover:opacity-80"
          data-test="route-cooking-manual"
          @click="openManual"
        >
          Указать вручную
        </button>

        <p v-if="dialogError" class="text-sm text-red-600" data-test="route-cooking-error-dialog">
          {{ dialogError }}
        </p>

        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="cursor-pointer rounded-xl border border-primary bg-primary px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            :disabled="isSaving || draftGearItemId === ''"
            data-test="route-cooking-save"
            @click="saveItem"
          >
            Предложить
          </button>

          <button
            type="button"
            class="cursor-pointer rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-text transition-colors hover:border-primary"
            :disabled="isSaving"
            data-test="route-cooking-cancel"
            @click="isDialogOpen = false"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>

    <!--
      «Добавить ещё»: весь личный каталог, полки группы первыми. Выбор
      и «Указать вручную» отдаются событиями — сохраняет секция.
    -->
    <TripGearExtraPicker
      v-if="isExtraOpen && extraGroup !== null"
      :items="extraCatalog"
      :exclude-ids="[...takenGearIds()]"
      :preferred-group-codes="[extraGroup.preferredGroupCode]"
      :preferred-type-codes="extraGroup.types.map((type) => type.code)"
      :loading="isExtraLoading"
      @pick="pickExtra"
      @manual="openExtraManual"
      @close="isExtraOpen = false"
    />

    <!--
      Одна модалка «вручную» на все типы: из кнопки группы тип задан,
      из «Добавить ещё» — любой на выбор.
    -->
    <TripGearManualModal
      v-if="isManualOpen"
      :trip-id="trip.id"
      :type-codes="manualTypeCodes"
      :default-type-code="manualDefaultTypeCode"
      :route-section="manualRouteSection"
      :owner-options="manualOwnerOptions"
      @created="onManualCreated"
      @close="cancelManual"
    />
  </section>
</template>
