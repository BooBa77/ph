import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { User } from '../../users/entities/user.entity';
import { CalendarActivityType } from './activity-type.entity';

/**
 * Отметка активности на дне: «в этот день был бег».
 *
 * Составной первичный ключ `(user_id, date, activity_type_id)` — это и есть
 * уникальность «одна отметка на тип в день», а заодно индекс для выборки
 * активностей за диапазон дат (запрос идёт по префиксу `user_id, date`).
 *
 * Никаких `note` и `privacy`: заметки переехали в `calendar_production`
 * (две колонки на день), а приватность у заметки своя. Здесь только факт
 * отметки.
 *
 * Отметки разных лет у одного пользователя не пересекаются: дата — обычная
 * `date`, без часового пояса.
 */
@Entity('calendar_activities')
export class CalendarActivity {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @PrimaryColumn({ type: 'date' })
  date: string;

  @PrimaryColumn({ name: 'activity_type_id' })
  activityTypeId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => CalendarActivityType, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'activity_type_id' })
  activityType: CalendarActivityType;
}
