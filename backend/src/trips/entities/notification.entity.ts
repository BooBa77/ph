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
import { Conversation } from './conversation.entity';
import { TripCompensation } from './trip-compensation.entity';
import { Trip } from './trip.entity';

/**
 * Виды уведомлений (24.11.2026, §14 `messages.md`).
 *
 * Пять штук — ровно то, что заказчик назвал в правой панели: деньги,
 * альманах, чаты похода и личные сообщения. `kind` без CHECK в базе?
 * Нет — здесь CHECK есть: вид уведомления определяет и раздел, и набор
 * кнопок, и клиент не должен получать незнакомый вид молча. Новый вид —
 * строка в этом списке и миграция на CHECK, это осознанный шаг.
 */
export const NOTIFICATION_KINDS = [
  'money_transfer',
  'payment_request',
  'almanac',
  'trip_chat',
  'direct_chat',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Разделы панели: системные уведомления и личные сообщения. */
export const NOTIFICATION_SECTIONS = ['system', 'personal'] as const;

export type NotificationSection = (typeof NOTIFICATION_SECTIONS)[number];

/**
 * Почему денежное уведомление ушло в архив.
 *
 * «ОК» сюда не относится: чат и альманах закрываются **удалением** без
 * архива, поэтому причина есть только у денег. `confirmed` — подтвердил
 * человек, `expired72` — сработало автосогласие, `paid` — долг закрыт
 * оплатой (запрос платежа).
 */
export const ARCHIVE_REASONS = ['confirmed', 'expired72', 'paid'] as const;

export type ArchiveReason = (typeof ARCHIVE_REASONS)[number];

/**
 * Уведомление — **не сообщение** (24.11.2026).
 *
 * Заказчик пересмотрел правую колонку: там должны быть уведомления, а не
 * лента диалогов. Уведомление создаёт только система; у него есть тип,
 * заголовок, текст и свой набор кнопок. Личное сообщение уведомлением
 * не является, но новое сообщение в чате порождает карточку «об этом чате».
 *
 * **Почему отдельная таблица, а не `messages`.** У сообщения автор, у
 * уведомления — тип и кнопки; у сообщения есть история и листание, у
 * карточки — состояние «активно / закрыто / в архиве». Смешать их значило
 * бы добавить в `messages` полдесятка колонок, которые к переписке
 * не относятся, и продолжать считать уведомления сообщениями в счётчиках.
 * Поэтому `messages` не меняется вовсе (§14.1 п.6 решения заказчика).
 *
 * **Дедупликация — ключом.** Одно и то же — одна карточка: новое сообщение
 * обновляет существующую, второй не заводит. Ключи: `trip_chat:<диалог>`,
 * `direct_chat:<диалог>`, `almanac:<поход>`, `money_transfer:<перевод>`,
 * `payment_request:<поход>`. Уникальность — `(recipient_user_id, dedup_key)`:
 * у двух получателей один перевод — две карточки, и это правильно.
 *
 * **Закрытие и архив — разные вещи.** «ОК» у чата и альманаха удаляет
 * строку: истории не нужно, следующее сообщение создаст карточку заново.
 * Деньги удалять нельзя: заказчик подтвердил, что они хранятся в архиве
 * (`archived_at` + причина), даже когда экрана архива ещё нет.
 *
 * **Ссылки — колонками, а не jsonb.** По ним идут выборки («закрыть
 * уведомление диалога», «архивировать перевод»), и jsonb-путь в WHERE
 * означал бы скан таблицы на каждое действие. `ON DELETE CASCADE`:
 * ушёл диалог или удалили отменённый перевод — карточке жить не с чем.
 */
@Entity('notifications')
@Index('UQ_notifications_recipient_dedup', ['recipientUserId', 'dedupKey'], {
  unique: true,
})
@Index('IDX_notifications_recipient_active', ['recipientUserId', 'archivedAt'])
@Check(
  'chk_notifications_kind',
  `"kind" IN ('money_transfer', 'payment_request', 'almanac', 'trip_chat', 'direct_chat')`,
)
@Check(
  'chk_notifications_archive',
  `("archived_at" IS NULL) = ("archived_reason" IS NULL)
   AND ("archived_reason" IS NULL OR "archived_reason" IN ('confirmed', 'expired72', 'paid'))`,
)
export class Notification {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  /** Кому показывать карточку. Уведомление видит только получатель. */
  @Column({ name: 'recipient_user_id', type: 'uuid' })
  recipientUserId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'recipient_user_id',
    foreignKeyConstraintName: 'FK_notifications_recipient',
  })
  recipientUser: User;

  @Column({ type: 'varchar', length: 30 })
  kind: NotificationKind;

  /** Заголовок карточки: «Денежный перевод», «Чат табора «…»». */
  @Column({ type: 'varchar', length: 200 })
  title: string;

  /** Текст карточки; у чатов — последнее сообщение, обрезанное до 300. */
  @Column({ type: 'text' })
  body: string;

  /** Ключ дедупликации, см. описание класса. */
  @Column({ name: 'dedup_key', type: 'varchar', length: 120 })
  dedupKey: string;

  @Column({ name: 'conversation_id', type: 'bigint', nullable: true })
  conversationId: string | null;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({
    name: 'conversation_id',
    foreignKeyConstraintName: 'FK_notifications_conversation',
  })
  conversation: Conversation | null;

  @Column({ name: 'trip_id', type: 'bigint', nullable: true })
  tripId: string | null;

  @ManyToOne(() => Trip, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({
    name: 'trip_id',
    foreignKeyConstraintName: 'FK_notifications_trip',
  })
  trip: Trip | null;

  /** Перевод, который ждёт подтверждения: за ним стоит компенсация. */
  @Column({ name: 'compensation_id', type: 'bigint', nullable: true })
  compensationId: string | null;

  @ManyToOne(() => TripCompensation, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({
    name: 'compensation_id',
    foreignKeyConstraintName: 'FK_notifications_compensation',
  })
  compensation: TripCompensation | null;

  /**
   * Момент архивации. NULL — карточка активна.
   *
   * Чаты и альманах сюда не попадают: их закрытие — удаление строки,
   * поэтому «архив» есть только у денег (§14.2).
   */
  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @Column({ name: 'archived_reason', type: 'varchar', length: 20, nullable: true })
  archivedReason: ArchiveReason | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
