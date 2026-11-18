import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';
import { Trip } from './trip.entity';

/**
 * Удержанный залог — строка фонда группы (18.11.2026).
 *
 * Заказчик: «Удержание залога с ушедшего участника также отображается,
 * народ должен понимать, откуда плюс в бюджете». Это не перевод человеку
 * и не расход: деньги отказавшегося остаются у группы, поэтому строка
 * живёт отдельно от `trip_expenses` и `trip_compensations`.
 *
 * **Балансы удержание больше не двигает.** Отказавшийся теряет свой
 * перевод залога (он удаляется вместе с удержанием), а его доля расходов
 * остаётся за ним — её и покрывает залог. Поэтому в примере заказчика
 * «A +800, B, C, D, E −200» после удержания не меняется: меняется только
 * фонд группы, где появляется 200 ₽. Если организатор вернёт залог,
 * строка удаляется, а доля ушедшего расходится на идущих
 * (`trip_deposit_adjustments`).
 *
 * **Одно удержание на человека.** Уникальность `(trip_id, source_user_id)`
 * не даёт двум нажатиям создать две строки фонда. Повторное «Удержать»
 * заменяет сумму, а не добавляет вторую.
 */
@Entity('trip_deposit_forfeits')
@Index('IDX_trip_deposit_forfeits_trip', ['tripId'])
@Unique('UQ_trip_deposit_forfeits_source', ['tripId', 'sourceUserId'])
@Check('chk_trip_deposit_forfeits_amount', `"amount_rub" > 0`)
export class TripDepositForfeit {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  @ManyToOne(() => Trip, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'trip_id',
    foreignKeyConstraintName: 'FK_trip_deposit_forfeits_trip',
  })
  trip: Trip;

  /** Чей залог удержан: по нему строка снимается при возврате. */
  @Column({ name: 'source_user_id', type: 'uuid' })
  sourceUserId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'source_user_id',
    foreignKeyConstraintName: 'FK_trip_deposit_forfeits_source',
  })
  sourceUser: User;

  @Column({ name: 'amount_rub', type: 'integer' })
  amountRub: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
