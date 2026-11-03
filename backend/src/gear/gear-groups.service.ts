import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import {
  AssignGearGroupTypeDto,
  CreateGearGroupDto,
  GearGroupDto,
  GearGroupListDto,
  UpdateGearGroupDto,
} from './dto/gear-group.dto';
import type { GearGroupMoveDirection } from './gear.types';
import { GearGroupTemplate } from './entities/gear-group-template.entity';
import { GearGroup } from './entities/gear-group.entity';
import { GearTypeGroup } from './entities/gear-type-group.entity';
import { GearType } from './entities/gear-type.entity';
import { GEAR_DEFAULT_GROUP_CODE } from './gear.types';

/** Шаг порядка групп: между соседями всегда есть куда вставить. */
const GROUP_SORT_STEP = 10;

/**
 * Результат «у пользователя точно есть группы и раскладка типов».
 *
 * `groupByType` — карта «тип → личная группа», по ней каталог раскладывает
 * вещи по секциям. `defaultGroup` — «Прочее»: туда попадает тип, для
 * которого нет ни раскладки, ни рекомендуемой группы.
 */
export interface UserGrouping {
  groups: GearGroup[];
  defaultGroup: GearGroup;
  groupByType: Map<number, GearGroup>;
  types: GearType[];
}

/**
 * Личные группы снаряжения (02.11.2026).
 *
 * Модель заказчика: «Типы, по-прежнему, создаёт админ, потому что там
 * задаются характеристики. А группировать их разрешим самостоятельно.
 * Заводим рекомендуемые группы, они управляются админом, приходят новым
 * пользователям и с новыми типами, но пользователь в праве сам менять их
 * под себя».
 *
 * Поэтому сервис делает две вещи:
 *
 * 1. **Материализует копии шаблонов** — лениво, при первом обращении
 *    к каталогу (`ensure`). Шаблоны правит админ (`GearGroupTemplatesService`),
 *    но копия — собственность человека: он её переименовывает, удаляет
 *    и переставляет, и это не трогает никого другого.
 * 2. **Держит раскладку типов** — `gear_type_groups`: один тип ровно
 *    в одной группе. Новый тип приходит в группу, которую админ указал
 *    рекомендованной; если человек эту группу удалил, тип ложится
 *    в «Прочее».
 *
 * **«Прочее» — неудаляемое и последнее.** Его нельзя удалить (409) и нельзя
 * переставить выше других (400): это умолчание и место, куда переезжают
 * типы удалённой группы. Порядок остальных групп человек задаёт стрелками.
 *
 * **Пустые группы в каталоге не показываются**, но в настройке группировки
 * видны: иначе только что созданную группу некуда было бы положить тип,
 * а опустевшую нельзя было бы удалить.
 */
@Injectable()
export class GearGroupsService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Группы человека с их типами — ответ экрана каталога и настройки.
   *
   * Перед чтением досоздаёт недостающее (`ensure`): без этого новый
   * пользователь увидел бы пустой список групп, а новый тип — ни в одной.
   */
  async list(userId: string): Promise<GearGroupListDto> {
    const grouping = await this.ensure(userId);

    return this.toList(grouping);
  }

  /**
   * Убедиться, что у человека есть личные группы и раскладка **всех** типов.
   *
   * Работает идемпотентно и в одной транзакции: массовый первый заход
   * не создаст дублей. Вставки идут через `ON CONFLICT DO NOTHING`, потому
   * что два параллельных запроса (каталог и настройка) могут прийти
   * одновременно.
   *
   * Архивные типы тоже раскладываются: у человека могут быть вещи в типе,
   * который админ позже отправил в архив, и без строки раскладки вещь
   * осталась бы без секции.
   */
  async ensure(userId: string): Promise<UserGrouping> {
    return this.dataSource.transaction(async (tx) => {
      const templates = await tx.find(GearGroupTemplate, {
        order: { sortOrder: 'ASC', id: 'ASC' },
      });
      const groups = await tx.find(GearGroup, {
        where: { ownerUserId: userId },
        order: { sortOrder: 'ASC', id: 'ASC' },
      });

      // Первый заход: групп ещё нет вовсе. «Прочее» неудаляемо, поэтому
      // у вернувшегося человека групп не может быть ноль — значит, копии
      // шаблонов создаются ровно один раз. Иначе удалённая человеком группа
      // воскресала бы при каждом открытии каталога, и «сам меняет их под
      // себя» было бы неправдой.
      const isFirstVisit = groups.length === 0;

      const otherTemplate = templates.find(
        (template) => template.code === GEAR_DEFAULT_GROUP_CODE,
      );

      let defaultGroup = groups.find(
        (group) => group.templateCode === GEAR_DEFAULT_GROUP_CODE,
      );

      if (!defaultGroup) {
        defaultGroup = await this.insertGroup(tx, userId, {
          templateCode: GEAR_DEFAULT_GROUP_CODE,
          name: otherTemplate?.name ?? 'Прочее',
          sortOrder: this.maxSort(groups) + GROUP_SORT_STEP,
        });
        groups.push(defaultGroup);
      }

      const groupsByTemplate = new Map(
        groups
          .filter((group) => group.templateCode !== null)
          .map((group) => [group.templateCode as string, group]),
      );

      // Копии **всех** действующих шаблонов — только при первом заходе:
      // «рекомендуемые группы приходят новым пользователям». Пустая группа
      // тоже приходит, человек наполнит её сам. Дальше недостающую группу
      // создаёт `resolveTargetGroup`, когда админ рекомендует в неё новый
      // тип, — то есть «приходят с новыми типами».
      if (isFirstVisit) {
        for (const template of templates) {
          if (!template.isActive) continue;
          if (template.code === GEAR_DEFAULT_GROUP_CODE) continue;
          if (groupsByTemplate.has(template.code)) continue;

          const created = await this.insertGroup(tx, userId, {
            templateCode: template.code,
            name: template.name,
            sortOrder: template.sortOrder,
          });
          groups.push(created);
          groupsByTemplate.set(template.code, created);
        }
      }

      // «Прочее» всегда последнее. Проверка стоит **после** раскладки:
      // `resolveTargetGroup` может создать копию нового шаблона и поставить
      // её в конец, и тогда «Прочее» перестало бы быть последним.
      const types = await tx.find(GearType, {
        order: { sortOrder: 'ASC', id: 'ASC' },
      });
      const mappings = await tx.find(GearTypeGroup, {
        where: { ownerUserId: userId },
      });
      const mappingByType = new Map(
        mappings.map((mapping) => [mapping.gearTypeId, mapping]),
      );
      const groupByType = new Map<number, GearGroup>();

      for (const type of types) {
        const mapping = mappingByType.get(type.id);
        const current = mapping
          ? groups.find((group) => group.id === mapping.groupId)
          : undefined;

        if (mapping && current) {
          groupByType.set(type.id, current);
          continue;
        }

        const target = await this.resolveTargetGroup(
          tx,
          userId,
          type,
          templates,
          groups,
          groupsByTemplate,
          defaultGroup,
        );

        if (mapping) {
          mapping.groupId = target.id;
          await tx.save(mapping);
        } else {
          await tx
            .createQueryBuilder()
            .insert()
            .into(GearTypeGroup)
            .values({
              ownerUserId: userId,
              gearTypeId: type.id,
              groupId: target.id,
            })
            .orIgnore()
            .execute();
        }

        groupByType.set(type.id, target);
      }

      // Теперь, когда новые копии шаблонов созданы, «Прочее» снова
      // отправляем в конец: иначе новая группа оказалась бы под свалкой.
      const maxOthers = Math.max(
        0,
        ...groups
          .filter((group) => group.id !== defaultGroup.id)
          .map((group) => group.sortOrder),
      );
      if (defaultGroup.sortOrder <= maxOthers) {
        defaultGroup.sortOrder = maxOthers + GROUP_SORT_STEP;
        await tx.save(defaultGroup);
      }

      groups.sort(
        (left, right) =>
          left.sortOrder - right.sortOrder || left.id - right.id,
      );

      return { groups, defaultGroup, groupByType, types };
    });
  }

  /** Группа человека с типами — по id; чужая отвечает 404. */
  async findOwned(userId: string, id: number): Promise<GearGroup> {
    const group = await this.dataSource.manager.findOne(GearGroup, {
      where: { id, ownerUserId: userId },
    });
    if (!group) throw new NotFoundException('Группа снаряжения не найдена');

    return group;
  }

  /** Своя группа. Встаёт перед «Прочим», если порядок не задан явно. */
  async create(
    userId: string,
    dto: CreateGearGroupDto,
  ): Promise<GearGroupListDto> {
    const grouping = await this.ensure(userId);
    const name = this.normalizeName(dto.name);
    this.assertNameFree(grouping.groups, name);

    await this.dataSource.transaction(async (tx) => {
      const defaultGroup = await tx.findOneOrFail(GearGroup, {
        where: { id: grouping.defaultGroup.id },
      });

      let sortOrder = dto.sortOrder;
      if (sortOrder === undefined) {
        // Новую группу ставят перед свалкой, а «Прочее» съезжает вниз.
        sortOrder = defaultGroup.sortOrder;
        defaultGroup.sortOrder += GROUP_SORT_STEP;
        await tx.save(defaultGroup);
      } else if (sortOrder >= defaultGroup.sortOrder) {
        defaultGroup.sortOrder = sortOrder + GROUP_SORT_STEP;
        await tx.save(defaultGroup);
      }

      await this.insertGroup(tx, userId, { name, sortOrder });
    });

    return this.list(userId);
  }

  /**
   * Правка группы: имя и порядок.
   *
   * «Прочее» переименовать можно, переставить — нет: оно обязано остаться
   * последним, иначе порядок секций каталога теряет смысл.
   */
  async update(
    userId: string,
    id: number,
    dto: UpdateGearGroupDto,
  ): Promise<GearGroupListDto> {
    const grouping = await this.ensure(userId);

    await this.dataSource.transaction(async (tx) => {
      const group = await tx.findOne(GearGroup, {
        where: { id, ownerUserId: userId },
      });
      if (!group) throw new NotFoundException('Группа снаряжения не найдена');

      if (dto.name !== undefined) {
        const name = this.normalizeName(dto.name);
        this.assertNameFree(grouping.groups, name, group.id);
        group.name = name;
      }

      if (dto.sortOrder !== undefined) {
        if (group.id === grouping.defaultGroup.id) {
          throw new BadRequestException(
            '«Прочее» всегда последнее: переставить его нельзя',
          );
        }
        group.sortOrder = dto.sortOrder;
        if (group.sortOrder >= grouping.defaultGroup.sortOrder) {
          const defaultGroup = await tx.findOneOrFail(GearGroup, {
            where: { id: grouping.defaultGroup.id },
          });
          defaultGroup.sortOrder = group.sortOrder + GROUP_SORT_STEP;
          await tx.save(defaultGroup);
        }
      }

      await tx.save(group);
    });

    return this.list(userId);
  }

  /**
   * Удалить группу. Типы переезжают в «Прочее» — не теряются с вещами.
   *
   * «Прочее» удалить нельзя (409): это умолчание для типа без раскладки.
   */
  async remove(userId: string, id: number): Promise<GearGroupListDto> {
    const grouping = await this.ensure(userId);

    if (id === grouping.defaultGroup.id) {
      throw new ConflictException(
        '«Прочее» удалить нельзя: это группа по умолчанию, в неё попадают типы без своей группы',
      );
    }

    await this.dataSource.transaction(async (tx) => {
      const group = await tx.findOne(GearGroup, {
        where: { id, ownerUserId: userId },
      });
      if (!group) throw new NotFoundException('Группа снаряжения не найдена');

      await tx.update(
        GearTypeGroup,
        { ownerUserId: userId, groupId: group.id },
        { groupId: grouping.defaultGroup.id },
      );
      await tx.delete(GearGroup, { id: group.id });
    });

    return this.list(userId);
  }

  /**
   * Переставить группу на позицию выше или ниже.
   *
   * «Прочее» не двигается (400). После перестановки порядок перенумеровывается
   * шагом 10: одинаковые `sort_order` (старые данные) иначе не давали бы
   * перестановке эффекта.
   */
  async move(
    userId: string,
    id: number,
    direction: GearGroupMoveDirection,
  ): Promise<GearGroupListDto> {
    const grouping = await this.ensure(userId);

    if (id === grouping.defaultGroup.id) {
      throw new BadRequestException(
        '«Прочее» всегда последнее: переставить его нельзя',
      );
    }

    await this.dataSource.transaction(async (tx) => {
      const groups = await tx.find(GearGroup, {
        where: { ownerUserId: userId },
        order: { sortOrder: 'ASC', id: 'ASC' },
      });
      const movable = groups.filter(
        (group) => group.id !== grouping.defaultGroup.id,
      );
      const index = movable.findIndex((group) => group.id === id);
      if (index === -1) throw new NotFoundException('Группа снаряжения не найдена');

      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= movable.length) return;

      const [moved] = movable.splice(index, 1);
      if (!moved) return;
      movable.splice(target, 0, moved);

      let order = GROUP_SORT_STEP;
      for (const group of movable) {
        if (group.sortOrder !== order) {
          await tx.update(GearGroup, { id: group.id }, { sortOrder: order });
        }
        order += GROUP_SORT_STEP;
      }

      const defaultGroup = await tx.findOneOrFail(GearGroup, {
        where: { id: grouping.defaultGroup.id },
      });
      if (defaultGroup.sortOrder !== order) {
        await tx.update(GearGroup, { id: defaultGroup.id }, { sortOrder: order });
      }
    });

    return this.list(userId);
  }

  /**
   * Переложить тип в группу.
   *
   * Тип один на человека (`UNIQUE` в `gear_type_groups`), поэтому это
   * «переезд», а не «добавление»: в прежней группе он исчезает. Архивный
   * тип не перекладывают — он не предлагается новым вещам.
   */
  async assignType(
    userId: string,
    groupId: number,
    dto: AssignGearGroupTypeDto,
  ): Promise<GearGroupListDto> {
    await this.ensure(userId);

    const manager = this.dataSource.manager;
    const group = await manager.findOne(GearGroup, {
      where: { id: groupId, ownerUserId: userId },
    });
    if (!group) throw new NotFoundException('Группа снаряжения не найдена');

    const type = await manager.findOne(GearType, {
      where: { id: dto.typeId },
    });
    if (!type) throw new BadRequestException('Тип снаряжения не найден');
    if (!type.isActive) {
      throw new BadRequestException(
        'Тип снаряжения в архиве — перекладывать его незачем',
      );
    }

    const existing = await manager.findOne(GearTypeGroup, {
      where: { ownerUserId: userId, gearTypeId: type.id },
    });
    if (existing) {
      if (existing.groupId !== group.id) {
        existing.groupId = group.id;
        await manager.save(existing);
      }
    } else {
      await manager
        .createQueryBuilder()
        .insert()
        .into(GearTypeGroup)
        .values({ ownerUserId: userId, gearTypeId: type.id, groupId: group.id })
        .orIgnore()
        .execute();
    }

    return this.list(userId);
  }

  // ───────────────────────── внутреннее ─────────────────────────

  /** Личная группа по коду шаблона — для ленивой материализации копий. */
  private async ensureGroupForTemplate(
    manager: EntityManager,
    userId: string,
    template: GearGroupTemplate,
    groups: GearGroup[],
    groupsByTemplate: Map<string, GearGroup>,
  ): Promise<GearGroup> {
    const existing = groupsByTemplate.get(template.code);
    if (existing) return existing;

    const order =
      Math.max(0, ...groups.map((group) => group.sortOrder)) + GROUP_SORT_STEP;
    const created = await this.insertGroup(manager, userId, {
      templateCode: template.code,
      name: template.name,
      sortOrder: order,
    });
    groups.push(created);
    groupsByTemplate.set(template.code, created);

    return created;
  }

  private async resolveTargetGroup(
    manager: EntityManager,
    userId: string,
    type: GearType,
    templates: GearGroupTemplate[],
    groups: GearGroup[],
    groupsByTemplate: Map<string, GearGroup>,
    defaultGroup: GearGroup,
  ): Promise<GearGroup> {
    if (type.recommendedGroupId === null) return defaultGroup;

    const template = templates.find(
      (row) => row.id === type.recommendedGroupId,
    );
    // Архивный шаблон новым типам не рекомендуют, но у старой строки он
    // может остаться: копию не создаём, тип ложится в «Прочее».
    if (!template || !template.isActive) return defaultGroup;

    return this.ensureGroupForTemplate(
      manager,
      userId,
      template,
      groups,
      groupsByTemplate,
    );
  }

  /**
   * Вставка группы с защитой от гонки.
   *
   * `ON CONFLICT DO NOTHING` умеет только конфликт уникального индекса;
   * если параллельный запрос уже создал копию шаблона, забираем её.
   */
  private async insertGroup(
    manager: EntityManager,
    userId: string,
    data: { name: string; sortOrder: number; templateCode?: string },
  ): Promise<GearGroup> {
    const values = {
      ownerUserId: userId,
      name: data.name,
      sortOrder: data.sortOrder,
      templateCode: data.templateCode ?? null,
    };

    const inserted = await manager
      .createQueryBuilder()
      .insert()
      .into(GearGroup)
      .values(values)
      .orIgnore()
      .returning('*')
      .execute();

    if (inserted.raw.length > 0) {
      const row = inserted.raw[0] as Record<string, unknown>;

      return manager.create(GearGroup, {
        id: Number(row.id),
        ownerUserId: String(row.owner_user_id),
        templateCode: (row.template_code as string | null) ?? null,
        name: String(row.name),
        sortOrder: Number(row.sort_order),
      });
    }

    const found = await manager.findOne(GearGroup, {
      where: {
        ownerUserId: userId,
        ...(data.templateCode === undefined
          ? { name: data.name }
          : { templateCode: data.templateCode }),
      },
    });
    if (!found) throw new ConflictException('Не удалось создать группу');

    return found;
  }

  private maxSort(groups: GearGroup[]): number {
    return Math.max(0, ...groups.map((group) => group.sortOrder));
  }

  private toList(grouping: UserGrouping): GearGroupListDto {
    return {
      items: grouping.groups.map((group) =>
        GearGroupDto.from(
          group,
          grouping.types
            .filter(
              (type) => grouping.groupByType.get(type.id)?.id === group.id,
            )
            .sort((left, right) => left.name.localeCompare(right.name, 'ru')),
        ),
      ),
    };
  }

  private normalizeName(raw: string): string {
    const name = raw.trim();
    if (name.length === 0) {
      throw new BadRequestException('У группы должно быть название');
    }
    if (name.length > 100) {
      throw new BadRequestException(
        'Название группы не должно превышать 100 символов',
      );
    }

    return name;
  }

  /** Одинаковые имена групп у одного человека путали бы выбор. */
  private assertNameFree(
    groups: GearGroup[],
    name: string,
    exceptId?: number,
  ): void {
    const clash = groups.find(
      (group) =>
        group.id !== exceptId &&
        group.name.toLowerCase() === name.toLowerCase(),
    );
    if (clash) {
      throw new ConflictException(`Группа «${name}» уже есть`);
    }
  }
}
