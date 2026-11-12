import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';
import { TripExpense } from './trip-expense.entity';

/**
 * Доля одного человека в расходе похода (11.11.2026).
 *
 * Строка на человека, а не массив id в расходе: доля — это сумма в рублях,
 * и её нельзя пересчитать «потом», когда состав похода изменится. Итог
 * всех долей всегда равен сумме расхода (проверяет сервис и e2e).
 *
 * Ключ `(expense_id, user_id)` — человек в одном расходе ровно один раз.
 * `amount_rub` может быть нулём: рубль на шестерых делится как 1, 0, 0…
 * — формально ноль, но человек в расходе участвовал, и это видно.
 */
@Entity('trip_expense_shares')
@Check('chk_trip_expense_shares_amount', `"amount_rub" >= 0`)
export class TripExpenseShare {
  @PrimaryColumn({ name: 'expense_id', type: 'bigint' })
  expenseId: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => TripExpense, (expense) => expense.shares, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'expense_id',
    foreignKeyConstraintName: 'FK_trip_expense_shares_expense',
  })
  expense: TripExpense;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_trip_expense_shares_user',
  })
  user: User;

  @Column({ name: 'amount_rub', type: 'integer' })
  amountRub: number;
}
