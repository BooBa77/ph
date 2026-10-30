import { apiFetch } from '@/api/client'
import type { GearAttributePayload } from '@/utils/gearAttributes'
import type { GearItem, GearList, TripGearItem, TripGearList } from '@/types/gear'

/**
 * Личное снаряжение: каталог предметов с весом.
 *
 * Как и календарь, работает «от токена»: владельца в теле запроса нет,
 * предмет всегда принадлежит тому, кто его создал.
 *
 * **Тип вместо вида (Stage B, 30.10.2026).** В теле запроса — `typeId`
 * из справочника (`GET /api/gear-types`), значения характеристик — картой
 * «код характеристики → значение». Вида (`kind`) здесь больше нет: его
 * принимает старый контракт, и оставлен он только на время перехода.
 */

/** GET /api/gear — мои предметы и итог по весу. */
export async function listGear(): Promise<GearList> {
  return apiFetch<GearList>('/gear')
}

/**
 * POST /api/gear — новый предмет. Вес и характеристики можно не указывать.
 *
 * `attributes` — карта «код → значение», а не список пар: код уникален
 * внутри типа, и карта не даёт прислать одну характеристику дважды.
 * `null` — «значение не задано»: строка в базе не заводится.
 */
export async function createGearItem(body: {
  typeId: number
  title: string
  weightGrams?: number | null
  note?: string | null
  attributes?: GearAttributePayload
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
 * тип поля допускает `null`, а не только число. Так же ведёт себя
 * `attributes`: `null` в значении — стереть характеристику.
 *
 * **Смена типа стирает значения прежнего типа** — это делает сервер,
 * и это единственное поведение, при котором «вместимость палатки» не живёт
 * у топора. Отдельного поля «очистить значения» нет.
 */
export async function updateGearItem(
  id: string,
  patch: {
    typeId?: number
    title?: string
    weightGrams?: number | null
    note?: string | null
    attributes?: GearAttributePayload
  },
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

// ───────────────────── снаряжение похода (вкладка «Снаряжение» и ночёвки) ─────────────────────

/**
 * GET /api/trips/:id/gear — вещи похода.
 *
 * Видят участники. Секция «Палатки» берёт отсюда палатки: плашка палатки —
 * это вещь из снаряжения похода, а не текст, набранный в ночёвках.
 */
export async function listTripGear(tripId: string): Promise<TripGearList> {
  return apiFetch<TripGearList>(`/trips/${tripId}/gear`)
}

/**
 * POST /api/trips/:id/gear — предложить свою вещь в поход.
 *
 * Владельца в теле нет: он тот, кто прислал запрос. Предложить можно только
 * предмет из своего каталога, поэтому `gearItemId` берётся из `listGear`.
 * Ручка существовала и до ночёвок — это то же действие, что «взять палатку
 * в поход» на вкладке «Снаряжение».
 */
export async function proposeTripGear(
  tripId: string,
  gearItemId: string,
): Promise<TripGearItem> {
  return apiFetch<TripGearItem>(`/trips/${tripId}/gear`, {
    method: 'POST',
    body: JSON.stringify({ gearItemId: Number(gearItemId) }),
  })
}
