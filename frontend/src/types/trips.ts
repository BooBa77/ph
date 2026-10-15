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

/**
 * Готовность похода.
 *
 * «Мечта» — это не «черновик»: поход-желание, элемент вишлиста, у которого
 * может не быть даты вовсе. «Планирую» — решение уже принято, но срок
 * ещё плавает («следующим летом»). «Решено» — конкретные даты, и только
 * здесь они обязательны: по ним считается, идёт поход сейчас или прошёл.
 *
 * От готовности зависит **способ ввода дат**, а не только подсказка:
 * у мечты и плана это месяцы или число плюс продолжительность, у решения —
 * начало и конец.
 */
export const TRIP_STATUSES = ['idea', 'planning', 'decided'] as const
export type TripStatus = (typeof TRIP_STATUSES)[number]

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  idea: 'Мечта',
  planning: 'Планирую',
  decided: 'Решено',
}

/** Месяцы для выбора «когда-нибудь»: индекс — номер месяца от единицы. */
export const MONTH_SHORT_NAMES = [
  'янв',
  'фев',
  'мар',
  'апр',
  'май',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
] as const

/** Объект справочника — цель похода. */
export interface GeoObject {
  id: string
  name: string
  type: string
  url: string | null
  parentId: string | null
  parentName: string | null
}

/**
 * Как объект подписан в списке выбора.
 *
 * С родителем, потому что имена в справочнике повторяются: на «Природе
 * Байкала» есть разные объекты с одним названием, и выбирать из списка,
 * где написано просто «Черепаха», невозможно.
 */
export function geoObjectLabel(object: GeoObject): string {
  return object.parentName ? `${object.name} · ${object.parentName}` : object.name
}

/**
 * Вариант дат — прогноз.
 *
 * Одна запись = один возможный старт. «Месяц без числа» — это «когда-нибудь
 * в июне», и это законный вариант: у мечты дата может быть не определена
 * вовсе. Продолжительность задаётся минимумом и запасом вверх: «2–3 дня» —
 * это `durationDays: 2`, `durationDelta: 1`.
 */
export interface TripDateVariantInput {
  year?: number | null
  month?: number | null
  day?: number | null
  durationDays?: number | null
  durationDelta?: number
}

/**
 * Черновик варианта дат в форме.
 *
 * Отличается от `TripDateVariantInput` тем, что это то, что человек видит
 * на экране: строки из полей ввода, режим («месяцы» или «точное число»)
 * и прокликанные месяцы. «Прокликать месяцы» — это отдельный вариант
 * на каждый выбранный месяц, поэтому здесь месяцы лежат массивом, а в
 * запрос уезжают отдельными записями.
 */
export interface DateVariantDraft {
  id: number
  mode: 'months' | 'exact'
  months: number[]
  year: string
  month: string
  day: string
  durationDays: string
  durationDelta: string
}

/** Пустой вариант: всё не заполнено, режим — месяцы. */
export function emptyVariantDraft(id: number): DateVariantDraft {
  return {
    id,
    mode: 'months',
    months: [],
    year: '',
    month: '',
    day: '',
    durationDays: '',
    durationDelta: '',
  }
}

/** Тело `POST /api/trips`. Организатором становится владелец токена. */export interface CreateTripRequest {
  goalObjectId: number
  /** Короткий текст-анонс. Имя похода — это цель, а не это поле. */
  announcement?: string | null
  routeText?: string
  requirementsText?: string | null
  visibility?: TripVisibility
  status?: TripStatus
  activityTypeIds?: number[]
  startsAt?: string | null
  endsAt?: string | null
  isCommercial?: boolean
  isSport?: boolean
  priceRub?: number | null
  priceNote?: string | null
  dateVariants?: TripDateVariantInput[]
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
  announcement: string | null
  routeText: string
  requirementsText: string | null
  visibility: TripVisibility
  isRecruitmentClosed: boolean
  activityTypeIds: number[]
  status: TripStatus
  startsAt: string | null
  endsAt: string | null
  isCommercial: boolean
  isSport: boolean
  priceRub: number | null
  priceNote: string | null
  createdAt: string
  updatedAt: string
}
