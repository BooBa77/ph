import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Trip } from './trip.entity';

/**
 * Чат похода — сущность, а не строка в походе.
 *
 * Взвешивали два варианта. Строкой (`trips.guest_chat_id` и
 * `trips.members_chat_id`) дешевле, но тогда внешнего ключа на чат из
 * сообщений нет, опечатки в id ничем не ловятся, а удаление похода надо
 * чистить руками. Поэтому таблица: сообщения ссылаются на `chat_id`
 * честным внешним ключом, а новые чаты (снаряжение, бюджет, темы) —
 * это новые строки, а не новые колонки в `trips`.
 *
 * `kind` — текст без CHECK: новый вид чата не должен требовать миграции.
 * `trip_id` nullable — на будущее, для чатов вне похода; сейчас не
 * используется, и именно из-за его nullable уникальность частичная.
 *
 * **Отдельного индекса по `trip_id` нет намеренно.** Частичный уникальный
 * индекс `(trip_id, kind) WHERE trip_id IS NOT NULL` уже даёт префикс по
 * `trip_id`, а второй индекс на то же самое — лишняя запись при каждой
 * вставке. Ровно такие дубли вычищали в календаре.
 *
 * Оба чата (`trip_guest`, `trip_members`) создаются сразу при создании
 * похода, в одной транзакции с ним, даже для приватного: существование
 * чата и доступ к нему — разные вопросы. Кто в каком чате читает и пишет,
 * решает приложение по текущей видимости похода.
 */
@Entity('chats')
@Index('UQ_chats_trip_kind', ['tripId', 'kind'], {
  unique: true,
  where: '"trip_id" IS NOT NULL',
})
export class Chat {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  /** 'trip_guest' | 'trip_members' — без CHECK, см. описание класса. */
  @Column({ type: 'varchar', length: 30 })
  kind: string;

  @Column({ name: 'trip_id', type: 'bigint', nullable: true })
  tripId: string | null;

  @ManyToOne(() => Trip, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'trip_id' })
  trip: Trip | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
