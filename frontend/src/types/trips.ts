/**
 * Типы и словари походов на фронте.
 *
 * Значения словарей — ровно те строки, что принимает и отдаёт бэкенд
 * (`trip.types.ts` на бэкенде). Русские подписи живут только здесь:
 * бэкенд отдаёт значения, а как их назвать человеку — дело интерфейса.
 * Меняешь набор значений — правь оба места, иначе форма предложит то,
 * что база отвергнет.
 */

/** Видимость похода. */
export const TRIP_VISIBILITIES = ['public', 'private'] as const
export type TripVisibility = (typeof TRIP_VISIBILITIES)[number]

export const TRIP_VISIBILITY_LABELS: Record<TripVisibility, string> = {
  public: 'Виден всем',
  private: 'Только участникам',
}

/** Стадия подготовки. `decided` требует обеих дат. */
export const TRIP_STATUSES = ['idea', 'planning', 'decided'] as const
export type TripStatus = (typeof TRIP_STATUSES)[number]

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  idea: 'Идея',
  planning: 'Планируем',
  decided: 'Решено',
}

/** Объект справочника — цель похода. */
export interface GeoObject {
  id: string
  name: string
  type: string
  url: string | null
  parentId: string | null
  parentName: string | null
}

/** Тело `POST /api/trips`. Организатором становится владелец токена. */
export interface CreateTripRequest {
  goalObjectId: number
  title?: string | null
  routeText?: string
  requirementsText?: string | null
  visibility?: TripVisibility
  status?: TripStatus
  activityTypeIds?: number[]
  startsAt?: string | null
  endsAt?: string | null
  isCommercial?: boolean
  priceRub?: number | null
  priceNote?: string | null
}

/**
 * Поход в том виде, в каком его отдаёт API.
 *
 * `id` и `goalObjectId` — строки: в базе это `bigint`, и `node-postgres`
 * отдаёт его строкой, чтобы значения больше 2^53 не теряли точность.
 */
export interface Trip {
  id: string
  organizerUserId: string
  goalObjectId: string
  goalObject: {
    id: string
    name: string
    type: string
    url: string | null
  } | null
  title: string | null
  routeText: string
  requirementsText: string | null
  visibility: TripVisibility
  isRecruitmentClosed: boolean
  activityTypeIds: number[]
  status: TripStatus
  startsAt: string | null
  endsAt: string | null
  isCommercial: boolean
  priceRub: number | null
  priceNote: string | null
  createdAt: string
  updatedAt: string
}
