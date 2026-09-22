import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * Сессия устройства. Один пользователь — много сессий (комп, мобила, планшет).
 * Refresh-токен хранится в виде хэша, не в открытом виде.
 */
@Entity('sessions')
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_sessions_user_id')
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Человекочитаемое описание устройства: "Chrome on Linux", "Safari on iOS" */
  @Column({ name: 'device_label', type: 'varchar', length: 100, nullable: true })
  deviceLabel: string | null;

  /** Хэш refresh-токена (sha256). Уникальный — по нему ищем сессию */
  @Index('UQ_sessions_refresh_token_hash', { unique: true })
  @Column({ name: 'refresh_token_hash', type: 'varchar', length: 255 })
  refreshTokenHash: string;

  /** Когда сессия истечёт сама */
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  /** Когда сессию отозвали вручную (logout). NULL — активна */
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}