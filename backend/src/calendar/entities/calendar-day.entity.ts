import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';
import type { CalendarDayType } from '../calendar.types';

/**
 * Персональный календарь пользователя: 365 строк на год.
 *
 * Заполняется при первом обращении к году: копией шаблона
 * (`calendar_state_production`), сплошными выходными или учебным
 * календарём — смотря какой режим выбрал пользователь. Дальше это его
 * календарь: метки, отпуска, дни рождения правятся здесь и больше нигде.
 *
 * Составной первичный ключ вместо суррогатного `id`: уникальность
 * «пользователь + дата» и так обязательна, а лишняя колонка с отдельной
 * последовательностью ничего не добавляет — ссылаться на строку дня
 * из других таблиц мы не собираемся.
 */
@Entity('calendar_production')
@Check(
  'chk_calendar_day_type',
  `"day_type" IN ('workday', 'weekend', 'short_workday')`,
)
export class CalendarDay {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** Дата по локальному календарю пользователя, без времени и пояса. */
  @PrimaryColumn({ type: 'date' })
  date: string;

  @Column({ name: 'day_type', type: 'varchar', length: 20 })
  dayType: CalendarDayType;

  /** «Понедельник», «Новый год», «ДР Любы» — что угодно, правит пользователь. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  label: string | null;

  /**
   * Заметки дня: личная и «поделиться».
   *
   * Живут здесь, а не в отдельной таблице: одна строка на день, и всё про
   * день в одном месте — статус, метка, заметки. Сохранение обоих полей
   * атомарно, JOIN не нужен, а длина строки с двумя NULL почти ничего
   * не стоит.
   *
   * `note_public` — задел: показывать чужие календари приложение ещё
   * не умеет, но поле есть с самого начала, чтобы потом не перекраивать.
   */
  @Column({ name: 'note_public', type: 'text', nullable: true })
  notePublic: string | null;

  @Column({ name: 'note_personal', type: 'text', nullable: true })
  notePersonal: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
