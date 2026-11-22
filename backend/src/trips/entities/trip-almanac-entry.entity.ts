import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';
import { MAX_DIARY_BODY_LENGTH } from '../trip-diary.types';
import { Trip } from './trip.entity';

/**
 * Место воспоминания в альманахе (22.11.2026).
 *
 * - `before` — «до похода»: после допоходных записей дневников, перед первым
 *   днём;
 * - `day` — конкретный день похода (`day_index`), после дневников этого дня
 *   и других воспоминаний;
 * - `after` — «без указания дня»: итоговое воспоминание в самом конце.
 */
export type AlmanacPlacement = 'before' | 'day' | 'after';

/**
 * Воспоминание участника в альманахе похода (22.11.2026).
 *
 * Заказчик: «Участникам в альманахе можно выбирать место вставки
 * воспоминания — день похода (номер, не дата), до похода, без указания дня»;
 * «на каждый день отводим одну запись участнику, после создания он может её
 * редактировать/дописывать, положение её после редактирования не изменяется»;
 * «запись создаётся/редактируется инструментом-чатом, календарик и указание
 * дня в нём не нужны».
 *
 * Отсюда устройство:
 *
 * - **Место вставки — свойство строки, а не вычисляется.** Номер дня
 *   выбирает автор, и после правки он не пересчитывается: «положение
 *   после редактирования не изменяется».
 * - **Один слот — одна запись.** `UNIQUE (trip_id, user_id, placement,
 *   day_index)`; для «до похода» и «итогового» слот тоже один, `day_index = 0`.
 *   Повторная вставка упирается в базу, а не в проверку в коде.
 * - **`day_index = 0` вместо `NULL`.** Postgres не считает NULL-ы равными
 *   в `UNIQUE`, и две строки «без дня» прошли бы проверку. Ноль — честный
 *   «слот без дня» `[chk_trip_almanac_entries_day]`.
 * - **Текст — markdown**, тот же редактор, что у чатов и дневника.
 * - **Удаляет только организатор** (решение заказчика 22.11.2026),
 *   и удаление строки освобождает слот: участник может написать заново.
 *
 * Жёсткого удаления админом записи из дневника здесь нет: дневниковая
 * строка в альманахе — это та же запись дневника с пометкой, и «удалить»
 * для неё значит снять пометку (`trip_diary_entries.shared_with_trip`),
 * а не стереть личный текст.
 */
@Entity('trip_almanac_entries')
@Index('IDX_trip_almanac_entries_trip', ['tripId', 'createdAt'])
@Index('UQ_trip_almanac_entries_slot', ['tripId', 'userId', 'placement', 'dayIndex'], {
  unique: true,
})
@Check(
  'chk_trip_almanac_entries_placement',
  `"placement" IN ('before', 'day', 'after')`,
)
@Check(
  'chk_trip_almanac_entries_day',
  `("placement" = 'day' AND "day_index" >= 1)
   OR ("placement" <> 'day' AND "day_index" = 0)`,
)
@Check(
  'chk_trip_almanac_entries_body',
  `char_length(btrim("body")) BETWEEN 1 AND ${MAX_DIARY_BODY_LENGTH}`,
)
export class TripAlmanacEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  @ManyToOne(() => Trip, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'trip_id',
    foreignKeyConstraintName: 'FK_trip_almanac_entries_trip',
  })
  trip: Trip;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_trip_almanac_entries_user',
  })
  user: User;

  @Column({ type: 'varchar', length: 10 })
  placement: AlmanacPlacement;

  /** Номер дня похода; `0` — воспоминание без дня (до или после похода). */
  @Column({ name: 'day_index', type: 'smallint', default: 0 })
  dayIndex: number;

  @Column({ type: 'text' })
  body: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
