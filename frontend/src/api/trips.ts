import { apiFetch } from '@/api/client'
import type {
  ChatKind,
  CreateTripRequest,
  GuestTrip,
  MealAllocationInput,
  ParticipantDecision,
  ParticipantStatus,
  RoleOption,
  Trip,
  TripChat,
  TripListQuery,
  TripListResponse,
  TripMessage,
  TripMealCheck,
  TripMealForm,
  TripMealKind,
  TripMealPlan,
  TripParticipant,
  TripRequest,
  TripTabPermission,
  TripTypeList,
  RequestDirection,
  UpdateTripRequest,
} from '@/types/trips'

/**
 * POST /api/trips
 *
 * Создать поход. Организатором становится владелец токена — поля
 * с организатором в теле нет и быть не должно: `forbidNonWhitelisted`
 * на бэкенде отбивает лишние поля 400-м.
 *
 * Возвращает созданный поход целиком, отдельный GET не нужен.
 */
export async function createTrip(data: CreateTripRequest): Promise<Trip> {
  return apiFetch<Trip>('/trips', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

/**
 * GET /api/trips/:id
 *
 * Один поход целиком. Приватный поход чужому отдаёт 404, а не 403 —
 * существование закрытого похода не должно утекать.
 */
export async function getTrip(id: string): Promise<Trip> {
  return apiFetch<Trip>(`/trips/${id}`)
}

/**
 * PATCH /api/trips/:id
 *
 * Правка похода организатором. Присланные поля перезаписываются,
 * отсутствующие остаются как были, `null` — осознанная очистка: поэтому
 * сюда уходит не форма целиком, а её разница с походом (`buildTripPatch`).
 */
export async function updateTrip(id: string, data: UpdateTripRequest): Promise<Trip> {
  return apiFetch<Trip>(`/trips/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

/**
 * Собрать строку запроса ленты.
 *
 * **Параметр уходит только если он задан.** `?isCommercial=false` и
 * отсутствие параметра — разные запросы: первое просит только некоммерческие
 * походы, второе — любые. Поэтому `undefined` отбрасывается, а `false`
 * остаётся: `false` здесь такое же значение, как `true`.
 *
 * Вынесено отдельной функцией и экспортировано, чтобы это правило
 * проверялось тестом, а не глазами в разметке компонента.
 */
export function buildTripListQuery(query: TripListQuery = {}): string {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }

  const text = params.toString()
  return text ? `?${text}` : ''
}

/**
 * GET /api/trips
 *
 * Лента походов с фильтрами и пагинацией. Приватные походы видны только
 * участникам, отменённые в ленту не попадают — и то и другое без
 * возможности отключить параметром.
 */
export async function listTrips(query: TripListQuery = {}): Promise<TripListResponse> {
  return apiFetch<TripListResponse>(`/trips${buildTripListQuery(query)}`)
}

/**
 * Словарь типов похода, загруженный однажды на жизнь вкладки.
 *
 * Лента показывает двадцать карточек, и каждая хочет подпись типа. Двадцать
 * запросов за тремя строками справочника — это тот самый N+1, от которого
 * спасает только кеш. Кеш живёт в модуле, а не в Pinia: справочник
 * не меняется без перезагрузки страницы, а отдельный store заводить ради
 * него незачем.
 *
 * Кешируется **промис**, а не результат: двадцать карточек, смонтированных
 * одновременно, получают один и тот же запрос, а не двадцать.
 *
 * Отказ сбрасывает кеш: иначе сеть упала бы один раз, и до перезагрузки
 * страницы форма молчала бы без единой попытки повторить.
 */
let tripTypesRequest: Promise<TripTypeList> | null = null

/**
 * GET /api/trips/types
 *
 * Типы похода для чипсов в форме и для подписи на странице: id, код,
 * подпись и ключ иконки. Плюс `defaultTypeId` — тип, который подставляется
 * неофициальному походу (`trip_hiking`, «Пеший поход»).
 */
export function listTripTypes(): Promise<TripTypeList> {
  tripTypesRequest ??= apiFetch<TripTypeList>('/trips/types').catch((problem) => {
    tripTypesRequest = null
    throw problem
  })

  return tripTypesRequest
}

/**
 * Сбросить кеш словаря. Нужен тестам: между ними модуль живёт один,
 * а база моков у каждого своя.
 */
export function resetTripTypesCache(): void {
  tripTypesRequest = null
}

// ───────────────────────────── доступ ─────────────────────────────

/**
 * GET /api/trips/:id/tabs — вкладки и права на правку.
 *
 * Права считает бэкенд по ролям и организатору: фронт не решает, кто завхоз.
 * Гостю (не участнику) приходит только «Гостевая».
 */
export async function fetchTripTabs(tripId: string): Promise<TripTabPermission[]> {
  const response = await apiFetch<{ tabs: TripTabPermission[] }>(`/trips/${tripId}/tabs`)
  return response.tabs
}

/** GET /api/trips/roles — справочник активных ролей. */
export async function fetchRoles(): Promise<RoleOption[]> {
  const response = await apiFetch<{ roles: RoleOption[] }>('/trips/roles')
  return response.roles
}

/**
 * PUT /api/trips/:id/participants/:userId/roles — назначить роли.
 *
 * Присланный список **заменяет** прежние роли. Роли назначают организатор
 * и соорганизатор; сами участники ими не управляют.
 */
export async function setParticipantRoles(
  tripId: string,
  userId: string,
  roleCodes: string[],
): Promise<TripParticipant> {
  return apiFetch<TripParticipant>(`/trips/${tripId}/participants/${userId}/roles`, {
    method: 'PUT',
    body: JSON.stringify({ roleCodes }),
  })
}

/** GET /api/trips/:id/guest — поход глазами гостя. */
export async function fetchGuestTrip(tripId: string): Promise<GuestTrip> {
  return apiFetch<GuestTrip>(`/trips/${tripId}/guest`)
}

// ───────────────────────────── состав ─────────────────────────────

/** GET /api/trips/:id/participants — состав с ролями и статусами. */
export async function listParticipants(tripId: string): Promise<TripParticipant[]> {
  const response = await apiFetch<{ participants: TripParticipant[] }>(
    `/trips/${tripId}/participants`,
  )
  return response.participants
}

/**
 * PATCH /api/trips/:id/participants/me — свой статус участия.
 *
 * `declined` здесь законен и означает «не иду», но человек остаётся
 * в списке состава: состав — это история похода, а не только те, кто
 * в итоге пошёл.
 */
export async function setMyStatus(
  tripId: string,
  status: ParticipantStatus,
  eatsSeparately?: boolean,
): Promise<TripParticipant> {
  return apiFetch<TripParticipant>(`/trips/${tripId}/participants/me`, {
    method: 'PATCH',
    body: JSON.stringify(
      eatsSeparately === undefined ? { status } : { status, eatsSeparately },
    ),
  })
}

/** DELETE /api/trips/:id/participants/:userId — убрать человека. Только организатор. */
export async function removeParticipant(tripId: string, userId: string): Promise<void> {
  await apiFetch<void>(`/trips/${tripId}/participants/${userId}`, { method: 'DELETE' })
}

// ─────────────────────── приглашения и заявки ───────────────────────

/**
 * GET /api/trips/:id/requests — тикеты похода.
 *
 * Организатор видит все, остальные только свои: заявка человека
 * к организатору других не касается.
 */
export async function listRequests(tripId: string): Promise<TripRequest[]> {
  const response = await apiFetch<{ requests: TripRequest[] }>(`/trips/${tripId}/requests`)
  return response.requests
}

/**
 * POST /api/trips/:id/requests — пригласить (`invite`) или попроситься
 * (`apply`). В заявке `userId` не передаётся: им становится владелец токена,
 * и бэкенд лишнее поле отбивает.
 */
export async function createRequest(
  tripId: string,
  body: { direction: RequestDirection; userId?: string; message?: string | null },
): Promise<TripRequest> {
  return apiFetch<TripRequest>(`/trips/${tripId}/requests`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/** POST /api/trips/:id/requests/:userId/accept — «иду» или «пока не решил». */
export async function acceptRequest(
  tripId: string,
  userId: string,
  status: ParticipantDecision,
): Promise<TripParticipant> {
  return apiFetch<TripParticipant>(`/trips/${tripId}/requests/${userId}/accept`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  })
}

/**
 * DELETE /api/trips/:id/requests/:userId — закрыть тикет.
 *
 * Один и тот же вызов для четырёх случаев: отказаться от приглашения,
 * отозвать приглашение, отклонить заявку или отозвать свою. Разница —
 * в том, кто это делает, и решает её бэкенд.
 */
export async function deleteRequest(tripId: string, userId: string): Promise<void> {
  await apiFetch<void>(`/trips/${tripId}/requests/${userId}`, { method: 'DELETE' })
}

// ─────────────────────────── переписка ───────────────────────────

/**
 * GET /api/trips/:id/chats — чаты похода, доступные смотрящему.
 *
 * Гостевой чат видит каждый, кому виден публичный поход; членский — только
 * состав. Фронт не угадывает: спрашивает список и рисует то, что пришло.
 */
export async function listTripChats(tripId: string): Promise<TripChat[]> {
  const response = await apiFetch<{ chats: TripChat[] }>(`/trips/${tripId}/chats`)
  return response.chats
}

/**
 * GET /api/trips/:id/messages — страница сообщений чата.
 *
 * `before` — id самого старого уже загруженного сообщения: листаем вверх
 * по id, а не по дате (id монотонен, дата — нет).
 */
export async function listTripMessages(
  tripId: string,
  kind: ChatKind,
  before?: string,
): Promise<{ messages: TripMessage[]; hasMore: boolean }> {
  const query = new URLSearchParams({ kind })
  if (before) query.set('before', before)

  return apiFetch<{ messages: TripMessage[]; hasMore: boolean }>(
    `/trips/${tripId}/messages?${query.toString()}`,
  )
}

/** POST /api/trips/:id/messages — отправить сообщение в чат. */
export async function sendTripMessage(
  tripId: string,
  kind: ChatKind,
  body: string,
): Promise<TripMessage> {
  return apiFetch<TripMessage>(`/trips/${tripId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ kind, body }),
  })
}

// ─────────────────────── питание похода ───────────────────────

/** GET /api/trips/:id/meal-plan — раскладка и фасовка целиком. */
export async function fetchMealPlan(tripId: string): Promise<TripMealPlan> {
  return apiFetch<TripMealPlan>(`/trips/${tripId}/meal-plan`)
}

/** Общий путь приёма: `/trips/:id/meals/:day/:kind`. */
function mealPath(tripId: string, dayIndex: number, kind: TripMealKind): string {
  return `/trips/${tripId}/meals/${dayIndex}/${kind}`
}

/** PUT .../form — готовка или перекус. */
export async function setMealForm(
  tripId: string,
  dayIndex: number,
  kind: TripMealKind,
  form: TripMealForm,
): Promise<TripMealPlan> {
  return apiFetch<TripMealPlan>(`${mealPath(tripId, dayIndex, kind)}/form`, {
    method: 'PUT',
    body: JSON.stringify({ form }),
  })
}

/** POST .../dishes — поставить своё блюдо. */
export async function addMealDish(
  tripId: string,
  dayIndex: number,
  kind: TripMealKind,
  dishId: string,
): Promise<TripMealPlan> {
  return apiFetch<TripMealPlan>(`${mealPath(tripId, dayIndex, kind)}/dishes`, {
    method: 'POST',
    body: JSON.stringify({ dishId }),
  })
}

/** DELETE .../dishes/:dishId — убрать блюдо. */
export async function removeMealDish(
  tripId: string,
  dayIndex: number,
  kind: TripMealKind,
  dishId: string,
): Promise<TripMealPlan> {
  return apiFetch<TripMealPlan>(
    `${mealPath(tripId, dayIndex, kind)}/dishes/${dishId}`,
    { method: 'DELETE' },
  )
}

/** PUT .../lines/:productId — ручная строка (абсолютная). */
/**
 * POST .../lines — добавить продукт в приём по названию.
 *
 * Либо `catalogProductId` (продукт справочника копируется в поход), либо
 * `name` (свой продукт этого похода). Ссылки на справочник в плане нет.
 */
export async function addMealLine(
  tripId: string,
  dayIndex: number,
  kind: TripMealKind,
  payload: { amount: number; name?: string; catalogProductId?: number },
): Promise<TripMealPlan> {
  return apiFetch<TripMealPlan>(`${mealPath(tripId, dayIndex, kind)}/lines`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function setMealLine(
  tripId: string,
  dayIndex: number,
  kind: TripMealKind,
  productId: number,
  amount: number,
): Promise<TripMealPlan> {
  return apiFetch<TripMealPlan>(
    `${mealPath(tripId, dayIndex, kind)}/lines/${productId}`,
    { method: 'PUT', body: JSON.stringify({ amount }) },
  )
}

/** DELETE .../lines/:productId — убрать ручную строку. */
export async function removeMealLine(
  tripId: string,
  dayIndex: number,
  kind: TripMealKind,
  productId: number,
): Promise<TripMealPlan> {
  return apiFetch<TripMealPlan>(
    `${mealPath(tripId, dayIndex, kind)}/lines/${productId}`,
    { method: 'DELETE' },
  )
}

/** DELETE .../ — убрать приём целиком. */
export async function removeMeal(
  tripId: string,
  dayIndex: number,
  kind: TripMealKind,
): Promise<TripMealPlan> {
  return apiFetch<TripMealPlan>(mealPath(tripId, dayIndex, kind), {
    method: 'DELETE',
  })
}

// ─────────────────────── фасовка ───────────────────────

/** POST /api/trips/:id/meal-packages — новый пакет «Пакет N». */
export async function createMealPackage(tripId: string): Promise<TripMealPlan> {
  return apiFetch<TripMealPlan>(`/trips/${tripId}/meal-packages`, {
    method: 'POST',
  })
}

/** PATCH /api/trips/:id/meal-packages/:packageId — имя и/или фактический вес. */
export async function updateMealPackage(
  tripId: string,
  packageId: string,
  patch: { name?: string; weightActualGrams?: number | null },
): Promise<TripMealPlan> {
  return apiFetch<TripMealPlan>(
    `/trips/${tripId}/meal-packages/${packageId}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  )
}

/** DELETE /api/trips/:id/meal-packages/:packageId — доли уходят каскадом. */
export async function removeMealPackage(
  tripId: string,
  packageId: string,
): Promise<TripMealPlan> {
  return apiFetch<TripMealPlan>(
    `/trips/${tripId}/meal-packages/${packageId}`,
    { method: 'DELETE' },
  )
}

/** PUT .../allocations/:productId — доли строки списком (заменяют прежние). */
export async function setMealAllocations(
  tripId: string,
  dayIndex: number,
  kind: TripMealKind,
  productId: number,
  allocations: MealAllocationInput[],
): Promise<TripMealPlan> {
  return apiFetch<TripMealPlan>(
    `${mealPath(tripId, dayIndex, kind)}/allocations/${productId}`,
    { method: 'PUT', body: JSON.stringify({ allocations }) },
  )
}

/** PUT .../kulek — кулёк приёма: включить или выключить. */
export async function setMealKulek(
  tripId: string,
  dayIndex: number,
  kind: TripMealKind,
  enabled: boolean,
): Promise<TripMealPlan> {
  return apiFetch<TripMealPlan>(`${mealPath(tripId, dayIndex, kind)}/kulek`, {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  })
}

// ─────────────────────── чек-лист покупок ───────────────────────

/** GET /api/trips/:id/meal-checks — проекция раскладки и отметки. */
export async function fetchMealChecks(tripId: string): Promise<TripMealCheck[]> {
  const response = await apiFetch<{ checks: TripMealCheck[] }>(
    `/trips/${tripId}/meal-checks`,
  )

  return response.checks
}

/** PUT /api/trips/:id/meal-checks/:productId — отметка чек-листа. */
export async function updateMealCheck(
  tripId: string,
  productId: number,
  patch: { isBought?: boolean; isHome?: boolean; boughtAmount?: number | null },
): Promise<TripMealCheck[]> {
  const response = await apiFetch<{ checks: TripMealCheck[] }>(
    `/trips/${tripId}/meal-checks/${productId}`,
    { method: 'PUT', body: JSON.stringify(patch) },
  )

  return response.checks
}

/** PUT .../dishes/:dishId/exclusions — убрать ингредиенты в этом приёме. */
export async function setMealDishExclusions(
  tripId: string,
  dayIndex: number,
  kind: TripMealKind,
  dishId: string,
  productIds: number[],
): Promise<TripMealPlan> {
  return apiFetch<TripMealPlan>(
    `${mealPath(tripId, dayIndex, kind)}/dishes/${dishId}/exclusions`,
    { method: 'PUT', body: JSON.stringify({ productIds }) },
  )
}

// ─────────────────────── моя еда: отдельное питание ───────────────────────

/**
 * Личная еда участника, который питается отдельно.
 *
 * Отдельные адреса, а не флаг в общих: сервер всегда берёт владельца из
 * токена, поэтому чужой личный слой попросить нечем. Списков два — общий
 * и свой, — и они не пересекаются.
 */
function myMealPath(
  tripId: string,
  dayIndex: number,
  kind: TripMealKind,
): string {
  return `/trips/${tripId}/my-meals/${dayIndex}/${kind}`
}

/** GET /api/trips/:id/my-meal-plan — личная раскладка и фасовка. */
export async function fetchMyMealPlan(tripId: string): Promise<TripMealPlan> {
  return apiFetch<TripMealPlan>(`/trips/${tripId}/my-meal-plan`)
}

/** POST .../my-meals/:day/:kind/dishes — блюдо в личный приём. */
export async function addMyMealDish(
  tripId: string,
  dayIndex: number,
  kind: TripMealKind,
  dishId: string,
): Promise<TripMealPlan> {
  return apiFetch<TripMealPlan>(`${myMealPath(tripId, dayIndex, kind)}/dishes`, {
    method: 'POST',
    body: JSON.stringify({ dishId }),
  })
}

/** DELETE .../my-meals/:day/:kind/dishes/:dishId — убрать блюдо. */
export async function removeMyMealDish(
  tripId: string,
  dayIndex: number,
  kind: TripMealKind,
  dishId: string,
): Promise<TripMealPlan> {
  return apiFetch<TripMealPlan>(
    `${myMealPath(tripId, dayIndex, kind)}/dishes/${dishId}`,
    { method: 'DELETE' },
  )
}

/** POST .../my-meals/:day/:kind/lines — продукт в личный приём. */
export async function addMyMealLine(
  tripId: string,
  dayIndex: number,
  kind: TripMealKind,
  payload: { amount: number; name?: string; catalogProductId?: number },
): Promise<TripMealPlan> {
  return apiFetch<TripMealPlan>(`${myMealPath(tripId, dayIndex, kind)}/lines`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** DELETE .../my-meals/:day/:kind/lines/:productId — убрать строку. */
export async function removeMyMealLine(
  tripId: string,
  dayIndex: number,
  kind: TripMealKind,
  productId: number,
): Promise<TripMealPlan> {
  return apiFetch<TripMealPlan>(
    `${myMealPath(tripId, dayIndex, kind)}/lines/${productId}`,
    { method: 'DELETE' },
  )
}

/** GET /api/trips/:id/my-meal-checks — мой список покупок. */
export async function fetchMyMealChecks(
  tripId: string,
): Promise<TripMealCheck[]> {
  const response = await apiFetch<{ checks: TripMealCheck[] }>(
    `/trips/${tripId}/my-meal-checks`,
  )

  return response.checks
}

/** PUT /api/trips/:id/my-meal-checks/:productId — отметка личного списка. */
export async function updateMyMealCheck(
  tripId: string,
  productId: number,
  patch: { isBought?: boolean; isHome?: boolean; boughtAmount?: number | null },
): Promise<TripMealCheck[]> {
  const response = await apiFetch<{ checks: TripMealCheck[] }>(
    `/trips/${tripId}/my-meal-checks/${productId}`,
    { method: 'PUT', body: JSON.stringify(patch) },
  )

  return response.checks
}
