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

/**
 * Вход `planCommonEaterShares`: чек, его доли и текущий состав едоков.
 *
 * `participantSince` и `expenseCreatedAt` нужны, чтобы отличить нового
 * участника (долг за закупку до него не начисляется) от вернувшегося
 * за общий стол.
 */
export interface CommonEaterShareInput {
  /** Сумма чека: сумма долей всегда должна ей равняться. */
  amountRub: number;
  /** Текущие строки долей этого чека. */
  shares: readonly ShareAmount[];
  /** Идущие участники в порядке состава похода. */
  goingIds: readonly string[];
  /** Идущие, которые едят с общего, в порядке состава похода. */
  eaterIds: readonly string[];
  /** Когда человек появился в составе похода. */
  participantSince: ReadonlyMap<string, Date>;
  /** Когда чек записали: граница «был ли человек в составе». */
  expenseCreatedAt: Date;
}

/**
 * Доли чека с общего стола на текущий состав едоков (13.11.2026).
 *
 * **Зачем это здесь, а не в сервисе.** Доли чека «на питающихся с общего» —
 * не решение автора, а проекция состава едоков (`finance.md` §2.1). Поэтому
 * при смене галочки «питаюсь отдельно» доли пересобираются, и правило «кто
 * входит в делёж» должно быть проверяемо без базы: ошибка в нём однажды уже
 * оставила чек, поделённый на четырёх, когда общий стол делили шестеро.
 *
 * **Правило.** Делим на **всех текущих едоков** (`going` и не
 * `eatsSeparately`) — в этом и смысл правки 13.11.2026: раньше убирались
 * только доли вышедших из-за стола, а вернувшийся за стол человек обратно
 * в делёж не попадал, и чек тихо оставался поделённым на меньшее число
 * людей. Заказчик: «6 человек питаются вместе, A покупает на 3 000 —
 * у A +2 500, у остальных −500; A решает питаться отдельно, балансы
 * пересчитываются: A +3 000, у остальных −600».
 *
 * Два ограничения сохраняются:
 *
 * - **кто вышел из похода, тот сохраняет долю** — прошедшая трата не
 *   переписывается задним числом, и его доля не перекладывается на других;
 * - **новый участник не получает долг за закупку, которая была до него**:
 *   в делёж входят только те, кто был в составе на момент чека
 *   (`participantSince` <= `expenseCreatedAt`).
 *
 * `null` — пересчитывать нечего: делить не на кого (все за отдельным
 * столом) или исторические доли уже забрали всю сумму.
 */
export function planCommonEaterShares(
  input: CommonEaterShareInput,
): ShareAmount[] | null {
  const going = new Set(input.goingIds);

  // Вышедшие из похода остаются в истории со своей долей. Сюда же попадают
  // приглашённые: они пока не идут, но и долг с них не снимается.
  const historical = input.shares.filter((share) => !going.has(share.userId));

  const shareIds = new Set(input.shares.map((share) => share.userId));

  const currentIds = input.eaterIds.filter(
    (userId) =>
      shareIds.has(userId) ||
      (input.participantSince.get(userId)?.getTime() ?? Infinity) <=
        input.expenseCreatedAt.getTime(),
  );

  // На общем столе никого не осталось — делить не на кого. Прежние доли
  // остаются как есть: терять сумму чека нельзя.
  if (currentIds.length === 0) return null;

  const historicalSum = historical.reduce(
    (sum, share) => sum + share.amountRub,
    0,
  );
  const pool = input.amountRub - historicalSum;

  if (pool <= 0) return null;

  return [
    ...splitAmount(pool, currentIds),
    // История сохраняется дословно, даже если её человек уже не идёт.
    ...historical,
  ];
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
 * Корректировка баланса от удержания залога (17.11.2026).
 *
 * Удержанный залог заказчик назвал «доходом фонда группы»: у отказавшегося
 * баланс падает на сумму залога, у каждого идущего растёт на её долю
 * («A −залог, каждому идущему +залог/число идущих»). Сумма по всем строкам
 * одного удержания — ноль, поэтому баланс группы сходится.
 */
export interface BalanceAdjustment {
  userId: string;
  amountRub: number;
}

/**
 * Баланс каждого: «заплатил − его доля + отправленные подтверждённые
 * − полученные подтверждённые + корректировки залога».
 *
 * Положительный — человеку должны, отрицательный — он должен. Сумма
 * по всем всегда ноль: каждая трата кому-то плюс, кому-то минус.
 * Нулевыми в карту попадают все участники — иначе на экране «нет строки»
 * и «баланс ноль» выглядели бы по-разному.
 *
 * Корректировки — единственное место, где в карту может попасть человек
 * вне состава `memberIds`: удержанный залог отказавшегося остаётся в его
 * балансе, хотя он уже не идёт.
 */
export function computeBalances(
  expenses: readonly BalanceExpense[],
  compensations: readonly BalanceCompensation[],
  memberIds: readonly string[],
  adjustments: readonly BalanceAdjustment[] = [],
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

  // Удержание залога — окончательное: оно уже произошло, как и расход.
  for (const adjustment of adjustments) {
    add(adjustment.userId, adjustment.amountRub);
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
 * одной строкой. Поэтому здесь список людей, а не один `userId`: на экране
 * показываются реквизиты всех, у кого они есть, а перевод один — в общую
 * кассу семьи (12.11.2026).
 */
export interface CompensationOption {
  /** Идущие получатели этой семьи — в порядке состава похода. */
  userIds: string[];
  /** `min(долг моей семьи, кредит этой семьи)`. */
  amountRub: number;
}

/**
 * Касса семьи — общий кошелёк: **сумма остатков её участников** (12.11.2026).
 *
 * Внутри семьи деньги не считаются по людям: если Иван заплатил за общий
 * стол, а Анна должна ему свою долю, это внутреннее дело семьи, а не долг
 * перед посторонним. Поэтому плюс одного **гасит** минус другого, и семья
 * выходит на внешних контрагентов одной цифрой.
 *
 * Прежде (12.11.2026) долг и кредит считались по отдельности — суммой
 * минусов и суммой плюсов, — и семья с балансами +4 000 и −1 000 показывала
 * и долг 1 000, и кредит 4 000. Внешним семьям она была должна 1 000,
 * а получила бы 4 000: лишние переводы между семьями, которых могло
 * не быть. Заказчик назвал это «общей кассой» — одна цифра на семью.
 */
export function familyBalance(
  remaining: ReadonlyMap<string, number>,
  userIds: readonly string[],
): number {
  return userIds.reduce(
    (sum, userId) => sum + (remaining.get(userId) ?? 0),
    0,
  );
}

/** Долг семьи — касса в минусе; в плюсе долга нет. */
export function familyDebt(
  remaining: ReadonlyMap<string, number>,
  userIds: readonly string[],
): number {
  return Math.max(0, -familyBalance(remaining, userIds));
}

/** Кредит семьи — касса в плюсе; в минусе кредита нет. */
export function familyCredit(
  remaining: ReadonlyMap<string, number>,
  userIds: readonly string[],
): number {
  return Math.max(0, familyBalance(remaining, userIds));
}

/**
 * Кому может компенсировать эта семья и сколько.
 *
 * `families` — идущие участники, разложенные по семьям в порядке состава.
 * Своя семья из вариантов исключена: внутри семьи деньги не переводят.
 * Сумма варианта — `min(долг моей семьи, кредит семьи получателя)` **по
 * общей кассе**: у семьи один общий остаток, а не отдельные долги и кредиты
 * участников (12.11.2026). Если касса в нуле — вариантов нет: компенсация
 * не нужна, и кнопка на экране будет неактивной.
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
  adjustments: readonly BalanceAdjustment[] = [],
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
    adjustments,
  );
}

/** Остаток из сущностей — та же логика, что и у `computeRemaining`. */
export function remainingFromEntities(
  expenses: readonly TripExpense[],
  compensations: readonly TripCompensation[],
  memberIds: readonly string[],
  adjustments: readonly BalanceAdjustment[] = [],
): Map<string, number> {
  return computeRemaining(
    balancesFromEntities(expenses, compensations, memberIds, adjustments),
    compensations.map((compensation) => ({
      fromUserId: compensation.fromUserId,
      toUserId: compensation.toUserId,
      amountRub: compensation.amountRub,
      status: compensation.status,
    })),
  );
}
