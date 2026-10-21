import { apiFetch } from '@/api/client'
import type {
  CreateTripRequest,
  GuestTrip,
  ParticipantDecision,
  ParticipantStatus,
  RoleOption,
  Trip,
  TripListQuery,
  TripListResponse,
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
): Promise<TripParticipant> {
  return apiFetch<TripParticipant>(`/trips/${tripId}/participants/me`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
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
