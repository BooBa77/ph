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
 * Корректировка баланса при возврате залога (18.11.2026, переписано).
 *
 * **Возврат залога — это прощение доли ушедшего.** Заказчик: «A уговорил
 * организатора вернуть залог, баланс стал A +1000, B, C, D, E −250,
 * разошли полюбовно». Доля A в продуктах (200 ₽) перестаёт быть его:
 * она расходится по идущим, и каждый платит на 50 ₽ больше. Поэтому строки
 * такие: у источника **плюс** его доля, у каждого идущего **минус** его
 * часть. Сумма по пачке — ноль, баланс группы сходится.
 *
 * **Почему не правим доли расходов.** `trip_expense_shares` — история:
 * 12.11.2026 решено, что вышедший остаётся в ней со своей долей. Возврат
 * залога — сегодняшнее решение организатора, а не переписывание прошедшей
 * траты; корректировка живёт отдельно и снимается вместе с решением.
 *
 * **Строки фиксируются на момент возврата.** Состав похода после этого
 * может измениться, но уже поделённая доля не пересчитывается. Поэтому
 * `source_user_id` и `created_at` лежат прямо в строке: по ним возврат
 * отменяется целиком, когда организатор снова удержал залог.
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

  /** Чей залог вернули: по нему корректировка снимается и показывается в ленте. */
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

  /** Со знаком: у источника плюс его доля, у идущего минус его часть. */
  @Column({ name: 'amount_rub', type: 'integer' })
  amountRub: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
