import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { GearItem } from '../../gear/entities/gear-item.entity';
import { TripParticipant } from './trip-participant.entity';
import { Trip } from './trip.entity';

/**
 * Личная вещь ночёвки: спальник или коврик участника (01.11.2026).
 *
 * **Секция «Спальник» личная.** Заказчик: «У каждого участника своё
 * содержимое» и «спальники виртуальных участников организаторам не
 * показываем, это личное». Поэтому API отдаёт строки **только смотрящему**,
 * а не всей группе: чужих спальников не видит никто, включая организатора.
 *
 * **Вещь — предмет личного каталога, а не строка снаряжения похода.**
 * Заказчик: «выбираем и отображается title… вес в пилюле отображаем».
 * Отсюда ссылка на `gear_items`: название и вес пилюля берёт из каталога,
 * а не из копии в походе. Тип вещи ограничен спальником и ковриком
 * (`SLEEPING_TYPE_CODES`) — проверяет сервис, потому что CHECK на тип
 * потребовал бы join-а, которого в PostgreSQL в CHECK нет.
 *
 * **Сколько угодно.** «Можно добавлять сколько угодно спальников
 * и ковриков» — поэтому нет ни `kind`, ни лимита: одна строка на вещь.
 * `UNIQUE (trip_id, user_id, gear_item_id)` держит только повторное
 * добавление той же вещи.
 *
 * **Ключи.** `(trip_id, user_id)` составной: ушёл человек из состава —
 * ушли его вещи. Вещь удалили из каталога — строка исчезает каскадом,
 * а не остаётся ссылкой в никуда.
 */
@Entity('trip_route_sleeping')
@Index('UQ_trip_route_sleeping_item', ['tripId', 'userId', 'gearItemId'], {
  unique: true,
})
@Index('IDX_trip_route_sleeping_person', ['tripId', 'userId'])
export class TripRouteSleeping {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  @ManyToOne(() => Trip, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'trip_id',
    foreignKeyConstraintName: 'FK_trip_route_sleeping_trip',
  })
  trip: Trip;

  /** Чья вещь. Место жительства тоже висит на составе — здесь то же. */
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => TripParticipant, { onDelete: 'CASCADE' })
  @JoinColumn([
    {
      name: 'trip_id',
      referencedColumnName: 'tripId',
      foreignKeyConstraintName: 'FK_trip_route_sleeping_member',
    },
    { name: 'user_id', referencedColumnName: 'userId' },
  ])
  member: TripParticipant;

  /** Предмет личного каталога: спальник или коврик. */
  @Column({ name: 'gear_item_id', type: 'bigint' })
  gearItemId: string;

  @ManyToOne(() => GearItem, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'gear_item_id',
    foreignKeyConstraintName: 'FK_trip_route_sleeping_gear',
  })
  gearItem: GearItem;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
