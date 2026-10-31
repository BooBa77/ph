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
  COOKING_KINDS,
  COOKING_NIGHT_KINDS,
  NIGHT_KINDS,
  type CookingKind,
  type NightKind,
} from '../trip-route.types';
import { TripGear } from '../../gear/entities/trip-gear.entity';
import { TripRouteNight } from './trip-route-night.entity';
import { TripTransferLeg } from './trip-transfer-leg.entity';

/**
 * Вариант ночёвки: «в эту ночь спим в палатке Васи и в избе».
 *
 * **Комбинированная ночёвка — несколько строк.** Заказчик просил вариантов
 * несколько, у каждого свои люди; массив в колонке это не выражает, поэтому
 * варианты отдельной таблицей, как пассажиры рейса.
 *
 * **«Палатка» и «машина» — ссылки, а не текст** (решение 29.10.2026):
 * палатка — вещь из снаряжения похода (`trip_gear`, тип `tent`), машина —
 * карточка своего ТС из «Трансфера». Текст «палатка Васи» разошёлся бы
 * с палаткой Васи в снаряжении после первой правки.
 *
 * **`kind` — контракт, ссылки — данные.** CHECK `chk_trip_route_options_source`
 * держит три состояния: палатка без вещи невозможна, машина без карточки
 * невозможна, у остальных вариантов ссылок нет вовсе. Отсюда же запрет
 * смешивать «идём всю ночь» и «палатку» — он в сервисе: в одну ночь
 * отвечают либо «спим», либо «идём».
 *
 * **Способ готовки — у варианта, а не у ночи** (заказчик 29.10.2026):
 * вопрос зависит от варианта, а не от места. База дополнительно следит,
 * что готовку не поставили «гостинице» и «ночному переходу».
 *
 * Уникальность `(trip_id, night_id, tent_gear_id)` и
 * `(trip_id, night_id, car_leg_id)`: одна и та же палатка (машина) в одну
 * ночь — одна строка. `NULL`-ы в Postgres различны, поэтому строкам без
 * ссылок эти ограничения не мешают — «гостиницу» от дубля держит сервис.
 */
@Entity('trip_route_options')
@Index('IDX_trip_route_options_night', ['tripId', 'nightId', 'id'])
@Index('UQ_trip_route_options_tent', ['tripId', 'nightId', 'tentGearId'], {
  unique: true,
})
@Index('UQ_trip_route_options_car', ['tripId', 'nightId', 'carLegId'], {
  unique: true,
})
@Check('chk_trip_route_options_kind', `"kind" IN (${sqlValues(NIGHT_KINDS)})`)
@Check(
  'chk_trip_route_options_source',
  `("kind" = 'tent' AND "tent_gear_id" IS NOT NULL AND "car_leg_id" IS NULL)
   OR ("kind" = 'car' AND "car_leg_id" IS NOT NULL AND "tent_gear_id" IS NULL)
   OR ("kind" NOT IN ('tent', 'car')
       AND "tent_gear_id" IS NULL AND "car_leg_id" IS NULL)`,
)
@Check(
  'chk_trip_route_options_cooking',
  `"cooking" IS NULL OR ("kind" IN (${sqlValues(COOKING_NIGHT_KINDS)})
     AND "cooking" IN (${sqlValues(COOKING_KINDS)}))`,
)
export class TripRouteOption {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  @Column({ name: 'night_id', type: 'bigint' })
  nightId: string;

  /**
   * Ночь, в которую стоит вариант. Составной ключ `(trip_id, night_id)`:
   * вариант не может приехать из чужого похода. `CASCADE` — убрали ночь,
   * ушли и её варианты.
   */
  @ManyToOne(() => TripRouteNight, { onDelete: 'CASCADE' })
  @JoinColumn([
    {
      name: 'trip_id',
      referencedColumnName: 'tripId',
      foreignKeyConstraintName: 'FK_trip_route_options_night',
    },
    { name: 'night_id', referencedColumnName: 'id' },
  ])
  night: TripRouteNight;

  /** `tent` | `hotel` | `hut` | `car` | `allnight` | `transit`. */
  @Column({ type: 'varchar', length: 20 })
  kind: NightKind;

  /**
   * Палатка из снаряжения похода. `CASCADE`: палатку убрали из похода —
   * вариант уходит вместе с ней (ночь остаётся, просто без этой строки).
   */
  @Column({ name: 'tent_gear_id', type: 'bigint', nullable: true })
  tentGearId: string | null;

  @ManyToOne(() => TripGear, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn([
    {
      name: 'trip_id',
      referencedColumnName: 'tripId',
      foreignKeyConstraintName: 'FK_trip_route_options_tent',
    },
    { name: 'tent_gear_id', referencedColumnName: 'id' },
  ])
  tentGear: TripGear | null;

  /** Машина — карточка своего ТС из «Трансфера». */
  @Column({ name: 'car_leg_id', type: 'bigint', nullable: true })
  carLegId: string | null;

  @ManyToOne(() => TripTransferLeg, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn([
    {
      name: 'trip_id',
      referencedColumnName: 'tripId',
      foreignKeyConstraintName: 'FK_trip_route_options_car',
    },
    { name: 'car_leg_id', referencedColumnName: 'id' },
  ])
  carLeg: TripTransferLeg | null;

  /** `fire` | `stove` | `both`; `NULL` — не готовим или не спросили. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  cooking: CookingKind | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
