import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { CalendarActivityGroup } from './activity-group.entity';

/**
 * Тип активности: «бег», «велик», «командировка», «пьянка».
 *
 * `icon` — ключ иконки из файла в коде фронтенда (`activity-icons.ts`),
 * а не картинка: иконки приезжают деплоем, поэтому в базе только имя.
 * Неизвестный ключ фронт рисует заглушкой, а не пустотой.
 *
 * `isActive` — та же замена удалению, что и у производственного календаря:
 * тип, который перестал быть нужен, гасим, а не удаляем (на него ссылаются
 * отметки пользователей, а ON DELETE RESTRICT не даст удалить).
 *
 * Новые типы пользователь не создаёт: он просит иконку, а её одобряет
 * админ — и тогда тип становится доступен всем.
 */
@Entity('calendar_activity_types')
export class CalendarActivityType {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 50, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 100 })
  label: string;

  @Column({ name: 'group_id' })
  groupId: number;

  @ManyToOne(() => CalendarActivityGroup, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'group_id' })
  group: CalendarActivityGroup;

  /** Ключ иконки: 'run', 'bike', 'sick'. */
  @Column({ type: 'varchar', length: 50 })
  icon: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;
}
