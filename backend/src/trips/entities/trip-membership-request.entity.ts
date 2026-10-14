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

import { sqlValues } from '../../users/sport-experience.types';
import { User } from '../../users/entities/user.entity';
import { REQUEST_DIRECTIONS, type RequestDirection } from '../trip.types';
import { Trip } from './trip.entity';

/**
 * Тикет на вступление: приглашение или заявка в одной таблице.
 *
 * Приглашение (организатор → человек) и заявка (человек → организатор) —
 * это одни и те же поля: поход, человек, текст, дата. Различает их только
 * направление, поэтому две таблицы были бы копией друг друга, а логика
 * обработки — дублирующей.
 *
 * **Статуса нет намеренно.** Тикет живёт, пока не обработан; обработали —
 * удалили. История не теряется: принятие, отказ и отзыв приглашения
 * оставляют системные сообщения в чатах (`group_messages.sender_id IS NULL`).
 * Хранить ещё и статус значило бы держать две правды об одном событии.
 *
 * `UNIQUE (trip_id, user_id)` — один тикет на человека на поход независимо
 * от направления. Это защита от рассинхрона: одновременно приглашение
 * и заявка существовать не могут, и приложение, наткнувшись на занятую
 * строку, обязано сказать об этом внятно, а не молча перезаписать.
 */
@Entity('trip_membership_requests')
@Check(
  'chk_trip_membership_requests_direction',
  `"direction" IN (${sqlValues(REQUEST_DIRECTIONS)})`,
)
@Index('UQ_trip_membership_requests_trip_user', ['tripId', 'userId'], {
  unique: true,
})
export class TripMembershipRequest {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index('IDX_trip_membership_requests_trip_id')
  @Column({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  @ManyToOne(() => Trip, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'trip_id' })
  trip: Trip;

  /** «Мои приглашения и заявки» — отсюда и индекс. */
  @Index('IDX_trip_membership_requests_user_id')
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** `invite` — приглашение, `apply` — заявка. */
  @Column({ type: 'varchar', length: 20 })
  direction: RequestDirection;

  /** Текст приглашения или обращения. Необязателен. */
  @Column({ type: 'text', nullable: true })
  message: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
