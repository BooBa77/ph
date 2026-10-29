/**
 * Снаряжение на фронте.
 *
 * Значения `kind` — ровно те строки, что принимает и отдаёт бэкенд
 * (`backend/src/gear/gear.types.ts`). Русские подписи живут только здесь:
 * бэкенд отдаёт значения, а как их назвать человеку — дело интерфейса.
 */

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

/** Предмет снаряжения: вид, название, необязательный вес. */
export interface GearItem {
  id: string
  kind: GearKind
  title: string
  /** Вес в граммах. null — не указан. */
  weightGrams: number | null
  note: string | null
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
