import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';

/**
 * Состояние действия в сообщении — «Да» / «Нет» и что из этого вышло.
 *
 * Отдельная таблица, а не поля в сообщении: **одно действие показывают
 * несколько сообщений** (публичное в чате похода и личное получателю),
 * и состояние у них обязано быть общим. Иначе «нет» в чате и «да» в личке
 * сосуществовали бы, а деньги — они одни.
 *
 * Деньги двигает только `confirmed`. `pending`, `disputed` и `cancelled`
 * баланс не меняют: «нет» — это сигнал «до меня не дошло», а не откат.
 * Поэтому ошибочно нажатое «нет» ничего не ломает; из него можно вернуться
 * в «да» (передумал), в «ждём» (отправитель: «посмотри ещё раз») или
 * в «отменено» («мой косяк, отменяем»). Из `confirmed` — никуда:
 * подтверждение окончательное.
 *
 * `payload` — jsonb, потому что форма полезной нагрузки зависит от `kind`
 * (у денег это сумма, поход и кто перевёл). Колонка на каждый вид действия
 * означала бы миграцию на каждый новый вид.
 *
 * `target_user_id` — кому отвечать. Проверка «нажать может только он» живёт
 * в сервисе, а не в шаблоне: спрятанная кнопка не запрет.
 */
@Entity('message_actions')
@Index('IDX_message_actions_target_state', ['targetUserId', 'state'])
@Check(
  'chk_message_actions_state',
  `"state" IN ('pending', 'confirmed', 'disputed', 'cancelled')`,
)
export class MessageAction {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  /** Вид действия: `money_received` — подтверждение перевода. */
  @Column({ type: 'varchar', length: 40 })
  kind: string;

  @Column({ name: 'target_user_id', type: 'uuid' })
  targetUserId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'target_user_id',
    foreignKeyConstraintName: 'FK_message_actions_target',
  })
  targetUser: User;

  /** Полезная нагрузка вида: у денег — сумма, поход, кто перевёл. */
  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  state: 'pending' | 'confirmed' | 'disputed' | 'cancelled';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  /** Когда адресат ответил в последний раз. NULL — ещё не отвечал. */
  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt: Date | null;
}
