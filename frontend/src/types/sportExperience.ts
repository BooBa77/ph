/**
 * Спортивный опыт: списки вариантов для выпадающих списков и типы профиля.
 *
 * Списки продублированы с бэкендом (`backend/src/users/sport-experience.types.ts`)
 * намеренно: бэкенд отдаёт наружу только значения, а подписи и разбивка
 * по группам — дело интерфейса. Меняешь варианты — правь в обоих файлах,
 * иначе фронт предложит значение, которое база отвергнет CHECK-ом.
 *
 * **Отсутствия в списках нет.** «Отсутствует», «нет данных» и «не выполнялся»
 * убраны: в форме они дублировали пустую строку «— нет —». Ничего не выбрано —
 * это `null`, и в базу он и уходит.
 *
 * **Порядок — от слабого к сильному** («Значок → МС»): в списке, который
 * начинается с МСМК, свой разряд приходится искать через все чужие.
 * Так же развёрнуты категории маршрутов (1Б → 6Б), категории походов
 * (1 → 6) и нормативы в дисциплинах (юношеский → I разряд).
 */

/**
 * Разряды и звания по альпинизму: от массового знака к МСМК.
 * «Значок» — массовый знак «Альпинист России», он ниже юношеского разряда.
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
] as const

export type AlpinismRank = (typeof ALPINISM_RANKS)[number]

/** Категории сложности альпинистских маршрутов — от 1Б к 6Б. */
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
] as const

export type MountainCategory = (typeof MOUNTAIN_CATEGORIES)[number]

/**
 * Разряды и звания по скайраннингу. Свой список, а не общий со спортивным
 * туризмом: «Значок» за дистанцию не дают, МСМК здесь тоже нет.
 */
export const SKYRUNNING_RANKS = [
  'юношеский',
  'III',
  'II',
  'I',
  'КМС',
  'МС',
] as const

export type SkyrunningRank = (typeof SKYRUNNING_RANKS)[number]

/** Разряды и звания по спортивному туризму: «Значок» — знак «Турист России». */
export const TOURISM_RANKS = [
  'Значок',
  'юношеский',
  'III',
  'II',
  'I',
  'КМС',
  'МС',
] as const

export type TourismRank = (typeof TOURISM_RANKS)[number]

/**
 * Инструктор-методист по альпинизму (ФАР): от ИНП к первой категории.
 * ФАР — Федерация альпинизма России, она и присваивает категории.
 */
export const INSTRUCTOR_METHODIST_RANKS = [
  'ИНП',
  '3 категория',
  '2 категория',
  '1 категория',
] as const

export type InstructorMethodistRank =
  (typeof INSTRUCTOR_METHODIST_RANKS)[number]

/** Инструктор-проводник: от работы без категории к международному классу. */
export const INSTRUCTOR_GUIDE_RANKS = [
  'Без категории (ИПбк)',
  '1 категория',
  '2 категория',
  '3 категория',
  '4 категория',
  '5 категория',
  'Международного класса',
] as const

export type InstructorGuideRank = (typeof INSTRUCTOR_GUIDE_RANKS)[number]

/** Максимальная категория сложности похода в спортивном туризме — от 1 к 6. */
export const TOURISM_CATEGORIES = ['1', '2', '3', '4', '5', '6'] as const

export type TourismCategory = (typeof TOURISM_CATEGORIES)[number]

/** Выполненный норматив в дисциплинах группы «дистанция» — по возрастанию. */
export const TOURISM_DISCIPLINE_RESULTS = [
  'юношеский',
  'III разряд',
  'II разряд',
  'I разряд',
] as const

export type TourismDisciplineResult = (typeof TOURISM_DISCIPLINE_RESULTS)[number]

/** Виды спортивного туризма: у каждого своя максимальная пройденная к.с. */
export type TourismKind =
  | 'hiking'
  | 'mountain'
  | 'ski'
  | 'water'
  | 'caving'
  | 'bicycle'
  | 'horse'
  | 'sailing'
  | 'autoMoto'

export const TOURISM_KINDS: readonly { key: TourismKind; label: string }[] = [
  { key: 'hiking', label: 'Пешеходный' },
  { key: 'mountain', label: 'Горный' },
  { key: 'ski', label: 'Лыжный' },
  { key: 'water', label: 'Водный' },
  { key: 'caving', label: 'Спелео' },
  { key: 'bicycle', label: 'Велосипедный' },
  { key: 'horse', label: 'Конный' },
  { key: 'sailing', label: 'Парусный' },
  { key: 'autoMoto', label: 'Авто-мото' },
]

/** Дисциплины группы «дистанция» в спортивном туризме. */
export type TourismDiscipline =
  | 'nordicWalking'
  | 'distanceHiking'
  | 'distanceSki'
  | 'distanceWater'
  | 'distanceCaving'

export const TOURISM_DISCIPLINES: readonly {
  key: TourismDiscipline
  label: string
}[] = [
  { key: 'nordicWalking', label: 'Северная ходьба' },
  { key: 'distanceHiking', label: 'Дистанция пешеходная' },
  { key: 'distanceSki', label: 'Дистанция лыжная' },
  { key: 'distanceWater', label: 'Дистанция водная' },
  { key: 'distanceCaving', label: 'Дистанция спелео' },
]

export interface AlpinismExperience {
  rank: AlpinismRank | null
  maxParticipation: MountainCategory | null
  maxLeadership: MountainCategory | null
  /**
   * Жетон «Спасение в горах» — участие в спасательных работах.
   * Галочка, а не значение словаря: жетон либо есть, либо нет.
   */
  rescueToken: boolean
  /** Инструктор-методист по альпинизму (ФАР). */
  instructorMethodist: InstructorMethodistRank | null
  /** Инструктор-проводник: категория государственной аттестации. */
  instructorGuide: InstructorGuideRank | null
  /**
   * Публичная ссылка на лицензию госаттестации инструктора-проводника.
   * Показывается только при выбранной категории; в базе хранится и без неё.
   */
  instructorGuideLicense: string | null
  /** Организатор детско-юношеского туризма (программа подготовки). */
  youthTourismOrganizer: boolean
  /** Инструктор детско-юношеского туризма (дополнительное образование). */
  youthTourismInstructor: boolean
}

export interface SkyrunningExperience {
  rank: SkyrunningRank | null
}

export interface SportTourismExperience {
  rank: TourismRank | null
  maxCategories: Record<TourismKind, TourismCategory | null>
  disciplines: Record<TourismDiscipline, TourismDisciplineResult | null>
}

/**
 * Спортивный опыт в том виде, в каком его отдаёт бэкенд.
 *
 * `null` вместо объекта в профиле — «пользователь ничего не заполнял»:
 * строки в user_sport_experience ещё нет.
 */
export interface SportExperience {
  alpinism: AlpinismExperience
  skyrunning: SkyrunningExperience
  sportTourism: SportTourismExperience
}

/**
 * Частичная правка спортивного опыта: PATCH присылает только изменённое.
 *
 * Отсутствие поля — «не трогать», `null` — очистить поле (вернуть «— нет —»).
 * Так одна смена выпадающего списка не затирает остальные значения.
 */
export interface SportExperiencePatch {
  alpinism?: Partial<AlpinismExperience>
  skyrunning?: Partial<SkyrunningExperience>
  sportTourism?: {
    rank?: TourismRank | null
    maxCategories?: Partial<Record<TourismKind, TourismCategory | null>>
    disciplines?: Partial<Record<TourismDiscipline, TourismDisciplineResult | null>>
  }
}
