import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { User } from '../../users/entities/user.entity';
import { CalendarActivityType } from './activity-type.entity';

/**
 * Избранное: что пользователь отмечает чаще всего.
 *
 * Отдельная таблица, а не расчёт по `calendar_activities`, потому что счёт
 * должен переживать удаление отметок: поставил «бег» сто раз, убрал одну —
 * счёт 99, и «бег» по-прежнему в избранном. Отсюда и `usage_count--` при
 * отмене: счёт отражает привычку, а не текущее состояние дней.
 *
 * Сортировка закладки «Избранное» — по `usage_count`, без времени: таймстемпы
 * нам не нужны.
 */
@Entity('calendar_activity_favorites')
export class CalendarActivityFavorite {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @PrimaryColumn({ name: 'activity_type_id' })
  activityTypeId: number;

  @Column({ name: 'usage_count', type: 'int', default: 0 })
  usageCount: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => CalendarActivityType, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'activity_type_id' })
  activityType: CalendarActivityType;
}
