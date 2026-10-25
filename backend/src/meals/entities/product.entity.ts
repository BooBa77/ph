import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { sqlValues } from '../../users/sport-experience.types';
import { Trip } from '../../trips/entities/trip.entity';
import { PRODUCT_UNITS, type ProductUnit } from '../meal.types';

/**
 * Продукт — строка общесистемного справочника.
 *
 * **Не личный.** «Гречка», «тушёнка», «сгущёнка» — одни и те же у всех:
 * личный справочник означал бы, что каждый заводит свою гречку со своим
 * весом, и раскладка не смогла бы их сложить. Пополнение справочника —
 * отдельная задача (решено: будущий функционал), поэтому приложение только
 * читает эти строки; в базе ему выдан `SELECT` (см. миграцию).
 *
 * **Вес единицы обязателен.** Без него нельзя посчитать вес раскладки —
 * а именно вес и нужен в походе: «три банки тушёнки» ничего не говорят
 * рюкзаку, «три банки по 340 г» говорят.
 *
 * `name` уникально: справочник без уникальности — это справочник, в котором
 * «Гречка» и «гречка» живут отдельно.
 */
@Entity('products')
@Index('UQ_products_name_global', ['name'], {
  unique: true,
  where: '"trip_id" IS NULL',
})
@Index('UQ_products_trip_name', ['tripId', 'name'], {
  unique: true,
  where: '"trip_id" IS NOT NULL',
})
@Check('chk_products_unit', `"unit" IN (${sqlValues(PRODUCT_UNITS)})`)
@Check('chk_products_weight', `"weight_per_unit_grams" >= 0`)
@Check('chk_products_name', `char_length(btrim("name")) > 0`)
export class Product {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ name: 'trip_id', type: 'bigint', nullable: true })
  tripId: string | null;

  @ManyToOne(() => Trip, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({
    name: 'trip_id',
    foreignKeyConstraintName: 'FK_products_trip',
  })
  trip: Trip | null;

  @Column({ type: 'varchar', length: 10 })
  unit: ProductUnit;

  /** Сколько весит одна единица: 340 г для банки тушёнки, 1 для граммов. */
  @Column({ name: 'weight_per_unit_grams', type: 'int' })
  weightPerUnitGrams: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
