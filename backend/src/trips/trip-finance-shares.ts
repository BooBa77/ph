import { In, type EntityManager } from 'typeorm';

import { TripExpense } from './entities/trip-expense.entity';
import { TripExpenseShare } from './entities/trip-expense-share.entity';
import { TripParticipant } from './entities/trip-participant.entity';
import { planCommonEaterShares } from './finance';

/**
 * Пересобрать доли чеков «на питающихся с общего» (12.11.2026,
 * переписано 13.11.2026).
 *
 * **Почему это нужно.** «Чек за продукты» — расход с `split = 'commonEaters'`:
 * доли делятся между теми, кто ест с общего. Пока флаг «питаюсь отдельно»
 * не менялся, состав долей совпадает с составом едоков. Но галочку ставят
 * и после закупки — и тогда человек, который уже не ест общую еду, остаётся
 * должен за неё. Заказчик увидел именно это: «поставил галочки „питаюсь
 * отдельно“ троим после закупки общих продуктов, балансы участников
 * не изменились».
 *
 * **Что было не так в первом варианте.** Пересчёт только убирал доли
 * вышедших из-за стола, но никогда не возвращал тех, кто вернулся: чек,
 * поделённый на четырёх, оставался четырёхдольным и при шести едоках.
 * Заказчик снова видел «балансы без изменений», потому что галочка
 * у человека без доли ничего не меняла. Теперь доли **пересобираются
 * целиком** по правилу `planCommonEaterShares` (`finance.ts`): текущие едоки
 * плюс доли вышедших из похода в истории.
 *
 * **Почему не все расходы.** Доли расходов `all` и `group` — это решение
 * автора о конкретной трате, а не проекция состава едоков: состав похода
 * меняется, а арифметика прошедшей траты — нет (`finance.md` §2.1).
 * Пересчитываются только автоматические чеки из «Питания».
 *
 * Возвращает число пересчитанных расходов: по нему вызывающий понимает,
 * надо ли посылать денежное событие.
 */
export async function recalculateCommonEaterShares(
  manager: EntityManager,
  tripId: string,
): Promise<number> {
  const participants = await manager.find(TripParticipant, {
    where: { tripId, status: 'going' },
    // Порядок состава: от него зависит, кому достанется рубль остатка.
    order: { createdAt: 'ASC', userId: 'ASC' },
  });
  const goingIds = participants.map((participant) => participant.userId);
  const eaterIds = participants
    .filter((participant) => !participant.eatsSeparately)
    .map((participant) => participant.userId);
  const participantSince = new Map(
    participants.map((participant) => [
      participant.userId,
      participant.createdAt,
    ]),
  );

  const expenses = await manager.find(TripExpense, {
    where: { tripId, split: 'commonEaters' },
  });

  let changed = 0;

  for (const expense of expenses) {
    const shares = await manager.find(TripExpenseShare, {
      where: { expenseId: expense.id },
    });

    const desired = planCommonEaterShares({
      amountRub: expense.amountRub,
      shares: shares.map((share) => ({
        userId: share.userId,
        amountRub: share.amountRub,
      })),
      goingIds,
      eaterIds,
      participantSince,
      expenseCreatedAt: expense.createdAt,
    });

    // Делить не на кого — прежние доли остаются: терять сумму нельзя.
    if (desired === null) continue;

    const existing = new Map(shares.map((share) => [share.userId, share]));
    const desiredIds = new Set(desired.map((share) => share.userId));

    let touched = false;

    for (const share of desired) {
      const row = existing.get(share.userId);

      if (row === undefined) {
        await manager.save(
          manager.create(TripExpenseShare, {
            expenseId: expense.id,
            userId: share.userId,
            amountRub: share.amountRub,
          }),
        );
        touched = true;
        continue;
      }

      if (row.amountRub === share.amountRub) continue;

      row.amountRub = share.amountRub;
      await manager.save(row);
      touched = true;
    }

    // Доли, которых в новом составе нет: вышедшие из-за стола. Их сумма уже
    // разложена по текущим едокам выше — терять её нельзя.
    const extra = shares
      .filter((share) => !desiredIds.has(share.userId))
      .map((share) => share.userId);

    if (extra.length > 0) {
      await manager.delete(TripExpenseShare, {
        expenseId: expense.id,
        userId: In(extra),
      });
      touched = true;
    }

    if (touched) changed += 1;
  }

  return changed;
}
