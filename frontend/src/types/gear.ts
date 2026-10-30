/**
 * Снаряжение на фронте.
 *
 * Значения `kind` — ровно те строки, что принимает и отдаёт бэкенд
 * (`backend/src/gear/gear.types.ts`). Русские подписи живут только здесь:
 * бэкенд отдаёт значения, а как их назвать человеку — дело интерфейса.
 */

import type { GearValueKind } from '@/types/gearTypes'

export const GEAR_KINDS = [
  'tent',
  'sleeping',
  'backpack',
  'kitchen',
  'clothing',
  'footwear',
  'technical',
  'other',
] as const

export type GearKind = (typeof GEAR_KINDS)[number]

/**
 * Подписи видов.
 *
 * «Палатка», «Спальник» — в единственном числе, как называют сами вещи:
 * у человека их может быть две, но категория одна.
 */
export const GEAR_KIND_LABELS: Record<GearKind, string> = {
  tent: 'Палатка',
  sleeping: 'Спальник',
  backpack: 'Рюкзак',
  kitchen: 'Кухня',
  clothing: 'Одежда',
  footwear: 'Обувь',
  technical: 'Техника',
  other: 'Прочее',
}

/**
 * Значение характеристики у вещи — как его отдаёт `GearItemAttributeDto`.
 *
 * `code` нужен, чтобы правка собирала карту «код → значение» (так их
 * принимает `PATCH /api/gear/:id`), `name` и `unit` — для подписи на экране,
 * `valueKind` — чтобы решить, как нарисовать поле.
 */
export interface GearItemAttribute {
  /** Id характеристики: стабильнее кода, но для запросов хватает кода. */
  attributeId: number
  code: string
  name: string
  valueKind: GearValueKind
  /** Единица измерения: «мест», «см», «л». `null` — без единицы. */
  unit: string | null
  /** Число, строка (у списка — имя варианта) или галочка. */
  value: number | string | boolean
}

/**
 * Предмет снаряжения: тип, название, необязательный вес и значения.
 *
 * **Вид (`kind`) — уходящее поле** (Stage B). С 30.10.2026 в базе живёт тип,
 * а `kind` бэкенд считает по коду типа и отдаёт ещё один шаг: на нём держатся
 * экраны «Костровое» и «Палатки», пока не перейдут на коды типов. Личный
 * каталог вид не использует — он группирует вещи по типу.
 */
export interface GearItem {
  id: string
  typeId: number
  /** Код типа: `tent`, `axe`, `shelter`. Контракт, на нём фильтруют экраны. */
  typeCode: string
  /** Название типа для человека: «Палатка», «Топор». */
  typeName: string
  /** @deprecated вид старого каталога, посчитанный по коду типа. */
  kind: GearKind
  title: string
  /** Вес в граммах. null — не указан. */
  weightGrams: number | null
  note: string | null
  /** Значения характеристик в порядке справочника. */
  attributes: GearItemAttribute[]
  createdAt: string
}

/** Ответ `GET /api/gear`: предметы и итог по весу. */
export interface GearList {
  items: GearItem[]
  totalWeightGrams: number
  /** Сколько предметов без веса — они в сумму не входят. */
  itemsWithoutWeight: number
}

/**
 * Статус вещи в снаряжении похода (`backend/src/gear/trip-gear.types.ts`).
 *
 * `declined` — «не берём»: строка остаётся, потому что «эту палатку
 * обсуждали и не взяли» — тоже ответ. На экране ночёвок такая палатка
 * не показывается: ночевать в ней никто не собирается.
 */
export const TRIP_GEAR_STATUSES = ['proposed', 'approved', 'declined'] as const
export type TripGearStatus = (typeof TRIP_GEAR_STATUSES)[number]

/**
 * Вещь в снаряжении похода — ссылка на предмет личного каталога.
 *
 * Название, вид и вес приходят из `gear_items`: палатку взвешивают один раз,
 * и в походе она весит столько же. Имени владельца в строке нет: состав
 * похода загружен отдельно, и два источника правды об одном человеке не
 * нужны — фронт склеивает их по `ownerUserId`.
 */
export interface TripGearItem {
  id: string
  gearItemId: string
  kind: GearKind
  title: string
  weightGrams: number | null
  note: string | null
  status: TripGearStatus
  ownerUserId: string
  /** Кто несёт. `null` — ещё не распределена. */
  assignedUserId: string | null
  createdAt: string
}

/** Ответ `GET /api/trips/:id/gear` (вес считает бэкенд по утверждённым). */
export interface TripGearList {
  items: TripGearItem[]
  totalWeightGrams: number
  itemsWithoutWeight: number
}
