/**
 * Справочные значения домена снаряжения.
 *
 * Один список нужен entity (CHECK), DTO (`@IsIn`) и Swagger (`enum`).
 * Русские подписи живут только на фронте: бэкенд отдаёт значения, а как
 * их назвать человеку — дело интерфейса.
 */

/**
 * Вид снаряжения — **уходящий список**.
 *
 * Это не справочник в базе, а короткий список в коде: категорий десяток,
 * они не меняются от похода к походу. С 30.10.2026 (Stage B) роль вида
 * играет **тип** (`gear_types`): вещь ссылается на `gear_type_id`, и «топор»
 * или «тент» заводятся админом без миграции.
 *
 * **Почему список ещё жив.** Экраны «Снаряжение», «Костровое» и «Палатки»
 * пока фильтруют по виду, а форма личного каталога присылает `kind`
 * в теле запроса. Чтобы переход шёл одной сессией на слой, API временно
 * принимает `kind` (и переводит его в тип) и **отдаёт** `kind`, посчитанный
 * по коду типа. Следующий шаг переведёт экраны на коды типов и уберёт вид
 * совсем — из API и из этого файла.
 *
 * `other` есть намеренно: снаряжение не заканчивается списком, и «прочее»
 * лучше, чем заставлять человека выбирать неподходящую категорию.
 */
export const GEAR_KINDS = [
  'tent',
  'sleeping',
  'backpack',
  'kitchen',
  'clothing',
  'footwear',
  'technical',
  'other',
] as const;

export type GearKind = (typeof GEAR_KINDS)[number];

/**
 * Вид значения характеристики типа.
 *
 * Характеристика типов (`gear_type_attributes`) — не текст в jsonb, а строка
 * с типом: в Stage B значение ляжет в свою колонку (`number_value`,
 * `text_value`, `bool_value`), и по этому полю решается, в какую именно.
 *
 * **`select` — четвёртый вид (30.10.2026):** короткий выбор из вариантов
 * (`gear_attribute_options`). Значение такого вида в Stage B ляжет не
 * в отдельную колонку, а в `text_value` — текстом выбранного варианта
 * (или своим, если у характеристики разрешено своё). Варианты лежат отдельной
 * таблицей, а не массивом в характеристике: их переименовывают, добавляют
 * и архивируют, а массиву нечем держать ни стабильный код, ни архив,
 * ни порядок.
 *
 * Список живёт в коде и дублируется CHECK-ом в базе: entity, DTO (`@IsIn`)
 * и Swagger берут его отсюда, а база страхует от записи мимо API.
 */
export const GEAR_VALUE_KINDS = ['number', 'text', 'bool', 'select'] as const;

export type GearValueKind = (typeof GEAR_VALUE_KINDS)[number];

/**
 * Код типа и характеристики — стабильный контракт.
 *
 * Латиница, начиная с буквы: код уходит в API, на него опираются фильтры
 * Stage B и фронт, поэтому кириллица и заглавные запрещены в самой базе
 * (CHECK), а не только в форме админки. До 40 символов.
 *
 * Отдельной константой, потому что нужна и entity (SQL-регулярка),
 * и DTO (`@Matches`), и тестам.
 */
export const GEAR_CODE_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Максимальная длина кода — та же, что в CHECK-ах базы. */
export const GEAR_CODE_MAX_LENGTH = 40;

/**
 * Предел вариантов у одной характеристики-списка.
 *
 * Это защита от случайной «простыни» в одном запросе (и от бесконечной
 * формы в админке), а не продуктовое ограничение: 100 вариантов хватает
 * с запасом, а больше — уже справочник, который стоит пересмотреть.
 */
export const GEAR_OPTIONS_MAX = 100;

/**
 * Забинденные коды типов — на них опираются экраны (заказчик, 30.10.2026).
 *
 * «В Ночёвках используем забинденные типы палатка, топор и пр. В разделе
 * „Палатки“ используем `tent` („палатка“) и `shelter` („тент“)». Значит,
 * экраны читают не слова в названии вещи и не вид старого каталога, а
 * **конкретный код типа** из справочника: «Палатки» — `tent` и `shelter`,
 * «Костровое» — топор, пила, розжиг, таган, горелка и баллон.
 *
 * Код живёт в `gear_types.code` и правится только архивом с новым кодом
 * (`PATCH` кода не принимает), поэтому константа и строка справочника
 * не разойдутся: переименовать можно имя, не код.
 *
 * **Коды не синонимы видам.** `shelter` — тент: под ним ночуют, но это
 * не палатка и в старом каталоге вида «тент» не было вовсе. Поэтому
 * и `tent`, и `shelter` в «Палатках» — два разных типа, а не один.
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
} as const;

export type GearBoundType = (typeof GEAR_TYPE_CODES)[keyof typeof GEAR_TYPE_CODES];

/** «Палатки» ночёвок: палатка и тент, оба дают место для ночлега. */
export const TENT_TYPE_CODES: readonly string[] = [
  GEAR_TYPE_CODES.tent,
  GEAR_TYPE_CODES.shelter,
];

/** «Костровое» при костре: чем рубить, пилить, разжигать и на чём стоять. */
export const CAMPFIRE_TYPE_CODES: readonly string[] = [
  GEAR_TYPE_CODES.axe,
  GEAR_TYPE_CODES.saw,
  GEAR_TYPE_CODES.firestarter,
  GEAR_TYPE_CODES.tagan,
];

/** «Костровое» при горелке: сама горелка и баллон к ней. */
export const STOVE_TYPE_CODES: readonly string[] = [
  GEAR_TYPE_CODES.stove,
  GEAR_TYPE_CODES.gas,
];

/**
 * Временное соответствие вида старого каталога и кода типа.
 *
 * Нужно ровно для перехода: `POST /api/gear` ещё принимает `kind` от формы
 * личного каталога, а ответы по-прежнему отдают `kind`, посчитанный по типу.
 * Как только экраны перейдут на коды типов, таблица исчезнет вместе
 * с `GEAR_KINDS`.
 */
export const LEGACY_KIND_TYPE_CODES: Readonly<Record<GearKind, string>> = {
  tent: 'tent',
  sleeping: 'sleeping_bag',
  backpack: 'backpack',
  kitchen: 'kitchen',
  clothing: 'clothing',
  footwear: 'footwear',
  technical: 'technical',
  other: 'other',
};

/**
 * Обратное соответствие: код типа → вид старого каталога.
 *
 * У типа, заведённого админом, старого вида нет — такой попадает в `other`:
 * лучше «прочее», чем ошибка в ответе, который живёт ещё один шаг.
 * Тенты и горелки раскладываются по смыслу: `shelter` для старых экранов —
 * палатка (под тентом ночуют), `stove` и `gas` — кухня.
 */
const LEGACY_TYPE_KINDS: Readonly<Record<string, GearKind>> = {
  tent: 'tent',
  shelter: 'tent',
  sleeping_bag: 'sleeping',
  backpack: 'backpack',
  kitchen: 'kitchen',
  gas: 'kitchen',
  stove: 'kitchen',
  clothing: 'clothing',
  footwear: 'footwear',
  technical: 'technical',
  axe: 'technical',
  saw: 'technical',
  firestarter: 'technical',
  tagan: 'technical',
  other: 'other',
};

/** Вид старого каталога по коду типа; неизвестный код — `other`. */
export function legacyKindOfTypeCode(code: string): GearKind {
  return LEGACY_TYPE_KINDS[code] ?? 'other';
}

/**
 * Код типа по виду старого каталога.
 *
 * Такие типы заводит миграция `1792271000000-GearItemTypes` — иначе вещам
 * из старого каталога некуда было деться при `SET NOT NULL`. Если админ
 * погасил такой тип в архив, `POST` с `kind` ответит 400: вещь не должна
 * попасть в архивный тип.
 */
export function legacyTypeCodeOfKind(kind: GearKind): string {
  return LEGACY_KIND_TYPE_CODES[kind];
}

