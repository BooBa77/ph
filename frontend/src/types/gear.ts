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
