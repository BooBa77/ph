import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { sqlValues } from '../../users/sport-experience.types';
import { User } from '../../users/entities/user.entity';
import {
  TRIP_MEAL_PACKAGE_KINDS,
  type TripMealPackageKind,
} from '../trip.types';
import { TripMeal } from './trip-meal.entity';
import { Trip } from './trip.entity';

/**
 * Пакет фасовки: «Пакет 2» или кулёк приёма.
 *
 * **Имя по умолчанию «Пакет N»**, уникально в походе. Пустой пакет создать
 * можно: завхоз заводит пакеты заранее. Удаление пакета обнуляет его доли
 * (`trip_meal_allocations` уходят каскадом) — приложение предупреждает.
 *
 * **Кулёк** — пакет всего приёма: `kind = 'kulek'`, `meal_id` заполнен.
 * В него уходят все продукты приёма, включая соль; доли других приёмов
 * его не видят. Удаление приёма уносит и кулёк (CASCADE): он часть приёма.
 *
 * **Вес фактический** — после контрольного взвешивания. Если содержимое
 * менялось после, `weight_actual_stale` просит перевесить; в «Рюкзаках»
 * до перевешивания берётся расчётный вес.
 *
 * **`eaterUserId` — чья тара.** NULL — общие пакеты похода; uuid — пакеты
 * личной еды. Имя уникально внутри слоя: «Пакет 1» участника не занимает
 * имя общего пакета, но и не смешивается с чужими — частичные индексы.
 *
 * **`assignedUserId` — кто несёт** (06.11.2026). Пусто — пакет ещё
 * не распределён. У личных пакетов несущий не спрашивается: свою еду
 * человек несёт сам (`eaterUserId`), а общий пакет раскладывается вместе
 * со снарягой в «Снаряжении» (`docs/ph/gear-distribution.md` §4–§5).
 */
@Entity('trip_meal_packages')
@Index('UQ_trip_meal_packages_name', ['tripId', 'name'], {
  unique: true,
  where: '"eater_user_id" IS NULL',
})
@Index(
  'UQ_trip_meal_packages_personal_name',
  ['tripId', 'eaterUserId', 'name'],
  { unique: true, where: '"eater_user_id" IS NOT NULL' },
)
@Index('IDX_trip_meal_packages_trip', ['tripId', 'id'])
@Index('IDX_trip_meal_packages_assigned', ['tripId', 'assignedUserId'])
@Check(
  'chk_trip_meal_packages_kind',
  `"kind" IN (${sqlValues(TRIP_MEAL_PACKAGE_KINDS)})`,
)
@Check('chk_trip_meal_packages_name', `char_length(btrim("name")) > 0`)
@Check(
  'chk_trip_meal_packages_weight',
  `"weight_actual_grams" IS NULL OR "weight_actual_grams" > 0`,
)
export class TripMealPackage {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  @ManyToOne(() => Trip, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'trip_id',
    foreignKeyConstraintName: 'FK_trip_meal_packages_trip',
  })
  trip: Trip;

  /** Чьи это пакеты; NULL — общие. */
  @Column({ name: 'eater_user_id', type: 'uuid', nullable: true })
  eaterUserId: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({
    name: 'eater_user_id',
    foreignKeyConstraintName: 'FK_trip_meal_packages_eater',
  })
  eater: User | null;

  @Column({ type: 'varchar', length: 60 })
  name: string;

  /**
   * Кто несёт пакет. `NULL` — не распределён.
   *
   * Ссылка на `users`, а не на участие: еда — общак, и при уходе человека
   * из похода пакет остаётся в походе, снимается только назначение
   * (`docs/ph/gear-distribution.md` §6).
   */
  @Column({ name: 'assigned_user_id', type: 'uuid', nullable: true })
  assignedUserId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'assigned_user_id',
    foreignKeyConstraintName: 'FK_trip_meal_packages_assigned',
  })
  assignee: User | null;

  @Column({ type: 'varchar', length: 10, default: 'normal' })
  kind: TripMealPackageKind;

  /** Приём для кулёка; у обычного пакета пусто. */
  @Column({ name: 'meal_id', type: 'bigint', nullable: true })
  mealId: string | null;

  @ManyToOne(() => TripMeal, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({
    name: 'meal_id',
    foreignKeyConstraintName: 'FK_trip_meal_packages_meal',
  })
  meal: TripMeal | null;

  /** Фактический вес после взвешивания; null — ещё не взвешивали. */
  @Column({ name: 'weight_actual_grams', type: 'int', nullable: true })
  weightActualGrams: number | null;

  /** Содержимое менялось после взвешивания — пора перевесить. */
  @Column({ name: 'weight_actual_stale', type: 'boolean', default: false })
  weightActualStale: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
