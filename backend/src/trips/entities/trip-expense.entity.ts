import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';
import type { ExpenseSplit } from '../finance';
import { Trip } from './trip.entity';
import { TripExpenseShare } from './trip-expense-share.entity';

/**
 * Расход похода — «кто-то заплатил за кого-то» (11.11.2026).
 *
 * Заказчик описал таблицу движения денег колонками «дата, кто, сколько,
 * за что, кнопка подтверждения». Расход отвечает за первые четыре: кто
 * заплатил (автор записи, он же плательщик), сколько, за что и когда.
 * Кнопки подтверждения у расхода нет — подтверждают только компенсации.
 *
 * **Доли лежат отдельными строками** (`trip_expense_shares`), а не
 * считаются на лету. Сумма делится один раз при создании, остаток от
 * деления раскладывается по рублю первым по порядку состава, — и
 * арифметика на экране сходится до рубля, даже если состав похода потом
 * изменится или кто-то выйдет.
 *
 * `split` хранит, **как** делили: на всех идущих, на выбранную группу или
 * на питающихся с общего (кнопка «Чек» в «Питании»). Доли можно вывести
 * и из состава, но подпись «на всех · по 2 000 ₽» должна пережить
 * изменение состава: через месяц уже не понять, почему людей в долях
 * пять, а идущих сейчас шестеро.
 *
 * Автор — плательщик, и редактировать/удалять запись может только он
 * (слова заказчика: «строки с расходами редактируются авторами»).
 */
@Entity('trip_expenses')
@Index('IDX_trip_expenses_trip', ['tripId'])
@Index('UQ_trip_expenses_client', ['tripId', 'clientId'], { unique: true })
@Check('chk_trip_expenses_amount', `"amount_rub" > 0`)
@Check(
  'chk_trip_expenses_description',
  `length(btrim("description")) > 0`,
)
@Check(
  'chk_trip_expenses_split',
  `"split" IN ('all', 'group', 'commonEaters')`,
)
export class TripExpense {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  @ManyToOne(() => Trip, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'trip_id',
    foreignKeyConstraintName: 'FK_trip_expenses_trip',
  })
  trip: Trip;

  @Column({ name: 'author_user_id', type: 'uuid' })
  authorUserId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'author_user_id',
    foreignKeyConstraintName: 'FK_trip_expenses_author',
  })
  author: User;

  @Column({ name: 'amount_rub', type: 'integer' })
  amountRub: number;

  @Column({ type: 'varchar', length: 200 })
  description: string;

  /**
   * UUID с устройства — ключ идемпотентности офлайн-чека (19.11.2026).
   *
   * `NULL` у чека, заведённого онлайн без очереди. Уникален в пределах
   * похода (`UQ_trip_expenses_client`): повторная отправка того же чека
   * находит существующую строку и не создаёт вторую.
   */
  @Column({ name: 'client_id', type: 'uuid', nullable: true })
  clientId: string | null;

  @Column({ type: 'varchar', length: 20, default: 'group' })
  split: ExpenseSplit;

  /**
   * Дата траты — календарная, без времени: в походе важно «вчера
   * в кафе», а не минута. `date` TypeORM отдаёт строкой `ГГГГ-ММ-ДД`.
   *
   * Значения по умолчанию нет ни здесь, ни в базе: дату всегда ставит
   * сервис (не передали — сегодня). `CURRENT_DATE` в схеме TypeORM
   * нормализует в `('now'::text)::date` и видит вечный дрейф — вторая
   * миграция убрала default, чтобы `schema:log` был чистым.
   */
  @Column({ name: 'spent_at', type: 'date' })
  spentAt: string;

  @OneToMany(() => TripExpenseShare, (share) => share.expense)
  shares: TripExpenseShare[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
