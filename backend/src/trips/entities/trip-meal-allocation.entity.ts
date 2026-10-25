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

import { TripProduct } from './trip-product.entity';
import { TripMeal } from './trip-meal.entity';
import { TripMealPackage } from './trip-meal-package.entity';

/**
 * Доля строки раскладки в пакете: «крупа 600 г → Пакет 2, 400 г».
 *
 * **Фиксированные доли и одна эластичная «всё».** Фиксированная стоит,
 * сколько положили; эластичная забирает остаток и следует за изменением
 * количества при смене состава. Больше одной «всё» на строку не бывает —
 * иначе остаток делился бы непонятно (частичный уникальный индекс).
 *
 * `amount` у эластичной строки — 0: остаток считается на чтении как
 * «всего − фиксированные». Хранить его копию значило бы держать число,
 * которое устаревает от каждой смены состава.
 *
 * «Не расфасовано» — не строка, а разница «всего − доли»: она видна
 * в раскладке цветом, но пакетом не является.
 */
@Entity('trip_meal_allocations')
@Index('UQ_trip_meal_allocations', ['mealId', 'productId', 'packageId'], {
  unique: true,
})
@Index('UQ_trip_meal_allocations_elastic', ['mealId', 'productId'], {
  unique: true,
  where: '"is_elastic"',
})
@Check('chk_trip_meal_allocations_amount', '"amount" >= 0')
export class TripMealAllocation {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'meal_id', type: 'bigint' })
  mealId: string;

  @ManyToOne(() => TripMeal, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'meal_id',
    foreignKeyConstraintName: 'FK_trip_meal_allocations_meal',
  })
  meal: TripMeal;

  @Column({ name: 'product_id', type: 'int' })
  productId: number;

  @ManyToOne(() => TripProduct, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'product_id',
    foreignKeyConstraintName: 'FK_trip_meal_allocations_product',
  })
  product: TripProduct;

  @Column({ name: 'package_id', type: 'bigint' })
  packageId: string;

  @ManyToOne(() => TripMealPackage, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'package_id',
    foreignKeyConstraintName: 'FK_trip_meal_allocations_package',
  })
  package: TripMealPackage;

  @Column({ type: 'int', default: 0 })
  amount: number;

  @Column({ name: 'is_elastic', type: 'boolean', default: false })
  isElastic: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
