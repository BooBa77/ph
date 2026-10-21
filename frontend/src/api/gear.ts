import { apiFetch } from '@/api/client'
import type { GearItem, GearKind, GearList } from '@/types/gear'

/**
 * Личное снаряжение: каталог предметов с весом.
 *
 * Как и календарь, работает «от токена»: владельца в теле запроса нет,
 * предмет всегда принадлежит тому, кто его создал.
 */

/** GET /api/gear — мои предметы и итог по весу. */
export async function listGear(): Promise<GearList> {
  return apiFetch<GearList>('/gear')
}

/** POST /api/gear — новый предмет. Вес можно не указывать. */
export async function createGearItem(body: {
  kind: GearKind
  title: string
  weightGrams?: number | null
  note?: string | null
}): Promise<GearItem> {
  return apiFetch<GearItem>('/gear', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * PATCH /api/gear/:id — правка предмета.
 *
 * `weightGrams: null` — осознанно стереть вес («взвешу позже»), поэтому
 * тип поля допускает `null`, а не только число.
 */
export async function updateGearItem(
  id: string,
  patch: { kind?: GearKind; title?: string; weightGrams?: number | null; note?: string | null },
): Promise<GearItem> {
  return apiFetch<GearItem>(`/gear/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/** DELETE /api/gear/:id */
export async function deleteGearItem(id: string): Promise<void> {
  await apiFetch<void>(`/gear/${id}`, { method: 'DELETE' })
}
