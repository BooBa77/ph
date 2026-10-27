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
import { TRANSFER_MODES, type TransferMode } from '../trip-transfer.types';
import { Trip } from './trip.entity';

/**
 * Строка заброски: «когда, откуда, куда и на чём».
 *
 * **Строка — не машина.** У поезда машины нет, а пассажиры и места нужны
 * те же; поэтому первая сущность отвечает на вопрос «как едем в этот раз»,
 * а машины (`trip_transfer_cars`) живут внутри строки. Отсюда и
 * «вернуться так же» — копия строки с обратными точками, а не общая машина
 * на весь поход: туда и обратно едут разными составами, и это норма.
 *
 * `position` — порядок строк в списке («сначала туда, потом обратно»),
 * а не сортировка по датам: дату обратного выезда часто ставят позже,
 * а иногда её нет вовсе (`departs_at IS NULL` — «время уточняется»).
 *
 * `from_place`/`to_place` — текст, а не ссылка на справочник объектов:
 * «Иркутск, автовокзал, у первой платформы» — это не объект природы,
 * и в справочнике его нет. Позже, если понадобится связь с картой,
 * появится отдельное поле, а не замена этого.
 */
@Entity('trip_transfer_legs')
@Index('UQ_trip_transfer_legs_trip', ['tripId', 'id'], { unique: true })
@Index('IDX_trip_transfer_legs_order', ['tripId', 'position', 'id'])
@Check('chk_trip_transfer_legs_mode', `"mode" IN (${sqlValues(TRANSFER_MODES)})`)
@Check('chk_trip_transfer_legs_position', '"position" >= 1')
export class TripTransferLeg {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  @ManyToOne(() => Trip, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'trip_id',
    foreignKeyConstraintName: 'FK_trip_transfer_legs_trip',
  })
  trip: Trip;

  /** Порядок в списке. Уникальности нет: перестановка — это номера подряд. */
  @Column({ type: 'int', default: 1 })
  position: number;

  /** Выезд; `NULL` — «время уточняется», а не «неизвестно навсегда». */
  @Column({ name: 'departs_at', type: 'timestamptz', nullable: true })
  departsAt: Date | null;

  @Column({ name: 'from_place', type: 'varchar', length: 200 })
  fromPlace: string;

  @Column({ name: 'to_place', type: 'varchar', length: 200 })
  toPlace: string;

  /** `car` | `train` | `bus` | `horses` | `foot` | `other`. */
  @Column({ type: 'varchar', length: 20, default: 'car' })
  mode: TransferMode;

  /** «Сбор у первой платформы, выезжаем в восемь». */
  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
