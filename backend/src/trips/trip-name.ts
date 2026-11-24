import type { EntityManager } from 'typeorm';

import { GeoObject } from './entities/geo-object.entity';
import type { Trip } from './entities/trip.entity';

/**
 * Название похода в человеческом тексте: уведомления, подписи чатов.
 *
 * **Имя похода — цель** (`objects.name`), так решил заказчик 24.11.2026:
 * «Борис перевёл тебе 1000 ₽ за поход «Хамар-Дабан». Цель похода является
 * его именем, анонс это для гостевой». Анонс — подпись для гостевой вкладки
 * и ленты, а не название: два похода на одно плато различимы анонсом, но
 * имя у обоих — плато.
 *
 * Функция одна на все уведомления намеренно. До 24.11.2026 копий было три:
 * в альманахе «анонс → цель → номер», в деньгах «анонс → номер», в подписях
 * чатов «анонс → цель → номер». Один поход назывался по-разному в соседних
 * сообщениях, и заказчик справедливо не мог понять, какое написание верное.
 * Теперь её зовут деньги, альманах и подписи чатов.
 *
 * `goal_object_id` обязателен (поход без цели — не поход), поэтому запасной
 * вариант — только номер: он нужен, если цель удалили из справочника.
 *
 * `trip.goalObject` может быть уже загружен (`{ relations: { goalObject: true } }`) —
 * тогда лишнего запроса нет.
 */
export async function tripNameOf(
  manager: EntityManager,
  trip: Trip,
): Promise<string> {
  if (trip.goalObject?.name) return trip.goalObject.name;

  if (trip.goalObjectId) {
    const goal = await manager.findOne(GeoObject, {
      where: { id: trip.goalObjectId },
    });

    if (goal?.name) return goal.name;
  }

  return `поход #${trip.id}`;
}
