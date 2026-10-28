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

import { sqlValues } from '../../users/sport-experience.types';
import {
  TRANSFER_PASSENGER_STATUSES,
  type TransferPassengerStatus,
} from '../trip-transfer.types';
import { TripParticipant } from './trip-participant.entity';
import { TripTransferLeg } from './trip-transfer-leg.entity';

/**
 * Пассажир карточки перемещения.
 *
 * **Заявка есть только у чужого ТС.** На общественном транспорте (автобус,
 * ж/д, корабль, вертолёт) человек «присоединяется» сразу: купил билет —
 * едешь, спрашивать некого. На личном ТС место даёт владелец, поэтому
 * человек **просится** (`requested`), а владелец принимает или отклоняет.
 * Отклонение — удаление строки, а не статус: «отказ» не история, а решение
 * (то же правило, что у заявок в состав похода).
 *
 * **Уйти можно самому в любом статусе** — и отменить свою заявку, и сойти
 * с уже принятой поездки. Это и есть «пассажир может отказаться».
 *
 * Уникальность `(leg_id, user_id)`: в одной карточке человек едет один раз.
 * **Один человек — один рейс «туда» и один «обратно»** (решение заказчика
 * 28.10.2026): второй рейс того же направления сервис не сажает. Заявки
 * (`requested`) не считаются — место они не занимают, а заброски
 * (`is_stage`) не считаются вовсе: этапов у человека сколько нужно.
 * Подробности — `TripTransferService.assertSingleRide`.
 *
 * Внешние ключи — на пару `(trip_id, …)`: пассажир не из чужой карточки
 * и не из чужого похода. Ушёл из состава — его строки уходят каскадом.
 */
@Entity('trip_transfer_passengers')
@Index('UQ_trip_transfer_passengers_leg_user', ['legId', 'userId'], {
  unique: true,
})
@Index('IDX_trip_transfer_passengers_trip', ['tripId', 'id'])
@Check(
  'chk_trip_transfer_passengers_status',
  `"status" IN (${sqlValues(TRANSFER_PASSENGER_STATUSES)})`,
)
export class TripTransferPassenger {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  @Column({ name: 'leg_id', type: 'bigint' })
  legId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** `requested` — просится, `accepted` — едет. */
  @Column({ type: 'varchar', length: 20, default: 'accepted' })
  status: TransferPassengerStatus;

  @ManyToOne(() => TripTransferLeg, { onDelete: 'CASCADE' })
  @JoinColumn([
    {
      name: 'trip_id',
      referencedColumnName: 'tripId',
      foreignKeyConstraintName: 'FK_trip_transfer_passengers_leg',
    },
    { name: 'leg_id', referencedColumnName: 'id' },
  ])
  leg: TripTransferLeg;

  @ManyToOne(() => TripParticipant, { onDelete: 'CASCADE' })
  @JoinColumn([
    {
      name: 'trip_id',
      referencedColumnName: 'tripId',
      foreignKeyConstraintName: 'FK_trip_transfer_passengers_member',
    },
    { name: 'user_id', referencedColumnName: 'userId' },
  ])
  member: TripParticipant;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
