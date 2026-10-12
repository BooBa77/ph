import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { User } from '../../users/entities/user.entity';

/**
 * Администратор.
 *
 * Отдельная таблица, а не флаг у пользователя: ролей в проекте пока нет,
 * и одной колонкой `users.is_admin` мы бы завели роль «наполовину» —
 * без истории и без возможности отозвать доступ, не трогая профиль.
 * Понадобятся роли — вырастет отсюда.
 *
 * Первый админ ставится руками (скриптом заливки), дальше — этой таблицей.
 */
@Entity('admin_users')
export class AdminUser {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
