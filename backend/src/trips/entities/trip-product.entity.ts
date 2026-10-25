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
import { PRODUCT_UNITS, type ProductUnit } from '../../meals/meal.types';
import { Trip } from './trip.entity';

/**
 * Продукт похода — своя строка, а не ссылка на справочник.
 *
 * Справочник (`products`) нужен только чтобы предложить готовые названия:
 * единицы и вес там «эталонные». В походе живёт **копия**: имя, единица и
 * вес переписываются сюда, и дальше поход от справочника не зависит —
 * поправят справочник, прошедшие походы не поедут.
 *
 * Имя уникально внутри похода: две «Гречки» в одном походе — это две
 * строки в чек-листе и двойной вес в пакете.
 *
 * **`ownerUserId` — свой продукт участника.** NULL — общий продукт похода,
 * его видят все и он попадает в общую раскладку. uuid — личный продукт:
 * виден только владельцу и живёт только в его личной еде. Имя уникально
 * внутри слоя (частичные индексы), поэтому «Шоколад» участника не мешает
 * общему «Шоколаду» и наоборот.
 */
@Entity('trip_products')
@Index('UQ_trip_products_name', ['tripId', 'name'], {
  unique: true,
  where: '"owner_user_id" IS NULL',
})
@Index('UQ_trip_products_personal_name', ['tripId', 'ownerUserId', 'name'], {
  unique: true,
  where: '"owner_user_id" IS NOT NULL',
})
@Check('chk_trip_products_unit', `"unit" IN (${sqlValues(PRODUCT_UNITS)})`)
@Check('chk_trip_products_weight', `"weight_per_unit_grams" >= 0`)
@Check('chk_trip_products_name', `char_length(btrim("name")) > 0`)
export class TripProduct {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  @ManyToOne(() => Trip, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'trip_id',
    foreignKeyConstraintName: 'FK_trip_products_trip',
  })
  trip: Trip;

  /** Чей это продукт; NULL — общий для похода. */
  @Column({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({
    name: 'owner_user_id',
    foreignKeyConstraintName: 'FK_trip_products_owner',
  })
  owner: User | null;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 10 })
  unit: ProductUnit;

  @Column({ name: 'weight_per_unit_grams', type: 'int', default: 0 })
  weightPerUnitGrams: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
