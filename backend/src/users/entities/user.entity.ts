import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Check,
} from 'typeorm';

import type { CalendarMode } from '../../calendar/calendar.types';

/**
 * Пользователь — доменная сущность.
 * Данные для входа хранятся отдельно в auth_identities.
 *
 * Профиль намеренно минимальный: только displayName (единственное «имя»)
 * и location (город). Историю смены displayName см. в display_name_history.
 */
@Entity('users')
@Check(
  'chk_users_calendar_mode',
  `"calendar_mode" IN ('cycle', 'free', 'study', 'parental', 'retired')`,
)
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Единственное отображаемое имя. Заполняется при регистрации
   * из email (см. AuthService.displayNameFromEmail), потом можно менять.
   * Очистить нельзя — NOT NULL + валидация на DTO.
   */
  @Column({ name: 'display_name', type: 'varchar', length: 50 })
  displayName: string;

  /** Место проживания. Строкой, без геокоординат (пока). */
  @Column({ type: 'varchar', length: 100, nullable: true })
  location: string | null;

  @Column({ name: 'avatar_url', type: 'varchar', length: 255, nullable: true })
  avatarUrl: string | null;

  /**
   * Режим работы для календаря: cycle | free | study | parental | retired.
   *
   * NULL — пользователя ещё не спрашивали (персонального календаря нет).
   * Отдельной таблицы лет отказались: заполненность года видна по строкам
   * в calendar_production, а вопрос про следующий год строится из этого
   * значения. Показывать ли кнопку «Производственный календарь» — тоже
   * решается по нему (cycle или study).
   */
  @Column({ name: 'calendar_mode', type: 'varchar', length: 20, nullable: true })
  calendarMode: CalendarMode | null;

  /**
   * Soft delete. NULL — активен. Дата — удалён (не показывается в поиске,
   * но профиль доступен по ссылке, и юзер может залогиниться обратно).
   */
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}