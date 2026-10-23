import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Dish } from '../../meals/entities/dish.entity';
import { TripMeal } from './trip-meal.entity';

/**
 * Блюдо в приёме пищи.
 *
 * Рецепт — блюдо из кулинарной книги (`dishes`): состав и вес на одного
 * человека. В походе количество = рецепт × едоков; мясные ингредиенты —
 * × (едоков − вегетарианцев). Копию рецепта не храним: блюдо поправили —
 * раскладка пересчиталась.
 *
 * `RESTRICT` на блюдо: удалить из книги блюдо, которое уже стоит в походе,
 * нельзя — приложение ответит понятным 409, а не потеряет блюдо из
 * раскладки молча.
 */
@Entity('trip_meal_dishes')
@Index('UQ_trip_meal_dishes', ['mealId', 'dishId'], { unique: true })
export class TripMealDish {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'meal_id', type: 'bigint' })
  mealId: string;

  @ManyToOne(() => TripMeal, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'meal_id',
    foreignKeyConstraintName: 'FK_trip_meal_dishes_meal',
  })
  meal: TripMeal;

  @Column({ name: 'dish_id', type: 'bigint' })
  dishId: string;

  @ManyToOne(() => Dish, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'dish_id',
    foreignKeyConstraintName: 'FK_trip_meal_dishes_dish',
  })
  dish: Dish;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
