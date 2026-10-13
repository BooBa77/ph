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
  MOUNTAIN_CATEGORIES,
  SPORT_RANKS,
  TOURISM_CATEGORIES,
  TOURISM_DISCIPLINE_RESULTS,
  sqlValues,
  type AlpinismRank,
  type MountainCategory,
  type SportRank,
  type TourismCategory,
  type TourismDisciplineResult,
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
  'chk_sport_experience_skyrunning_rank',
  `"skyrunning_rank" IN (${sqlValues(SPORT_RANKS)})`,
)
@Check(
  'chk_sport_experience_tourism_rank',
  `"tourism_rank" IN (${sqlValues(SPORT_RANKS)})`,
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

  // ─── Скайраннинг ───

  @Column({
    name: 'skyrunning_rank',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  skyrunningRank: SportRank | null;

  // ─── Спортивный туризм ───

  @Column({ name: 'tourism_rank', type: 'varchar', length: 20, nullable: true })
  tourismRank: SportRank | null;

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
