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
import { TripGearSection } from './trip-gear-section.entity';
import { TripParticipant } from '../../trips/entities/trip-participant.entity';
import { Trip } from '../../trips/entities/trip.entity';

/**
 * Личная вещь в разделе «Взял» (06.11.2026).
 *
 * Заказчик: «Личные вещи — это то, что помимо общественного: одежда, каска,
 * трекинговые палочки», и у пилюль «Взял» нужны крестик и кнопки
 * «Добавить снаряжение в этот раздел». Общественное снаряжение живёт
 * в `trip_gear` и едет в «Распределение»; сюда оно попадать не должно,
 * иначе личное снова стало бы общественным — ровно то, что заказчик
 * забраковал 06.11.2026.
 *
 * **Вещь — предмет личного каталога.** Название, тип, вес и характеристики
 * берутся из `gear_items`: вещь взвешивают один раз в каталоге, и в походе
 * она весит столько же. Копий полей нет — одна правда.
 *
 * **Раздел — личный раздел «Взял».** `section_id` с `ON DELETE SET NULL`:
 * удалили раздел — вещь осталась в походе и показалась в корне, как
 * и общественные вещи в «Берём». Триггер в базе проверяет, что раздел
 * принадлежит тому же человеку и тому же походу.
 *
 * **Спальник «Ночёвок» здесь не дублируется.** Он живёт в
 * `trip_route_sleeping` и показывается в «в палатку» отдельными строками:
 * одна вещь — одна таблица, иначе вес задвоился бы.
 */
@Entity('trip_personal_gear')
@Index('UQ_trip_personal_gear_item', ['tripId', 'userId', 'gearItemId'], {
  unique: true,
})
@Index('IDX_trip_personal_gear_person', ['tripId', 'userId'])
@Index('IDX_trip_personal_gear_section', ['sectionId'])
export class TripPersonalGear {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  @ManyToOne(() => Trip, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'trip_id',
    foreignKeyConstraintName: 'FK_trip_personal_gear_trip',
  })
  trip: Trip;

  /** Чья вещь: личные вещи чужим не показываются — правило «Ночёвок». */
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => TripParticipant, { onDelete: 'CASCADE' })
  @JoinColumn([
    {
      name: 'trip_id',
      referencedColumnName: 'tripId',
      foreignKeyConstraintName: 'FK_trip_personal_gear_member',
    },
    { name: 'user_id', referencedColumnName: 'userId' },
  ])
  member: TripParticipant;

  /** Предмет личного каталога: одежда, каска, палки — любая своя вещь. */
  @Column({ name: 'gear_item_id', type: 'bigint' })
  gearItemId: string;

  @ManyToOne(() => GearItem, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'gear_item_id',
    foreignKeyConstraintName: 'FK_trip_personal_gear_item',
  })
  gearItem: GearItem;

  /** Личный раздел «Взял». `null` — корень секции. */
  @Column({ name: 'section_id', type: 'bigint', nullable: true })
  sectionId: string | null;

  @ManyToOne(() => TripGearSection, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'section_id',
    foreignKeyConstraintName: 'FK_trip_personal_gear_section',
  })
  section: TripGearSection | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
