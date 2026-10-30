import { apiFetch } from '@/api/client'
import type {
  AdminGearType,
  AdminGearTypeAttribute,
  CreateGearAttributeInput,
  CreateGearTypeInput,
  GearType,
  GearTypeList,
  UpdateGearAttributeInput,
  UpdateGearTypeInput,
} from '@/types/gearTypes'

/**
 * Справочник типов снаряжения (Stage A).
 *
 * Два префикса, и это осознанно: **публичное чтение** — `GET /api/gear-types`
 * (только активное, контракт Stage B), **все изменения** —
 * `/api/gear/admin/types/...` (один контроллер, одна проверка прав).
 * Публичного URL с админской семантикой нет: если понадобится другая
 * авторизация, меняется проверка на сервере, а не адрес.
 *
 * Права проверяет бэкенд: не-админу любой админский запрос отвечает 403
 * «Раздел только для администратора», без токена — 401.
 */

/** Префикс админских ручек: чтобы путь не собирался по кускам в семи местах. */
const ADMIN_TYPES = '/gear/admin/types'

/** GET /api/gear-types — активные типы с активными характеристиками. */
export async function fetchGearTypes(): Promise<GearType[]> {
  const response = await apiFetch<GearTypeList>('/gear-types')

  return response.items
}

/** GET /api/gear/admin/types — все типы, включая архивные. */
export async function fetchAdminGearTypes(): Promise<AdminGearType[]> {
  const response = await apiFetch<{ items: AdminGearType[] }>(ADMIN_TYPES)

  return response.items
}

/** POST /api/gear/admin/types — новый тип. Дубликат кода — 409. */
export async function createGearType(body: CreateGearTypeInput): Promise<AdminGearType> {
  return apiFetch<AdminGearType>(ADMIN_TYPES, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * PATCH /api/gear/admin/types/:id — имя, порядок, активность.
 *
 * `isActive: true` возвращает тип из архива; `code` сервер не принимает
 * вовсе (400), поэтому его здесь нет и в типе тела.
 */
export async function updateGearType(
  id: number,
  patch: UpdateGearTypeInput,
): Promise<AdminGearType> {
  return apiFetch<AdminGearType>(`${ADMIN_TYPES}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/**
 * DELETE /api/gear/admin/types/:id — архив, ответ 204.
 *
 * Физического удаления нет: в Stage B на тип будут ссылаться вещи.
 * Повторный вызов тоже 204 — кнопка «В архив» не может «сломаться».
 */
export async function archiveGearType(id: number): Promise<void> {
  await apiFetch<void>(`${ADMIN_TYPES}/${id}`, { method: 'DELETE' })
}

/** POST /api/gear/admin/types/:typeId/attributes — новая характеристика. */
export async function createGearTypeAttribute(
  typeId: number,
  body: CreateGearAttributeInput,
): Promise<AdminGearTypeAttribute> {
  return apiFetch<AdminGearTypeAttribute>(`${ADMIN_TYPES}/${typeId}/attributes`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/** PATCH …/attributes/:attributeId — имя, единица, обязательность, архив. */
export async function updateGearTypeAttribute(
  typeId: number,
  attributeId: number,
  patch: UpdateGearAttributeInput,
): Promise<AdminGearTypeAttribute> {
  return apiFetch<AdminGearTypeAttribute>(
    `${ADMIN_TYPES}/${typeId}/attributes/${attributeId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    },
  )
}

/** DELETE …/attributes/:attributeId — архив, ответ 204. */
export async function archiveGearTypeAttribute(
  typeId: number,
  attributeId: number,
): Promise<void> {
  await apiFetch<void>(`${ADMIN_TYPES}/${typeId}/attributes/${attributeId}`, {
    method: 'DELETE',
  })
}
