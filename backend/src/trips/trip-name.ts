import type { EntityManager } from 'typeorm';

import { GeoObject } from './entities/geo-object.entity';
import type { Trip } from './entities/trip.entity';

/**
 * Название похода в человеческом тексте: уведомления, подписи чатов.
 *
 * Порядок задан заказчиком дважды и в двух местах: 24.11.2026 он поправил
 * уведомление альманаха («„Поход для проверки альманаха“ — это анонс, а не
 * цель „Хамар-Дабан“»), а подпись чата похода была такой же с 23.11.2026.
 * Анонс — необязательное поле, поэтому у него есть подстраховка: цель
 * (она у похода обязательна), а если нет и её — номер.
 *
 * Функция одна на все уведомления намеренно. До 24.11.2026 их было три:
 * в альманахе «анонс → цель → номер», в деньгах «анонс → номер», в подписях
 * чатов «анонс → цель → номер». Из-за этого один и тот же поход назывался
 * по-разному в соседних сообщениях, и заказчик справедливо не мог понять,
 * какое из написаний верное.
 *
 * `trip.goalObject` может быть уже загружен (`{ relations: { goalObject: true } }`) —
 * тогда лишнего запроса нет.
 */
export async function tripNameOf(
  manager: EntityManager,
  trip: Trip,
): Promise<string> {
  const announcement = trip.announcement?.trim();
  if (announcement) return announcement;

  if (trip.goalObject?.name) return trip.goalObject.name;

  if (trip.goalObjectId) {
    const goal = await manager.findOne(GeoObject, {
      where: { id: trip.goalObjectId },
    });

    if (goal?.name) return goal.name;
  }

  return `поход #${trip.id}`;
}
