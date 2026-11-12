import { describe, expect, it } from 'vitest';

import {
  compensationOptions,
  computeBalances,
  computeRemaining,
  splitAmount,
  type BalanceCompensation,
  type BalanceExpense,
} from './finance';

/**
 * Арифметика «Бухгалтерии» — без базы и без HTTP.
 *
 * Здесь два примера заказчика целиком: первый (шесть человек, продукты,
 * бензин, ужин и коньяк) проверяет баланс, второй (А, Б, В, Г) — подсказки
 * компенсации и бронирование кредита ожидающими переводами.
 */

/** Расход: плательщик, сумма и доли. */
function expense(
  authorUserId: string,
  amountRub: number,
  shares: Array<[string, number]>,
): BalanceExpense {
  return {
    authorUserId,
    amountRub,
    shares: shares.map(([userId, amount]) => ({ userId, amountRub: amount })),
  };
}

function compensation(
  fromUserId: string,
  toUserId: string,
  amountRub: number,
  status: 'pending' | 'confirmed' = 'pending',
): BalanceCompensation {
  return { fromUserId, toUserId, amountRub, status };
}

describe('splitAmount', () => {
  it('делит 12 000 на шестерых ровно по 2 000', () => {
    const shares = splitAmount(12000, ['a', 'b', 'c', 'd', 'e', 'f']);

    expect(shares).toHaveLength(6);
    expect(shares.every((share) => share.amountRub === 2000)).toBe(true);
  });

  it('остаток от деления раскладывает по рублю первым по порядку', () => {
    const shares = splitAmount(1000, ['a', 'b', 'c']);

    // 1000 / 3 = 333 и 1 рубль остатка — первому.
    expect(shares.map((share) => share.amountRub)).toEqual([334, 333, 333]);
    expect(shares.reduce((sum, share) => sum + share.amountRub, 0)).toBe(1000);
  });

  it('не дробит рубли: сумма долей всегда равна расходу', () => {
    for (const amount of [1, 7, 100, 1000, 1001, 12000]) {
      for (const people of [1, 2, 3, 5, 6, 7]) {
        const ids = Array.from({ length: people }, (_, index) => `u${index}`);
        const shares = splitAmount(amount, ids);

        expect(shares.reduce((sum, share) => sum + share.amountRub, 0)).toBe(
          amount,
        );
      }
    }
  });

  it('не считает человека дважды', () => {
    const shares = splitAmount(300, ['a', 'b', 'a']);

    expect(shares).toHaveLength(2);
    expect(shares.reduce((sum, share) => sum + share.amountRub, 0)).toBe(300);
  });

  it('на пустой состав и неположительную сумму долей нет', () => {
    expect(splitAmount(100, [])).toEqual([]);
    expect(splitAmount(0, ['a'])).toEqual([]);
    expect(splitAmount(-10, ['a'])).toEqual([]);
  });
});

describe('балансы: пример заказчика с шестью участниками', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];

  const expenses: BalanceExpense[] = [
    // Питание: Г заплатил 12 000 за всех шестерых.
    expense('g', 12000, [
      ['a', 2000],
      ['b', 2000],
      ['c', 2000],
      ['d', 2000],
      ['e', 2000],
      ['g', 2000],
    ]),
    // Бензин: А заплатил 1 500 за А, Б и В.
    expense('a', 1500, [
      ['a', 500],
      ['b', 500],
      ['c', 500],
    ]),
    // Ужин: В заплатил 500 за Е.
    expense('c', 500, [['e', 500]]),
    // Коньяк: Д заплатил 1 000, А за рулём не пьёт — делят пятеро.
    expense('d', 1000, [
      ['b', 200],
      ['c', 200],
      ['d', 200],
      ['e', 200],
      ['g', 200],
    ]),
  ];

  it('сходится с цифрами заказчика', () => {
    // Заголовок «g», но в постановке участники А–Е и Г — здесь
    // g = Г, a–e = А–Е. Порядок ids в балансе не важен.
    const balances = computeBalances(expenses, [], ids);

    expect(balances.get('a')).toBe(-1000);
    expect(balances.get('b')).toBe(-2700);
    expect(balances.get('c')).toBe(-2200);
    expect(balances.get('g')).toBe(9800);
    expect(balances.get('d')).toBe(-1200);
    expect(balances.get('e')).toBe(-2700);
  });

  it('сумма балансов — ноль', () => {
    const balances = computeBalances(expenses, [], ids);
    const total = [...balances.values()].reduce((sum, value) => sum + value, 0);

    expect(total).toBe(0);
  });

  it('единственный в плюсе — Г, остальным он и должен', () => {
    const balances = computeBalances(expenses, [], ids);
    const creditors = [...balances.entries()].filter(([, value]) => value > 0);

    expect(creditors).toHaveLength(1);
    expect(creditors[0][0]).toBe('g');
  });
});

describe('ожидающие компенсации бронируют кредит', () => {
  const ids = ['a', 'b', 'v', 'g'];

  /**
   * Второй пример заказчика: А +2000, Б +4000, В −1000, Г −5000.
   *
   * Баланс задан картой напрямую: как он получился из расходов, проверяет
   * предыдущий блок, а здесь важны только подсказки компенсации.
   */
  const balances = new Map<string, number>([
    ['a', 2000],
    ['b', 4000],
    ['v', -1000],
    ['g', -5000],
  ]);

  it('у В оба кредитора, у Г — Б и А', () => {
    const remaining = computeRemaining(balances, []);

    expect(compensationOptions('v', remaining, ids)).toEqual([
      { userId: 'a', amountRub: 1000 },
      { userId: 'b', amountRub: 1000 },
    ]);
    expect(compensationOptions('g', remaining, ids)).toEqual([
      { userId: 'b', amountRub: 4000 },
      { userId: 'a', amountRub: 2000 },
    ]);
  });

  it('после ожидающих переводов Г у В остаётся только А на 1000', () => {
    const pending: BalanceCompensation[] = [
      compensation('g', 'b', 4000),
      compensation('g', 'a', 1000),
    ];

    const remaining = computeRemaining(balances, pending);

    expect(remaining.get('a')).toBe(1000);
    expect(remaining.get('b')).toBe(0);
    expect(remaining.get('v')).toBe(-1000);
    expect(remaining.get('g')).toBe(0);

    expect(compensationOptions('v', remaining, ids)).toEqual([
      { userId: 'a', amountRub: 1000 },
    ]);
  });

  it('подтверждение перевода двигает баланс, ожидание — нет', () => {
    // Отдельный маленький пример: А заплатил 3 000, доли В 1 000 и Г 2 000.
    const expenses: BalanceExpense[] = [
      expense('a', 3000, [
        ['v', 1000],
        ['g', 2000],
      ]),
    ];
    const smallIds = ['a', 'v', 'g'];

    const noTransfer = computeBalances(expenses, [], smallIds);
    expect(noTransfer.get('a')).toBe(3000);
    expect(noTransfer.get('v')).toBe(-1000);

    const pending = computeBalances(
      expenses,
      [compensation('v', 'a', 1000)],
      smallIds,
    );
    expect(pending.get('v')).toBe(-1000);
    expect(pending.get('a')).toBe(3000);

    const confirmed = computeBalances(
      expenses,
      [compensation('v', 'a', 1000, 'confirmed')],
      smallIds,
    );
    expect(confirmed.get('v')).toBe(0);
    expect(confirmed.get('a')).toBe(2000);
  });

  it('человеку без долга компенсировать нечего', () => {
    const remaining = computeRemaining(balances, []);

    expect(compensationOptions('a', remaining, ids)).toEqual([]);
    expect(compensationOptions('b', remaining, ids)).toEqual([]);
  });
});

