import { describe, expect, it } from 'vitest';

import {
  compensationOptions,
  computeBalances,
  computeRemaining,
  familyBalance,
  familyCredit,
  familyDebt,
  joinNames,
  planCommonEaterShares,
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

describe('общая касса семьи', () => {
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

  it('касса — сумма остатков: плюс одного гасит минус другого', () => {
    const mixed = new Map<string, number>([
      ['a', 500],
      ['b', -300],
      ['c', -300],
      ['g', 100],
    ]);

    expect(familyBalance(mixed, ['b', 'c'])).toBe(-600);
    expect(familyDebt(mixed, ['b', 'c'])).toBe(600);
    expect(familyCredit(mixed, ['b', 'c'])).toBe(0);

    // 12.11.2026: семья — одна касса. До этого здесь было «долг 300,
    // кредит 500»: два числа на одну семью и лишние переводы снаружи.
    expect(familyBalance(mixed, ['a', 'b'])).toBe(200);
    expect(familyDebt(mixed, ['a', 'b'])).toBe(0);
    expect(familyCredit(mixed, ['a', 'b'])).toBe(200);
  });

  it('сумма варианта — чистый остаток кассы, а не сумма плюсов', () => {
    const net = new Map<string, number>([
      ['a', 500],
      ['g', -300],
      ['b', -300],
      ['c', 200],
    ]);

    // Касса (a, g) в плюсе на 200, касса (b, c) в минусе на 100:
    // предлагается 100, хотя плюсов у получателя на 500.
    expect(compensationOptions('b', net, families)).toEqual([
      { userIds: ['a', 'g'], amountRub: 100 },
    ]);
  });

  it('семья Б и В — один вариант на 600, своей семьи в списке нет', () => {
    const options = compensationOptions('b', remaining, families);

    expect(options).toEqual([{ userIds: ['a', 'g'], amountRub: 600 }]);
    expect(options.some((option) => option.userIds.includes('c'))).toBe(false);
  });

  it('сумма варианта не больше кредита кассы получателя', () => {
    const poor = new Map<string, number>([
      ['a', 100],
      ['b', -300],
      ['c', -300],
      ['g', 100],
    ]);

    // Долг 600, касса (a, g) — 200, значит предлагается 200.
    expect(compensationOptions('b', poor, families)).toEqual([
      { userIds: ['a', 'g'], amountRub: 200 },
    ]);
  });

  it('плюс у меня и минус у родного: кнопка компенсации работает', () => {
    // 13.11.2026, проверка заказчика: «у пользователя положительный баланс,
    // а у родственника отрицательный — доступна ли кнопка?». У родных общая
    // касса: +1 000 и −1 500 дают долг 500, поэтому вариант есть, хотя лично
    // смотрящему не должны ни рубля.
    const family = [
      ['a', 'b'],
      ['c'],
    ];
    const balances = new Map<string, number>([
      ['a', 1000],
      ['b', -1500],
      ['c', 500],
    ]);

    expect(compensationOptions('a', balances, family)).toEqual([
      { userIds: ['c'], amountRub: 500 },
    ]);
    // А без родного (каждый сам за себя) вариантов нет: платить не с чего.
    expect(compensationOptions('a', balances, singles(['a', 'b', 'c']))).toEqual(
      [],
    );
  });

  it('имена — одной строкой, как просил заказчик', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['Вася'])).toBe('Вася');
    expect(joinNames(['Вася', 'Аня'])).toBe('Вася и Аня');
    expect(joinNames(['Вася', 'Аня', 'Петя'])).toBe('Вася, Аня и Петя');
  });
});

/**
 * Доли чека с общего стола — проекция текущих едоков (13.11.2026).
 *
 * Заказчик: «6 человек питаются вместе, A покупает на 3 000 — у A +2 500,
 * у остальных −500. Затем A решил питаться отдельно, осталось 5 человек —
 * A +3 000, у остальных −600. И этот пересчёт должен обновляться в том числе
 * по SSE». Первый вариант пересчёта убирал доли вышедших, но не возвращал
 * вернувшихся — чек, поделённый на четырёх, оставался четырёхдольным при
 * шести едоках, и галочка ничего не меняла.
 */
describe('planCommonEaterShares', () => {
  const early = new Date('2026-11-01T00:00:00Z');
  const check = new Date('2026-11-12T00:00:00Z');
  const late = new Date('2026-11-13T00:00:00Z');

  /** Шесть человек в составе с самого начала. */
  function since(ids: readonly string[], at = early): Map<string, Date> {
    return new Map(ids.map((id) => [id, at]));
  }

  const six = ['a', 'b', 'c', 'd', 'e', 'f'];

  it('вышедший из-за стола выпадает из долей, остальные делят его часть', () => {
    const desired = planCommonEaterShares({
      amountRub: 3000,
      shares: splitAmount(3000, six),
      goingIds: six,
      eaterIds: ['b', 'c', 'd', 'e', 'f'],
      participantSince: since(six),
      expenseCreatedAt: check,
    });

    expect(desired).not.toBeNull();
    expect(desired!.map((share) => share.amountRub)).toEqual([
      600, 600, 600, 600, 600,
    ]);
    expect(desired!.some((share) => share.userId === 'a')).toBe(false);
    expect(desired!.reduce((sum, share) => sum + share.amountRub, 0)).toBe(3000);
  });

  it('вернувшийся за общий стол снова попадает в делёж', () => {
    // Чек уже поделён на пятерых: у A доли нет — её когда-то убрали.
    const desired = planCommonEaterShares({
      amountRub: 3000,
      shares: splitAmount(3000, ['b', 'c', 'd', 'e', 'f']),
      goingIds: six,
      eaterIds: six,
      participantSince: since(six),
      expenseCreatedAt: check,
    });

    expect(desired).not.toBeNull();
    expect(desired!.map((share) => share.userId)).toEqual(six);
    expect(desired!.every((share) => share.amountRub === 500)).toBe(true);
    expect(desired!.reduce((sum, share) => sum + share.amountRub, 0)).toBe(3000);
  });

  it('вышедший из похода сохраняет долю, а его часть не перекладывают', () => {
    const desired = planCommonEaterShares({
      amountRub: 3000,
      shares: splitAmount(3000, six),
      // F отказался от похода: он не going, но доля остаётся в истории.
      goingIds: ['a', 'b', 'c', 'd', 'e'],
      eaterIds: ['a', 'b', 'c', 'd', 'e'],
      participantSince: since(six),
      expenseCreatedAt: check,
    });

    expect(desired).not.toBeNull();
    expect(desired!.filter((share) => share.userId === 'f')).toEqual([
      { userId: 'f', amountRub: 500 },
    ]);
    expect(desired!.filter((share) => share.userId !== 'f')).toHaveLength(5);
    expect(desired!.reduce((sum, share) => sum + share.amountRub, 0)).toBe(3000);
  });

  it('новый участник не получает долг за закупку, которая была до него', () => {
    const desired = planCommonEaterShares({
      amountRub: 3000,
      shares: splitAmount(3000, six),
      goingIds: [...six, 'new'],
      eaterIds: [...six, 'new'],
      participantSince: new Map([...since(six), ['new', late]]),
      expenseCreatedAt: check,
    });

    expect(desired).not.toBeNull();
    expect(desired!.some((share) => share.userId === 'new')).toBe(false);
    expect(desired!).toHaveLength(6);
  });

  it('все перешли на отдельное питание — доли остаются как были', () => {
    const desired = planCommonEaterShares({
      amountRub: 3000,
      shares: splitAmount(3000, six),
      goingIds: six,
      eaterIds: [],
      participantSince: since(six),
      expenseCreatedAt: check,
    });

    // Делить не на кого: терять сумму нельзя, история остаётся.
    expect(desired).toBeNull();
  });
});

