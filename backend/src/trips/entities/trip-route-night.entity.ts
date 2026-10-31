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

import { Trip } from './trip.entity';

/**
 * Ночь похода: «ночь 1 · район, дата».
 *
 * **Ночь — строка, а не дата похода.** Ночей в таблице может быть меньше,
 * больше и вовсе ни одной: даты похода меняются, а расписанный табор —
 * это отдельная работа, и терять её при правке дат нельзя. Поэтому
 * `position` с 1 — порядок, а `night_date` — подпись, не источник порядка:
 * «ночь на 3-е» читается, но список строится по номеру.
 *
 * **`place` — одно на ночь, а не на вариант** (ответ заказчика 31.10.2026).
 * Палатка и изба стоят в одном районе; писать район дважды значило бы
 * разрешить «палатка на Байкале, изба на Ольхоне» в одну ночь. У «в пути»
 * и «идём всю ночь» места нет: там не останавливаются.
 *
 * **Уникальность `(trip_id, position)`:** две «ночи 2» в одном походе —
 * это не две ночи, а ошибка счёта. Перестановка ночей — перезапись
 * позиций целиком (`PUT` вкладки), а не сдвиг по одной.
 *
 * Пара `(trip_id, id)` уникальна: на неё ссылаются варианты составным
 * внешним ключом, чтобы строка не могла приехать из чужого похода.
 */
@Entity('trip_route_nights')
@Index('UQ_trip_route_nights_position', ['tripId', 'position'], {
  unique: true,
})
@Index('UQ_trip_route_nights_trip_id', ['tripId', 'id'], { unique: true })
@Check('chk_trip_route_nights_position', '"position" >= 1')
@Check(
  'chk_trip_route_nights_place',
  `"place" IS NULL OR char_length(btrim("place")) BETWEEN 1 AND 120`,
)
export class TripRouteNight {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  @ManyToOne(() => Trip, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'trip_id',
    foreignKeyConstraintName: 'FK_trip_route_nights_trip',
  })
  trip: Trip;

  /** Номер ночи с 1 — порядок показа и правки. */
  @Column({ type: 'int' })
  position: number;

  /** Район ночёвки словами; `NULL` — не записали. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  place: string | null;

  /**
   * Дата ночи (`date` в БД, строка `YYYY-MM-DD` в API).
   *
   * Хранится для чтения, а не для порядка: поход может быть без дат,
   * а таблица ночёвок — с ними.
   */
  @Column({ name: 'night_date', type: 'date', nullable: true })
  nightDate: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
