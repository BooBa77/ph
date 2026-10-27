import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { TripParticipant } from './trip-participant.entity';
import { TripTransferCar } from './trip-transfer-car.entity';
import { TripTransferLeg } from './trip-transfer-leg.entity';

/**
 * Пассажир строки заброски — «кто едет этой строкой».
 *
 * **Сначала строка, потом машина.** Человек едет заброской, а место
 * в машине получает после: `car_id = NULL` — «едет, но места нет».
 * На экране это подписано «без машины» и это работа для людей, а не
 * ошибка данных: первого попавшегося не подставляем (`gear-distribution.md`
 * §6.6). У поезда и автобуса машины нет вовсе, а пассажиры есть — поэтому
 * принадлежность строке, а не машине.
 *
 * **Уникальность `(leg_id, user_id)`**: в одной строке человек едет один
 * раз. В разных строках — сколько нужно: «туда» машиной, «обратно» поездом.
 *
 * Внешние ключи:
 *
 * - `(trip_id, leg_id) → trip_transfer_legs` — `CASCADE`: убрали строку,
 *   ушли её пассажиры (машины уходят тем же путём);
 * - `(trip_id, user_id) → trip_participants` — `CASCADE`: ушёл из состава,
 *   ушёл из всех строк (правила §6 без кода);
 * - `car_id → trip_transfer_cars` — `SET NULL`: убрали машину, её пассажиры
 *   остаются в строке нераспределёнными. Одиночный ключ, а не составной
 *   `(leg_id, car_id)`: `ON DELETE SET NULL` обнулил бы и `leg_id`, а он
 *   `NOT NULL`; что машина из этой же строки, проверяет сервис (400).
 */
@Entity('trip_transfer_passengers')
@Index('UQ_trip_transfer_passengers_leg_user', ['legId', 'userId'], {
  unique: true,
})
@Index('IDX_trip_transfer_passengers_car', ['carId'])
@Index('IDX_trip_transfer_passengers_trip', ['tripId', 'id'])
export class TripTransferPassenger {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  @Column({ name: 'leg_id', type: 'bigint' })
  legId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** Место в машине. `NULL` — едет строкой, но ещё не распределён. */
  @Column({ name: 'car_id', type: 'bigint', nullable: true })
  carId: string | null;

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

  @ManyToOne(() => TripTransferCar, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'car_id',
    foreignKeyConstraintName: 'FK_trip_transfer_passengers_car',
  })
  car: TripTransferCar | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
