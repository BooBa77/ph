import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { User } from '../../users/entities/user.entity';

/** Статусы запроса на новую иконку. */
export type ActivityRequestStatus = 'pending' | 'approved' | 'rejected' | 'revision';

/**
 * Запрос пользователя на новую активность с иконкой.
 *
 * Пользователь просит у системы, а не создаёт личное: одобренная иконка
 * становится доступна всем, поэтому запрос живёт отдельно от типов, а тип
 * появляется только после одобрения.
 *
 * `revision` — «на доработку»: админ посмотрел вариант иконки и хочет
 * другой. Комментарий админа лежит рядом, чтобы было понятно, чего хотят.
 *
 * Уведомления запросившего пока нет: будет внутренняя система сообщений,
 * и отправлять письма через SMTP ради этого не стоит.
 */
@Entity('calendar_activity_type_requests')
@Check(
  'chk_activity_request_status',
  `"status" IN ('pending', 'approved', 'rejected', 'revision')`,
)
export class CalendarActivityTypeRequest {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Как пользователь назвал активность: «борда», «сап». */
  @Column({ type: 'varchar', length: 100 })
  label: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: ActivityRequestStatus;

  /** Что не так или что поправить: пишет админ. */
  @Column({ name: 'admin_comment', type: 'varchar', length: 500, nullable: true })
  adminComment: string | null;
}
