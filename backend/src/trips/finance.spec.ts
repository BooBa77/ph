import { describe, expect, it } from 'vitest';

import {
  compensationOptions,
  computeBalances,
  computeRemaining,
  familyCredit,
  familyDebt,
  joinNames,
  planCompensation,
  splitAmount,
  type BalanceCompensation,
  type BalanceExpense,
} from './finance';

/**
 * Арифметика «Бухгалтерии» — без базы и без HTTP.
 *
 * Здесь два примера заказчика целиком: первый (шесть человек, продукты,
 * бензин, ужин и коньяк) проверяет баланс, второй (А, Б, В, Г) — подсказки
 * компенсации и бронирование кредита ожидающими переводами. Отдельный блок —
 * семейный случай: «папа платит за всех», вариант одной строкой и раздача
 * суммы по личным долгам и кредитам.
 */

/** Семьи-одиночки: по умолчанию каждый сам за себя. */
function singles(ids: readonly string[]): string[][] {
  return ids.map((id) => [id]);
}

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

    expect(compensationOptions('v', remaining, singles(ids))).toEqual([
      { userIds: ['a'], amountRub: 1000 },
      { userIds: ['b'], amountRub: 1000 },
    ]);
    expect(compensationOptions('g', remaining, singles(ids))).toEqual([
      { userIds: ['b'], amountRub: 4000 },
      { userIds: ['a'], amountRub: 2000 },
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

    expect(compensationOptions('v', remaining, singles(ids))).toEqual([
      { userIds: ['a'], amountRub: 1000 },
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

    expect(compensationOptions('a', remaining, singles(ids))).toEqual([]);
    expect(compensationOptions('b', remaining, singles(ids))).toEqual([]);
  });
});

describe('семья в компенсации', () => {
  /**
   * Две семьи: (b, c) — мама и сын, (a, g) — своя. Внутри первой оба
   * должны по 300, внутри второй оба в плюсе (А 500, Г 100).
   */
  const families = [
    ['a', 'g'],
    ['b', 'c'],
  ];
  const remaining = new Map<string, number>([
    ['a', 500],
    ['b', -300],
    ['c', -300],
    ['g', 100],
  ]);

  it('долг и кредит семьи считаются по участникам с нужным знаком', () => {
    const mixed = new Map<string, number>([
      ['a', 500],
      ['b', -300],
      ['c', -300],
      ['g', 100],
    ]);

    expect(familyDebt(mixed, ['b', 'c'])).toBe(600);
    expect(familyCredit(mixed, ['b', 'c'])).toBe(0);

    // Плюс одного не гасит минус другого: это разные контрагенты.
    expect(familyDebt(mixed, ['a', 'b'])).toBe(300);
    expect(familyCredit(mixed, ['a', 'b'])).toBe(500);
  });

  it('семья Б и В — один вариант на 600, своей семьи в списке нет', () => {
    const options = compensationOptions('b', remaining, families);

    expect(options).toEqual([{ userIds: ['a', 'g'], amountRub: 600 }]);
    expect(options.some((option) => option.userIds.includes('c'))).toBe(false);
  });

  it('сумма варианта не больше кредита семьи получателя', () => {
    const poor = new Map<string, number>([
      ['a', 100],
      ['b', -300],
      ['c', -300],
      ['g', 100],
    ]);

    // Долг 600, кредит семьи (a, g) — 200, значит предлагается 200.
    expect(compensationOptions('b', poor, families)).toEqual([
      { userIds: ['a', 'g'], amountRub: 200 },
    ]);
  });

  it('сумма раскладывается по личным долгам и кредитам', () => {
    const transfers = planCompensation(600, ['b', 'c'], ['a', 'g'], remaining);

    expect(transfers).toEqual([
      { fromUserId: 'b', toUserId: 'a', amountRub: 300 },
      { fromUserId: 'c', toUserId: 'a', amountRub: 200 },
      { fromUserId: 'c', toUserId: 'g', amountRub: 100 },
    ]);
    expect(transfers.reduce((sum, item) => sum + item.amountRub, 0)).toBe(600);
  });

  it('меньшую сумму получает первый должник, остаток — следующему', () => {
    const transfers = planCompensation(400, ['b', 'c'], ['a', 'g'], remaining);

    expect(transfers).toEqual([
      { fromUserId: 'b', toUserId: 'a', amountRub: 300 },
      { fromUserId: 'c', toUserId: 'a', amountRub: 100 },
    ]);
    expect(transfers.reduce((sum, item) => sum + item.amountRub, 0)).toBe(400);
  });

  it('не раскладывает нулевую и нецелую сумму', () => {
    expect(planCompensation(0, ['b'], ['a'], remaining)).toEqual([]);
    expect(planCompensation(-100, ['b'], ['a'], remaining)).toEqual([]);
    expect(planCompensation(10.5, ['b'], ['a'], remaining)).toEqual([]);
  });

  it('имена — одной строкой, как просил заказчик', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['Вася'])).toBe('Вася');
    expect(joinNames(['Вася', 'Аня'])).toBe('Вася и Аня');
    expect(joinNames(['Вася', 'Аня', 'Петя'])).toBe('Вася, Аня и Петя');
  });
});

