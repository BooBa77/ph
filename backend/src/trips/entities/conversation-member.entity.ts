import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';
import { Conversation } from './conversation.entity';

/**
 * Участник диалога — и заодно его читательское состояние.
 *
 * У личного диалога состав — это и есть доступ: двое участников, и больше
 * никого. У чата похода состав **не** определяет доступ (его считает
 * приложение по видимости похода и составу похода), поэтому строки здесь
 * появляются лениво — когда человек впервые открыл чат или отметил его
 * прочитанным. Придумывать строку «на всякий случай» каждому участнику
 * каждого чата значит держать таблицу, которая врёт: человек мог ни разу
 * чат не открыть.
 *
 * `last_read_at` — единственное, что нужно для счётчика непрочитанного:
 * «сколько сообщений в диалоге новее моего last_read_at и не мои».
 * Хранить счётчик числом нельзя — он начнёт расходиться с сообщениями
 * при первой же правке или удалении.
 *
 * `ON DELETE RESTRICT` на пользователя согласован с остальным проектом:
 * пользователи физически не удаляются (soft delete).
 */
@Entity('conversation_members')
@Index('IDX_conversation_members_user', ['userId'])
export class ConversationMember {
  @PrimaryColumn({ name: 'conversation_id', type: 'bigint' })
  conversationId: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id', foreignKeyConstraintName: 'FK_conversation_members_conversation' })
  conversation: Conversation;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_conversation_members_user' })
  user: User;

  /** Когда человек последний раз читал диалог. NULL — не открывал. */
  @Column({ name: 'last_read_at', type: 'timestamptz', nullable: true })
  lastReadAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
