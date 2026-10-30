/**
 * Снаряжение на фронте.
 *
 * **Вида старого каталога (`kind`) здесь больше нет** (30.10.2026). С Stage B
 * роль вида играет **тип** из справочника (`gear_types`), и вещь приходит
 * с `typeCode` — стабильным кодом, на который опираются экраны. Вид был
 * прослойкой перехода, пока «Палатки» и «Костровое» читали его; теперь они
 * читают код типа, и прослойка удалена вместе с последним потребителем.
 */

import type { GearValueKind } from '@/types/gearTypes'

/**
 * Забинденные коды типов — те же, что в `backend/src/gear/gear.types.ts`.
 *
 * Список продублирован, а не приходит со справочником: экран решает,
 * какую кнопку показать и что фильтровать, **до** загрузки типов, и ждать
 * ради этого `GET /api/gear-types` значило бы рисовать пустой экран.
 * Коды — контракт (в `PATCH` типа код не меняется), поэтому копия и
 * справочник не разойдутся: переименовать можно имя, не код.
 *
 * Заказчик 30.10.2026: «в Ночёвках используем забинденные типы палатка,
 * топор и пр.; в разделе „Палатки“ — `tent` („палатка“) и `shelter`
 * („тент“)».
 */
export const GEAR_TYPE_CODES = {
  tent: 'tent',
  shelter: 'shelter',
  axe: 'axe',
  saw: 'saw',
  firestarter: 'firestarter',
  tagan: 'tagan',
  stove: 'stove',
  gas: 'gas',
} as const

/** «Палатки»: палатка и тент — оба дают место для ночлега. */
export const TENT_TYPE_CODES: readonly string[] = [
  GEAR_TYPE_CODES.tent,
  GEAR_TYPE_CODES.shelter,
]

/** «Костровое» при костре: чем рубить, пилить, разжигать и на чём стоять. */
export const CAMPFIRE_TYPE_CODES: readonly string[] = [
  GEAR_TYPE_CODES.axe,
  GEAR_TYPE_CODES.saw,
  GEAR_TYPE_CODES.firestarter,
  GEAR_TYPE_CODES.tagan,
]

/** «Костровое» при горелке: сама горелка и баллон к ней. */
export const STOVE_TYPE_CODES: readonly string[] = [
  GEAR_TYPE_CODES.stove,
  GEAR_TYPE_CODES.gas,
]

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
 * Экраны похода читают тип (`typeCode`) и значения (`attributes`), а личный
 * каталог — ещё и `title`: названием вещи человек сам её различает, в походе
 * оно не показывается.
 */
export interface GearItem {
  id: string
  typeId: number
  /** Код типа: `tent`, `axe`, `shelter`. Контракт, на нём фильтруют экраны. */
  typeCode: string
  /** Название типа для человека: «Палатка», «Топор». */
  typeName: string
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
 * Тип, название, значения и вес приходят из `gear_items`: палатку взвешивают
 * один раз, и в походе она весит столько же. Имени владельца в строке нет:
 * состав похода загружен отдельно, и два источника правды об одном человеке
 * не нужны — фронт склеивает их по `ownerUserId`.
 *
 * `typeCode` и `attributes` — то, по чему «Палатки» и «Костровое» решают,
 * куда вещь положить и чем подписать: вместимость палатки — значение
 * характеристики `seats`, а не слово в названии.
 */
export interface TripGearItem {
  id: string
  gearItemId: string
  typeId: number
  /** Код типа: `tent`, `shelter`, `stove`. */
  typeCode: string
  /** Название типа из справочника: «Палатка», «Тент», «Горелка». */
  typeName: string
  title: string
  /** Значения характеристик в порядке справочника. */
  attributes: GearItemAttribute[]
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
