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
import { TripProduct } from './trip-product.entity';
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
 *
 * **`eaterUserId` — чей чек-лист.** NULL — общий список завхоза; uuid —
 * личный список участника, который питается отдельно. Списков поэтому
 * два, и они не мешают друг другу: купленная в общий список «Гречка»
 * не отмечает личную гречку того же имени (разные продукты — разные
 * строки).
 */
@Entity('trip_meal_checks')
@Index('UQ_trip_meal_checks_product', ['tripId', 'productId'], {
  unique: true,
  where: '"eater_user_id" IS NULL',
})
@Index('UQ_trip_meal_checks_personal', ['tripId', 'eaterUserId', 'productId'], {
  unique: true,
  where: '"eater_user_id" IS NOT NULL',
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

  /** Чей это список; NULL — общий чек-лист похода. */
  @Column({ name: 'eater_user_id', type: 'uuid', nullable: true })
  eaterUserId: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({
    name: 'eater_user_id',
    foreignKeyConstraintName: 'FK_trip_meal_checks_eater',
  })
  eater: User | null;

  @Column({ name: 'product_id', type: 'int' })
  productId: number;

  @ManyToOne(() => TripProduct, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'product_id',
    foreignKeyConstraintName: 'FK_trip_meal_checks_product',
  })
  product: TripProduct;

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
