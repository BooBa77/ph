/**
 * Питание на фронте: продукты и блюда.
 *
 * Значения `unit` — ровно те строки, что принимает и отдаёт бэкенд
 * (`backend/src/meals/meal.types.ts`). Подписи единиц живут только здесь.
 */

export const PRODUCT_UNITS = ['g', 'piece', 'can', 'pack'] as const
export type ProductUnit = (typeof PRODUCT_UNITS)[number]

/**
 * Подписи единиц.
 *
 * Короткие: «2 бан.» в строке состава читается лучше, чем «2 банки»
 * с согласованием, а согласование по-русски пришлось бы считать отдельно
 * для каждого числа.
 */
export const PRODUCT_UNIT_LABELS: Record<ProductUnit, string> = {
  g: 'г',
  piece: 'шт',
  can: 'бан.',
  pack: 'уп.',
}

/** Продукт справочника. */
export interface Product {
  id: number
  name: string
  unit: ProductUnit
  /** Вес одной единицы, граммы. Для граммов — 1. */
  weightPerUnitGrams: number
}

/** Строка состава блюда. */
export interface DishIngredient {
  id: string
  product: Product
  /** Количество в единицах продукта. */
  amount: number
  /** Вес строки, граммы (считает бэкенд). */
  grams: number
  /**
   * Мясной ингредиент: в раскладке похода считается на «едоков минус
   * вегетарианцы», а не на всех.
   */
  isMeat: boolean
}

/** Блюдо кулинарной книги. */
export interface Dish {
  id: string
  title: string
  note: string | null
  ingredients: DishIngredient[]
  /** Вес блюда по составу, граммы (считает бэкенд). */
  totalGrams: number
  createdAt: string
}

/** Количество с единицей: «200 г», «2 бан.». */
export function formatProductAmount(amount: number, unit: ProductUnit): string {
  return `${amount} ${PRODUCT_UNIT_LABELS[unit]}`
}
