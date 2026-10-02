import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

/**
 * История смены displayName.
 *
 * Аудит-лог: запись создаётся при каждом изменении displayName
 * у пользователя. Записи неизменяемы (нет updated_at) и не удаляются.
 *
 * Не пишем запись при регистрации — первое имя это не «смена».
 * Не пишем, если displayName не изменился (booba → booba).
 *
 * Цель — «от хулиганья»: если юзер поставил мат, потом сменил на
 * нормальное имя — можно посмотреть историю и увидеть.
 */
@Entity('display_name_history')
export class DisplayNameHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_display_name_history_user_id')
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Что было до изменения. */
  @Column({ name: 'old_name', type: 'varchar', length: 50 })
  oldName: string;

  /** Что стало после изменения. */
  @Column({ name: 'new_name', type: 'varchar', length: 50 })
  newName: string;

  /** Когда изменили. */
  @Column({ name: 'changed_at', type: 'timestamptz' })
  changedAt: Date;
}