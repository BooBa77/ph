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
import { TripParticipant } from '../../trips/entities/trip-participant.entity';
import { GearItem } from './gear-item.entity';
import { TRIP_GEAR_STATUSES, type TripGearStatus } from '../trip-gear.types';

/**
 * Общественное снаряжение похода: «берём эту палатку, едет у Васи».
 *
 * Личный каталог (`gear_items`) отвечает «что у меня есть», эта таблица —
 * «что из этого берём и кто понесёт». Шаги распределения и правила ухода
 * участника описаны в `docs/ph/gear-distribution.md`; здесь — только модель.
 *
 * **Ссылка на предмет каталога, а не копия.** Название, вид и вес читаются
 * из `gear_items`: палатку взвешивают один раз, и в походе она весит
 * столько же. Копия разошлась бы с каталогом после первой правки, а нужен
 * не снимок на момент предложения, а «сколько нести сейчас».
 *
 * **Владелец и назначенный — разные люди.** Правило заказчика: сначала
 * вещь едет в рюкзаке владельца, в чужой попадает только если владелец
 * не тянет. Владелец — владелец предмета в каталоге и в походе не меняется;
 * назначенный — тот, кто несёт, и его меняют перетаскиванием любой участник.
 * `assigned_user_id = NULL` — «нераспределённый», а не «вещи нет».
 *
 * **Оба человека — участники похода** (внешние ключи на пару
 * `(trip_id, user_id)` из `trip_participants`, как у `trip_participant_roles`).
 * Из этого следуют правила §6 без единой строки кода:
 *
 * - убрали человека из состава — его вещи уходят из похода каскадом;
 * - убрали назначенного — вещь остаётся в походе, назначение обнуляется
 *   (`SET NULL` только на `assigned_user_id`, `trip_id` не трогается).
 *
 * Отказ от участия (`declined`) строку участника не удаляет, поэтому вещи
 * отказавшегося так сами не уходят: это шаг «уход участника», он появится
 * вместе с пересборкой вкладки.
 *
 * Уникальность `(trip_id, gear_item_id)`: один предмет каталога — одна
 * строка в походе. Две строки одной палатки — это не две палатки,
 * а непонимание, что её уже взяли.
 */
@Entity('trip_gear')
@Index('UQ_trip_gear_item', ['tripId', 'gearItemId'], { unique: true })
@Index('IDX_trip_gear_trip', ['tripId', 'id'])
@Check(
  'chk_trip_gear_status',
  `"status" IN (${sqlValues(TRIP_GEAR_STATUSES)})`,
)
export class TripGear {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  @Column({ name: 'gear_item_id', type: 'bigint' })
  gearItemId: string;

  /**
   * Предмет каталога. `RESTRICT`: вещь, которая уже едет в походе, нельзя
   * выдернуть из каталога молча — каталог ответит 409 и предложит сначала
   * убрать её из похода.
   */
  @ManyToOne(() => GearItem, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'gear_item_id',
    foreignKeyConstraintName: 'FK_trip_gear_item',
  })
  gearItem: GearItem;

  /** Владелец предмета — участник этого похода. */
  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string;

  @ManyToOne(() => TripParticipant, { onDelete: 'CASCADE' })
  @JoinColumn([
    {
      name: 'trip_id',
      referencedColumnName: 'tripId',
      foreignKeyConstraintName: 'FK_trip_gear_owner',
    },
    { name: 'owner_user_id', referencedColumnName: 'userId' },
  ])
  owner: TripParticipant;

  /** Кто несёт. `NULL` — ещё не распределена. */
  @Column({ name: 'assigned_user_id', type: 'uuid', nullable: true })
  assignedUserId: string | null;

  /**
   * Назначенный — тоже участник похода. `SET NULL` при уходе: вещь
   * остаётся в походе и ждёт нового несущего (правило §6).
   */
  @ManyToOne(() => TripParticipant, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn([
    {
      name: 'trip_id',
      referencedColumnName: 'tripId',
      foreignKeyConstraintName: 'FK_trip_gear_assignee',
    },
    { name: 'assigned_user_id', referencedColumnName: 'userId' },
  ])
  assignee: TripParticipant | null;

  /** `proposed` | `approved` | `declined` — см. `trip-gear.types.ts`. */
  @Column({ type: 'varchar', length: 20, default: 'proposed' })
  status: TripGearStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
