import { In, IsNull, type EntityManager } from 'typeorm';

import { GearItem } from './entities/gear-item.entity';
import { GearItemAttribute } from './entities/gear-item-attribute.entity';
import { nextSortOrder } from './gear-sort';

/**
 * Клоны вещи в семейном каталоге: создать, оживить, слить семьи
 * (11.11.2026, шаг 2).
 *
 * Живёт отдельным файлом, а не методом `FamilyGearService`, по той же
 * причине, что `gear-uid.ts`: объединение семей запускает `UsersModule`,
 * а `GearModule` сам импортирует `UsersModule`. Сервис из `GearModule`
 * внутри «Контактов» дал бы цикл модулей, а чистая функция над
 * `EntityManager` — нет.
 *
 * Функции здесь работают с базой, но ничего не знают ни о походах, ни
 * о правах: это операции с каталогом, и вызывать их нужно **в чужой
 * транзакции** (`manager` приходит снаружи).
 */

/** Что сделало слияние: сколько клонов появилось и сколько ожило. */
export interface CloneMergeResult {
  created: number;
  revived: number;
}

/**
 * Значения характеристик — копией.
 *
 * Набор полей задаёт тип, а тип у клона тот же, поэтому переносить можно
 * целиком, без разбора по `gear_type_attributes`. Копирование начинается
 * с удаления старых значений: после смены типа прошлые принадлежали бы
 * чужому набору.
 */
export async function copyCloneAttributes(
  manager: EntityManager,
  sourceItemId: string,
  targetItemId: string,
  replace = false,
): Promise<void> {
  if (replace) {
    await manager.delete(GearItemAttribute, { gearItemId: targetItemId });
  }

  const values = await manager.find(GearItemAttribute, {
    where: { gearItemId: sourceItemId },
  });
  if (values.length === 0) return;

  await manager.insert(
    GearItemAttribute,
    values.map((row) => ({
      gearItemId: targetItemId,
      gearTypeAttributeId: row.gearTypeAttributeId,
      numberValue: row.numberValue,
      textValue: row.textValue,
      boolValue: row.boolValue,
    })),
  );
}

/**
 * Новый клон вещи в каталоге другого человека.
 *
 * `sort_order` — в конец группы **владельца клона**: чужой личный порядок
 * не переносим, а личная группа выводится из типа (`gear-sort.ts`).
 * Характеристики копируются после вставки: до неё у клона нет `id`.
 */
export async function createClone(
  manager: EntityManager,
  source: GearItem,
  ownerUserId: string,
): Promise<GearItem> {
  const clone = await manager.save(
    manager.create(GearItem, {
      ownerUserId,
      gearUid: source.gearUid,
      originUserId: source.originUserId,
      gearTypeId: source.gearTypeId,
      sortOrder: await nextSortOrder(manager, ownerUserId, source.gearTypeId),
      title: source.title,
      weightGrams: source.weightGrams,
      location: source.location,
      note: source.note,
      isTripOnly: false,
    }),
  );

  await copyCloneAttributes(manager, source.id, clone.id);

  return clone;
}

/**
 * Оживить мягко удалённый клон: залить характеристики активной копии.
 *
 * Сценарий объединения семей: у двух семей была одна и та же вещь, одна
 * сторона её удалила (`deleted_at`), а потом семьи решили объединиться.
 * Ключ `gear_uid` неизменен, поэтому новая строка не нужна — достаточно
 * снять `deleted_at`. Восстановления «в один клик» в каталоге при этом
 * нет: оживление — следствие объединения, а не отдельная ручка.
 *
 * `sort_order` пересчитывается только при смене типа: у каждого свой
 * порядок, и трогать его без причины нельзя.
 */
export async function reviveClone(
  manager: EntityManager,
  source: GearItem,
  clone: GearItem,
): Promise<void> {
  const update: Partial<GearItem> = {
    deletedAt: null,
    title: source.title,
    weightGrams: source.weightGrams,
    location: source.location,
    note: source.note,
  };

  if (clone.gearTypeId !== source.gearTypeId) {
    update.gearTypeId = source.gearTypeId;
    update.sortOrder = await nextSortOrder(
      manager,
      clone.ownerUserId,
      source.gearTypeId,
    );
  }

  await manager.update(GearItem, { id: clone.id }, update);
  await copyCloneAttributes(manager, source.id, clone.id, true);
}

/**
 * Слить каталоги: у каждого из перечисленных людей появляется клон
 * **каждой** вещи, которая есть у кого-то из них.
 *
 * Так заканчивается объединение семей: после согласия всех каждому
 * участнику нужна копия вещей всех остальных, иначе «общее снаряжение»
 * осталось бы словами. Работает и как идемпотентная догонка: активные
 * клоны пропускаются, мягко удалённые оживают, недостающие создаются.
 *
 * **Кого берём источником.** У одной и той же вещи в семье может быть
 * несколько активных копий — если семьи когда-то разошлись и у обеих
 * осталась своя. Источник выбирается детерминированно: копия **автора
 * вещи** (`origin_user_id = owner_user_id`), иначе копия с меньшим `id`.
 * Характеристики таких копий могли разойтись; объединение их не сверяет —
 * это ошибка эксплуатации, а не сценарий (`gear.md`, шаг 2).
 *
 * Одноразовые вещи похода (`is_trip_only`) не клонируются и источниками
 * не считаются: это строка конкретного похода, а не каталог.
 */
export async function mergeClones(
  manager: EntityManager,
  memberIds: string[],
): Promise<CloneMergeResult> {
  if (memberIds.length < 2) return { created: 0, revived: 0 };

  const sources = await manager.find(GearItem, {
    where: {
      ownerUserId: In(memberIds),
      deletedAt: IsNull(),
      isTripOnly: false,
    },
    order: { id: 'ASC' },
  });

  const byUid = new Map<string, GearItem>();
  for (const item of sources) {
    const current = byUid.get(item.gearUid);
    if (!current) {
      byUid.set(item.gearUid, item);
      continue;
    }
    // Авторская копия важнее любой другой — по ней и заливаем остальные.
    if (item.originUserId === item.ownerUserId) {
      byUid.set(item.gearUid, item);
    }
  }

  if (byUid.size === 0) return { created: 0, revived: 0 };

  // Все клоны этих вещей одним запросом: по ним решаем «создать или оживить».
  const existing = await manager.find(GearItem, {
    where: {
      gearUid: In([...byUid.keys()]),
      ownerUserId: In(memberIds),
    },
  });

  const byOwnerAndUid = new Map<string, GearItem>();
  for (const clone of existing) {
    byOwnerAndUid.set(`${clone.gearUid}:${clone.ownerUserId}`, clone);
  }

  const result: CloneMergeResult = { created: 0, revived: 0 };

  for (const [uid, source] of byUid) {
    for (const ownerUserId of memberIds) {
      const clone = byOwnerAndUid.get(`${uid}:${ownerUserId}`);

      if (!clone) {
        await createClone(manager, source, ownerUserId);
        result.created += 1;
        continue;
      }

      // Активная копия — не трогаем; одноразовая — не каталог.
      if (clone.deletedAt === null || clone.isTripOnly) continue;

      await reviveClone(manager, source, clone);
      result.revived += 1;
    }
  }

  return result;
}
