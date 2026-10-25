import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { TripProduct } from './trip-product.entity';
import { TripMealDish } from './trip-meal-dish.entity';

/**
 * Исключённый ингредиент в приёме: «лук не любим».
 *
 * Привязано к строке приёма, а не к рецепту: рецепт не меняется, в другом
 * приёме ингредиент остаётся. Раскладка вычитает исключённое из состава
 * и количеств; доли пакетов по ушедшему продукту чистятся.
 */
@Entity('trip_meal_dish_exclusions')
@Index('UQ_trip_meal_dish_exclusions', ['mealDishId', 'productId'], {
  unique: true,
})
export class TripMealDishExclusion {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'meal_dish_id', type: 'bigint' })
  mealDishId: string;

  @ManyToOne(() => TripMealDish, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'meal_dish_id',
    foreignKeyConstraintName: 'FK_trip_meal_dish_exclusions_dish',
  })
  mealDish: TripMealDish;

  @Column({ name: 'product_id', type: 'int' })
  productId: number;

  @ManyToOne(() => TripProduct, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'product_id',
    foreignKeyConstraintName: 'FK_trip_meal_dish_exclusions_product',
  })
  product: TripProduct;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
