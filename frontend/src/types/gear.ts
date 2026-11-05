/**
 * Снаряжение на фронте.
 *
 * **Вида старого каталога (`kind`) здесь больше нет** (30.10.2026). С Stage B
 * роль вида играет **тип** из справочника (`gear_types`), и вещь приходит
 * с `typeCode` — стабильным кодом, на который опираются экраны. Вид был
 * прослойкой перехода, пока «Палатки» и «Костровое» читали его; теперь они
 * читают код типа, и прослойка удалена вместе с последним потребителем.
 */

import type { GearValueKind } from '@/types/gearTypes'

/**
 * Забинденные коды типов — те же, что в `backend/src/gear/gear.types.ts`.
 *
 * Список продублирован, а не приходит со справочником: экран решает,
 * какую кнопку показать и что фильтровать, **до** загрузки типов, и ждать
 * ради этого `GET /api/gear-types` значило бы рисовать пустой экран.
 * Коды — контракт (в `PATCH` типа код не меняется), поэтому копия и
 * справочник не разойдутся: переименовать можно имя, не код.
 *
 * Заказчик 30.10.2026: «в Ночёвках используем забинденные типы палатка,
 * топор и пр.; в разделе „Палатки“ — `tent` („палатка“) и `shelter`
 * („тент“)».
 */
export const GEAR_TYPE_CODES = {
  tent: 'tent',
  shelter: 'shelter',
  axe: 'axe',
  saw: 'saw',
  firestarter: 'firestarter',
  tagan: 'tagan',
  stove: 'stove',
  gas: 'gas',
  sleeping_bag: 'sleeping_bag',
  mat: 'mat',
  kettle: 'kettle',
  ladle: 'ladle',
  knife: 'knife',
} as const

/** «Палатки»: палатка и тент — оба дают место для ночлега. */
export const TENT_TYPE_CODES: readonly string[] = [
  GEAR_TYPE_CODES.tent,
  GEAR_TYPE_CODES.shelter,
]

/** «Костровое» при костре: чем рубить, пилить, разжигать и на чём стоять. */
export const CAMPFIRE_TYPE_CODES: readonly string[] = [
  GEAR_TYPE_CODES.axe,
  GEAR_TYPE_CODES.saw,
  GEAR_TYPE_CODES.firestarter,
  GEAR_TYPE_CODES.tagan,
]

/** «Костровое» при горелке: сама горелка и баллон к ней. */
export const STOVE_TYPE_CODES: readonly string[] = [
  GEAR_TYPE_CODES.stove,
  GEAR_TYPE_CODES.gas,
]

/**
 * «Посуда» — третья группа секции «Готовка» (01.11.2026).
 *
 * Заказчик: «переименуй секцию „Костровое“ в „Готовка“… три группы
 * снаряжения „Посуда“, „Костровое“ и „Горелки“… в новой „Посуда“ — кнопки
 * „Добавить котёл“, „Добавить половник“, „Добавить нож“, это всё забинденные
 * типы снаряжения».
 */
export const DISHES_TYPE_CODES: readonly string[] = [
  GEAR_TYPE_CODES.kettle,
  GEAR_TYPE_CODES.ladle,
  GEAR_TYPE_CODES.knife,
]

/**
 * Личные вещи ночёвки: спальник и коврик (01.11.2026).
 *
 * Секция «Спальник» спрашивает каталог этими кодами для двух забинденных
 * кнопок — «Добавить спальник» и «Добавить коврик». Кнопка «Добавить ещё»
 * (01.11.2026) берёт вещь любого типа: заказчик просил «вкладыш в спальник,
 * грелка».
 */
export const SLEEPING_TYPE_CODES: readonly string[] = [
  GEAR_TYPE_CODES.sleeping_bag,
  GEAR_TYPE_CODES.mat,
]

/**
 * Секции «Ночёвок», у которых есть кнопка «Добавить ещё» (01.11.2026).
 *
 * Это **не группы каталога**: секция экрана. Заказчик: «Добавить на всех
 * секциях (Палатки, Готовка (3 шт), Спальник) кнопку „Добавить ещё“…
 * предлагать в фильтре выбора сначала соответствующую группу». Вещь,
 * добавленная так, показывается там, где её добавили, — потому пометка
 * и уходит на сервер (`route_section`), а не живёт в памяти экрана.
 *
 * «Спальник» в список не входит: его строки личные и живут в своей таблице,
 * где секция и так одна.
 */
export const TRIP_GEAR_ROUTE_SECTIONS = [
  'tent',
  'dishes',
  'campfire',
  'stove',
] as const

export type TripGearRouteSection = (typeof TRIP_GEAR_ROUTE_SECTIONS)[number]

/**
 * Значение характеристики у вещи — как его отдаёт `GearItemAttributeDto`.
 *
 * `code` нужен, чтобы правка собирала карту «код → значение» (так их
 * принимает `PATCH /api/gear/:id`), `name` и `unit` — для подписи на экране,
 * `valueKind` — чтобы решить, как нарисовать поле.
 */
export interface GearItemAttribute {
  /** Id характеристики: стабильнее кода, но для запросов хватает кода. */
  attributeId: number
  code: string
  name: string
  valueKind: GearValueKind
  /** Единица измерения: «мест», «см», «л». `null` — без единицы. */
  unit: string | null
  /** Число, строка (у списка — имя варианта) или галочка. */
  value: number | string | boolean
}

/**
 * Тип внутри личной группы (02.11.2026).
 *
 * Настройщику группировки нужно показать, что уже лежит в группе, и дать
 * переложить это в другую. Характеристики типов здесь не нужны — их знает
 * справочник. `isActive` — чтобы не предлагать перекладывать архивный тип.
 */
export interface GearGroupType {
  id: number
  code: string
  name: string
  isActive: boolean
}

/**
 * Личная группа снаряжения (02.11.2026).
 *
 * Заказчик: «Типы… группировать их разрешим самостоятельно… можно
 * переименовывать, удалять, перекидывать содержащиеся типы». Поэтому группа
 * собирает **типы**, а вещь попадает в группу своего типа.
 *
 * `templateCode` — след рекомендуемой группы админа: по нему «Прочее»
 * находит себя (`other`), а новые типы доезжают в нужную группу.
 * `isDefault` — неудаляемое и всегда последнее «Прочее».
 */
export interface GearGroup {
  id: number
  /** Название для человека: «Кров», «Костровое», «Прочее». */
  name: string
  /** Порядок секций каталога: свой у каждого человека. */
  sortOrder: number
  /** Код шаблона, из которого пришла группа. `null` — своя группа. */
  templateCode: string | null
  /** «Прочее»: неудаляемое умолчание, всегда последнее. */
  isDefault: boolean
  /** Типы, которые лежат в этой группе. */
  types: GearGroupType[]
}

/**
 * Группа по умолчанию — «Прочее» (`other`), как в бэкенде.
 *
 * У каждого человека есть личная группа с этим кодом шаблона: туда попадает
 * тип без рекомендованной группы и типы удалённой группы. Поэтому она
 * неудаляема и всегда последняя.
 */
export const GEAR_DEFAULT_GROUP_CODE = 'other'

/** Ответ `GET /api/gear-groups`. */
export interface GearGroupList {
  items: GearGroup[]
}

/**
 * Рекомендуемая группа — шаблон админа (02.11.2026).
 *
 * Публично не отдаётся: человек видит свои копии. Нужна админке типов
 * (выбрать рекомендуемую группу) и админке шаблонов.
 */
export interface GearGroupTemplate {
  id: number
  code: string
  name: string
  sortOrder: number
}

/** Шаблон в админке: с архивом и числом рекомендованных типов. */
export interface AdminGearGroupTemplate extends GearGroupTemplate {
  isActive: boolean
  typesCount: number
}

/** Ответ `GET /api/gear/admin/group-templates`. */
export interface AdminGearGroupTemplateList {
  items: AdminGearGroupTemplate[]
}

/**
 * Предмет снаряжения: тип, название, необязательный вес и значения.
 *
 * Экраны похода читают тип (`typeCode`) и значения (`attributes`), а личный
 * каталог — ещё и `title`: названием вещи человек сам её различает, в походе
 * оно не показывается.
 */
export interface GearItem {
  id: string
  typeId: number
  /** Код типа: `tent`, `axe`, `shelter`. Контракт, на нём фильтруют экраны. */
  typeCode: string
  /** Название типа для человека: «Палатка», «Топор». */
  typeName: string
  /** Полка каталога: id, код и имя группы. */
  groupId: number
  /**
   * Код группы. У копии шаблона — его код (`roof`), у своей группы —
   * синтетический `custom_<id>`: стабильного кода у личной группы нет.
   */
  groupCode: string
  groupName: string
  /**
   * Где вещь лежит: «балкон», «гараж», «дача».
   *
   * `null` — не указано. Подсказки в форме собираются из уже введённых
   * значений: отдельного справочника мест нет. В типе поле необязательное,
   * чтобы старые фейки тестов не пришлось учить: сервер его всегда присылает.
   */
  location?: string | null
  /** Личный порядок внутри группы: его меняют стрелки в каталоге. */
  sortOrder: number
  title: string
  /** Вес в граммах. null — не указан. */
  weightGrams: number | null
  note: string | null
  /** Значения характеристик в порядке справочника. */
  attributes: GearItemAttribute[]
  createdAt: string
}

/** Ответ `GET /api/gear`: предметы и итог по весу. */
export interface GearList {
  items: GearItem[]
  totalWeightGrams: number
  /** Сколько предметов без веса — они в сумму не входят. */
  itemsWithoutWeight: number
}

/**
 * Статус вещи в снаряжении похода (`backend/src/gear/trip-gear.types.ts`).
 *
 * `declined` — «не берём»: строка остаётся, потому что «эту палатку
 * обсуждали и не взяли» — тоже ответ. На экране ночёвок такая палатка
 * не показывается: ночевать в ней никто не собирается.
 */
export const TRIP_GEAR_STATUSES = ['proposed', 'approved', 'declined'] as const
export type TripGearStatus = (typeof TRIP_GEAR_STATUSES)[number]

/**
 * Вид раздела «Берём» / «Взял» (05.11.2026).
 *
 * `shared` — раздел общественного снаряжения, его видит весь состав;
 * `personal` — раздел человека в «Взял», остальным он не виден вовсе.
 */
export const TRIP_GEAR_SECTION_SCOPES = ['shared', 'personal'] as const
export type TripGearSectionScope = (typeof TRIP_GEAR_SECTION_SCOPES)[number]

/**
 * Раздел внутри «Берём» или «Взял».
 *
 * Вложенность — `parentId`: «Альпинизм» → «Верёвки». Разделы приходят
 * тем же ответом, что и вещи: пустой раздел — законное состояние, и второй
 * запрос ради заголовков означал бы два состояния загрузки на одной секции.
 */
export interface TripGearSection {
  id: string
  scope: TripGearSectionScope
  /** Владелец личного раздела. `null` у общественного. */
  ownerUserId: string | null
  /** Родительский раздел. `null` — корень большой секции. */
  parentId: string | null
  title: string
  sortOrder: number
}

/**
 * Вещь в снаряжении похода — ссылка на предмет личного каталога.
 *
 * Тип, название, значения и вес приходят из `gear_items`: палатку взвешивают
 * один раз, и в походе она весит столько же. Имени владельца в строке нет:
 * состав похода загружен отдельно, и два источника правды об одном человеке
 * не нужны — фронт склеивает их по `ownerUserId`.
 *
 * `typeCode` и `attributes` — то, по чему «Палатки» и «Костровое» решают,
 * куда вещь положить и чем подписать: вместимость палатки — значение
 * характеристики `seats`, а не слово в названии.
 */
export interface TripGearItem {
  id: string
  gearItemId: string
  typeId: number
  /** Код типа: `tent`, `shelter`, `stove`. */
  typeCode: string
  /** Название типа из справочника: «Палатка», «Тент», «Горелка». */
  typeName: string
  title: string
  /** Значения характеристик в порядке справочника. */
  attributes: GearItemAttribute[]
  weightGrams: number | null
  note: string | null
  /**
   * Вещь заведена **в походе вручную** и каталогу не принадлежит
   * (31.10.2026): «бутылка бензина на розжиг», «кусок целлофана на тент».
   *
   * `GET /api/gear` такие вещи не отдаёт, поэтому строки в профиле нет
   * и правка по `gearItemId` ответит 404. На экранах похода — «Палатках»
   * и «Костровом» — это обычная вещь, разницы нет; флаг нужен лишь там,
   * где человеку предлагают «править в каталоге».
   */
  isTripOnly: boolean
  status: TripGearStatus
  /**
   * Секция «Ночёвок», куда вещь добавили кнопкой «Добавить ещё» (01.11.2026).
   *
   * `null` — обычная вещь: её секция определяется типом. С пометкой вещь
   * показывается там, где её добавили, даже если её тип ни к одной секции
   * не привязан, — «хоть лодку».
   */
  routeSection: TripGearRouteSection | null
  /** Общественный раздел «Берём». `null` — корень секции. */
  sharedSectionId: string | null
  /** Мой личный раздел «Взял». У чужой вещи — `null`. */
  personalSectionId: string | null
  ownerUserId: string
  /** Кто несёт. `null` — ещё не распределена. */
  assignedUserId: string | null
  createdAt: string
}

/** Ответ `GET /api/trips/:id/gear` (вес считает бэкенд по утверждённым). */
export interface TripGearList {
  items: TripGearItem[]
  /** Все общественные разделы и свои личные. */
  sections: TripGearSection[]
  totalWeightGrams: number
  itemsWithoutWeight: number
}
