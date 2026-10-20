import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Trip } from './trip.entity';

/**
 * Диалог — одна сущность на все переписки: чаты похода и личные.
 *
 * **Почему одна таблица, а не две.** Личные сообщения отличаются от
 * походных только тем, к чему привязаны: у чата похода есть `trip_id`,
 * у личного — пара участников. Всё остальное (сообщения, листание, счётчик
 * непрочитанного, будущий realtime) одинаково. Две таблицы означали бы два
 * кода на одно и то же: два листания курсором, два счётчика, два экрана.
 *
 * Цена решения — не «медленнее» (лишние строки на 1 ГБ сервере не стоят
 * ничего), а полиморфность: `trip_id` бывает NULL, и часть правил доступа
 * считается по походу, а часть — по составу диалога. Поэтому в таблице
 * прямо записано, какие комбинации законны (`chk_conversations_scope`):
 *
 * - `direct` — `trip_id` нет, есть пара `direct_a`/`direct_b`;
 * - чаты похода (`trip_guest`, `trip_members`, дальше — по вкладкам) —
 *   `trip_id` есть, пары нет.
 *
 * `kind` — текст без CHECK: новый вид чата (снаряжение, питание, деньги)
 * не должен требовать миграции. Проверка `chk_conversations_scope`
 * опирается на `kind = 'direct'` как на единственный «непоходный» вид;
 * появится второй внепоходный — CHECK придётся править вместе с моделью,
 * и это правильно: снаружи похода пока только личные.
 *
 * **Пара личных пишется отсортированной** (`direct_a < direct_b`) и
 * уникальна: так один и тот же человек не получит два диалога с одним
 * собеседником. Сортировка — не украшение, а способ не заводить
 * `LEAST/GREATEST` в индексе: `UNIQUE (direct_a, direct_b)` работает
 * по обычному btree.
 *
 * Чаты похода создаются сразу при создании похода, в одной транзакции
 * с ним, даже для приватного: существование чата и доступ к нему — разные
 * вопросы. Кто в каком чате читает и пишет, решает приложение по текущей
 * видимости похода.
 */
@Entity('conversations')
@Index('UQ_conversations_trip_kind', ['tripId', 'kind'], {
  unique: true,
  where: '"trip_id" IS NOT NULL',
})
@Index('UQ_conversations_direct_pair', ['directA', 'directB'], {
  unique: true,
  where: `"kind" = 'direct'`,
})
@Check(
  'chk_conversations_scope',
  `("kind" = 'direct' AND "trip_id" IS NULL AND "direct_a" IS NOT NULL AND "direct_b" IS NOT NULL AND "direct_a" < "direct_b")
   OR ("kind" <> 'direct' AND "trip_id" IS NOT NULL AND "direct_a" IS NULL AND "direct_b" IS NULL)`,
)
export class Conversation {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  /** 'trip_guest' | 'trip_members' | 'direct' — без CHECK, см. описание. */
  @Column({ type: 'varchar', length: 30 })
  kind: string;

  @Column({ name: 'trip_id', type: 'bigint', nullable: true })
  tripId: string | null;

  @ManyToOne(() => Trip, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'trip_id', foreignKeyConstraintName: 'FK_conversations_trip' })
  trip: Trip | null;

  /** Первый участник личного диалога — всегда меньший из двух id. */
  @Column({ name: 'direct_a', type: 'uuid', nullable: true })
  directA: string | null;

  /** Второй участник личного диалога — всегда больший из двух id. */
  @Column({ name: 'direct_b', type: 'uuid', nullable: true })
  directB: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
