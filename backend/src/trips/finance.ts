import type { TripCompensation } from './entities/trip-compensation.entity';
import type { TripExpense } from './entities/trip-expense.entity';

/**
 * Арифметика «Бухгалтерии» похода — чистые функции (11.11.2026).
 *
 * Здесь нет ни базы, ни Nest: всё, что можно проверить без HTTP, живёт
 * в этом файле и покрыто юнит-тестами. Сервис только собирает данные
 * и раскладывает результат в DTO, поэтому ошибка в формуле не требует
 * поднимать приложение, чтобы её увидеть.
 */

/** Как делится расход. */
export const EXPENSE_SPLITS = ['all', 'group', 'commonEaters'] as const;
export type ExpenseSplit = (typeof EXPENSE_SPLITS)[number];

/** Доля одного человека. */
export interface ShareAmount {
  userId: string;
  amountRub: number;
}

/**
 * Разделить сумму поровну.
 *
 * Остаток от деления раскладывается по рублю **первым по порядку** —
 * порядок состава похода, а не порядок галочек в модалке: одно и то же
 * действие должно давать одни и те же доли при повторной правке.
 * Копеек в проекте нет (`trip-tabs.md`: «рубли, округление до целого»),
 * поэтому 1000 ₽ на троих — это 334, 333 и 333 ₽.
 *
 * Повторяющиеся id схлопываются: человек в одном расходе участвует один
 * раз, иначе доля считалась бы дважды.
 */
export function splitAmount(
  amountRub: number,
  userIds: readonly string[],
): ShareAmount[] {
  const ids = [...new Set(userIds)];

  if (!Number.isInteger(amountRub) || amountRub <= 0 || ids.length === 0) {
    return [];
  }

  const base = Math.floor(amountRub / ids.length);
  const remainder = amountRub % ids.length;

  return ids.map((userId, index) => ({
    userId,
    // Первым по порядку — на рубль больше, чтобы сумма совпала точно.
    amountRub: base + (index < remainder ? 1 : 0),
  }));
}

/** Расход в том виде, в каком он нужен балансу. */
export interface BalanceExpense {
  authorUserId: string;
  amountRub: number;
  shares: ShareAmount[];
}

/** Компенсация в том виде, в каком она нужна балансу. */
export interface BalanceCompensation {
  fromUserId: string;
  toUserId: string;
  amountRub: number;
  status: 'pending' | 'confirmed';
}

/**
 * Баланс каждого: «заплатил − его доля + отправленные подтверждённые
 * − полученные подтверждённые».
 *
 * Положительный — человеку должны, отрицательный — он должен. Сумма
 * по всем всегда ноль: каждая трата кому-то плюс, кому-то минус.
 * Нулевыми в карту попадают все участники — иначе на экране «нет строки»
 * и «баланс ноль» выглядели бы по-разному.
 */
export function computeBalances(
  expenses: readonly BalanceExpense[],
  compensations: readonly BalanceCompensation[],
  memberIds: readonly string[],
): Map<string, number> {
  const balances = new Map<string, number>();
  const add = (userId: string, delta: number): void => {
    balances.set(userId, (balances.get(userId) ?? 0) + delta);
  };

  for (const userId of memberIds) balances.set(userId, 0);

  for (const expense of expenses) {
    add(expense.authorUserId, expense.amountRub);
    for (const share of expense.shares) add(share.userId, -share.amountRub);
  }

  for (const compensation of compensations) {
    // Деньги двигает только подтверждённое: «ждём» — это намерение.
    if (compensation.status !== 'confirmed') continue;
    add(compensation.fromUserId, compensation.amountRub);
    add(compensation.toUserId, -compensation.amountRub);
  }

  return balances;
}

/**
 * Остаток с учётом ожидающих компенсаций.
 *
 * `remaining = balance + отправлено ожидающих − получено ожидающих`.
 * По нему строятся подсказки в модалке: кредит, на который уже есть
 * ожидающий перевод, занят. Отсюда и поведение из примера заказчика:
 * когда Г отправил Б 4000 и А 1000, у В остаётся только А на 1000,
 * хотя переводы Г ещё не подтверждены.
 */
export function computeRemaining(
  balances: ReadonlyMap<string, number>,
  compensations: readonly BalanceCompensation[],
): Map<string, number> {
  const remaining = new Map(balances);

  for (const compensation of compensations) {
    if (compensation.status !== 'pending') continue;
    remaining.set(
      compensation.fromUserId,
      (remaining.get(compensation.fromUserId) ?? 0) + compensation.amountRub,
    );
    remaining.set(
      compensation.toUserId,
      (remaining.get(compensation.toUserId) ?? 0) - compensation.amountRub,
    );
  }

  return remaining;
}

/** Один вариант «кому и сколько» в модалке компенсации. */
export interface CompensationOption {
  userId: string;
  amountRub: number;
}

/**
 * Кому может компенсировать этот человек и сколько.
 *
 * Только кредиторы с положительным остатком; сумма — `min(долг, кредит)`,
 * чтобы один перевод не улетел выше чужого кредита. Если человеку
 * не должны (остаток не отрицательный) — вариантов нет: компенсация
 * не нужна, и кнопка на экране будет неактивной.
 *
 * Сортировка — по убыванию суммы: крупный долг закрывается первым.
 * При равенстве — порядок состава похода, чтобы список не прыгал между
 * перерисовками.
 */
export function compensationOptions(
  meId: string,
  remaining: ReadonlyMap<string, number>,
  memberIds: readonly string[],
): CompensationOption[] {
  const debt = -(remaining.get(meId) ?? 0);
  if (debt <= 0) return [];

  const order = new Map(memberIds.map((userId, index) => [userId, index]));
  const options: CompensationOption[] = [];

  for (const userId of memberIds) {
    if (userId === meId) continue;
    const credit = remaining.get(userId) ?? 0;
    if (credit <= 0) continue;
    options.push({ userId, amountRub: Math.min(debt, credit) });
  }

  return options.sort(
    (a, b) =>
      b.amountRub - a.amountRub ||
      (order.get(a.userId) ?? 0) - (order.get(b.userId) ?? 0),
  );
}

/** Собрать балансы из сущностей — один адаптер, чтобы не дублировать поля. */
export function balancesFromEntities(
  expenses: readonly TripExpense[],
  compensations: readonly TripCompensation[],
  memberIds: readonly string[],
): Map<string, number> {
  return computeBalances(
    expenses.map((expense) => ({
      authorUserId: expense.authorUserId,
      amountRub: expense.amountRub,
      shares: (expense.shares ?? []).map((share) => ({
        userId: share.userId,
        amountRub: share.amountRub,
      })),
    })),
    compensations.map((compensation) => ({
      fromUserId: compensation.fromUserId,
      toUserId: compensation.toUserId,
      amountRub: compensation.amountRub,
      status: compensation.status,
    })),
    memberIds,
  );
}

/** Остаток из сущностей — та же логика, что и у `computeRemaining`. */
export function remainingFromEntities(
  expenses: readonly TripExpense[],
  compensations: readonly TripCompensation[],
  memberIds: readonly string[],
): Map<string, number> {
  return computeRemaining(
    balancesFromEntities(expenses, compensations, memberIds),
    compensations.map((compensation) => ({
      fromUserId: compensation.fromUserId,
      toUserId: compensation.toUserId,
      amountRub: compensation.amountRub,
      status: compensation.status,
    })),
  );
}
