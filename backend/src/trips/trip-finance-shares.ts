import type { EntityManager } from 'typeorm';

import { TripExpense } from './entities/trip-expense.entity';
import { TripExpenseShare } from './entities/trip-expense-share.entity';
import { TripParticipant } from './entities/trip-participant.entity';
import { splitAmount } from './finance';

/**
 * Пересобрать доли чеков «на питающихся с общего» (12.11.2026).
 *
 * **Почему это нужно.** «Чек за продукты» — расход с `split = 'commonEaters'`:
 * доли делятся между теми, кто ест с общего. Пока флаг «питаюсь отдельно»
 * не менялся, состав долей совпадает с составом едоков. Но галочку ставят
 * и после закупки — и тогда человек, который уже не ест общую еду, остаётся
 * должен за неё. Заказчик увидел именно это: «поставил галочки „питаюсь
 * отдельно“ троим после закупки общих продуктов, балансы участников
 * не изменились».
 *
 * **Почему не все расходы.** Доли расходов `all` и `group` — это решение
 * автора о конкретной трате, а не проекция состава едоков: состав похода
 * меняется, а арифметика прошедшей траты — нет (`finance.md` §2.1).
 * Пересчитываются только автоматические чеки из «Питания».
 *
 * **Кого двигаем, а кого нет.** Убирается доля только тех, кто сейчас идёт
 * и перешёл на отдельное питание; её сумма раскладывается между остальными
 * **уже участвовавшими** едоками. Так сохраняются два правила:
 *
 * - **вышедший из похода не платит меньше задним числом** — его доля
 *   в прошедшем чеке остаётся (тот же принцип, что «отказ от похода
 *   финансовую историю не стирает»);
 * - **новый участник не получает долг за чужую закупку** — его в прежнем
 *   расходе не было, и пересчёт не должен его туда добавить.
 *
 * **Почему не трогаем пустой состав.** Если все перешли на отдельное
 * питание, делить освободившуюся долю не на кого. Оставить расход без
 * долей значило бы потерять сумму (она не попала бы ни в чей минус),
 * поэтому в этом случае история остаётся как была — до первого человека,
 * вернувшегося к общему столу. Кнопка «Чек за продукты» в такой момент
 * и так выключена.
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
  const goingIds = new Set(participants.map((participant) => participant.userId));
  const eaterIds = participants
    .filter((participant) => !participant.eatsSeparately)
    .map((participant) => participant.userId);
  const eaterSet = new Set(eaterIds);

  const expenses = await manager.find(TripExpense, {
    where: { tripId, split: 'commonEaters' },
  });

  let changed = 0;

  for (const expense of expenses) {
    const shares = await manager.find(TripExpenseShare, {
      where: { expenseId: expense.id },
    });

    // Только те, кто идёт и теперь ест отдельно. Вышедшие из похода
    // остаются в истории со своей долей.
    const removed = shares.filter(
      (share) => goingIds.has(share.userId) && !eaterSet.has(share.userId),
    );
    if (removed.length === 0) continue;

    // Только уже участвовавшие едоки: новый человек не получает долг
    // за закупку, которая была до него. Порядок — состав похода.
    const activeIds = eaterIds.filter((userId) =>
      shares.some((share) => share.userId === userId),
    );
    if (activeIds.length === 0) continue;

    const activeShares = shares.filter((share) =>
      activeIds.includes(share.userId),
    );
    const pool =
      activeShares.reduce((sum, share) => sum + share.amountRub, 0) +
      removed.reduce((sum, share) => sum + share.amountRub, 0);

    const next = splitAmount(pool, activeIds);
    const nextById = new Map(next.map((share) => [share.userId, share.amountRub]));

    for (const share of activeShares) {
      const amountRub = nextById.get(share.userId);
      if (amountRub === undefined || share.amountRub === amountRub) continue;

      share.amountRub = amountRub;
      await manager.save(share);
    }

    for (const share of removed) {
      await manager.delete(TripExpenseShare, {
        expenseId: expense.id,
        userId: share.userId,
      });
    }

    changed += 1;
  }

  return changed;
}
