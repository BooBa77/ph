import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import {
  CreateGearItemDto,
  GearItemDto,
  GearListDto,
  UpdateGearItemDto,
} from './dto/gear.dto';
import {
  parseAttributeValue,
  type GearValueColumns,
} from './gear-attribute-values';
import type { GearKind } from './gear.types';
import { legacyTypeCodeOfKind } from './gear.types';
import { GearItem } from './entities/gear-item.entity';
import { GearItemAttribute } from './entities/gear-item-attribute.entity';
import { GearType } from './entities/gear-type.entity';
import { GearTypeAttribute } from './entities/gear-type-attribute.entity';
import { TripGear } from './entities/trip-gear.entity';

/**
 * Личное снаряжение человека.
 *
 * Всё простое и потому опасное: «мой список» — это единственное правило
 * доступа, и оно записано одним методом (`findOwned`). Чужой предмет
 * отвечает 404, а не 403: перебирать id чужого снаряжения нечего.
 *
 * **Вещь знает тип, а тип знает характеристики** (Stage B, 30.10.2026).
 * Вид старого каталога ещё принимается в теле запроса и отдаётся в ответе,
 * но в базе его нет: `kind` переводится в код типа (`legacyTypeCodeOfKind`),
 * а в ответе считается по коду типа (`legacyKindOfTypeCode`). Это временная
 * прослойка на один шаг — экраны переходят на типы.
 *
 * Вес необязателен. `NULL` значит «не знаю», и такой предмет не попадает
 * в итог: считать его нулём — врать в сумме рюкзака, а отказываться
 * добавлять вещь без веса — заставлять человека взвешивать палатку,
 * чтобы записать её в список.
 *
 * **В поход предмет попадает через `TripGearService`** (вкладка
 * «Снаряжение», Ф7): участник выбирает предмет из этого списка, и в походе
 * появляется строка со ссылкой на каталог. Обратная связь — один запрет:
 * предмет, который уже едет в походе, отсюда не удалить (409), иначе он
 * исчез бы из подготовки молча.
 */
@Injectable()
export class GearService {
  constructor(private readonly dataSource: DataSource) {}

  /** Мой список и итог по весу. */
  async list(userId: string): Promise<GearListDto> {
    const items = await this.dataSource.manager.find(GearItem, {
      where: { ownerUserId: userId },
      relations: {
        gearType: true,
        attributes: { gearTypeAttribute: true },
      },
    });

    for (const item of items) this.sortValues(item);
    items.sort((left, right) => {
      if (left.gearType.sortOrder !== right.gearType.sortOrder) {
        return left.gearType.sortOrder - right.gearType.sortOrder;
      }
      if (left.gearType.name !== right.gearType.name) {
        return left.gearType.name.localeCompare(right.gearType.name, 'ru');
      }
      return Number(left.id) - Number(right.id);
    });

    return this.toList(items);
  }

  /** Новый предмет. */
  async create(userId: string, dto: CreateGearItemDto): Promise<GearItemDto> {
    const title = dto.title.trim();
    if (title.length === 0) {
      throw new BadRequestException('У предмета должно быть название');
    }

    const id = await this.dataSource.transaction(async (tx) => {
      const type = await this.resolveType(tx, dto);
      const attributes = await this.typeAttributes(tx, type.id);
      const active = attributes.filter((attribute) => attribute.isActive);

      const values = this.parseValues(active, dto.attributes ?? {});
      // Обязательные характеристики проверяются, когда тип пришёл полем
      // `typeId` — это новый контракт, и вместе с ним приходит форма,
      // которая обязательные поля спрашивает. Старая форма присылает
      // только вид (`kind`), заполнять значения не умеет, и блокировать
      // её значило бы «палатку в каталог больше не добавить». Прослойка
      // умирает вместе с `kind`.
      if (dto.typeId !== undefined) this.assertRequired(active, values.keys());

      const saved = await tx.save(
        tx.create(GearItem, {
          ownerUserId: userId,
          gearTypeId: type.id,
          title,
          weightGrams: dto.weightGrams ?? null,
          note: dto.note?.trim() || null,
        }),
      );
      await this.writeValues(tx, saved.id, values);

      return saved.id;
    });

    return this.loadItem(this.dataSource.manager, userId, id);
  }

  /**
   * Правка предмета.
   *
   * Присваиваем только присланное: `PATCH` без поля не меняет его,
   * а `weightGrams: null` — осознанное «стереть вес». Три состояния поля
   * различать обязательно, иначе «не прислали» и «стереть» склеятся.
   *
   * **Смена типа стирает старые значения.** Характеристики принадлежат типу:
   * «вместимость» палатки не бывает свойством топора, и оставлять её строкой
   * `gear_item_attributes` значило бы хранить значение характеристики
   * другого типа. Поэтому при смене типа значения убираются, а обязательные
   * характеристики нового типа требуется заполнить сразу — иначе человек
   * сменил бы тип и не заметил, чего не хватает.
   */
  async update(
    userId: string,
    id: number,
    dto: UpdateGearItemDto,
  ): Promise<GearItemDto> {
    const manager = this.dataSource.manager;
    const item = await this.findOwned(manager, userId, id);

    await this.dataSource.transaction(async (tx) => {
      const current = await tx.findOne(GearItem, {
        where: { id: item.id },
        relations: { attributes: true },
      });
      if (!current) throw new NotFoundException('Предмет не найден');

      const changingType = dto.typeId !== undefined || dto.kind !== undefined;
      const type = changingType ? await this.resolveType(tx, dto) : null;
      const typeId = type?.id ?? current.gearTypeId;
      const typeChanged = type !== null && type.id !== current.gearTypeId;

      const attributes =
        changingType || dto.attributes !== undefined
          ? await this.typeAttributes(tx, typeId)
          : [];
      const active = attributes.filter((attribute) => attribute.isActive);

      const values =
        dto.attributes === undefined
          ? null
          : this.parseValues(active, dto.attributes);

      /** Колонки, которые точно меняются: значений касается `writeValues`. */
      const changes: {
        title?: string;
        weightGrams?: number | null;
        note?: string | null;
        gearTypeId?: number;
      } = {};

      if (typeChanged) {
        // Значения старого типа не переживают смену типа.
        await tx.delete(GearItemAttribute, { gearItemId: current.id });
        current.attributes = [];
      }

      // Обязательные характеристики проверяются, когда тип пришёл полем
      // `typeId` — это новый контракт, и вместе с ним приходит форма,
      // которая обязательные поля спрашивает. Старая форма присылает
      // только вид (`kind`), заполнять значения не умеет, и блокировать
      // её значило бы «палатку в каталог больше не добавить» или «вид
      // не поменять». Прослойка умирает вместе с `kind`.
      const strict = dto.typeId !== undefined;

      if (strict && (typeChanged || values !== null)) {
        const willHave = new Set(
          typeChanged
            ? []
            : current.attributes.map((row) => row.gearTypeAttributeId),
        );
        for (const [attributeId, columns] of values ?? []) {
          if (columns === null) willHave.delete(attributeId);
          else willHave.add(attributeId);
        }
        this.assertRequired(active, willHave);
      }

      if (dto.title !== undefined) {
        const title = dto.title.trim();
        if (title.length === 0) {
          throw new BadRequestException('У предмета должно быть название');
        }
        changes.title = title;
      }

      if (dto.weightGrams !== undefined) changes.weightGrams = dto.weightGrams;
      if (dto.note !== undefined) changes.note = dto.note?.trim() || null;
      if (typeChanged) changes.gearTypeId = typeId;

      if (values !== null) await this.writeValues(tx, current.id, values);

      // `update`, а не `save`: `save` синхронизирует загруженную коллекцию
      // значений и обнулил бы `gear_item_id` у строк, вставленных строкой
      // выше (orphanedRowAction OneToMany). Поэтому пишем только колонки.
      if (Object.keys(changes).length > 0) {
        await tx.update(GearItem, { id: current.id }, changes);
      }
    });

    return this.loadItem(manager, userId, String(id));
  }

  /**
   * Удалить предмет.
   *
   * Вещь, которая уже предложена в поход, удалить нельзя: в походе она
   * ссылается на каталог (`trip_gear`), и «удалить молча» значило бы
   * выдернуть палатку из подготовки, о которой договорились. Отвечаем
   * 409 и говорим, что делать: сначала убрать её из похода.
   *
   * Значения характеристик уходят каскадом (`ON DELETE CASCADE`) —
   * отдельного удаления не нужно.
   */
  async remove(userId: string, id: number): Promise<void> {
    const manager = this.dataSource.manager;
    const item = await this.findOwned(manager, userId, id);

    const usedInTrips = await manager.count(TripGear, {
      where: { gearItemId: item.id },
    });
    if (usedInTrips > 0) {
      throw new ConflictException(
        'Предмет уже едет в походе — сначала уберите его из снаряжения похода',
      );
    }

    await manager.delete(GearItem, { id: item.id });
  }

  // ───────────────────────── внутреннее ─────────────────────────

  /**
   * Тип из тела запроса: `typeId` побеждает `kind`.
   *
   * `kind` — прослойка перехода: форма личного каталога ещё присылает вид,
   * и сервер переводит его в код типа, заведённый миграцией
   * (`1792271000000-GearItemTypes`). Архивный тип не принимается: вещь
   * в архивном типе нечем показать и не по чему фильтровать.
   */
  private async resolveType(
    manager: EntityManager,
    dto: { typeId?: number; kind?: GearKind },
  ): Promise<GearType> {
    if (dto.typeId !== undefined) {
      const type = await manager.findOne(GearType, {
        where: { id: dto.typeId },
      });
      if (!type) throw new BadRequestException('Тип снаряжения не найден');
      this.assertTypeActive(type);

      return type;
    }

    if (dto.kind !== undefined) {
      const code = legacyTypeCodeOfKind(dto.kind);
      const type = await manager.findOne(GearType, { where: { code } });
      if (!type) {
        throw new BadRequestException(
          'Для этого вида снаряжения не заведён тип — выберите тип из справочника',
        );
      }
      this.assertTypeActive(type);

      return type;
    }

    throw new BadRequestException('Укажите тип снаряжения');
  }

  private assertTypeActive(type: GearType): void {
    if (!type.isActive) {
      throw new BadRequestException(
        'Тип снаряжения в архиве — выберите действующий',
      );
    }
  }

  /** Все характеристики типа, включая архивные: по ним ловим ошибку в ключе. */
  private async typeAttributes(
    manager: EntityManager,
    typeId: number,
  ): Promise<GearTypeAttribute[]> {
    const attributes = await manager.find(GearTypeAttribute, {
      where: { gearTypeId: typeId },
      relations: { options: true },
    });

    return attributes.sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) {
        return left.sortOrder - right.sortOrder;
      }

      return left.id - right.id;
    });
  }

  private async activeAttributes(
    manager: EntityManager,
    typeId: number,
  ): Promise<GearTypeAttribute[]> {
    const attributes = await this.typeAttributes(manager, typeId);

    return attributes.filter((attribute) => attribute.isActive);
  }

  /**
   * Карта «характеристика → колонки значения» из тела запроса.
   *
   * Ключ — код характеристики. Неизвестный код и архивная характеристика —
   * 400 с названием типа: молча проглоченная опечатка сохранила бы вещь
   * без значения, и человек узнал бы об этом через месяц.
   */
  private parseValues(
    attributes: GearTypeAttribute[],
    raw: Record<string, unknown>,
  ): Map<number, GearValueColumns | null> {
    const byCode = new Map(
      attributes.map((attribute) => [attribute.code, attribute]),
    );
    const values = new Map<number, GearValueColumns | null>();

    for (const [code, value] of Object.entries(raw)) {
      const attribute = byCode.get(code);
      if (!attribute) {
        const list = attributes.map((row) => row.code).join(', ');
        throw new BadRequestException(
          list.length === 0
            ? `У типа снаряжения нет характеристики «${code}» — характеристики задаёт админ в справочнике`
            : `У типа снаряжения нет характеристики «${code}». Есть: ${list}`,
        );
      }

      const optionNames = (attribute.options ?? [])
        .filter((option) => option.isActive)
        .sort((left, right) => {
          if (left.sortOrder !== right.sortOrder) {
            return left.sortOrder - right.sortOrder;
          }

          return left.id - right.id;
        })
        .map((option) => option.name);

      values.set(
        attribute.id,
        parseAttributeValue(attribute, value, optionNames),
      );
    }

    return values;
  }

  /**
   * Обязательные характеристики должны быть заполнены.
   *
   * Проверяется при создании вещи и при смене типа — то есть когда состав
   * характеристик определяется заново. Старые вещи с дырой в обязательной
   * характеристике правятся свободно: значение появилось раньше, чем
   * обязательность, и запрещать из-за этого переименование было бы хамством.
   * Массовое заполнение пустых значений — это `fillMissing` в справочнике.
   */
  private assertRequired(
    attributes: GearTypeAttribute[],
    present: Iterable<number>,
  ): void {
    const filled = new Set(present);
    const missing = attributes
      .filter(
        (attribute) => attribute.isRequired && !filled.has(attribute.id),
      )
      .map((attribute) => `«${attribute.name}»`);

    if (missing.length > 0) {
      throw new BadRequestException(
        `Заполните обязательные характеристики: ${missing.join(', ')}`,
      );
    }
  }

  /** Запись значений: `null` — стереть, колонки — вставить или обновить. */
  private async writeValues(
    manager: EntityManager,
    itemId: string,
    values: Map<number, GearValueColumns | null>,
  ): Promise<void> {
    for (const [attributeId, columns] of values) {
      const existing = await manager.findOne(GearItemAttribute, {
        where: { gearItemId: itemId, gearTypeAttributeId: attributeId },
      });

      if (columns === null) {
        if (existing) await manager.delete(GearItemAttribute, { id: existing.id });
        continue;
      }

      if (existing) {
        existing.numberValue = columns.numberValue;
        existing.textValue = columns.textValue;
        existing.boolValue = columns.boolValue;
        await manager.save(existing);
      } else {
        await manager.save(
          manager.create(GearItemAttribute, {
            gearItemId: itemId,
            gearTypeAttributeId: attributeId,
            ...columns,
          }),
        );
      }
    }
  }

  /** Значения в порядке справочника: активные и по `sort_order`. */
  private sortValues(item: GearItem): void {
    item.attributes = [...(item.attributes ?? [])].sort((left, right) => {
      const leftAttribute = left.gearTypeAttribute;
      const rightAttribute = right.gearTypeAttribute;
      if (leftAttribute.sortOrder !== rightAttribute.sortOrder) {
        return leftAttribute.sortOrder - rightAttribute.sortOrder;
      }

      return leftAttribute.id - rightAttribute.id;
    });
  }

  /** Мой предмет с типом и значениями — или 404: чужой не существует. */
  private async loadItem(
    manager: EntityManager,
    userId: string,
    id: string,
  ): Promise<GearItemDto> {
    const item = await manager.findOne(GearItem, {
      where: { id, ownerUserId: userId },
      relations: { gearType: true, attributes: { gearTypeAttribute: true } },
    });
    if (!item) throw new NotFoundException('Предмет не найден');

    this.sortValues(item);

    return GearItemDto.from(item);
  }

  /** Предмет без связей: нужен только id и запрет на удаление. */
  private async findOwned(
    manager: EntityManager,
    userId: string,
    id: number,
  ): Promise<GearItem> {
    const item = await manager.findOne(GearItem, {
      where: { id: String(id), ownerUserId: userId },
    });
    if (!item) throw new NotFoundException('Предмет не найден');

    return item;
  }

  /** Список с итогом: сумма известных весов и сколько осталось без веса. */
  private toList(items: GearItem[]): GearListDto {
    let totalWeightGrams = 0;
    let itemsWithoutWeight = 0;

    for (const item of items) {
      if (item.weightGrams === null) itemsWithoutWeight += 1;
      else totalWeightGrams += item.weightGrams;
    }

    return {
      items: items.map((item) => GearItemDto.from(item)),
      totalWeightGrams,
      itemsWithoutWeight,
    };
  }
}
