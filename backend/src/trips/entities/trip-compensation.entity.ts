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

/** Состояния компенсации. «Не получено» здесь нет намеренно. */
export const COMPENSATION_STATUSES = ['pending', 'confirmed'] as const;
export type CompensationStatus = (typeof COMPENSATION_STATUSES)[number];

/**
 * Вид перевода: обычная компенсация или залог за участие (18.11.2026).
 *
 * Залог идёт той же механикой — ожидающий перевод и подтверждение
 * получателем, — потому что заказчик просил «подтверждение перевода теми же
 * механизмами, что и при компенсации». Отличается только подпись в ленте
 * и то, что подтверждение залога ставит человеку состояние `held`.
 */
export const COMPENSATION_KINDS = ['compensation', 'deposit'] as const;
export type CompensationKind = (typeof COMPENSATION_KINDS)[number];

/**
 * Компенсация — «должник перевёл кредитору» (11.11.2026).
 *
 * Отдельная таблица, а не `message_actions`: строке в таблице движения
 * денег нужны `trip_id` и `amount_rub` колонками, иначе каждый подсчёт
 * баланса превращался бы в сканирование jsonb. Действие в сообщении —
 * про подтверждение перевода в чате, где одно действие показывают
 * несколько сообщений; у компенсации своя жизнь и свой экран.
 *
 * **Состояния два.** «Ожидает подтверждения» и «получено». Кнопки
 * «не получено» нет: деньги в банке идут с задержкой, и красный статус
 * на следующий день пугал бы больше, чем помогал (`trip-tabs.md`
 * §«Сообщения», решение заказчика). Если перевод не дошёл — должник
 * удаляет ожидающую запись и повторяет перевод.
 *
 * **Баланс двигает только `confirmed`.** Ожидающая компенсация баланс
 * не меняет, но бронирует кредит при подборе вариантов — поэтому
 * у второго должника список кредиторов сужается сразу, не дожидаясь
 * подтверждения (проверено на примере заказчика).
 *
 * **Подтверждённая — окончательная.** Не правится и не удаляется:
 * деньги уже двигались, и «отменить» их значит сделать вид, что перевода
 * не было. Ошибку исправляют встречной записью, а не правкой истории.
 */
@Entity('trip_compensations')
@Index('IDX_trip_compensations_trip_created', ['tripId', 'createdAt'])
@Index('IDX_trip_compensations_to_status', ['toUserId', 'status'])
@Index('IDX_trip_compensations_trip_kind', ['tripId', 'kind'])
@Check('chk_trip_compensations_amount', `"amount_rub" > 0`)
@Check(
  'chk_trip_compensations_status',
  `"status" IN ('pending', 'confirmed')`,
)
@Check(
  'chk_trip_compensations_self',
  `"from_user_id" <> "to_user_id"`,
)
@Check(
  'chk_trip_compensations_confirmed',
  `("status" = 'confirmed') = ("confirmed_at" IS NOT NULL)`,
)
@Check(
  'chk_trip_compensations_kind',
  `"kind" IN ('compensation', 'deposit')`,
)
export class TripCompensation {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  @ManyToOne(() => Trip, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'trip_id',
    foreignKeyConstraintName: 'FK_trip_compensations_trip',
  })
  trip: Trip;

  /** Кто перевёл — должник. Создать запись может только он сам. */
  @Column({ name: 'from_user_id', type: 'uuid' })
  fromUserId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'from_user_id',
    foreignKeyConstraintName: 'FK_trip_compensations_from',
  })
  fromUser: User;

  /** Кому перевели — кредитор. Подтвердить получение может только он. */
  @Column({ name: 'to_user_id', type: 'uuid' })
  toUserId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'to_user_id',
    foreignKeyConstraintName: 'FK_trip_compensations_to',
  })
  toUser: User;

  @Column({ name: 'amount_rub', type: 'integer' })
  amountRub: number;

  /**
   * Компенсация или залог за участие (18.11.2026).
   *
   * Залог приходит в ту же таблицу, потому что подтверждение у него такое
   * же: «я перевёл» → «получено». Отдельная сущность повторила бы права,
   * бронирование кредита и строку ленты, и две копии разошлись бы.
   */
  @Column({ type: 'varchar', length: 20, default: 'compensation' })
  kind: CompensationKind;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: CompensationStatus;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
