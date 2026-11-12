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

/**
 * Один вариант «кому и сколько» в модалке компенсации.
 *
 * С 12.11.2026 вариантом может быть **семья целиком**: Вася и Аня получают
 * одной строкой. Поэтому здесь список людей, а не один `userId`; сколько
 * именно переводится каждому — распишет `planCompensation` при создании.
 */
export interface CompensationOption {
  /** Идущие получатели этой семьи — в порядке состава похода. */
  userIds: string[];
  /** `min(долг моей семьи, кредит этой семьи)`. */
  amountRub: number;
}

/**
 * Долг семьи — сумма долей её участников с отрицательным остатком.
 *
 * Не «сумма балансов» с плюсами: внутри семьи положительный и отрицательный
 * остатки взаимно не гасятся. Семья — это общий кошелёк, но долг одному
 * человеку и кредит от другого — разные контрагенты; если участник в плюсе,
 * эти деньги ему должен кто-то третий, и семья не может заплатить ими
 * за другого своего участника.
 */
export function familyDebt(
  remaining: ReadonlyMap<string, number>,
  userIds: readonly string[],
): number {
  return userIds.reduce(
    (sum, userId) => sum + Math.max(0, -(remaining.get(userId) ?? 0)),
    0,
  );
}

/** Кредит семьи — сумма её участников с положительным остатком. */
export function familyCredit(
  remaining: ReadonlyMap<string, number>,
  userIds: readonly string[],
): number {
  return userIds.reduce(
    (sum, userId) => sum + Math.max(0, remaining.get(userId) ?? 0),
    0,
  );
}

/**
 * Кому может компенсировать эта семья и сколько.
 *
 * `families` — идущие участники, разложенные по семьям в порядке состава.
 * Своя семья из вариантов исключена: внутри семьи деньги не переводят.
 * Сумма варианта — `min(долг моей семьи, кредит семьи получателя)`, чтобы
 * один перевод не улетел выше чужого кредита. Если семья ничего не должна —
 * вариантов нет: компенсация не нужна, и кнопка на экране будет неактивной.
 *
 * Сортировка — по убыванию суммы: крупный долг закрывается первым.
 * При равенстве — порядок состава похода, чтобы список не прыгал между
 * перерисовками.
 */
export function compensationOptions(
  meId: string,
  remaining: ReadonlyMap<string, number>,
  families: readonly (readonly string[])[],
): CompensationOption[] {
  const myFamily = families.find((group) => group.includes(meId)) ?? [meId];
  const debt = familyDebt(remaining, myFamily);
  if (debt <= 0) return [];

  const order = new Map<string, number>();
  for (const group of families) {
    for (const userId of group) {
      if (!order.has(userId)) order.set(userId, order.size);
    }
  }

  const options: CompensationOption[] = [];

  for (const group of families) {
    if (group.includes(meId)) continue;
    const credit = familyCredit(remaining, group);
    if (credit <= 0) continue;
    options.push({ userIds: [...group], amountRub: Math.min(debt, credit) });
  }

  return options.sort(
    (a, b) =>
      b.amountRub - a.amountRub ||
      (order.get(a.userIds[0]) ?? 0) - (order.get(b.userIds[0]) ?? 0),
  );
}

/** Перевод внутри одного действия: «этот должник этому получателю столько». */
export interface CompensationTransfer {
  fromUserId: string;
  toUserId: string;
  amountRub: number;
}

/**
 * Разложить сумму семейной компенсации на личные переводы.
 *
 * «Папа платит за всех» — одно действие на экране, но баланс в проекте
 * остаётся **персональным**. Поэтому деньги раскладываются по долгам
 * участников моей семьи и по кредитам участников семьи получателя:
 * сначала закрывается долг первого по составу, внутри него — кредит
 * первого по составу, и так до исчерпания суммы.
 *
 * Порядок детерминированный: от него зависят записи в базе, а повторное
 * действие с теми же числами должно давать те же строки. Копеек нет,
 * поэтому каждая пара получает целые рубли, а сумма переводов равна
 * переданной сумме.
 */
export function planCompensation(
  amountRub: number,
  fromUserIds: readonly string[],
  toUserIds: readonly string[],
  remaining: ReadonlyMap<string, number>,
): CompensationTransfer[] {
  if (!Number.isInteger(amountRub) || amountRub <= 0) return [];

  const debtors = fromUserIds
    .map((userId) => ({
      userId,
      debt: Math.max(0, -(remaining.get(userId) ?? 0)),
    }))
    .filter((debtor) => debtor.debt > 0);

  const creditors = toUserIds
    .map((userId) => ({
      userId,
      credit: Math.max(0, remaining.get(userId) ?? 0),
    }))
    .filter((creditor) => creditor.credit > 0);

  const transfers: CompensationTransfer[] = [];
  let left = amountRub;

  for (const debtor of debtors) {
    let pays = Math.min(debtor.debt, left);

    for (const creditor of creditors) {
      if (pays === 0) break;
      if (creditor.credit === 0) continue;

      const amount = Math.min(pays, creditor.credit);
      transfers.push({
        fromUserId: debtor.userId,
        toUserId: creditor.userId,
        amountRub: amount,
      });

      creditor.credit -= amount;
      pays -= amount;
      left -= amount;
    }

    if (left === 0) break;
  }

  return transfers;
}

/**
 * Имена одной строкой: «Вася», «Вася и Аня», «Вася, Аня и Петя».
 *
 * Заказчик: «предлагать семью одной строкой „Вася и Аня“». Союз «и» перед
 * последним именем — по-русски; запятая перед ним не ставится при двух
 * именах и ставится при трёх и более.
 */
export function joinNames(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0] ?? '';

  return `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`;
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
