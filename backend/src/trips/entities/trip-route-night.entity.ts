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
import { Trip } from './trip.entity';
import {
  COOKING_KINDS,
  COOKING_NIGHT_KINDS,
  NIGHT_KINDS,
  PLACE_NIGHT_KINDS,
  type CookingKind,
  type NightKind,
} from '../trip-route.types';

/**
 * Ночь похода: «ночь 1 · район, дата» и **один вариант ночёвки**.
 *
 * **Ночь — строка, а не дата похода.** Ночей в таблице может быть меньше,
 * больше и вовсе ни одной: даты похода меняются, а расписанный табор —
 * это отдельная работа, и терять её при правке дат нельзя. Поэтому
 * `position` с 1 — порядок, а `night_date` — подпись, не источник порядка:
 * «ночь на 3-е» читается, но список строится по номеру.
 *
 * **У ночи один вариант** (решение заказчика 01.11.2026). До этого шага
 * варианты жили отдельной таблицей `trip_route_options` и комбинировались;
 * заказчик отменил комбинированные ночи: «На одну ночь один вариант
 * ночёвки». Поэтому `kind` и `cooking` — колонки этой строки.
 * `kind = NULL` — вариант ещё не выбрали; на экране это значит «идём всю
 * ночь», стоянки нет.
 *
 * **Ссылок на палатку и машину здесь нет.** Распределение по палаткам
 * действует на весь поход и живёт в `trip_route_lodgers`, а машины
 * в ночёвках с «Трансфером» заказчик связывать не просил. Палатку ночи
 * не выбирают — она одна на поход у человека.
 *
 * **`place` — одно на ночь.** У «в пути» и «идём всю ночь» места нет:
 * там не останавливаются; это держит `chk_trip_route_nights_place`.
 *
 * **Уникальность `(trip_id, position)`:** две «ночи 2» в одном походе —
 * это не две ночи, а ошибка счёта. Перестановка ночей — перезапись
 * позиций целиком (`PUT` вкладки), а не сдвиг по одной.
 */
@Entity('trip_route_nights')
@Index('UQ_trip_route_nights_position', ['tripId', 'position'], {
  unique: true,
})
@Check('chk_trip_route_nights_position', '"position" >= 1')
@Check(
  'chk_trip_route_nights_place',
  `"place" IS NULL OR char_length(btrim("place")) BETWEEN 1 AND 120`,
)
@Check(
  'chk_trip_route_nights_kind',
  `"kind" IS NULL OR "kind" IN (${sqlValues(NIGHT_KINDS)})`,
)
@Check(
  'chk_trip_route_nights_cooking',
  `"cooking" IS NULL OR ("kind" IS NOT NULL
     AND "kind" IN (${sqlValues(COOKING_NIGHT_KINDS)})
     AND "cooking" IN (${sqlValues(COOKING_KINDS)}))`,
)
@Check(
  'chk_trip_route_nights_place_kind',
  `"place" IS NULL OR ("kind" IS NOT NULL
     AND "kind" IN (${sqlValues(PLACE_NIGHT_KINDS)}))`,
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

  /**
   * Как ночуем: `tent` | `hotel` | `hut` | `car` | `allnight` | `transit`.
   * `NULL` — ещё не выбрали (на экране это «идём всю ночь»).
   */
  @Column({ type: 'varchar', length: 20, nullable: true })
  kind: NightKind | null;

  /**
   * Способ готовки: `fire` | `stove` | `both`; `NULL` — не готовим или
   * вопрос не задан. Бывает только у палатки, избы и машины.
   */
  @Column({ type: 'varchar', length: 10, nullable: true })
  cooking: CookingKind | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
