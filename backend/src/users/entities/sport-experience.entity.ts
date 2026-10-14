import {
  Check,
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
} from 'typeorm';

import { User } from './user.entity';
import {
  ALPINISM_RANKS,
  INSTRUCTOR_GUIDE_RANKS,
  INSTRUCTOR_METHODIST_RANKS,
  MOUNTAIN_CATEGORIES,
  SKYRUNNING_RANKS,
  TOURISM_CATEGORIES,
  TOURISM_DISCIPLINE_RESULTS,
  TOURISM_RANKS,
  sqlValues,
  type AlpinismRank,
  type InstructorGuideRank,
  type InstructorMethodistRank,
  type MountainCategory,
  type SkyrunningRank,
  type TourismCategory,
  type TourismDisciplineResult,
  type TourismRank,
} from '../sport-experience.types';

/**
 * Спортивный опыт пользователя: альпинизм, скайраннинг, спортивный туризм.
 *
 * Почему отдельная таблица, а не 19 колонок в `users`:
 *   - `users` читается на каждом bootstrap и refresh, а спортивный опыт
 *     нужен только в профиле;
 *   - строки может не быть вовсе — «опыт не заполнял», и это честнее
 *     девятнадцати NULL-ов в профиле.
 *
 * Почему явные колонки, а не jsonb: значения — фиксированные списки из
 * разрядных требований, и база умеет их проверить (CHECK). В jsonb пришлось
 * бы валидировать только на входе, а мусор от ручной правки в базе остался
 * бы незамеченным.
 *
 * Ключ — сам `user_id`: строка ровно одна на пользователя. Отдельного
 * `id` нет, как нет его у `admin_users` и `calendar_activities`.
 */
@Entity('user_sport_experience')
@Check(
  'chk_sport_experience_alpinism_rank',
  `"alpinism_rank" IN (${sqlValues(ALPINISM_RANKS)})`,
)
@Check(
  'chk_sport_experience_alpinism_max_participation',
  `"alpinism_max_participation" IN (${sqlValues(MOUNTAIN_CATEGORIES)})`,
)
@Check(
  'chk_sport_experience_alpinism_max_leadership',
  `"alpinism_max_leadership" IN (${sqlValues(MOUNTAIN_CATEGORIES)})`,
)
@Check(
  'chk_sport_experience_instructor_methodist',
  `"alpinism_instructor_methodist" IN (${sqlValues(INSTRUCTOR_METHODIST_RANKS)})`,
)
@Check(
  'chk_sport_experience_instructor_guide',
  `"alpinism_instructor_guide" IN (${sqlValues(INSTRUCTOR_GUIDE_RANKS)})`,
)
@Check(
  'chk_sport_experience_skyrunning_rank',
  `"skyrunning_rank" IN (${sqlValues(SKYRUNNING_RANKS)})`,
)
@Check(
  'chk_sport_experience_tourism_rank',
  `"tourism_rank" IN (${sqlValues(TOURISM_RANKS)})`,
)
@Check(
  'chk_sport_experience_tourism_max_hiking',
  `"tourism_max_hiking" IN (${sqlValues(TOURISM_CATEGORIES)})`,
)
@Check(
  'chk_sport_experience_tourism_max_mountain',
  `"tourism_max_mountain" IN (${sqlValues(TOURISM_CATEGORIES)})`,
)
@Check(
  'chk_sport_experience_tourism_max_ski',
  `"tourism_max_ski" IN (${sqlValues(TOURISM_CATEGORIES)})`,
)
@Check(
  'chk_sport_experience_tourism_max_water',
  `"tourism_max_water" IN (${sqlValues(TOURISM_CATEGORIES)})`,
)
@Check(
  'chk_sport_experience_tourism_max_caving',
  `"tourism_max_caving" IN (${sqlValues(TOURISM_CATEGORIES)})`,
)
@Check(
  'chk_sport_experience_tourism_max_bicycle',
  `"tourism_max_bicycle" IN (${sqlValues(TOURISM_CATEGORIES)})`,
)
@Check(
  'chk_sport_experience_tourism_max_horse',
  `"tourism_max_horse" IN (${sqlValues(TOURISM_CATEGORIES)})`,
)
@Check(
  'chk_sport_experience_tourism_max_sailing',
  `"tourism_max_sailing" IN (${sqlValues(TOURISM_CATEGORIES)})`,
)
@Check(
  'chk_sport_experience_tourism_max_auto_moto',
  `"tourism_max_auto_moto" IN (${sqlValues(TOURISM_CATEGORIES)})`,
)
@Check(
  'chk_sport_experience_tourism_norm_nordic_walking',
  `"tourism_norm_nordic_walking" IN (${sqlValues(TOURISM_DISCIPLINE_RESULTS)})`,
)
@Check(
  'chk_sport_experience_tourism_norm_distance_hiking',
  `"tourism_norm_distance_hiking" IN (${sqlValues(TOURISM_DISCIPLINE_RESULTS)})`,
)
@Check(
  'chk_sport_experience_tourism_norm_distance_ski',
  `"tourism_norm_distance_ski" IN (${sqlValues(TOURISM_DISCIPLINE_RESULTS)})`,
)
@Check(
  'chk_sport_experience_tourism_norm_distance_water',
  `"tourism_norm_distance_water" IN (${sqlValues(TOURISM_DISCIPLINE_RESULTS)})`,
)
@Check(
  'chk_sport_experience_tourism_norm_distance_caving',
  `"tourism_norm_distance_caving" IN (${sqlValues(TOURISM_DISCIPLINE_RESULTS)})`,
)
export class SportExperience {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  /**
   * Владелец строки. Обратная сторона связи объявлена в `User`
   * (`sportExperience`), и она же eager — чтобы опыт подтягивался везде,
   * где читается пользователь, и не приходилось помнить про join.
   */
  @OneToOne(() => User, (user) => user.sportExperience, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  // ─── Альпинизм ───

  @Column({
    name: 'alpinism_rank',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  alpinismRank: AlpinismRank | null;

  @Column({
    name: 'alpinism_max_participation',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  alpinismMaxParticipation: MountainCategory | null;

  @Column({
    name: 'alpinism_max_leadership',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  alpinismMaxLeadership: MountainCategory | null;

  /**
   * Жетон «Спасение в горах» — участие в спасательных работах.
   *
   * Галочка, а не значение словаря: жетон либо есть, либо нет. NOT NULL
   * DEFAULT false — «нет» и «не отвечал» здесь одно состояние, как
   * у вегетарианства. При подсчёте «строка пуста» false считается пустым
   * значением, поэтому строка с одной снятой галочкой не сохраняется.
   */
  @Column({ name: 'alpinism_rescue_token', type: 'boolean', default: false })
  alpinismRescueToken: boolean;

  /** Инструктор-методист по альпинизму (ФАР). */
  @Column({
    name: 'alpinism_instructor_methodist',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  alpinismInstructorMethodist: InstructorMethodistRank | null;

  /** Инструктор-проводник: категория государственной аттестации. */
  @Column({
    name: 'alpinism_instructor_guide',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  alpinismInstructorGuide: InstructorGuideRank | null;

  /**
   * Публичная ссылка на лицензию госаттестации инструктора-проводника.
   *
   * Свободный текст, а не отдельная таблица: лицензия одна на человека,
   * и её номер живёт в реестре knd.gov.ru — нам достаточно ссылки.
   */
  @Column({
    name: 'alpinism_instructor_guide_license',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  alpinismInstructorGuideLicense: string | null;

  /** Организатор детско-юношеского туризма: программа подготовки. */
  @Column({
    name: 'alpinism_youth_tourism_organizer',
    type: 'boolean',
    default: false,
  })
  alpinismYouthTourismOrganizer: boolean;

  /** Инструктор детско-юношеского туризма: дополнительное образование. */
  @Column({
    name: 'alpinism_youth_tourism_instructor',
    type: 'boolean',
    default: false,
  })
  alpinismYouthTourismInstructor: boolean;

  // ─── Скайраннинг ───

  @Column({
    name: 'skyrunning_rank',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  skyrunningRank: SkyrunningRank | null;

  // ─── Спортивный туризм ───

  @Column({ name: 'tourism_rank', type: 'varchar', length: 20, nullable: true })
  tourismRank: TourismRank | null;

  @Column({
    name: 'tourism_max_hiking',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  tourismMaxHiking: TourismCategory | null;

  @Column({
    name: 'tourism_max_mountain',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  tourismMaxMountain: TourismCategory | null;

  @Column({
    name: 'tourism_max_ski',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  tourismMaxSki: TourismCategory | null;

  @Column({
    name: 'tourism_max_water',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  tourismMaxWater: TourismCategory | null;

  @Column({
    name: 'tourism_max_caving',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  tourismMaxCaving: TourismCategory | null;

  @Column({
    name: 'tourism_max_bicycle',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  tourismMaxBicycle: TourismCategory | null;

  @Column({
    name: 'tourism_max_horse',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  tourismMaxHorse: TourismCategory | null;

  @Column({
    name: 'tourism_max_sailing',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  tourismMaxSailing: TourismCategory | null;

  @Column({
    name: 'tourism_max_auto_moto',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  tourismMaxAutoMoto: TourismCategory | null;

  @Column({
    name: 'tourism_norm_nordic_walking',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  tourismNormNordicWalking: TourismDisciplineResult | null;

  @Column({
    name: 'tourism_norm_distance_hiking',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  tourismNormDistanceHiking: TourismDisciplineResult | null;

  @Column({
    name: 'tourism_norm_distance_ski',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  tourismNormDistanceSki: TourismDisciplineResult | null;

  @Column({
    name: 'tourism_norm_distance_water',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  tourismNormDistanceWater: TourismDisciplineResult | null;

  @Column({
    name: 'tourism_norm_distance_caving',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  tourismNormDistanceCaving: TourismDisciplineResult | null;
}
