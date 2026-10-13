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
 */

/**
 * Разряды и звания по альпинизму. «Значок» — массовый знак «Альпинист
 * России», он ниже юношеского разряда и поэтому стоит первым.
 */
export const ALPINISM_RANKS = [
  'Значок',
  'МСМК',
  'МС',
  'КМС',
  'I',
  'II',
  'III',
  'юношеский',
] as const

export type AlpinismRank = (typeof ALPINISM_RANKS)[number]

/** Категории сложности альпинистских маршрутов — от 6Б к 1Б. */
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
] as const

export type MountainCategory = (typeof MOUNTAIN_CATEGORIES)[number]

/**
 * Разряды и звания по скайраннингу. Свой список, а не общий со спортивным
 * туризмом: «Значок» за дистанцию не дают, МСМК здесь тоже нет.
 */
export const SKYRUNNING_RANKS = [
  'МС',
  'КМС',
  'I',
  'II',
  'III',
  'юношеский',
] as const

export type SkyrunningRank = (typeof SKYRUNNING_RANKS)[number]

/** Разряды и звания по спортивному туризму: «Значок» — знак «Турист России». */
export const TOURISM_RANKS = [
  'Значок',
  'МС',
  'КМС',
  'I',
  'II',
  'III',
  'юношеский',
] as const

export type TourismRank = (typeof TOURISM_RANKS)[number]

/** Максимальная категория сложности похода в спортивном туризме — одной цифрой. */
export const TOURISM_CATEGORIES = ['6', '5', '4', '3', '2', '1'] as const

export type TourismCategory = (typeof TOURISM_CATEGORIES)[number]

/** Выполненный норматив в дисциплинах группы «дистанция». */
export const TOURISM_DISCIPLINE_RESULTS = [
  'I разряд',
  'II разряд',
  'III разряд',
  'юношеский',
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
 * Так одна смена выпадающего списка не затирает остальные восемнадцать
 * значений.
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
