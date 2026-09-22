import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Пользователь — доменная сущность.
 * Данные для входа хранятся отдельно в auth_identities.
 */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Как показывать пользователя в интерфейсе */
  @Column({ name: 'display_name', type: 'varchar', length: 50 })
  displayName: string;

  /** Погоняло, отображаемое поле, не уникальное */
  @Column({ type: 'varchar', length: 30, nullable: true })
  nickname: string | null;

  @Column({ name: 'first_name', type: 'varchar', length: 50, nullable: true })
  firstName: string | null;

  @Column({ name: 'last_name', type: 'varchar', length: 50, nullable: true })
  lastName: string | null;

  /** Место проживания */
  @Column({ type: 'varchar', length: 100, nullable: true })
  location: string | null;

  /**
   * День рождения. Год фиктивный (2000), используется только месяц и день.
   * 2000 выбран потому что високосный — 29 февраля валидно.
   */
  @Column({ name: 'birth_date', type: 'date', nullable: true })
  birthDate: string | null;

  @Column({ name: 'avatar_url', type: 'varchar', length: 255, nullable: true })
  avatarUrl: string | null;

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