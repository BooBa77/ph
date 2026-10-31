import { apiFetch } from '@/api/client'
import type { GearAttributePayload } from '@/utils/gearAttributes'
import type {
  GearGroup,
  GearGroupList,
  GearItem,
  GearList,
  TripGearItem,
  TripGearList,
} from '@/types/gear'

/**
 * Личное снаряжение: каталог предметов с весом.
 *
 * Как и календарь, работает «от токена»: владельца в теле запроса нет,
 * предмет всегда принадлежит тому, кто его создал.
 *
 * **Тип вместо вида (Stage B, 30.10.2026).** В теле запроса — `typeId`
 * из справочника (`GET /api/gear-types`), значения характеристик — картой
 * «код характеристики → значение». Вида (`kind`) нет ни в запросе, ни
 * в ответе: прослойка перехода удалена 30.10.2026 вместе с экранами,
 * которые читали вид, — с этого шага тип единственный.
 */

/** GET /api/gear — мои предметы и итог по весу. */
export async function listGear(): Promise<GearList> {
  return apiFetch<GearList>('/gear')
}

/**
 * GET /api/gear-groups — полки каталога, только действующие.
 *
 * Из этого списка экран берёт названия секций, их порядок и выбор группы
 * в форме вещи. Архивных групп здесь нет: вещь в архивной полке покажется
 * после действующих, и её имя приходит самой вещью (`groupName`).
 */
export async function fetchGearGroups(): Promise<GearGroup[]> {
  const list = await apiFetch<GearGroupList>('/gear-groups')

  return list.items
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
  groupId?: number
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
    groupId?: number
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

/**
 * POST /api/gear/:id/move — переставить вещь выше или ниже в её группе.
 *
 * Через границу группы стрелка не переставляет: порядок полок задаёт админ,
 * а не человек. Ответ — список целиком: после перестановки изменились две
 * строки, и клиенту не нужно угадывать вторую.
 */
export async function moveGearItem(
  id: string,
  direction: 'up' | 'down',
): Promise<GearList> {
  return apiFetch<GearList>(`/gear/${id}/move`, {
    method: 'POST',
    body: JSON.stringify({ direction }),
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

/**
 * Тело `POST /api/trips/:id/gear/manual` — вещь, заведённая в походе вручную.
 *
 * Второй путь снаряжения (31.10.2026), слова заказчика: «При добавлении
 * снаряги нужен пункт „Указать вручную“». Любой участник заводит себе
 * одноразовую вещь («бутылка бензина на розжиг»); организатор может
 * указать хозяином человека без аккаунта.
 *
 * - `title` необязателен: пусто — сервер подпишет вещь именем типа;
 * - `ownerUserId` не указан — хозяин я; чужому настоящему участнику вещь
 *   не добавляют (403), виртуальному этого похода — можно;
 * - `addToCatalog` — «добавить в список для регулярного использования»:
 *   у настоящего хозяина заводит вещь ещё и в его каталоге, у виртуального
 *   каталога нет и `true` при нём — 400.
 */
export interface AddManualTripGearRequest {
  typeId: number
  attributes?: GearAttributePayload
  title?: string | null
  weightGrams?: number | null
  ownerUserId?: string | null
  addToCatalog?: boolean
}

/** POST /api/trips/:id/gear/manual — вещь «вручную» → строка похода. */
export async function addManualTripGear(
  tripId: string,
  body: AddManualTripGearRequest,
): Promise<TripGearItem> {
  return apiFetch<TripGearItem>(`/trips/${tripId}/gear/manual`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * DELETE /api/trips/:id/gear/:gearId — убрать вещь из похода (31.10.2026).
 *
 * Крестики в «Палатках» и «Костровом» раньше жили в памяти: ручки не было,
 * и после перезагрузки убранная вещь возвращалась. Теперь это настоящая
 * строка `trip_gear`: владелец убирает свою вещь, тот, кто ведёт снаряжение
 * (организатор, завхоз), — любую. Одноразовая вещь уходит вместе со строкой,
 * вещь из каталога остаётся у владельца — из похода уходит только решение
 * её взять.
 *
 * Права проверяет сервер: чужая вещь без права на вкладку «Снаряжение» —
 * 403, и текст ошибки показывается на экране.
 */
export async function removeTripGear(
  tripId: string,
  gearId: string,
): Promise<void> {
  await apiFetch<void>(`/trips/${tripId}/gear/${gearId}`, { method: 'DELETE' })
}
