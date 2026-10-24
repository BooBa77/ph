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

import { Product } from '../../meals/entities/product.entity';
import { TripMeal } from './trip-meal.entity';

/**
 * Ручная строка раскладки: «хлеб 600 г», «конфеты 300 г».
 *
 * **Абсолютная.** От состава не зависит: сколько положили, столько и есть;
 * мясного флага у неё нет. Рецептовые строки считаются от едоков, ручные —
 * нет, поэтому они и живут отдельно.
 *
 * **Одна строка на продукт в приёме.** Если продукт пришёл и из рецепта,
 * и рукой, в раскладке это одна строка: количество складывается
 * на чтении. Две строки «соль» в одном приёме — это вопрос без ответа
 * «сколько соли».
 */
@Entity('trip_meal_lines')
@Index('UQ_trip_meal_lines', ['mealId', 'productId'], { unique: true })
@Check('chk_trip_meal_lines_amount', '"amount" <> 0')
export class TripMealLine {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'meal_id', type: 'bigint' })
  mealId: string;

  @ManyToOne(() => TripMeal, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'meal_id',
    foreignKeyConstraintName: 'FK_trip_meal_lines_meal',
  })
  meal: TripMeal;

  @Column({ name: 'product_id', type: 'int' })
  productId: number;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'product_id',
    foreignKeyConstraintName: 'FK_trip_meal_lines_product',
  })
  product: Product;

  /** Количество: положительное — добавили, отрицательное — убрали. */
  @Column({ type: 'int' })
  amount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
