/**
 * Справочник типов снаряжения и их характеристик (Stage A).
 *
 * Типы и характеристики — **данные, а не код**: их заводит и правит админ
 * в `/admin/gear`, поэтому здесь живут только словари значений, подписи
 * и контракт ответов. Источник правды — `backend/src/gear/dto/gear-type.dto.ts`:
 * публичный `GET /api/gear-types` отдаёт только активное, админский
 * `GET /api/gear/admin/types` — всё, вместе с архивом и флагами `isActive`.
 *
 * **`gear_items` этот файл не описывает.** Вид (`kind`) и обязательное название
 * вещи живут в `types/gear.ts` и не меняются до Stage B: справочник пока
 * ни на что пользовательское не влияет.
 */

/**
 * Вид значения характеристики — ровно те строки, что принимает бэкенд
 * (CHECK `value_kind` в базе). По нему же выбирается поле ввода: число,
 * строка или галочка; в Stage B — колонка, куда ляжет значение.
 */
export const GEAR_VALUE_KINDS = ['number', 'text', 'bool'] as const

export type GearValueKind = (typeof GEAR_VALUE_KINDS)[number]

/** Подписи видов: бэкенд отдаёт значения, слова для человека — здесь. */
export const GEAR_VALUE_KIND_LABELS: Record<GearValueKind, string> = {
  number: 'Число',
  text: 'Текст',
  bool: 'Галочка',
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
  /** Обязательная характеристика: без неё вещь не описать (Stage B). */
  isRequired: boolean
  sortOrder: number
}

/** Характеристика в админском ответе: то же плюс архив. */
export interface AdminGearTypeAttribute extends GearTypeAttribute {
  /** `false` — в архиве: в публичном списке её нет, вернуть можно. */
  isActive: boolean
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
  sortOrder?: number
  /** Нужен только при `isRequired: true`; в Stage A не применяется. */
  fillMissing?: number | string | boolean | null
}

/**
 * Тело `PATCH /api/gear/admin/types/:id/attributes/:attrId`.
 *
 * `code` и `valueKind` не входят: код неизменяем (400), вид — 409, даже если
 * прислать тот же самый. Исправление — архив и новая характеристика.
 */
export interface UpdateGearAttributeInput {
  name?: string
  unit?: string | null
  isRequired?: boolean
  isActive?: boolean
  sortOrder?: number
  /** Нужен при включении обязательности (`false → true`). */
  fillMissing?: number | string | boolean | null
}
