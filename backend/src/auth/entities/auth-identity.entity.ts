import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * Способ входа пользователя (email, позже VK, Google).
 * У одного пользователя может быть несколько identity — по одной на провайдера.
 *
 * Создаётся ТОЛЬКО после успешного подтверждения кода.
 * Поэтому отдельного поля "email_verified_at" нет — наличие identity = подтверждён.
 */
@Entity('auth_identities')
@Unique('UQ_auth_identities_provider_user', ['provider', 'providerUserId'])
@Unique('UQ_auth_identities_user_provider', ['userId', 'provider'])
export class AuthIdentity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_auth_identities_user_id')
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Провайдер: 'email', позже 'vk', 'google' */
  @Column({ type: 'varchar', length: 20 })
  provider: string;

  /** Идентификатор у провайдера: для email — сам email, для VK — vk user id */
  @Column({ name: 'provider_user_id', type: 'varchar', length: 255 })
  providerUserId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}