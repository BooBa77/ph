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
import { Vehicle } from './vehicle.entity';
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
 * у своего транспорта — только общие расходы.
 *
 * **Заброска — это `is_stage`** (28.10.2026). «Этап — это рейс, заброска,
 * одна карточка, а не группа»: заказчику нужен не список цепочек, а три
 * простых списка — рейсы туда, заброски, рейсы обратно. Поэтому у строки
 * один флаг, и он отвечает только за то, в какой секции она показывается.
 * Права, пассажиры, места и деньги у этапа те же, что у любого рейса.
 *
 * **`is_round_trip` ни к чему не привязан** (28.10.2026): это планирование —
 * «вернёмся тем же способом», а не вид оплаты. У общественного транспорта
 * билеты стоят на обеих карточках и могут отличаться по цене.
 */
@Entity('trip_transfer_legs')
@Index('UQ_trip_transfer_legs_trip', ['tripId', 'id'], { unique: true })
@Index('IDX_trip_transfer_legs_order', ['tripId', 'direction', 'position', 'id'])
@Index('IDX_trip_transfer_legs_vehicle', ['vehicleId'])
@Index('IDX_trip_transfer_legs_round_trip', ['roundTripSourceId'])
@Index('IDX_trip_transfer_legs_stage', ['tripId', 'isStage'])
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

  /**
   * Этап заброски — та же строка, только в своей секции.
   *
   * «Этап — это рейс, заброска, одна карточка, а не группа» (заказчик
   * 28.10.2026). Поэтому никаких цепочек и номеров: флаг отвечает ровно
   * за одно — показывать строку в «Заброске» или среди обычных рейсов.
   */
  @Column({ name: 'is_stage', type: 'boolean', default: false })
  isStage: boolean;

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

  /**
   * Транспорт из каталога участника (`vehicles`). Выбрали из списка —
   * способ, места и владелец берутся оттуда, а не заполняются заново.
   * `RESTRICT`: транспорт, который едет в походе, из каталога не удаляют.
   */
  @Column({ name: 'vehicle_id', type: 'bigint', nullable: true })
  vehicleId: string | null;

  @ManyToOne(() => Vehicle, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({
    name: 'vehicle_id',
    foreignKeyConstraintName: 'FK_trip_transfer_legs_vehicle',
  })
  vehicle: Vehicle | null;

  /**
   * Исходная карточка пары «туда-обратно». NULL — карточка живёт сама;
   * заполнено — это зеркало.
   *
   * **Состав пассажиров у пары не обязан совпадать** (уточнение заказчика
   * 28.10.2026): на обратном рейсе можно менять людей, и на прямой рейс это
   * не влияет. Общее у пары — создание (пассажиры копируются), оплата
   * (задаётся на исходной) и одно правило ухода: ушёл из исходной — ушёл
   * и из зеркала. Точки маршрута у зеркала тоже правятся свободно.
   */
  @Column({ name: 'round_trip_source_id', type: 'bigint', nullable: true })
  roundTripSourceId: string | null;

  @ManyToOne(() => TripTransferLeg, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({
    name: 'round_trip_source_id',
    foreignKeyConstraintName: 'FK_trip_transfer_legs_round_trip',
  })
  roundTripSource: TripTransferLeg | null;

  /** `free` | `ticket` | `shared` | `sharedPerPassenger`. */
  @Column({ type: 'varchar', length: 20, default: 'free' })
  compensation: TransferCompensation;

  /** Сумма компенсации в рублях; у «безвозмездно» — `NULL`. */
  @Column({ name: 'compensation_amount_rub', type: 'int', nullable: true })
  compensationAmountRub: number | null;

  /**
   * «Туда-обратно»: карточка — начало пары, зеркало встанет в другую сторону.
   *
   * **Не бывает у общественного транспорта** (уточнение заказчика
   * 28.10.2026): билеты на автобус, ж/д, корабль и вертолёт покупают
   * раздельно в каждую сторону. У своего и наёмного транспорта пара есть —
   * бензин и аренда платятся «за два конца». От вида компенсации флаг
   * при этом не зависит.
   *
   * Ставится только на исходной карточке: у зеркала флаг всегда `false`,
   * и включать его там нельзя — иначе пара зеркалилась бы второй раз.
   */
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
