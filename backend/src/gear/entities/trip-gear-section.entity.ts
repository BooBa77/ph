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

import { User } from '../../users/entities/user.entity';
import { Trip } from '../../trips/entities/trip.entity';
import type { TripGearSectionScope } from '../trip-gear.types';

/**
 * Раздел внутри «Берём» или «Взял» (05.11.2026).
 *
 * Заказчик: «в секциях „Берём“ и „Взял“ … возможность создавать
 * (редактировать и удалять) разделы, типа „Альпинизм“, „Пешка“, а какие-то
 * даже шаблонами встают, например, „Табор“, если есть ночёвки и/или
 * Готовка».
 *
 * **Общественный и личный раздел — одна таблица.** Отличие только
 * в владельце, а поля те же: название, порядок, родитель. `scope`
 * и `owner_user_id` вместе отвечают, кому раздел виден и кто его правит:
 *
 * - `shared` — раздел похода, владельца нет, видит весь состав;
 * - `personal` — раздел человека в «Взял», владелец обязателен, остальным
 *   он не виден вовсе (не «виден без кнопок», а не приходит в ответе).
 *
 * CHECK `chk_trip_gear_sections_scope` держит эту пару в согласии: раздел
 * без владельца и личный раздел без владельца — разные вещи, и перепутать
 * их молча нельзя.
 *
 * **Вложенность — `parent_id` на себя.** Глубина не ограничена: «Альпинизм»
 * → «Верёвки» — обычный случай. Цикл ловит сервис (SQL-ом цепочку
 * не проверить); родитель обязан быть из того же похода, того же вида
 * и с тем же владельцем.
 *
 * **Удаление не теряет вещи.** `trip_gear.shared_section_id` и
 * `personal_section_id` ссылаются сюда с `ON DELETE SET NULL`, а дочерние
 * разделы уходят каскадом: вещи удалённого раздела оказываются в корне
 * своей большой секции — ровно то, что просил заказчик.
 *
 * **Шаблоны — обычные строки.** Отметка «уже засеяли» лежит не здесь,
 * а в `trips.gear_sections_seeded_at` / `trip_participants…`: удалённый
 * шаблон не должен возвращаться при следующем открытии вкладки.
 */
@Entity('trip_gear_sections')
@Index('UQ_trip_gear_sections_trip_id', ['tripId', 'id'], { unique: true })
@Index('IDX_trip_gear_sections_owner', ['ownerUserId'])
@Index('IDX_trip_gear_sections_parent', ['parentId'])
@Check(
  'chk_trip_gear_sections_scope',
  `("scope" = 'shared' AND "owner_user_id" IS NULL)
   OR ("scope" = 'personal' AND "owner_user_id" IS NOT NULL)`,
)
@Check(
  'chk_trip_gear_sections_title',
  `char_length(btrim("title")) BETWEEN 1 AND 60`,
)
@Check('chk_trip_gear_sections_order', `"sort_order" >= 0`)
export class TripGearSection {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  @ManyToOne(() => Trip, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'trip_id',
    foreignKeyConstraintName: 'FK_trip_gear_sections_trip',
  })
  trip: Trip;

  /** `shared` | `personal` — см. `TRIP_GEAR_SECTION_SCOPES`. */
  @Column({ type: 'varchar', length: 20 })
  scope: TripGearSectionScope;

  /**
   * Владелец личного раздела. У общественного пуст: раздел принадлежит
   * походу, и «мой общий раздел» — это уже не общий.
   */
  @Column({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({
    name: 'owner_user_id',
    foreignKeyConstraintName: 'FK_trip_gear_sections_owner',
  })
  owner: User | null;

  /** Родительский раздел. `NULL` — корень большой секции. */
  @Column({ name: 'parent_id', type: 'bigint', nullable: true })
  parentId: string | null;

  @ManyToOne(() => TripGearSection, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({
    name: 'parent_id',
    foreignKeyConstraintName: 'FK_trip_gear_sections_parent',
  })
  parent: TripGearSection | null;

  /**
   * Название словами заказчика: «Альпинизм», «Пешка», «Табор».
   * Длина ограничена 60: это заголовок секции, а не абзац.
   */
  @Column({ type: 'varchar', length: 60 })
  title: string;

  /**
   * Порядок среди соседей. Новый раздел встаёт последним (`max + 10`),
   * шаблоны приходят с шагом 10: между ними можно вставить свой, не
   * переписывая остальные.
   */
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
