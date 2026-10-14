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
 *
 * **Отсутствия в списках нет.** Варианты вроде «отсутствует», «нет данных»
 * и «не выполнялся» убраны 13.10.2026 по замечанию владельца: в форме они
 * дублировали пустую строку — сверху «— нет —», снизу «отсутствует».
 * «Ничего не выполнено» пишется как `NULL`.
 *
 * **Порядок — от слабого к сильному.** 14.10.2026 владелец попросил
 * развернуть разряды («Значок → МС»): в списке, который начинается
 * с МСМК, свой разряд приходится искать сверху вниз через все чужие.
 * Тот же порядок у категорий маршрутов (1Б → 6Б), категорий походов
 * (1 → 6) и нормативов в дисциплинах (юношеский → I разряд).
 */

/**
 * Разряды и звания по альпинизму: от массового знака к МСМК.
 * «Значок» — знак «Альпинист России», он ниже юношеского разряда.
 * МСМК есть только здесь: по скайраннингу и спортивному туризму
 * это звание не присваивают.
 */
export const ALPINISM_RANKS = [
  'Значок',
  'юношеский',
  'III',
  'II',
  'I',
  'КМС',
  'МС',
  'МСМК',
] as const;

export type AlpinismRank = (typeof ALPINISM_RANKS)[number];

/**
 * Категории сложности маршрутов (вершин) в альпинизме — от 1Б к 6Б,
 * по возрастанию: как и разряды, список идёт от простого к сложному.
 */
export const MOUNTAIN_CATEGORIES = [
  '1Б',
  '2А',
  '2Б',
  '3А',
  '3Б',
  '4А',
  '4Б',
  '5А',
  '5Б',
  '6А',
  '6Б',
] as const;

export type MountainCategory = (typeof MOUNTAIN_CATEGORIES)[number];

/**
 * Разряды и звания по скайраннингу: от юношеского к МС.
 *
 * Отдельный список, а не общий со спортивным туризмом: «Значок» здесь
 * не присваивают — это знак за маршруты и походы, а не за дистанцию.
 * МСМК по скайраннингу тоже нет.
 */
export const SKYRUNNING_RANKS = [
  'юношеский',
  'III',
  'II',
  'I',
  'КМС',
  'МС',
] as const;

export type SkyrunningRank = (typeof SKYRUNNING_RANKS)[number];

/** Разряды и звания по спортивному туризму: «Значок» — знак «Турист России». */
export const TOURISM_RANKS = [
  'Значок',
  'юношеский',
  'III',
  'II',
  'I',
  'КМС',
  'МС',
] as const;

export type TourismRank = (typeof TOURISM_RANKS)[number];

/**
 * Инструктор-методист по альпинизму (ФАР): от ИНП к первой категории.
 *
 * ФАР — Федерация альпинизма России, она и присваивает эти категории.
 * ИНП — инструктор-методист начальной подготовки, ступень ниже третьей
 * категории.
 */
export const INSTRUCTOR_METHODIST_RANKS = [
  'ИНП',
  '3 категория',
  '2 категория',
  '1 категория',
] as const;

export type InstructorMethodistRank =
  (typeof INSTRUCTOR_METHODIST_RANKS)[number];

/** Инструктор-проводник: от работы без категории к международному классу. */
export const INSTRUCTOR_GUIDE_RANKS = [
  'Без категории (ИПбк)',
  '1 категория',
  '2 категория',
  '3 категория',
  '4 категория',
  '5 категория',
  'Международного класса',
] as const;

export type InstructorGuideRank = (typeof INSTRUCTOR_GUIDE_RANKS)[number];

/**
 * Максимальная категория сложности похода в спортивном туризме: одной
 * цифрой, без буквы — буквы есть только у альпинистских маршрутов.
 * Порядок по возрастанию: от первой категории к шестой.
 */
export const TOURISM_CATEGORIES = ['1', '2', '3', '4', '5', '6'] as const;

export type TourismCategory = (typeof TOURISM_CATEGORIES)[number];

/** Выполненный норматив в дисциплинах группы «дистанция» — по возрастанию. */
export const TOURISM_DISCIPLINE_RESULTS = [
  'юношеский',
  'III разряд',
  'II разряд',
  'I разряд',
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
    /** Жетон «Спасение в горах»: участие в спасательных работах. */
    rescueToken?: boolean;
    /** Инструктор-методист по альпинизму (ФАР). */
    instructorMethodist?: InstructorMethodistRank | null;
    /** Инструктор-проводник: категория государственной аттестации. */
    instructorGuide?: InstructorGuideRank | null;
    /**
     * Публичная ссылка на лицензию госаттестации инструктора-проводника.
     * Поле имеет смысл только вместе с `instructorGuide`.
     */
    instructorGuideLicense?: string | null;
    /** Организатор детско-юношеского туризма (программа подготовки). */
    youthTourismOrganizer?: boolean;
    /** Инструктор детско-юношеского туризма (дополнительное образование). */
    youthTourismInstructor?: boolean;
  };
  skyrunning?: {
    rank?: SkyrunningRank | null;
  };
  sportTourism?: {
    rank?: TourismRank | null;
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
