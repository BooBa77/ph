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
import { Chat } from './chat.entity';

/**
 * Сообщение чата похода.
 *
 * `sender_id IS NULL` — **системное сообщение**, и отдельного флага
 * `is_system` для этого нет: само отсутствие автора уже всё говорит,
 * а флаг пришлось бы держать согласованным с `sender_id`. Приложение
 * рендерит такие сообщения особым стилем.
 *
 * Системные сообщения есть в обоих чатах: заявки и их отклонение — в
 * гостевом, отказы, отзывы приглашений и смены статусов — в чате
 * участников. Это и есть история обработки тикетов, поэтому у
 * `trip_membership_requests` нет статуса.
 *
 * `body` — markdown (GFM) с обязательным санитайзом при рендере: XSS
 * здесь был бы не теоретическим — сообщения видны другим людям. Санитайз
 * делается на рендере, в базе лежит исходный текст.
 *
 * Составной индекс `(chat_id, created_at)` — это порядок выдачи сообщений
 * чата, он же курсор для подгрузки истории.
 */
@Entity('group_messages')
@Index('IDX_group_messages_chat_created', ['chatId', 'createdAt'])
export class GroupMessage {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'chat_id', type: 'bigint' })
  chatId: string;

  @ManyToOne(() => Chat, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chat_id' })
  chat: Chat;

  @Column({ name: 'sender_id', type: 'uuid', nullable: true })
  senderId: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'sender_id' })
  sender: User | null;

  @Column({ type: 'text' })
  body: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
