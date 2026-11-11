import type { EntityManager } from 'typeorm';

import { GearItem } from './entities/gear-item.entity';
import { GearTypeGroup } from './entities/gear-type-group.entity';

/** Шаг личного порядка: между двумя вещами всегда есть место для вставки. */
export const SORT_STEP = 10;

/**
 * Типы, которые у человека лежат в одной группе с указанным типом.
 *
 * Понадобилось вынести из `GearService` (11.11.2026): клон вещи в чужом
 * каталоге тоже встаёт «в конец своей группы», а группу задаёт раскладка
 * **владельца клона**. Вторая копия этого запроса разошлась бы с первой
 * после правки правил группировки.
 */
export async function typeIdsOfTypeGroup(
  manager: EntityManager,
  ownerUserId: string,
  typeId: number,
): Promise<number[]> {
  const mapping = await manager.findOne(GearTypeGroup, {
    where: { ownerUserId, gearTypeId: typeId },
  });
  if (!mapping) return [typeId];

  const siblings = await manager.find(GearTypeGroup, {
    where: { ownerUserId, groupId: mapping.groupId },
  });

  return siblings.length > 0
    ? siblings.map((row) => row.gearTypeId)
    : [typeId];
}

/**
 * Следующая позиция в конце группы: «добавил — встало вниз».
 *
 * Считается по максимуму, а не по количеству: вещи удаляют (теперь ещё
 * и мягко), и позиция `count + 1` однажды совпала бы с уже занятой.
 */
export async function nextSortOrder(
  manager: EntityManager,
  ownerUserId: string,
  typeId: number,
): Promise<number> {
  const typeIds = await typeIdsOfTypeGroup(manager, ownerUserId, typeId);
  const row: { max: string | null } | undefined = await manager
    .createQueryBuilder(GearItem, 'item')
    .select('MAX(item.sort_order)', 'max')
    .where('item.owner_user_id = :ownerUserId', { ownerUserId })
    .andWhere('item.gear_type_id IN (:...typeIds)', { typeIds })
    .getRawOne();

  return Number(row?.max ?? 0) + SORT_STEP;
}
