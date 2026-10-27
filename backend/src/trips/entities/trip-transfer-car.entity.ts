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
  TRANSFER_CAR_OWNERSHIPS,
  type TransferCarOwnership,
} from '../trip-transfer.types';
import { TripParticipant } from './trip-participant.entity';
import { TripTransferLeg } from './trip-transfer-leg.entity';

/**
 * Машина строки заброски.
 *
 * **Своя и наёмная — один тип.** У наёмной водителя в составе нет, но
 * пассажиров и мест ровно столько же; отдельная таблица завела бы второй
 * набор тех же правил. Разница выражена CHECK-ом: у своей водитель —
 * участник (`driver_user_id NOT NULL`), у наёмной — имя и телефон
 * (`driver_user_id IS NULL`), потому что аккаунта у него не бывает.
 *
 * **Водитель своей машины — участник похода**, внешний ключ ведёт на пару
 * `(trip_id, driver_user_id)` из `trip_participants`, как у владельца
 * снаряжения. Отсюда правило ухода участника работает без кода: убрали
 * человека из состава — его машина ушла каскадом, а её пассажиры остались
 * в строке нераспределёнными (`car_id → NULL` у пассажиров). Отказ
 * (`declined`) строку участника не удаляет: это шаг «уход участника»,
 * он появится позже, вместе с ночёвками.
 *
 * `seats` — **всего мест, включая водителя**: так люди и говорят
 * («пятиместная»). `NULL` — «не знаю», и это не потолок: машину на пятерых
 * уточнят позже, а запрещать посадку до уточнения значило бы блокировать
 * работу. Заполненные места проверяет сервис (400 «нет свободных мест»),
 * а не CHECK: это правило про количество строк-пассажиров, а CHECK видит
 * одну строку.
 */
@Entity('trip_transfer_cars')
@Index('UQ_trip_transfer_cars_leg', ['legId', 'id'], { unique: true })
@Index('IDX_trip_transfer_cars_trip', ['tripId', 'id'])
@Check(
  'chk_trip_transfer_cars_ownership',
  `"ownership" IN (${sqlValues(TRANSFER_CAR_OWNERSHIPS)})`,
)
@Check('chk_trip_transfer_cars_seats', '"seats" IS NULL OR "seats" > 0')
@Check(
  'chk_trip_transfer_cars_driver',
  `("ownership" = 'own') = ("driver_user_id" IS NOT NULL)`,
)
@Check(
  'chk_trip_transfer_cars_hired_name',
  `"ownership" = 'own' OR "driver_name" IS NOT NULL`,
)
export class TripTransferCar {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  @Column({ name: 'leg_id', type: 'bigint' })
  legId: string;

  /**
   * Строка, к которой относится машина. Составной ключ `(trip_id, leg_id)`
   * держит машину в своём походе: одиночный `leg_id` позволил бы привязать
   * её к строке чужого похода мимо API.
   */
  @ManyToOne(() => TripTransferLeg, { onDelete: 'CASCADE' })
  @JoinColumn([
    {
      name: 'trip_id',
      referencedColumnName: 'tripId',
      foreignKeyConstraintName: 'FK_trip_transfer_cars_leg',
    },
    { name: 'leg_id', referencedColumnName: 'id' },
  ])
  leg: TripTransferLeg;

  /** `own` — своя, `hired` — наёмная. */
  @Column({ type: 'varchar', length: 10 })
  ownership: TransferCarOwnership;

  /** Водитель-участник. `NULL` — наёмная машина, аккаунта у водителя нет. */
  @Column({ name: 'driver_user_id', type: 'uuid', nullable: true })
  driverUserId: string | null;

  /**
   * Водитель. `CASCADE`: ушёл из состава — ушёл со своей машиной
   * (`gear-distribution.md` §6.1); пассажиры при этом не теряются.
   */
  @ManyToOne(() => TripParticipant, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn([
    {
      name: 'trip_id',
      referencedColumnName: 'tripId',
      foreignKeyConstraintName: 'FK_trip_transfer_cars_driver',
    },
    { name: 'driver_user_id', referencedColumnName: 'userId' },
  ])
  driver: TripParticipant | null;

  /** Имя водителя наёмной машины: «Сергей». У своей берётся из профиля. */
  @Column({ name: 'driver_name', type: 'varchar', length: 100, nullable: true })
  driverName: string | null;

  /** Телефон водителя: в день выезда ищут именно его. */
  @Column({ name: 'driver_phone', type: 'varchar', length: 40, nullable: true })
  driverPhone: string | null;

  /** Всего мест, включая водителя; `NULL` — не знаю (потолка нет). */
  @Column({ type: 'int', nullable: true })
  seats: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
