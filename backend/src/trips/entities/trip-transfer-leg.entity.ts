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
  TRANSFER_COMPENSATIONS,
  TRANSFER_DIRECTIONS,
  TRANSFER_MODES,
  TRANSFER_PERSONAL_MODES,
  TRANSFER_PUBLIC_MODES,
  type TransferCompensation,
  type TransferDirection,
  type TransferMode,
} from '../trip-transfer.types';
import { TripParticipant } from './trip-participant.entity';
import { Trip } from './trip.entity';

/**
 * Карточка перемещения — одна часть группы едет одним способом.
 *
 * **Машина больше не отдельная сущность** (переделано 27.10.2026). Раньше
 * под строкой жили машины с водителями и местами, и получалось, что
 * «строка» и «машина» — это почти одно и то же, только у поезда машины нет.
 * Теперь карточка — это и есть ТС: способ доставки, время, откуда и куда,
 * места, компенсация. Пять человек в одной машине и трое в другой — это
 * две карточки в одной области «Туда».
 *
 * **Сторона (`direction`) — поле, а не вывод из точек.** В подготовке две
 * области с своими кнопками; выводить «обратно» из переставленных точек
 * значило бы ошибаться на «Иркутск → Иркутск» и на выезде без точек.
 *
 * **`is_own_vehicle` — «наше ТС».** Флаг ставит организатор (или роль
 * с вкладкой); участник, который завёл свой транспорт, получает флаг
 * автоматически. У автобуса, поезда, корабля и вертолёта флага не бывает:
 * это рейсы, и владельца у них в группе нет — CHECK следит.
 *
 * **Владелец ТС — участник похода** (составной внешний ключ на
 * `trip_participants`). Отсюда правило ухода без кода: ушёл человек
 * из состава — ушла его карточка вместе с пассажирами.
 *
 * **`departs_at` обязателен.** Карточка без времени — это не заброска,
 * а пожелание; заказчик попросил обязательные «откуда», «докуда» и время.
 *
 * **Компенсация** (`compensation`): безвозмездно, цена билета, общий расход,
 * общий расход на пассажиров. У рейсов бывает только «цена билета»,
 * у своего транспорта — только общие расходы; у общих есть флаг
 * «туда-обратно» (бензин платят один раз, а не в каждой стороне).
 */
@Entity('trip_transfer_legs')
@Index('UQ_trip_transfer_legs_trip', ['tripId', 'id'], { unique: true })
@Index('IDX_trip_transfer_legs_order', ['tripId', 'direction', 'position', 'id'])
@Check(
  'chk_trip_transfer_legs_direction',
  `"direction" IN (${sqlValues(TRANSFER_DIRECTIONS)})`,
)
@Check('chk_trip_transfer_legs_mode', `"mode" IN (${sqlValues(TRANSFER_MODES)})`)
@Check('chk_trip_transfer_legs_position', '"position" >= 1')
@Check(
  'chk_trip_transfer_legs_compensation',
  `"compensation" IN (${sqlValues(TRANSFER_COMPENSATIONS)})`,
)
@Check(
  'chk_trip_transfer_legs_own',
  `"is_own_vehicle" = ("owner_user_id" IS NOT NULL)`,
)
@Check(
  'chk_trip_transfer_legs_own_mode',
  `"is_own_vehicle" = false OR "mode" IN (${sqlValues(TRANSFER_PERSONAL_MODES)})`,
)
@Check(
  'chk_trip_transfer_legs_ticket',
  `"compensation" <> 'ticket' OR "mode" IN (${sqlValues(TRANSFER_PUBLIC_MODES)})`,
)
@Check(
  'chk_trip_transfer_legs_shared',
  `"compensation" NOT IN ('shared', 'sharedPerPassenger') OR "mode" NOT IN (${sqlValues(TRANSFER_PUBLIC_MODES)})`,
)
@Check(
  'chk_trip_transfer_legs_round_trip',
  `"is_round_trip" = false OR "compensation" IN ('shared', 'sharedPerPassenger')`,
)
@Check('chk_trip_transfer_legs_seats', '"seats" IS NULL OR "seats" > 0')
@Check(
  'chk_trip_transfer_legs_amount',
  '"compensation_amount_rub" IS NULL OR "compensation_amount_rub" >= 0',
)
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

  /** `there` — туда, `back` — обратно: две области подготовки. */
  @Column({ type: 'varchar', length: 10 })
  direction: TransferDirection;

  /** Порядок внутри стороны: «сначала машины, потом автобус». */
  @Column({ type: 'int', default: 1 })
  position: number;

  /** Время отправления — обязательное. */
  @Column({ name: 'departs_at', type: 'timestamptz' })
  departsAt: Date;

  @Column({ name: 'from_place', type: 'varchar', length: 200 })
  fromPlace: string;

  @Column({ name: 'to_place', type: 'varchar', length: 200 })
  toPlace: string;

  /** Способ доставки: `car`, `bus`, `train`, `horses`, `atv`, `boat`, её… */
  @Column({ type: 'varchar', length: 20 })
  mode: TransferMode;

  /** «Наше ТС»: транспорт группы, а не рейс. */
  @Column({ name: 'is_own_vehicle', type: 'boolean', default: false })
  isOwnVehicle: boolean;

  /** Владелец ТС — участник похода; `NULL` у рейса. */
  @Column({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId: string | null;

  /**
   * Владелец ТС. `CASCADE`: уходит из состава — уходит со своим транспортом
   * (`gear-distribution.md` §6.1), пассажиры при этом не теряются — карточка
   * уходит целиком, потому что уехать ею больше некому.
   */
  @ManyToOne(() => TripParticipant, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn([
    {
      name: 'trip_id',
      referencedColumnName: 'tripId',
      foreignKeyConstraintName: 'FK_trip_transfer_legs_owner',
    },
    { name: 'owner_user_id', referencedColumnName: 'userId' },
  ])
  owner: TripParticipant | null;

  /** Всего мест, включая водителя; `NULL` — не указано, потолка нет. */
  @Column({ type: 'int', nullable: true })
  seats: number | null;

  /** `free` | `ticket` | `shared` | `sharedPerPassenger`. */
  @Column({ type: 'varchar', length: 20, default: 'free' })
  compensation: TransferCompensation;

  /** Сумма компенсации в рублях; у «безвозмездно» — `NULL`. */
  @Column({ name: 'compensation_amount_rub', type: 'int', nullable: true })
  compensationAmountRub: number | null;

  /** «Туда-обратно» — только у общих расходов. */
  @Column({ name: 'is_round_trip', type: 'boolean', default: false })
  isRoundTrip: boolean;

  /** «Сбор у первой платформы, выезжаем в восемь». */
  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
