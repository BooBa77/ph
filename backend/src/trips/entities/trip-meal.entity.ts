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
  TRIP_MEAL_FORMS,
  TRIP_MEAL_KINDS,
  type TripMealForm,
  type TripMealKind,
} from '../trip.types';
import { Trip } from './trip.entity';

/**
 * Приём пищи похода: «третий день, завтрак».
 *
 * **День — номер, а не дата.** Даты похода меняются (планирую → решено),
 * и приём не должен переезжать из-за этого. Номер дня стабилен, пока
 * поход не сократили; при сокращении приёмы за границей удаляются.
 *
 * **Строка появляется с данными.** Пустые плашки завтрака/обеда/ужина
 * рисует фронт по дням похода; в базе приём есть, только если в нём
 * что-то лежит (блюдо, ручная строка или кулёк).
 *
 * `form` — готовка или перекус: форма приёма, а не четвёртый приём.
 * `kind` + `day_index` уникальны в походе: два завтрака третьего дня —
 * это не два завтрака, а ошибка.
 *
 * **`eaterUserId` — чей это приём.** NULL — общая раскладка похода;
 * uuid — личная еда участника, который питается отдельно. Слот уникален
 * внутри слоя: частичные индексы не дают двум общим приёмам одного дня
 * сойтись, а личным — перепутать едоков.
 */
@Entity('trip_meals')
@Index('UQ_trip_meals_slot', ['tripId', 'dayIndex', 'kind'], {
  unique: true,
  where: '"eater_user_id" IS NULL',
})
@Index('UQ_trip_meals_personal_slot', ['tripId', 'eaterUserId', 'dayIndex', 'kind'], {
  unique: true,
  where: '"eater_user_id" IS NOT NULL',
})
@Check('chk_trip_meals_day', '"day_index" >= 1')
@Check('chk_trip_meals_kind', `"kind" IN (${sqlValues(TRIP_MEAL_KINDS)})`)
@Check('chk_trip_meals_form', `"form" IN (${sqlValues(TRIP_MEAL_FORMS)})`)
export class TripMeal {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  @ManyToOne(() => Trip, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'trip_id', foreignKeyConstraintName: 'FK_trip_meals_trip' })
  trip: Trip;

  /**
   * Личная еда участника; NULL — общая раскладка.
   *
   * Удаление аккаунта уносит и его личную еду: она нужна только ему
   * и в общей раскладке не участвует.
   */
  @Column({ name: 'eater_user_id', type: 'uuid', nullable: true })
  eaterUserId: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({
    name: 'eater_user_id',
    foreignKeyConstraintName: 'FK_trip_meals_eater',
  })
  eater: User | null;

  /** Номер дня от начала похода, с единицы. */
  @Column({ name: 'day_index', type: 'int' })
  dayIndex: number;

  @Column({ type: 'varchar', length: 10 })
  kind: TripMealKind;

  @Column({ type: 'varchar', length: 10, default: 'cook' })
  form: TripMealForm;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
