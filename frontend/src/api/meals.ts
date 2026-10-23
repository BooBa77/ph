import { apiFetch } from '@/api/client'
import type { Dish, DishIngredient, Product } from '@/types/meals'

/**
 * Питание: справочник продуктов (только чтение) и кулинарная книга.
 *
 * Продукты общие для всех, блюда — личные, и всё работает «от токена»:
 * владельца в теле нет.
 */

/**
 * GET /api/products?search=
 *
 * Поиск по подстроке названия. Пустая строка уходит как есть — бэкенд
 * отвечает пустым списком, и это правильно: справочник не листают,
 * его ищут.
 */
export async function searchProducts(search: string): Promise<Product[]> {
  const response = await apiFetch<{ products: Product[] }>(
    `/products?search=${encodeURIComponent(search)}`,
  )
  return response.products
}

/** GET /api/dishes — мои блюда с составом и весом. */
export async function listDishes(): Promise<Dish[]> {
  const response = await apiFetch<{ dishes: Dish[] }>('/dishes')
  return response.dishes
}

/** POST /api/dishes */
export async function createDish(title: string): Promise<Dish> {
  return apiFetch<Dish>('/dishes', {
    method: 'POST',
    body: JSON.stringify({ title }),
  })
}

/** PATCH /api/dishes/:id — название и/или заметка. */
export async function updateDish(
  id: string,
  patch: { title?: string; note?: string | null },
): Promise<Dish> {
  return apiFetch<Dish>(`/dishes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/** DELETE /api/dishes/:id — блюдо уходит вместе с составом. */
export async function deleteDish(id: string): Promise<void> {
  await apiFetch<void>(`/dishes/${id}`, { method: 'DELETE' })
}

/**
 * POST /api/dishes/:id/ingredients
 *
 * Повторный продукт в блюде бэкенд отвергает 409: две строки с одним
 * продуктом означали бы два количества одного и того же.
 */
export async function addIngredient(
  dishId: string,
  productId: number,
  amount: number,
  isMeat = false,
): Promise<DishIngredient> {
  return apiFetch<DishIngredient>(`/dishes/${dishId}/ingredients`, {
    method: 'POST',
    body: JSON.stringify({ productId, amount, isMeat }),
  })
}

/** PATCH /api/dishes/ingredients/:id — количество и/или мясной флаг. */
export async function updateIngredient(
  ingredientId: string,
  amount: number,
  isMeat?: boolean,
): Promise<DishIngredient> {
  return apiFetch<DishIngredient>(`/dishes/ingredients/${ingredientId}`, {
    method: 'PATCH',
    body: JSON.stringify(isMeat === undefined ? { amount } : { amount, isMeat }),
  })
}

/** DELETE /api/dishes/ingredients/:id */
export async function deleteIngredient(ingredientId: string): Promise<void> {
  await apiFetch<void>(`/dishes/ingredients/${ingredientId}`, { method: 'DELETE' })
}
