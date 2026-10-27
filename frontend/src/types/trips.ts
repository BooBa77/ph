/**
 * Типы и словари походов на фронте.
 *
 * Значения словарей — ровно те строки, что принимает и отдаёт бэкенд
 * (`trip.types.ts` на бэкенде). Русские подписи живут только здесь:
 * бэкенд отдаёт значения, а как их назвать человеку — дело интерфейса.
 * Меняешь набор значений — правь оба места, иначе форма предложит то,
 * что база отвергнет.
 */

import type { ProductUnit } from '@/types/meals'

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

/**
 * Что значит «когда» в фильтре ленты — значения бэкенда (`TRIP_WHEN_VALUES`).
 *
 * Это не то же самое, что готовность: «Решено» с датой в прошлом — прошедший
 * поход, а «Мечта» без дат — бездатный. Готовность человек выбирает сам,
 * «когда» вычисляется из дат и факта.
 *
 * `weekend` — следующие выходные: ближайшие суббота и воскресенье, которые
 * ещё не начались (в сами выходные — уже следующие за ними). Считается
 * на бэкенде в поясе Прибайкалья, а не в поясе браузера.
 *
 * Порядок здесь — порядок пунктов в списке: «Следующие выходные» первыми,
 * потому что это самый частый вопрос к ленте анонсов.
 */
export const TRIP_WHEN_VALUES = [
  'weekend',
  'upcoming',
  'ongoing',
  'past',
  'undated',
] as const
export type TripWhen = (typeof TRIP_WHEN_VALUES)[number]

export const TRIP_WHEN_LABELS: Record<TripWhen, string> = {
  weekend: 'Следующие выходные',
  upcoming: 'Впереди',
  ongoing: 'Идёт сейчас',
  past: 'Прошёл',
  undated: 'Без дат',
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
 * Месяц конкретного года.
 *
 * Год здесь не для красоты: «июнь» без года — это и ближайший июнь,
 * и следующий, и через пять лет, а мечта обычно про «этим летом или
 * следующим». Поэтому в примерном периоде месяц выбирается вместе
 * с годом, а не сам по себе.
 */
export interface DatePeriod {
  year: number
  month: number
}

/**
 * Черновик варианта дат в форме.
 *
 * Отличается от `TripDateVariantInput` тем, что это то, что человек видит
 * на экране: строки из полей ввода, режим («примерный период» или «точное
 * число») и прокликанные месяцы с годами. «Прокликать месяцы» — это
 * отдельный вариант на каждый выбранный месяц, поэтому здесь они лежат
 * массивом, а в запрос уезжают отдельными записями.
 */
export interface DateVariantDraft {
  id: number
  mode: 'periods' | 'exact'
  periods: DatePeriod[]
  year: string
  month: string
  day: string
  durationDays: string
  durationDelta: string
}

/** Пустой вариант: всё не заполнено, режим — примерный период. */
export function emptyVariantDraft(id: number): DateVariantDraft {
  return {
    id,
    mode: 'periods',
    periods: [],
    year: '',
    month: '',
    day: '',
    durationDays: '',
    durationDelta: '',
  }
}

/** Тело `POST /api/trips`. Организатором становится владелец токена. */ export interface CreateTripRequest {
  goalObjectId: number
  /** Короткий текст-анонс. Имя похода — это цель, а не это поле. */
  announcement?: string | null
  routeText?: string
  requirementsText?: string | null
  /** Будет ли гитара. По умолчанию нет: «не указано» и «не будет» — одно. */
  hasGuitar?: boolean
  visibility?: TripVisibility
  status?: TripStatus
  activityTypeIds?: number[]
  startsAt?: string | null
  endsAt?: string | null
  isCommercial?: boolean
  /** Официальный поход: зачётный выход по правилам. */
  isOfficial?: boolean
  priceRub?: number | null
  priceNote?: string | null
  dateVariants?: TripDateVariantInput[]
}

/**
 * Тело `PATCH /api/trips/:id`.
 *
 * Все поля необязательны, и **отсутствие поля — не то же самое, что `null`**:
 * без поля значение остаётся прежним, а `null` его стирает. Поэтому патч
 * собирается сравнением с походом (`buildTripPatch`), а не отправкой формы
 * целиком: полная форма затёрла бы то, чего человек не касался.
 *
 * Это не `Partial<CreateTripRequest>`: у правки есть поля, которых нет
 * при создании, — факт выхода и возвращения (его отмечают после похода)
 * и «набор закрыт» (его переключают, когда он закрылся).
 */
export interface UpdateTripRequest {
  goalObjectId?: number
  announcement?: string | null
  routeText?: string
  requirementsText?: string | null
  hasGuitar?: boolean
  visibility?: TripVisibility
  status?: TripStatus
  startsAt?: string | null
  endsAt?: string | null
  /** Факт: выход на маршрут. План не затирает — обе правды хранятся рядом. */
  actualStartedAt?: string | null
  /** Факт: возвращение с маршрута. */
  actualFinishedAt?: string | null
  /** Набор закрыт: заявки не принимаются. */
  isRecruitmentClosed?: boolean
  isCommercial?: boolean
  /** Официальный поход: зачётный выход по правилам. */
  isOfficial?: boolean
  priceRub?: number | null
  priceNote?: string | null
  activityTypeIds?: number[]
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
  /** Будет ли гитара. */
  hasGuitar: boolean
  visibility: TripVisibility
  isRecruitmentClosed: boolean
  activityTypeIds: number[]
  status: TripStatus
  startsAt: string | null
  endsAt: string | null
  /**
   * Прогноз дат. Нужен форме правки: без него смена готовности с «Мечты»
   * на «Планирую» показывала бы пустую продолжительность и стирала её
   * при сохранении.
   */
  dateVariants: TripDateVariantInput[]
  /** Факт выхода на маршрут: он важнее плана — см. `TRIP_WHEN_VALUES`. */
  actualStartedAt: string | null
  /** Факт возвращения. */
  actualFinishedAt: string | null
  isCommercial: boolean
  /** Официальный поход: зачётный выход по правилам. */
  isOfficial: boolean
  priceRub: number | null
  priceNote: string | null
  /** Когда поход отменён. В ленту отменённые не попадают, но по id видны. */
  cancelledAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Фильтры `GET /api/trips`.
 *
 * Все необязательны, и **отсутствие параметра — это не то же самое, что
 * `false`**: без `isCommercial` вернутся и коммерческие, и нет, а с
 * `isCommercial=false` — только некоммерческие. Поэтому «любое значение»
 * в интерфейсе означает «не отправлять параметр», а не `false`.
 *
 * `mine` — три состояния: `true` — только мои, `false` — только чужие,
 * без параметра — все видимые.
 */
export interface TripListQuery {
  /**
   * Объект справочника: поход, у которого это цель **или** который
   * упоминает его в маршруте. Один параметр, а не два: человеку, который
   * ищет походы про Витязь, не важно, целью он был или пунктом маршрута.
   */
  objectId?: number
  activityTypeId?: number
  status?: TripStatus
  isCommercial?: boolean
  isOfficial?: boolean
  when?: TripWhen
  mine?: boolean
  organizerUserId?: string
  limit?: number
  offset?: number
}

/** Ответ `GET /api/trips`: страница ленты и сколько всего подходит. */
export interface TripListResponse {
  trips: Trip[]
  total: number
}

/**
 * Тип похода — строка общего справочника активностей из группы «Туризм».
 *
 * Отдельного словаря у похода нет: «Пеший поход», «Альпинизм», «Велосипед»
 * лежат там же, где активности календаря, и место сужает `scope` группы
 * (см. `docs/ph/trip-tabs.md`). Фронт получает готовый список с
 * `GET /api/trips/types` — с подписями и ключами иконок, а не одни id.
 */
export interface TripTypeOption {
  id: number
  /** Машинный код: по нему узнаём тип по умолчанию, не глядя на порядок. */
  code: string
  label: string
  /** Ключ иконки из `assets/activity-icons.ts`. */
  icon: string
}

/** Ответ `GET /api/trips/types`. */
export interface TripTypeList {
  types: TripTypeOption[]
  /**
   * Тип, который подставляется неофициальному походу. Считает бэкенд:
   * «пеший поход по умолчанию» — правило домена, а не разметки чипсов.
   * `null` — в справочнике нет `trip_hiking`, и подставлять нечего.
   */
  defaultTypeId: number | null
}

/**
 * Вкладки страницы похода и права ролей на них (Ф6).
 *
 * Порядок и коды — как в бэкенде (`backend/src/trips/trip-tabs.ts`).
 * Русские подписи живут только здесь.
 *
 * **Права — на правку, а не на просмотр:** вкладки видят все участники
 * (решение заказчика 21.10.2026), гость — «Гостевую». Отдельной вкладки
 * «Инфо» нет: информация живёт в «Гостевой», она одна для всех, правка —
 * кнопкой «Редактировать» в шапке.
 */
export const TRIP_TABS = [
  'guest',
  'members',
  'sport',
  'transfer',
  'route',
  'meals',
  'gear',
  'firstAid',
  'finance',
  'diary',
] as const

export type TripTabCode = (typeof TRIP_TABS)[number]

export const TRIP_TAB_LABELS: Record<TripTabCode, string> = {
  guest: 'Гостевая',
  members: 'Участники',
  sport: 'Спорт',
  transfer: 'Трансфер',
  route: 'Маршрут',
  meals: 'Питание',
  gear: 'Снаряжение',
  firstAid: 'Аптечка',
  finance: 'Бухгалтерия',
  diary: 'Дневник',
}

/** Вкладка с правом правки: считает бэкенд по ролям и организатору. */
export interface TripTabPermission {
  code: TripTabCode
  canEdit: boolean
}

/**
 * Поход глазами гостя — вкладка «Гостевая», одна для всех.
 *
 * С 21.10.2026 информации о походе одна: состав участников и даты (решение
 * и факт) здесь тоже есть — это важная часть анонса. Места сбора нет:
 * «где встречаемся» уехало в «Трансфер».
 */
export interface GuestTrip {
  id: string
  goalObject: { id: string; name: string; type: string; url: string | null } | null
  announcement: string | null
  routeText: string
  requirementsText: string | null
  status: TripStatus
  startsAt: string | null
  endsAt: string | null
  actualStartedAt: string | null
  actualFinishedAt: string | null
  /** Состав: кто идёт, с ролями и статусами. */
  participants: TripParticipant[]
  isCommercial: boolean
  priceRub: number | null
  priceNote: string | null
  isOfficial: boolean
  isRecruitmentClosed: boolean
}

/** Роль из справочника: код для API, название для человека. */
export interface RoleOption {
  code: string
  name: string
}

// ─────────────────────────── переписка ───────────────────────────

/**
 * Виды чатов похода: гостевой видят все, остальные — только состав.
 *
 * Чат — тема вкладки (решение 21.10.2026): гостевой живёт на «Гостевой»,
 * членский — на «Участниках», питания — в «Питании», трансфера —
 * в «Трансфере».
 */
export const CHAT_KINDS = [
  'trip_guest',
  'trip_members',
  'trip_meals',
  'trip_transfer',
] as const
export type ChatKind = (typeof CHAT_KINDS)[number]

export const CHAT_KIND_LABELS: Record<ChatKind, string> = {
  trip_guest: 'Гостевой чат',
  trip_members: 'Чат участников',
  trip_meals: 'Чат питания',
  trip_transfer: 'Чат трансфера',
}

/** Сообщение чата похода. `senderId === null` — системное. */
export interface TripMessage {
  id: string
  senderId: string | null
  senderName: string | null
  senderAvatarUrl: string | null
  body: string
  isSystem: boolean
  createdAt: string
}

/** Чат похода, доступный смотрящему. */
export interface TripChat {
  id: string
  kind: ChatKind
  title: string
  canWrite: boolean
  lastMessage: TripMessage | null
}

/**
 * Участие в походе.
 *
 * `invited` — пригласили и человек ещё не ответил; `declined` — не идёт
 * по любой причине, включая «организую, но сам не пойду». Отдельного
 * «удалён из состава» нет: убранного человека в списке просто нет.
 */
export const PARTICIPANT_STATUSES = ['invited', 'going', 'maybe', 'declined'] as const
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number]

export const PARTICIPANT_STATUS_LABELS: Record<ParticipantStatus, string> = {
  invited: 'Приглашён',
  going: 'Идёт',
  maybe: 'Пока не решил',
  declined: 'Не идёт',
}

/**
 * Чем можно ответить на приглашение: «иду» или «пока не решил».
 * Отказ — не ответ, а закрытие тикета: он убирает человека из состава.
 */
export const PARTICIPANT_DECISIONS = ['going', 'maybe'] as const
export type ParticipantDecision = (typeof PARTICIPANT_DECISIONS)[number]

/** Роль участника: код для логики, название для человека. */
export interface TripRole {
  code: string
  name: string
}

/** Участник похода: кто, как участвует и какие у него роли. */
export interface TripParticipant {
  userId: string
  displayName: string
  avatarUrl: string | null
  status: ParticipantStatus
  roles: TripRole[]
  /** Автор похода: его нельзя убрать из состава. */
  isOrganizer: boolean
  createdAt: string
  updatedAt: string
}

/** Направление тикета: приглашение (организатор → человек) или заявка. */
export type RequestDirection = 'invite' | 'apply'

/** Тикет: кого позвали или кто попросился. */
export interface TripRequest {
  userId: string
  displayName: string
  avatarUrl: string | null
  direction: RequestDirection
  message: string | null
  createdAt: string
}

// ─────────────────────── питание похода ───────────────────────

/** Приёмы пищи: три в день, больше нельзя (`meals.md` §5.4). */
export const TRIP_MEAL_KINDS = ['breakfast', 'lunch', 'dinner'] as const
export type TripMealKind = (typeof TRIP_MEAL_KINDS)[number]

export const TRIP_MEAL_LABELS: Record<TripMealKind, string> = {
  breakfast: 'Завтрак',
  lunch: 'Обед',
  dinner: 'Ужин',
}

/** Время приёма: 08 / 13 / 19. Края дня подрезаются по времени заезда. */
export const TRIP_MEAL_TIMES: Record<TripMealKind, string> = {
  breakfast: '08:00',
  lunch: '13:00',
  dinner: '19:00',
}

/** Буква приёма в коде дня: «1з», «2о», «3у». */
export const TRIP_MEAL_CODES: Record<TripMealKind, string> = {
  breakfast: 'з',
  lunch: 'о',
  dinner: 'у',
}

export const TRIP_MEAL_FORMS = ['cook', 'snack'] as const
export type TripMealForm = (typeof TRIP_MEAL_FORMS)[number]

export const TRIP_MEAL_FORM_LABELS: Record<TripMealForm, string> = {
  cook: 'Готовка',
  snack: 'Перекус',
}

export const TRIP_MEAL_PACKAGE_KINDS = ['normal', 'kulek'] as const
export type TripMealPackageKind = (typeof TRIP_MEAL_PACKAGE_KINDS)[number]

/** Едок: идущий участник с диетическими пометками. */
export interface TripEater {
  userId: string
  displayName: string
  avatarUrl: string | null
  gender: 'm' | 'f'
  isVegetarian: boolean
  allergies: string | null
  eatsSeparately: boolean
}

export interface TripEaters {
  /** Едоков всего — без тех, кто питается отдельно. */
  total: number
  men: number
  women: number
  vegetarians: number
  /** Идущие, включая тех, кто ест отдельно. */
  people: TripEater[]
}

/** Доля строки раскладки в пакете. */
export interface TripMealAllocation {
  packageId: string
  /** У эластичной «всё» — остаток. */
  amount: number
  isElastic: boolean
}

/** Доля, которую отправляют на сервер: не больше одной эластичной. */
export interface MealAllocationInput {
  packageId: string
  amount: number
  isElastic?: boolean
}

/** Ингредиент блюда в раскладке — на человека. */
export interface TripMealDishIngredient {
  productId: number
  name: string
  unit: ProductUnit
  amount: number
  isMeat: boolean
}

export interface TripMealDish {
  dishId: string
  title: string
  ingredients: TripMealDishIngredient[]
  /** Ингредиенты, убранные в этом приёме; рецепт не меняется. */
  excludedProductIds: number[]
}

/** Строка раскладки: продукт в приёме, рецептовая и ручная части. */
export interface TripMealProduct {
  productId: number
  name: string
  unit: ProductUnit
  weightPerUnitGrams: number
  recipeAmount: number
  manualAmount: number
  amount: number
  isMeat: boolean
  fromDishes: string[]
  allocations: TripMealAllocation[]
}

export interface TripMeal {
  id: string
  dayIndex: number
  kind: TripMealKind
  form: TripMealForm
  dishes: TripMealDish[]
  products: TripMealProduct[]
  weightGrams: number
}

export interface TripMealPackageItem {
  mealId: string
  dayIndex: number
  kind: TripMealKind
  productId: number
  name: string
  amount: number
  isElastic: boolean
  weightGrams: number
}

export interface TripMealPackage {
  id: string
  name: string
  kind: TripMealPackageKind
  mealId: string | null
  weightActualGrams: number | null
  weightActualStale: boolean
  weightEstimatedGrams: number
  items: TripMealPackageItem[]
}

/** Раскладка и фасовка похода целиком. */
export interface TripMealPlan {
  dayCount: number
  eaters: TripEaters
  meals: TripMeal[]
  packages: TripMealPackage[]
}

// ─────────────────────────── трансфер похода ───────────────────────────

/**
 * Сторона: туда или обратно.
 *
 * Раньше сторона выводилась из точек маршрута, и это оказалось хрупко:
 * обратный выезд бывает без точек вовсе. Теперь это поле, а на экране —
 * две области со своими кнопками «Добавить трансфер».
 */
export const TRANSFER_DIRECTIONS = ['there', 'back'] as const
export type TransferDirection = (typeof TRANSFER_DIRECTIONS)[number]

export const TRANSFER_DIRECTION_LABELS: Record<TransferDirection, string> = {
  there: 'Туда',
  back: 'Обратно',
}

/**
 * Способы доставки, сгруппированные для выпадающего списка.
 *
 * Группа — это только порядок и подпись в интерфейсе, в базе её нет.
 * «Пешком» убрано 27.10.2026: пеший переход — это маршрут, а не заброска.
 */
export const TRANSFER_MODE_GROUPS = [
  {
    code: 'land',
    label: 'Земля',
    modes: [
      'car',
      'suv',
      'truck',
      'tractor',
      'crawler',
      'bus',
      'train',
      'motorcycle',
      'snowmobile',
      'bicycle',
      'horses',
      'atv',
    ],
  },
  { code: 'water', label: 'Вода', modes: ['boat', 'ship', 'airboat'] },
  { code: 'air', label: 'Воздух', modes: ['helicopter'] },
  { code: 'other', label: 'Другое', modes: ['other'] },
] as const

export const TRANSFER_MODES = TRANSFER_MODE_GROUPS.flatMap((group) => group.modes)
export type TransferMode = (typeof TRANSFER_MODE_GROUPS)[number]['modes'][number]

export const TRANSFER_MODE_LABELS: Record<TransferMode, string> = {
  car: 'Автомобиль',
  suv: 'Внедорожник',
  truck: 'Грузовик',
  tractor: 'Трактор',
  crawler: 'Вездеход',
  bus: 'Автобус',
  train: 'Ж/д',
  motorcycle: 'Мотоцикл',
  snowmobile: 'Снегоход',
  bicycle: 'Велосипед',
  horses: 'Кони',
  atv: 'Квадроцикл',
  boat: 'Лодка',
  ship: 'Корабль',
  airboat: 'Аэролодка',
  helicopter: 'Вертолёт',
  other: 'Другое',
}

/**
 * Рейсы: автобус, ж/д, корабль, вертолёт. У них не бывает «нашего ТС»
 * и владельца, зато бывает цена билета; общий расход — наоборот, только
 * у своего транспорта.
 */
export const TRANSFER_PUBLIC_MODES = ['bus', 'train', 'ship', 'helicopter'] as const

/**
 * Компенсация расходов.
 *
 * `free` — безвозмездно; `ticket` — цена билета (только рейсы);
 * `shared` — общий расход; `sharedPerPassenger` — общий расход на пассажиров.
 * У общих расходов бывает флаг «туда-обратно».
 */
export const TRANSFER_COMPENSATIONS = [
  'free',
  'ticket',
  'shared',
  'sharedPerPassenger',
] as const
export type TransferCompensation = (typeof TRANSFER_COMPENSATIONS)[number]

export const TRANSFER_COMPENSATION_LABELS: Record<TransferCompensation, string> = {
  free: 'Безвозмездно',
  ticket: 'Цена билета',
  shared: 'Общий расход',
  sharedPerPassenger: 'Общий расход на пассажиров',
}

/** Компенсации, у которых бывает флаг «туда-обратно». */
export const TRANSFER_ROUND_TRIP_COMPENSATIONS = ['shared', 'sharedPerPassenger'] as const

/**
 * Статус пассажира.
 *
 * `requested` — попросился на чужое ТС и ждёт владельца; `accepted` — едет.
 * На рейсах заявок нет: билет куплен, спрашивать некого.
 */
export const TRANSFER_PASSENGER_STATUSES = ['requested', 'accepted'] as const
export type TransferPassengerStatus = (typeof TRANSFER_PASSENGER_STATUSES)[number]

export const TRANSFER_PASSENGER_STATUS_LABELS: Record<TransferPassengerStatus, string> = {
  requested: 'Просится',
  accepted: 'Едет',
}

/** Человек, которого можно посадить в карточку. */
export interface TripTransferPerson {
  userId: string
  displayName: string
}

/** Пассажир карточки: едет или ещё просится. */
export interface TripTransferPassenger extends TripTransferPerson {
  status: TransferPassengerStatus
}

/**
 * Карточка перемещения — одна часть группы едет одним способом.
 *
 * Машины отдельной сущностью больше нет: способ доставки, места, владелец
 * и компенсация — свойства карточки. Пять человек в одной машине и трое
 * в другой — это две карточки в одной области.
 */
export interface TripTransferLeg {
  id: string
  direction: TransferDirection
  /** Порядок внутри своей стороны. */
  position: number
  mode: TransferMode
  /** Выезд: обязателен, поэтому здесь всегда дата. */
  departsAt: string
  fromPlace: string
  toPlace: string
  /** «Наше ТС»: транспорт группы, а не рейс. */
  isOwnVehicle: boolean
  ownerUserId: string | null
  ownerName: string | null
  seats: number | null
  /** Транспорт из каталога участника, если выбрали из списка. */
  vehicleId: string | null
  vehicleTitle: string | null
  /** Исходная карточка пары «туда-обратно»: заполнено — это зеркало. */
  sourceLegId: string | null
  /** Сколько мест занято принятыми пассажирами. Считает бэкенд. */
  occupied: number
  compensation: TransferCompensation
  compensationAmountRub: number | null
  isRoundTrip: boolean
  note: string | null
  /** Правит ли смотрящий карточку: право вкладки или владелец этого ТС. */
  canEdit: boolean
  /**
   * Что будет, если смотрящий присоединится: `accepted` — сразу едет,
   * `requested` — заявка владельцу, `null` — уже в карточке или нельзя.
   */
  joinStatus: TransferPassengerStatus | null
  passengers: TripTransferPassenger[]
}

/** Вкладка «Трансфер» целиком (`GET /api/trips/:id/transfer`). */
export interface TripTransfer {
  /** Может ли смотрящий создавать любые карточки — считает бэкенд. */
  canEdit: boolean
  /** Кого можно посадить: участники, которые идут. */
  travelers: TripTransferPerson[]
  legs: TripTransferLeg[]
}

/** Что уходит на сервер при создании карточки. */
export interface TransferLegInput {
  direction: TransferDirection
  mode: TransferMode
  departsAt: string
  fromPlace: string
  toPlace: string
  isOwnVehicle?: boolean
  ownerUserId?: string | null
  seats?: number | null
  /** Транспорт из каталога: способ и места берутся оттуда. */
  vehicleId?: number | null
  compensation: TransferCompensation
  compensationAmountRub?: number | null
  isRoundTrip?: boolean
  note?: string | null
}

/**
 * Типы личной техники — раздел «Моя техника» в «Снаряжении».
 *
 * Это не способы доставки: у способа есть рейсы (автобус, поезд, корабль,
 * вертолёт), а личная техника — то, что человек держит сам. Связь
 * «тип → способ» однозначна, поэтому карточка «Трансфера» понимает способ
 * по выбранной технике сама.
 */
export const VEHICLE_KINDS = ['car', 'bicycle', 'snowmobile', 'atv', 'motorcycle', 'boat'] as const
export type VehicleKind = (typeof VEHICLE_KINDS)[number]

export const VEHICLE_KIND_LABELS: Record<VehicleKind, string> = {
  car: 'Автомобиль',
  snowmobile: 'Снегоход',
  atv: 'Квадроцикл',
  motorcycle: 'Мотоцикл',
  bicycle: 'Велосипед',
  boat: 'Лодка',
}

/** Во что превращается тип техники в карточке перемещения. */
export const VEHICLE_KIND_TO_MODE: Record<VehicleKind, TransferMode> = {
  car: 'car',
  snowmobile: 'snowmobile',
  atv: 'atv',
  motorcycle: 'motorcycle',
  bicycle: 'bicycle',
  boat: 'boat',
}

/**
 * Личная техника участника.
 *
 * Поля ровно те, что нужны для учёта: тип, марка, госномер и вместимость
 * (необязательная). На «Трансфере» техника выбирается из списка, и способ
 * с местами приходят отсюда.
 */
export interface Vehicle {
  id: string
  kind: VehicleKind
  brand: string
  plate: string | null
  seats: number | null
  createdAt: string
}

/** Тело создания и правки техники в каталоге. */
export interface VehicleInput {
  kind: VehicleKind
  brand: string
  plate?: string | null
  seats?: number | null
}

/** Строка чек-листа покупок: продукт раскладки и его отметки. */
export interface TripMealCheck {
  productId: number
  name: string
  unit: ProductUnit
  weightPerUnitGrams: number
  /** Сколько надо по раскладке. */
  needAmount: number
  needGrams: number
  isBought: boolean
  /** Домашнее: покупать не нужно, но строка остаётся. */
  isHome: boolean
  boughtAmount: number | null
  boughtByName: string | null
  boughtAt: string | null
  /** Продукт ушёл из раскладки, но куплен — строка осталась. */
  isOrphaned: boolean
}
