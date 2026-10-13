/**
 * Справочные списки спортивного опыта.
 *
 * Значения — ровно те строки, что приходят из выпадающих списков на фронте
 * и ложатся в колонки `user_sport_experience`. Отдельный файл нужен потому,
 * что список понадобился сразу в трёх местах: DTO (валидация `@IsIn`),
 * entity (CHECK-и) и Swagger (`enum`).
 *
 * Те же списки продублированы на фронте — `frontend/src/types/sportExperience.ts`:
 * бэкенд отдаёт наружу только значения, а подписи для выпадающих списков
 * («Пешеходный», «Дистанция лыжная») живут на клиенте. Меняешь список —
 * правь в обоих файлах, иначе интерфейс предложит вариант, который база
 * отвергнет.
 */

/**
 * Разряды и звания по альпинизму. МСМК здесь есть, а в остальных списках
 * его нет: по скайраннингу и спортивному туризму это звание не присваивают.
 */
export const ALPINISM_RANKS = [
  'МСМК',
  'МС',
  'КМС',
  'I',
  'II',
  'III',
  'юношеский',
  'отсутствует',
] as const;

export type AlpinismRank = (typeof ALPINISM_RANKS)[number];

/**
 * Категории сложности маршрутов (вершин) в альпинизме — от 6Б к 1Б,
 * как в разрядных требованиях: сначала самые сложные.
 */
export const MOUNTAIN_CATEGORIES = [
  '6Б',
  '6А',
  '5Б',
  '5А',
  '4Б',
  '4А',
  '3Б',
  '3А',
  '2Б',
  '2А',
  '1Б',
  'нет данных',
] as const;

export type MountainCategory = (typeof MOUNTAIN_CATEGORIES)[number];

/** Разряды и звания по скайраннингу и по спортивному туризму. */
export const SPORT_RANKS = [
  'МС',
  'КМС',
  'I',
  'II',
  'III',
  'юношеский',
  'отсутствует',
] as const;

export type SportRank = (typeof SPORT_RANKS)[number];

/**
 * Максимальная категория сложности похода в спортивном туризме: одной
 * цифрой, без буквы — буквы есть только у альпинистских маршрутов.
 */
export const TOURISM_CATEGORIES = [
  '6',
  '5',
  '4',
  '3',
  '2',
  '1',
  'нет данных',
] as const;

export type TourismCategory = (typeof TOURISM_CATEGORIES)[number];

/** Выполненный норматив в дисциплинах группы «дистанция». */
export const TOURISM_DISCIPLINE_RESULTS = [
  'I разряд',
  'II разряд',
  'III разряд',
  'юношеский',
  'не выполнялся',
] as const;

export type TourismDisciplineResult =
  (typeof TOURISM_DISCIPLINE_RESULTS)[number];

/**
 * Виды спортивного туризма. Ключи английские — имена колонок и полей API;
 * русские подписи («Пешеходный», «Авто-мото») живут на фронте.
 */
export const TOURISM_KINDS = [
  'hiking',
  'mountain',
  'ski',
  'water',
  'caving',
  'bicycle',
  'horse',
  'sailing',
  'autoMoto',
] as const;

export type TourismKind = (typeof TOURISM_KINDS)[number];

/** Дисциплины группы «дистанция» в спортивном туризме. */
export const TOURISM_DISCIPLINES = [
  'nordicWalking',
  'distanceHiking',
  'distanceSki',
  'distanceWater',
  'distanceCaving',
] as const;

export type TourismDiscipline = (typeof TOURISM_DISCIPLINES)[number];

/**
 * Спортивный опыт в том виде, в каком он приходит в сервис.
 *
 * Все поля опциональны, потому что PATCH: прислали «альпинизм, разряд» —
 * остальное не трогаем. `null` — осознанная очистка поля, `undefined` —
 * «не прислали, не трогать». Разница важна и видна в `updateInternal`.
 */
export interface SportExperienceData {
  alpinism?: {
    rank?: AlpinismRank | null;
    maxParticipation?: MountainCategory | null;
    maxLeadership?: MountainCategory | null;
  };
  skyrunning?: {
    rank?: SportRank | null;
  };
  sportTourism?: {
    rank?: SportRank | null;
    maxCategories?: Partial<Record<TourismKind, TourismCategory | null>>;
    disciplines?: Partial<
      Record<TourismDiscipline, TourismDisciplineResult | null>
    >;
  };
}

/**
 * Список значений в виде SQL-литералов — для CHECK-ов в entity.
 *
 * Апострофов в значениях нет и быть не должно: это подписи из разрядных
 * требований, а не пользовательский текст. Если однажды появится значение
 * с апострофом, экранировать придётся здесь.
 */
export function sqlValues(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}
