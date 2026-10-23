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

import { User } from '../../users/entities/user.entity';
import { Product } from '../../meals/entities/product.entity';
import { Trip } from './trip.entity';

/**
 * Отметки чек-листа покупок: куплено, домашнее, сколько куплено.
 *
 * Строка чек-листа — это продукт раскладки; здесь только то, что не
 * сбрасывается при правке плана. Уникальность `(trip_id, product_id)`:
 * один продукт — одна строка.
 *
 * `bought_by` — кто отметил покупку (чек-лист отвечает на «кто купил»);
 * `updated_by` — кто менял последним, включая «домашнее». Пользователи
 * `SET NULL`: строка переживает удаление аккаунта.
 */
@Entity('trip_meal_checks')
@Index('UQ_trip_meal_checks_product', ['tripId', 'productId'], {
  unique: true,
})
@Check(
  'chk_trip_meal_checks_amount',
  `"bought_amount" IS NULL OR "bought_amount" >= 0`,
)
export class TripMealCheck {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  @ManyToOne(() => Trip, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'trip_id',
    foreignKeyConstraintName: 'FK_trip_meal_checks_trip',
  })
  trip: Trip;

  @Column({ name: 'product_id', type: 'int' })
  productId: number;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'product_id',
    foreignKeyConstraintName: 'FK_trip_meal_checks_product',
  })
  product: Product;

  @Column({ name: 'is_bought', type: 'boolean', default: false })
  isBought: boolean;

  /** Домашнее: покупать не нужно, но строка остаётся в плане и в весе. */
  @Column({ name: 'is_home', type: 'boolean', default: false })
  isHome: boolean;

  /** Сколько куплено фактически; null — ещё не вводили. */
  @Column({ name: 'bought_amount', type: 'int', nullable: true })
  boughtAmount: number | null;

  @Column({ name: 'bought_by', type: 'uuid', nullable: true })
  boughtBy: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'bought_by',
    foreignKeyConstraintName: 'FK_trip_meal_checks_bought_by',
  })
  buyer: User | null;

  @Column({ name: 'bought_at', type: 'timestamptz', nullable: true })
  boughtAt: Date | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'updated_by',
    foreignKeyConstraintName: 'FK_trip_meal_checks_updated_by',
  })
  editor: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
