/**
 * Справочник типов снаряжения и их характеристик (Stage A).
 *
 * Типы и характеристики — **данные, а не код**: их заводит и правит админ
 * в `/admin/gear`, поэтому здесь живут только словари значений, подписи
 * и контракт ответов. Источник правды — `backend/src/gear/dto/gear-type.dto.ts`:
 * публичный `GET /api/gear-types` отдаёт только активное, админский
 * `GET /api/gear/admin/types` — всё, вместе с архивом и флагами `isActive`.
 *
 * **Четвёртый вид значения — список вариантов (`select`, 30.10.2026).**
 * Варианты лежат отдельной таблицей: у них есть стабильный код, имя, порядок
 * и архив, поэтому они переживают переименование и не размазываются по
 * массивам. Значение такого вида в Stage B ляжет в `text_value` текстом
 * имени варианта — и выбранного, и своего (если у характеристики разрешено
 * своё значение).
 *
 * **`gear_items` этот файл не описывает.** Вид (`kind`) и обязательное название
 * вещи живут в `types/gear.ts` и не меняются до Stage B: справочник пока
 * ни на что пользовательское не влияет.
 */

/**
 * Вид значения характеристики — ровно те строки, что принимает бэкенд
 * (CHECK `value_kind` в базе). По нему же выбирается поле ввода: число,
 * строка, галочка или список вариантов; в Stage B — колонка, куда ляжет
 * значение (`select` ложится в `text_value` текстом варианта).
 */
export const GEAR_VALUE_KINDS = ['number', 'text', 'bool', 'select'] as const

export type GearValueKind = (typeof GEAR_VALUE_KINDS)[number]

/** Подписи видов: бэкенд отдаёт значения, слова для человека — здесь. */
export const GEAR_VALUE_KIND_LABELS: Record<GearValueKind, string> = {
  number: 'Число',
  text: 'Текст',
  bool: 'Галочка',
  select: 'Список вариантов',
}

/**
 * Подсказка к коду — та же строка, что в API и в сиде.
 *
 * Код не меняется после создания: на него будут опираться фильтры Stage B
 * (`tent`, `axe`, …), поэтому ошибку исправляют архивом и новым кодом.
 */
export const GEAR_CODE_PATTERN = '^[a-z][a-z0-9_]*$'

export const GEAR_CODE_HINT = `Код — латиница, начиная с буквы: ${GEAR_CODE_PATTERN}`

/** Пределы — те же, что у CHECK-ов в базе. */
export const GEAR_CODE_MAX_LENGTH = 40
export const GEAR_NAME_MAX_LENGTH = 100
export const GEAR_UNIT_MAX_LENGTH = 20

/** Предел вариантов у одной характеристики-списка — как в API. */
export const GEAR_OPTIONS_MAX = 100

/** Сообщение об ошибке кода: подсказка плюс предел длины. */
export const GEAR_CODE_ERROR = `${GEAR_CODE_HINT}, до ${GEAR_CODE_MAX_LENGTH} символов`

const GEAR_CODE_RE = new RegExp(GEAR_CODE_PATTERN)

/**
 * Годится ли код в справочник.
 *
 * Проверка повторяет серверную, но нужна и на фронте: без неё админ узнаёт
 * про кириллицу в коде только после ответа 400, уже потеряв введённое.
 */
export function isGearCode(value: string): boolean {
  return value.length <= GEAR_CODE_MAX_LENGTH && GEAR_CODE_RE.test(value)
}

/**
 * Пример замещающего значения по виду характеристики.
 *
 * В Stage A значение **проверяется и отбрасывается**: таблицы значений
 * (`gear_item_attributes`) ещё нет, заполнять нечего. В Stage B тот же вызов
 * начнёт писать его вещам без значения — поэтому подсказка уже здесь.
 */
export const GEAR_FILL_MISSING_HINTS: Record<GearValueKind, string> = {
  number: 'число, например 0',
  text: 'непустая строка',
  bool: 'true или false',
  select: 'название одного из вариантов',
}

/**
 * Вариант характеристики-списка в публичном ответе.
 *
 * `code` — контракт (`thread`, `collet`), `name` — то, что видит человек
 * («резьбовой»). В Stage B значение экземпляра хранится текстом **имени**,
 * поэтому переименование варианта станет отдельной заботой бэкенда.
 */
export interface GearAttributeOption {
  id: number
  code: string
  name: string
  sortOrder: number
}

/** Вариант в админском ответе: то же плюс архив. */
export interface AdminGearAttributeOption extends GearAttributeOption {
  /** `false` — в архиве: в публичном списке его нет, вернуть можно. */
  isActive: boolean
}

/** Характеристика в публичном ответе: архивных здесь нет по определению. */
export interface GearTypeAttribute {
  id: number
  /** Код внутри типа, неизменяемый: `seats`, `brand`, `is_new`. */
  code: string
  name: string
  valueKind: GearValueKind
  /** Единица измерения: «мест», «см», «л». `null` — без единицы. */
  unit: string | null
  /**
   * Разрешить своё значение вместо выбора из списка.
   *
   * Только у `valueKind = 'select'`: у числа, строки и галочки бэкенд
   * отвечает 400, а в базе то же правило держит CHECK.
   */
  allowCustomValue: boolean
  /** Обязательная характеристика: без неё вещь не описать (Stage B). */
  isRequired: boolean
  sortOrder: number
  /** Варианты списка; у числа, строки и галочки — пустой массив. */
  options: GearAttributeOption[]
}

/** Характеристика в админском ответе: то же плюс архив. */
export interface AdminGearTypeAttribute extends GearTypeAttribute {
  /** `false` — в архиве: в публичном списке её нет, вернуть можно. */
  isActive: boolean
  /** Все варианты, включая архивные. */
  options: AdminGearAttributeOption[]
}

/** Тип снаряжения: «Палатка», «Топор», «Газовый баллон». */
export interface GearType {
  id: number
  /** Стабильный код: в `PATCH` его нет, дубликат — 409. */
  code: string
  name: string
  sortOrder: number
  attributes: GearTypeAttribute[]
}

/** Тип в админском ответе: архивные характеристики тоже здесь. */
export interface AdminGearType extends GearType {
  /** `false` — в архиве. Тип виден в админке, но не в публичном списке. */
  isActive: boolean
  attributes: AdminGearTypeAttribute[]
}

/** Ответ `GET /api/gear-types` — активные типы. */
export interface GearTypeList {
  items: GearType[]
}

/** Ответ `GET /api/gear/admin/types` — все типы, включая архивные. */
export interface AdminGearTypeList {
  items: AdminGearType[]
}

/** Тело `POST /api/gear/admin/types`. */
export interface CreateGearTypeInput {
  code: string
  name: string
  sortOrder?: number
}

/**
 * Тело `PATCH /api/gear/admin/types/:id`.
 *
 * `code` сюда не входит намеренно: код неизменяем, и сервер отвечает на него
 * 400. `isActive: true` возвращает тип из архива.
 */
export interface UpdateGearTypeInput {
  name?: string
  sortOrder?: number
  isActive?: boolean
}

/** Тело `POST /api/gear/admin/types/:id/attributes`. */
export interface CreateGearAttributeInput {
  code: string
  name: string
  valueKind: GearValueKind
  unit?: string | null
  isRequired?: boolean
  /** Только при `valueKind: 'select'`; с числом и галочкой сервер — 400. */
  allowCustomValue?: boolean
  /** Варианты списка — сразу вместе с характеристикой, одной транзакцией. */
  options?: CreateGearAttributeOptionInput[]
  sortOrder?: number
  /** Нужен только при `isRequired: true`; в Stage A не применяется. */
  fillMissing?: number | string | boolean | null
}

/**
 * Тело `PATCH /api/gear/admin/types/:id/attributes/:attrId`.
 *
 * `code` и `valueKind` не входят: код неизменяем (400), вид — 409, даже если
 * прислать тот же самый. Исправление — архив и новая характеристика.
 * Варианты тоже не входят: у них отдельные ручки, `options` в теле — 400.
 */
export interface UpdateGearAttributeInput {
  name?: string
  unit?: string | null
  isRequired?: boolean
  allowCustomValue?: boolean
  isActive?: boolean
  sortOrder?: number
  /** Нужен при включении обязательности (`false → true`). */
  fillMissing?: number | string | boolean | null
}

/**
 * Новый вариант списка.
 *
 * Одна форма на два запроса: `options` в теле создания характеристики
 * и `POST …/options` для добавления к существующему списку.
 */
export interface CreateGearAttributeOptionInput {
  code: string
  name: string
  sortOrder?: number
}

/** Тело `PATCH …/attributes/:attributeId/options/:optionId`. */
export interface UpdateGearAttributeOptionInput {
  name?: string
  sortOrder?: number
  isActive?: boolean
}
