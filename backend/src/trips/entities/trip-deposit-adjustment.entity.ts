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

import { User } from '../../users/entities/user.entity';
import { Trip } from './trip.entity';

/**
 * Корректировка баланса от удержания залога (17.11.2026).
 *
 * Заказчик подтвердил, что удержанный залог — **доход фонда группы**:
 * у отказавшегося баланс падает на сумму залога, у каждого идущего растёт
 * на её долю («A −залог, каждому идущему +залог/число идущих»). Поэтому
 * здесь лежит не одна запись, а пачка строк на одно удержание: одна
 * отрицательная у источника, по одной положительной у идущих.
 *
 * **Сумма строк одного удержания всегда ноль**, иначе баланс группы
 * перестал бы сходиться. Проверяется правилом формирования, а не CHECK:
 * база не умеет считать сумму по группе строк.
 *
 * **Строки фиксируются на момент удержания.** Состав похода после этого
 * может измениться, но уже поделённые деньги не пересчитываются — так же,
 * как доли расхода (`finance.md` §2.1). Поэтому `source_user_id` и
 * `created_at` лежат прямо в строке: по ним удержание отменяется целиком,
 * когда организатор вернул залог.
 *
 * **Почему не `trip_expenses`.** У расхода сумма всегда положительная
 * и он «кто-то заплатил за кого-то»; удержание же никому не платили —
 * это перераспределение залога, и у источника сумма отрицательная.
 */
@Entity('trip_deposit_adjustments')
@Index('IDX_trip_deposit_adjustments_trip', ['tripId', 'sourceUserId'])
@Check('chk_trip_deposit_adjustments_amount', `"amount_rub" <> 0`)
export class TripDepositAdjustment {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  @ManyToOne(() => Trip, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'trip_id',
    foreignKeyConstraintName: 'FK_trip_deposit_adjustments_trip',
  })
  trip: Trip;

  /** Чей залог удержан: по нему удержание отменяется и показывается в ленте. */
  @Column({ name: 'source_user_id', type: 'uuid' })
  sourceUserId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'source_user_id',
    foreignKeyConstraintName: 'FK_trip_deposit_adjustments_source',
  })
  sourceUser: User;

  /** Чей баланс двигается этой строкой: источник или один из идущих. */
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_trip_deposit_adjustments_user',
  })
  user: User;

  /** Со знаком: у источника минус, у идущего плюс его доля. */
  @Column({ name: 'amount_rub', type: 'integer' })
  amountRub: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
