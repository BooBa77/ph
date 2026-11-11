import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';

import { nextSortOrder } from './gear-sort';
import { GearItem } from './entities/gear-item.entity';
import { GearItemAttribute } from './entities/gear-item-attribute.entity';
import { UsersService } from '../users/users.service';
import type { FamilyPerson } from '../users/family.types';

/** Что зеркалится по клонам: всё, кроме личного порядка и одноразовости. */
export interface GearMirrorChanges {
  title?: string;
  weightGrams?: number | null;
  note?: string | null;
  location?: string | null;
  gearTypeId?: number;
}

/**
 * Семейный каталог: клоны вещи и мягкое удаление (11.11.2026).
 *
 * Заказчик: «один физический предмет — один неизменный `gear_uid`. В каталоге
 * каждого члена семьи лежит свой клон с тем же `gear_uid`. Ключ не меняется
 * никогда: ни при объединении, ни при выходе, ни при разводе».
 *
 * Здесь всё, что делает вещь общей, не превращая каталог в общий:
 *
 * - `syncClones` — новая вещь сразу заводится клонами у **прямых** родных
 *   (решено заказчиком: объединение семьи позже соберёт полные связи);
 * - `mirror` — правка вещи обновляет все активные клоны **текущей
 *   компоненты** связей; у бывшего родного его копия не трогается, потому
 *   что компонента уже другая;
 * - `softDelete` — удаление ставит `deleted_at` клонам текущей компоненты:
 *   история походов остаётся, каталог и выбор чистятся;
 * - `blockingTrip` — предохранитель: вещь, стоящую в живом решённом походе,
 *   удалять нельзя (409 с названием похода).
 *
 * Чего здесь **нет** и почему:
 * - зеркало `sort_order` — порядок у каждого свой, чужая раскладка не имеет
 *   значения;
 * - зеркало `is_trip_only` — одноразовая вещь похода не клонируется вовсе;
 * - личная группа — она выводится из типа у каждого своя, поэтому общий
 *   тип сам приезжает в клон, а полка остаётся личной.
 */
@Injectable()
export class FamilyGearService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly users: UsersService,
  ) {}

  /** Компонента связей: я и все родные, связанные со мной цепочкой пар. */
  async componentOf(
    userId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<FamilyPerson[]> {
    return this.users.familyComponent(userId, manager);
  }

  /**
   * Клоны новой вещи для прямых родных.
   *
   * Прямых, а не всех в компоненте: заказчик сказал «сразу создаются клоны
   * каждому прямому родному». Цепочка `A–B–C` доберётся объединением семьи
   * (шаг 2), а до него `C` не получает вещей `A` — это осознанное решение,
   * а не недосмотр.
   *
   * Если клон с тем же `gear_uid` уже есть (в том числе мягко удалённый),
   * он не трогается: оживление удалённого клона — сценарий объединения,
   * а не добавления вещи.
   */
  async syncClones(
    manager: EntityManager,
    source: GearItem,
  ): Promise<void> {
    if (source.isTripOnly) return;

    const relatives = (await this.users.familyMembers(source.ownerUserId)).filter(
      (person) => !person.isVirtual,
    );

    for (const person of relatives) {
      const existing = await manager.findOne(GearItem, {
        where: { gearUid: source.gearUid, ownerUserId: person.id },
      });
      if (existing) continue;

      const clone = await manager.save(
        manager.create(GearItem, {
          ownerUserId: person.id,
          gearUid: source.gearUid,
          originUserId: source.originUserId,
          gearTypeId: source.gearTypeId,
          sortOrder: await nextSortOrder(
            manager,
            person.id,
            source.gearTypeId,
          ),
          title: source.title,
          weightGrams: source.weightGrams,
          location: source.location,
          note: source.note,
          isTripOnly: false,
        }),
      );

      await this.copyAttributes(manager, source.id, clone.id);
    }
  }

  /**
   * Зеркало правки по активным клонам текущей компоненты.
   *
   * Смена типа — особый случай: клон переезжает в группу нового типа
   * **у своего владельца**, поэтому личный порядок пересчитывается для
   * каждого клона отдельно. Характеристики копируются целиком, а не
   * патчем: после смены типа набор полей другой, и старые значения
   * принадлежали бы чужому типу.
   *
   * Вызывается в той же транзакции, что и правка источника: половина
   * семьи с новым весом, половина со старым — недопустимое состояние.
   */
  async mirror(
    manager: EntityManager,
    source: GearItem,
    changes: GearMirrorChanges,
    mirrorAttributes: boolean,
  ): Promise<void> {
    const component = await this.componentOf(source.ownerUserId, manager);
    const ownerIds = component
      .filter((person) => !person.isVirtual)
      .map((person) => person.id);
    if (ownerIds.length === 0) return;

    const clones = await manager.find(GearItem, {
      where: {
        gearUid: source.gearUid,
        ownerUserId: In(ownerIds),
        deletedAt: IsNull(),
      },
    });

    const shared: Partial<GearItem> = {};
    if (changes.title !== undefined) shared.title = changes.title;
    if (changes.weightGrams !== undefined) {
      shared.weightGrams = changes.weightGrams;
    }
    if (changes.note !== undefined) shared.note = changes.note;
    if (changes.location !== undefined) shared.location = changes.location;

    for (const clone of clones) {
      if (clone.id === source.id) continue;

      const update: Partial<GearItem> = { ...shared };

      if (
        changes.gearTypeId !== undefined &&
        changes.gearTypeId !== clone.gearTypeId
      ) {
        update.gearTypeId = changes.gearTypeId;
        update.sortOrder = await nextSortOrder(
          manager,
          clone.ownerUserId,
          changes.gearTypeId,
        );
      }

      if (Object.keys(update).length > 0) {
        await manager.update(GearItem, { id: clone.id }, update);
      }

      if (mirrorAttributes) {
        await manager.delete(GearItemAttribute, { gearItemId: clone.id });
        await this.copyAttributes(manager, source.id, clone.id);
      }
    }
  }

  /**
   * Мягкое удаление клонов компоненты: `deleted_at` вместо `DELETE`.
   *
   * Восстановления нет — решение заказчика. Строки походов при этом
   * остаются: `trip_gear` ссылается на каталог через RESTRICT, а личные
   * таблицы — каскадом, и физическое удаление выдернуло бы вещь из истории.
   */
  async softDelete(
    manager: EntityManager,
    gearUid: string,
    ownerIds: string[],
  ): Promise<void> {
    if (ownerIds.length === 0) return;

    await manager.update(
      GearItem,
      {
        gearUid,
        ownerUserId: In(ownerIds),
        deletedAt: IsNull(),
      },
      { deletedAt: new Date() },
    );
  }

  /**
   * Живой поход, в котором стоит хоть один клон вещи.
   *
   * «Живой» — решённый (`decided`), не отменённый и ещё не закончившийся:
   * `COALESCE(actual_finished_at, ends_at) >= now()`. Прошедшие походы
   * не блокируют удаление (решение заказчика), предложение в планирующем
   * походе — тоже: поход ещё не решён.
   */
  async blockingTrip(
    manager: EntityManager,
    gearUid: string,
    ownerIds: string[],
  ): Promise<{ id: string; title: string } | null> {
    if (ownerIds.length === 0) return null;

    const rows = (await manager.query(
      `
      SELECT t.id::text AS "id",
             COALESCE(t.announcement, o.name, 'поход') AS "title"
        FROM (
          SELECT tg.trip_id, tg.gear_item_id
            FROM trip_gear tg
           WHERE tg.status <> 'declined'
          UNION ALL
          SELECT pg.trip_id, pg.gear_item_id
            FROM trip_personal_gear pg
          UNION ALL
          SELECT rs.trip_id, rs.gear_item_id
            FROM trip_route_sleeping rs
        ) used
        JOIN trips t ON t.id = used.trip_id
        LEFT JOIN objects o ON o.id = t.goal_object_id
        JOIN gear_items gi ON gi.id = used.gear_item_id
       WHERE gi.gear_uid = $1
         AND gi.owner_user_id = ANY($2::uuid[])
         AND t.status = 'decided'
         AND t.cancelled_at IS NULL
         AND COALESCE(t.actual_finished_at, t.ends_at) >= now()
       LIMIT 1
      `,
      [gearUid, ownerIds],
    )) as Array<{ id: string; title: string }>;

    return rows[0] ?? null;
  }

  /** Значения характеристики — копией: тип тот же, набор полей тот же. */
  private async copyAttributes(
    manager: EntityManager,
    sourceItemId: string,
    targetItemId: string,
  ): Promise<void> {
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
}
