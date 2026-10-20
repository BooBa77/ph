import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';
import { Conversation } from './conversation.entity';

/**
 * Сообщение диалога — походного чата или личного, без разницы.
 *
 * `sender_id IS NULL` — **системное сообщение**, и отдельного флага
 * `is_system` для этого нет: само отсутствие автора уже всё говорит,
 * а флаг пришлось бы держать согласованным с `sender_id`. Приложение
 * рендерит такие сообщения особым стилем.
 *
 * Системные сообщения — это история событий: заявки и их отклонение
 * в гостевом чате, отказы, отзывы приглашений и смены статусов в чате
 * участников, «Алиса подтвердила перевод» в личных денежных делах. Поэтому
 * у `trip_membership_requests` нет статуса — его роль играет переписка.
 *
 * `body` — markdown (GFM) с обязательным санитайзом при рендере: XSS
 * здесь был бы не теоретическим — сообщения видны другим людям. Санитайз
 * делается на рендере, в базе лежит исходный текст.
 *
 * Составной индекс `(conversation_id, created_at)` — это порядок выдачи
 * сообщений, он же курсор для подгрузки истории. Он же покрывает выборку
 * «последнее сообщение диалога».
 */
@Entity('messages')
@Index('IDX_messages_conversation_created', ['conversationId', 'createdAt'])
export class Message {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'conversation_id', type: 'bigint' })
  conversationId: string;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id', foreignKeyConstraintName: 'FK_messages_conversation' })
  conversation: Conversation;

  @Column({ name: 'sender_id', type: 'uuid', nullable: true })
  senderId: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'sender_id', foreignKeyConstraintName: 'FK_messages_sender' })
  sender: User | null;

  @Column({ type: 'text' })
  body: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
