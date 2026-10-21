import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Check,
  OneToOne,
} from 'typeorm';

import { SportExperience } from './sport-experience.entity';
import type { CalendarMode } from '../../calendar/calendar.types';
import type { UserGender } from '../gender.types';

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
@Check('chk_users_gender', `"gender" IN ('m', 'f')`)
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

  /**
   * Пол: `m` | `f`, по умолчанию `m` (`gender.types.ts`).
   *
   * Нужен распределению веса рюкзака (Ф7, `gear-distribution.md`): доля
   * женщины — 0,8 от мужской. Живёт в профиле, потому что это свойство
   * человека, а не похода, и «в походе» его не меняют.
   *
   * `NOT NULL DEFAULT 'm'`: миграция выдала мужской пол всем, кто был
   * в базе до неё, и распределение работает, не дожидаясь заполнения
   * профилей. В публичный профиль поле **не** попадает — см.
   * `UserPublicProfileDto`.
   */
  @Column({ type: 'varchar', length: 1, default: 'm' })
  gender: UserGender;

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
  @Column({
    name: 'calendar_mode',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  calendarMode: CalendarMode | null;

  /**
   * Пищевое ограничение «вегетарианство».
   *
   * NOT NULL DEFAULT false: «не вегетарианец» и «ещё не отвечал» здесь
   * одно и то же, отдельного «не заполнено» не заводим — второго
   * состояния у галочки всё равно нет.
   */
  @Column({ name: 'is_vegetarian', type: 'boolean', default: false })
  isVegetarian: boolean;

  /**
   * Аллергии — свободный текст пользователя. Отдельного справочника нет
   * намеренно: список аллергенов у людей разный и пополняется быстрее,
   * чем мы успевали бы его править.
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  allergies: string | null;

  /**
   * Спортивный опыт — отдельная таблица со строкой на пользователя.
   *
   * `eager: true` не для красоты: профиль собирается в `UserResponseDto`
   * из четырёх мест (профиль и три ответа авторизации), и без eager
   * где-нибудь забыли бы `relations`, а опыт молча стал бы `null`.
   *
   * Тип допускает `null` — строки нет, пока пользователь ничего не заполнил.
   */
  @OneToOne(() => SportExperience, (experience) => experience.user, {
    eager: true,
  })
  sportExperience: SportExperience | null;

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
