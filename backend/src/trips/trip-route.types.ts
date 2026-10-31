import type { TripTab } from './trip-tabs';

/**
 * Словари вкладки «Ночёвки» (`route`) — контракт БД и API.
 *
 * Как и у «Трансфера», значения живут в одном месте: CHECK-и entity
 * собираются из этих массивов (`sqlValues`), а DTO проверяют ими же
 * (`@IsIn`). Новый вариант ночёвки — строка здесь и миграция, а не
 * «договоримся на словах».
 *
 * Коды ночёвки — слова заказчика 29.10.2026 («палатка / гостиница / изба /
 * машина / идём всю ночь / в пути»): «изба», а не «зимовьё», потому что
 * миграция фиксирует словарь, а не переписывается после.
 */

/** Код вкладки: «Ночёвки» — историческое `route` (`trip-tabs.ts`). */
export const ROUTE_TAB: TripTab = 'route';

export const NIGHT_KINDS = [
  'tent',
  'hotel',
  'hut',
  'car',
  'allnight',
  'transit',
] as const;

export type NightKind = (typeof NIGHT_KINDS)[number];

/** Способ готовки в эту ночь: `NULL` — не готовим или вопрос не задан. */
export const COOKING_KINDS = ['fire', 'stove', 'both'] as const;

export type CookingKind = (typeof COOKING_KINDS)[number];

/**
 * Готовка спрашивается только там, где ужин и завтрак действительно
 * готовятся (заказчик 29.10.2026: «Готовка у „Изба“, „Машина“, „Палатка“.
 * В гостишках обычно есть кухня»). У «идём всю ночь» и «в пути» её нет.
 */
export const COOKING_NIGHT_KINDS: readonly NightKind[] = ['tent', 'hut', 'car'];

/**
 * Место ночёвки есть у всех вариантов с ночлегом. У «в пути» и «идём всю
 * ночь» места нет — там не останавливаются (заказчик 30.10.2026).
 */
export const PLACE_NIGHT_KINDS: readonly NightKind[] = [
  'tent',
  'hotel',
  'hut',
  'car',
];

/**
 * Варианты без ночлега: их нельзя ставить в одну ночь с другими.
 * Смешать «идём всю ночь» и «палатку» — значит ответить на вопрос ночи
 * дважды: либо группа спит, либо нет.
 */
export const SOLO_NIGHT_KINDS: readonly NightKind[] = ['allnight', 'transit'];

/**
 * Статус «кто где живёт».
 *
 * `accepted` — человек живёт в этой палатке, `requested` — попросился
 * и ждёт хозяина. Заявки — ровно как у посадки в чужое ТС в «Трансфере»:
 * в чужую палатку не садятся молча.
 */
export const ROUTE_LODGER_STATUSES = ['requested', 'accepted'] as const;

export type RouteLodgerStatus = (typeof ROUTE_LODGER_STATUSES)[number];

/**
 * Самый длинный поход, который таблица согласна хранить.
 *
 * Потолок нужен не бизнесу, а защите от «сохранили 10 000 ночей»: вкладка
 * правится целиком (`PUT`), и без предела один запрос превращается
 * в столько же INSERT-ов.
 */
export const MAX_ROUTE_NIGHTS = 60;

/** Сколько вариантов может быть в одной ночи. */
export const MAX_NIGHT_OPTIONS = 20;

/** Длина названия места — как у «откуда/докуда» в «Трансфере». */
export const PLACE_MAX_LENGTH = 120;
