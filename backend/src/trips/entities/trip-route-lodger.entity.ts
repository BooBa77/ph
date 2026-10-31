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
import { TripGear } from '../../gear/entities/trip-gear.entity';
import { TripParticipant } from './trip-participant.entity';
import {
  ROUTE_LODGER_STATUSES,
  type RouteLodgerStatus,
} from '../trip-route.types';

/**
 * Кто где живёт — **один раз на весь поход**, а не по ночам.
 *
 * Ответ заказчика 31.10.2026: «палатка у человека одна на весь поход».
 * Поэтому строка — это «Пётр живёт в палатке Анны», без ссылки на ночь:
 * таблица ночёвок лишь показывает это по каждой ночи, а меняется
 * распределение в одном месте. Отсюда `UNIQUE (trip_id, user_id)`:
 * у человека одно место на поход, и «переезд» — это правка той же строки,
 * а не вторая запись.
 *
 * **Ссылка на снаряжение похода, а не на вариант ночи.** Палатка Васи
 * может стоять в трёх ночах — это одна и та же палатка, и люди в ней те же.
 * Ссылайся строка на вариант, пришлось бы держать три копии распределения
 * и синхронизировать их.
 *
 * **Заявка и согласие.** В чужую палатку не садятся молча (как и в чужое
 * ТС в «Трансфере»): `requested` — попросился, `accepted` — хозяин
 * согласился или человек сел сам в свою палатку, либо его посадил тот,
 * кто ведёт вкладку.
 *
 * **Оба внешних ключа составные** (`trip_id` в каждой паре): ушёл человек
 * из состава — ушло его место; палатку убрали из похода — место исчезло
 * вместе с ней (ночной вариант при этом уходит отдельным каскадом).
 */
@Entity('trip_route_lodgers')
@Index('UQ_trip_route_lodgers_person', ['tripId', 'userId'], { unique: true })
@Index('IDX_trip_route_lodgers_tent', ['tripId', 'tentGearId'])
@Check(
  'chk_trip_route_lodgers_status',
  `"status" IN (${sqlValues(ROUTE_LODGER_STATUSES)})`,
)
export class TripRouteLodger {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  /** Кто живёт — участник этого похода. */
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => TripParticipant, { onDelete: 'CASCADE' })
  @JoinColumn([
    {
      name: 'trip_id',
      referencedColumnName: 'tripId',
      foreignKeyConstraintName: 'FK_trip_route_lodgers_member',
    },
    { name: 'user_id', referencedColumnName: 'userId' },
  ])
  member: TripParticipant;

  /** В какой палатке живёт — вещь из снаряжения этого же похода. */
  @Column({ name: 'tent_gear_id', type: 'bigint' })
  tentGearId: string;

  @ManyToOne(() => TripGear, { onDelete: 'CASCADE' })
  @JoinColumn([
    {
      name: 'trip_id',
      referencedColumnName: 'tripId',
      foreignKeyConstraintName: 'FK_trip_route_lodgers_tent',
    },
    { name: 'tent_gear_id', referencedColumnName: 'id' },
  ])
  tentGear: TripGear;

  /** `requested` | `accepted`. */
  @Column({ type: 'varchar', length: 20, default: 'accepted' })
  status: RouteLodgerStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
