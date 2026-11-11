import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';

import {
  CreateGearItemDto,
  GearItemDto,
  GearListDto,
  UpdateGearItemDto,
} from './dto/gear.dto';
import type { GearMoveDirection } from './dto/gear.dto';
import {
  parseAttributeValue,
  type GearValueColumns,
} from './gear-attribute-values';
import { GearGroupsService, type UserGrouping } from './gear-groups.service';
import { SORT_STEP, nextSortOrder, typeIdsOfTypeGroup } from './gear-sort';
import { FamilyGearService } from './family-gear.service';
import type { GearGroup } from './entities/gear-group.entity';
import { GearItem } from './entities/gear-item.entity';
import { GearItemAttribute } from './entities/gear-item-attribute.entity';
import { GearType } from './entities/gear-type.entity';
import { GearTypeAttribute } from './entities/gear-type-attribute.entity';

/**
 * Данные для заведения вещи — общие для каталога и для «вручную» в походе.
 *
 * Один путь на две ручки: `POST /api/gear` (каталог) и
 * `POST /api/trips/:id/gear/manual` (одноразовая вещь похода, 30.10.2026).
 * Разница только в `tripOnly` и в том, что у одноразовой вещи названия
 * может не быть.
 */
export interface CreateItemData {
  typeId: number;
  attributes?: Record<string, unknown>;
  /** `null`/пусто — подписать именем типа (только для одноразовой вещи). */
  title?: string | null;
  weightGrams?: number | null;
  location?: string | null;
  note?: string | null;
  tripOnly: boolean;
}

/**
 * Личное снаряжение человека.
 *
 * Всё простое и потому опасное: «мой список» — это единственное правило
 * доступа, и оно записано одним методом (`findOwned`). Чужой предмет
 * отвечает 404, а не 403: перебирать id чужого снаряжения нечего.
 *
 * **Вещь знает тип, а тип знает характеристики** (Stage B, 30.10.2026).
 * Вида старого каталога (`kind`) в контракте больше нет: экраны перешли
 * на коды типов, и прослойка «вид → тип» удалена. `typeId` обязателен
 * при создании и единственный способ сменить тип при правке.
 *
 * **Каталог — не все вещи владельца** (30.10.2026). Вещь, заведённая
 * «вручную» в походе, живёт только там (`is_trip_only`), и каталог её
 * **не отдаёт** — ни владельцу, ни организатору. Поэтому фильтр стоит
 * в трёх местах: список, загрузка после правки и `findOwned` (чужой
 * запрос по id одноразовой вещи — 404, как по чужой).
 *
 * Вес необязателен. `NULL` значит «не знаю», и такой предмет не попадает
 * в итог: считать его нулём — врать в сумме рюкзака, а отказываться
 * добавлять вещь без веса — заставлять человека взвешивать палатку,
 * чтобы записать её в список.
 *
 * **В поход предмет попадает через `TripGearService`** (вкладка
 * «Снаряжение», Ф7): участник выбирает свой клон вещи, и в походе
 * появляется строка со ссылкой на каталог. С 11.11.2026 каталог — общий
 * у родных (клоны `gear_uid`), а удаление — мягкое: строка не исчезает,
 * потому что на неё ссылается история походов. Блокирует удаление только
 * живой решённый поход (409), а не любая строка `trip_gear`, как раньше.
 */
@Injectable()
export class GearService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly gearGroups: GearGroupsService,
    /**
     * Клоны вещи в каталогах родных (11.11.2026): создание при добавлении,
     * зеркало при правке, мягкое удаление по компоненте связей.
     */
    private readonly familyGear: FamilyGearService,
  ) {}

  /** Мой список и итог по весу. Одноразовые и удалённые вещи сюда не входят. */
  async list(userId: string): Promise<GearListDto> {
    const grouping = await this.gearGroups.ensure(userId);
    const items = await this.dataSource.manager.find(GearItem, {
      where: {
        ownerUserId: userId,
        isTripOnly: false,
        deletedAt: IsNull(),
      },
      relations: {
        gearType: true,
        attributes: { gearTypeAttribute: true },
      },
    });

    for (const item of items) this.sortValues(item);
    items.sort((left, right) => {
      const leftGroup = this.groupOf(left, grouping);
      const rightGroup = this.groupOf(right, grouping);

      if (leftGroup.sortOrder !== rightGroup.sortOrder) {
        return leftGroup.sortOrder - rightGroup.sortOrder;
      }
      if (leftGroup.name !== rightGroup.name) {
        return leftGroup.name.localeCompare(rightGroup.name, 'ru');
      }
      if (left.sortOrder !== right.sortOrder) {
        return left.sortOrder - right.sortOrder;
      }

      return Number(left.id) - Number(right.id);
    });

    return this.toList(items, grouping);
  }

  /**
   * Предмет каталога, который человек вправе поставить в поход (11.11.2026).
   *
   * Раньше «доступный» значил «свой или родного»: вещь родного лежала
   * в его каталоге, и в поход её ставили ссылкой на чужую строку. Теперь
   * у каждого родного **свой клон** вещи (та же `gear_uid`), поэтому
   * в поход ставится свой клон, а `owner_user_id` строки похода — владелец
   * клона, то есть тот, кто её выставил. Чужая строка для человека больше
   * не существует: 404, как любая чужая вещь.
   *
   * Мягко удалённая вещь (`deleted_at`) не находится — иначе её можно было
   * бы поставить в поход по старому id, хотя из каталога она исчезла.
   *
   * Возвращаемое имя владельца всегда `null`: оно осталось в сигнатуре,
   * пока походные вызовы не переписаны (следующий шаг), и уходит вместе
   * с ними.
   */
  async findAvailable(
    manager: EntityManager,
    userId: string,
    gearItemId: string,
  ): Promise<{ item: GearItem; ownerName: string | null } | null> {
    const item = await manager.findOne(GearItem, {
      where: {
        id: gearItemId,
        ownerUserId: userId,
        isTripOnly: false,
        deletedAt: IsNull(),
      },
      relations: { gearType: true, attributes: { gearTypeAttribute: true } },
    });
    if (!item) return null;

    return { item, ownerName: null };
  }

  /** Новый предмет каталога. */
  async create(userId: string, dto: CreateGearItemDto): Promise<GearItemDto> {
    const title = dto.title.trim();
    if (title.length === 0) {
      throw new BadRequestException('У предмета должно быть название');
    }

    // Раскладка типов нужна до вставки: от неё зависит, в какую группу
    // встанет вещь и какой у неё будет личный порядок.
    await this.gearGroups.ensure(userId);

    const item = await this.dataSource.transaction((tx) =>
      this.createItem(tx, userId, {
        typeId: dto.typeId,
        attributes: dto.attributes,
        title,
        weightGrams: dto.weightGrams ?? null,
        location: dto.location ?? null,
        note: dto.note ?? null,
        tripOnly: false,
      }),
    );

    return this.loadItem(this.dataSource.manager, userId, item.id);
  }

  /**
   * Завести вещь — общим путём для каталога и для «вручную» в походе.
   *
   * Одна дверь на две ручки (`gear.service.create` и
   * `trip-gear.service.addManual`): тип, характеристики, обязательные
   * значения и запись значений — одни и те же правила. Вторая копия этой
   * логики означала бы, что «вручную» однажды примет вещь без обязательного
   * значения.
   *
   * **Название у одноразовой вещи необязательно.** В каталоге `title` —
   * это название вещи, человек пишет его осознанно; в походе строку
   * подписывает тип («Топор», «Палатка»), и требовать «название» у бутылки
   * бензина незачем. Поэтому пустое имя заменяется именем типа — колонка
   * `gear_items.title` остаётся `NOT NULL` и непустой (`chk_gear_items_title`).
   * Каталог этот запасной путь не использует: там `title` проверяется
   * до вызова и пустым не бывает.
   *
   * Возвращает вещь с типом и значениями: `TripGearItemDto` собирается
   * из них, и второй запрос за тем же был бы лишним кругом до базы.
   */
  async createItem(
    manager: EntityManager,
    ownerUserId: string,
    data: CreateItemData,
  ): Promise<GearItem> {
    const type = await this.resolveType(manager, data.typeId);
    const attributes = await this.typeAttributes(manager, type.id);
    const active = attributes.filter((attribute) => attribute.isActive);

    const values = this.parseValues(active, data.attributes ?? {});
    // Обязательные характеристики спрашиваются у новой вещи всегда: тип
    // пришёл полем `typeId`, а вместе с ним пришла форма, которая знает
    // набор полей и умеет их спрашивать.
    //
    // Считаем **заполненные** характеристики, а не присланные ключи:
    // форма отправляет карту целиком, а пустые значения — `null`.
    this.assertRequired(active, this.filledIds(values));

    const title = data.title?.trim() || type.name;

    const saved = await manager.save(
      manager.create(GearItem, {
        ownerUserId,
        gearUid: randomUUID(),
        originUserId: ownerUserId,
        gearTypeId: type.id,
        sortOrder: await nextSortOrder(manager, ownerUserId, type.id),
        title,
        weightGrams: data.weightGrams ?? null,
        location: this.normalizeLocation(data.location),
        note: data.note?.trim() || null,
        isTripOnly: data.tripOnly,
      }),
    );
    await this.writeValues(manager, saved.id, values);

    const item = await manager.findOne(GearItem, {
      where: { id: saved.id },
      relations: {
        gearType: true,
        attributes: { gearTypeAttribute: true },
      },
    });
    if (!item) throw new NotFoundException('Предмет не найден');

    this.sortValues(item);

    // Клоны в каталоги родных — в той же транзакции, что и сама вещь:
    // «вещь добавлена, а у жены её нет» — недопустимое промежуточное
    // состояние. Одноразовые вещи похода не клонируются.
    if (!item.isTripOnly) {
      await this.familyGear.syncClones(manager, item);
    }

    return item;
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

    // Смена типа переставляет вещь в группу нового типа — раскладка должна
    // быть актуальной до расчёта личного порядка.
    await this.gearGroups.ensure(userId);

    await this.dataSource.transaction(async (tx) => {
      const current = await tx.findOne(GearItem, {
        where: { id: item.id },
        relations: { attributes: true },
      });
      if (!current) throw new NotFoundException('Предмет не найден');

      const changingType = dto.typeId !== undefined;
      const type =
        dto.typeId === undefined ? null : await this.resolveType(tx, dto.typeId);
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
        location?: string | null;
        gearTypeId?: number;
        sortOrder?: number;
      } = {};

      if (typeChanged) {
        // Значения старого типа не переживают смену типа.
        await tx.delete(GearItemAttribute, { gearItemId: current.id });
        current.attributes = [];
      }

      // Обязательные характеристики проверяются, когда тип пришёл полем
      // `typeId`: с ним приходит форма, которая знает набор полей и умеет
      // их спрашивать. Правка одной характеристики или названия старую вещь
      // с дырой в обязательном значении не блокирует — правило «состав
      // характеристик определяется заново» (создание и смена типа).
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
      if (dto.location !== undefined) {
        changes.location = this.normalizeLocation(dto.location);
      }
      if (typeChanged) {
        changes.gearTypeId = typeId;
        // Вещь переехала в группу нового типа — встаёт в её конец, иначе
        // оказалась бы посреди чужого порядка.
        changes.sortOrder = await nextSortOrder(tx, userId, typeId);
      }

      if (values !== null) await this.writeValues(tx, current.id, values);

      // `update`, а не `save`: `save` синхронизирует загруженную коллекцию
      // значений и обнулил бы `gear_item_id` у строк, вставленных строкой
      // выше (orphanedRowAction OneToMany). Поэтому пишем только колонки.
      if (Object.keys(changes).length > 0) {
        await tx.update(GearItem, { id: current.id }, changes);
      }

      // Зеркало по активным клонам текущей компоненты: правка вещи у одного
      // родного видна всем. `sort_order` и личная группа (через тип) —
      // у каждого свои, они не зеркалятся.
      await this.familyGear.mirror(
        tx,
        current,
        changes,
        typeChanged || values !== null,
      );
    });

    return this.loadItem(manager, userId, String(id));
  }

  /**
   * Удалить предмет — **мягко** и по всей текущей компоненте родных
   * (11.11.2026).
   *
   * Заказчик: «удаление — `deleted_at` на клонах текущей компоненты;
   * у бывшего остаётся его копия. Восстановления нет». Поэтому строка
   * не исчезает физически: история походов ссылается на неё, а физическое
   * удаление выдернуло бы вещь из прошлых походов (каскады) или вообще
   * не дало бы удалить вещь, которая где-то ездила (`trip_gear` — RESTRICT).
   *
   * **Блокирует только живой поход.** Если хоть один из удаляемых клонов
   * стоит в решённом (`decided`), не отменённом и ещё не закончившемся
   * походе — 409 с названием похода: «сначала уберите её из подготовки».
   * Предложенная в планирующем походе вещь не блокирует (поход ещё не
   * решён), а прошедший поход не блокирует по решению заказчика.
   *
   * У бывшего родного его копия остаётся активной: компонента уже другая,
   * и его каталог мы не трогаем.
   */
  async remove(userId: string, id: number): Promise<void> {
    await this.dataSource.transaction(async (tx) => {
      const item = await this.findOwned(tx, userId, id);
      const componentIds = (await this.familyGear.componentOf(userId, tx))
        .filter((person) => !person.isVirtual)
        .map((person) => person.id);

      const blocked = await this.familyGear.blockingTrip(
        tx,
        item.gearUid,
        componentIds,
      );
      if (blocked) {
        throw new ConflictException(
          `Вещь стоит в походе «${blocked.title}», который ещё не закончился, — ` +
            'сначала уберите её из снаряжения похода',
        );
      }

      await this.familyGear.softDelete(tx, item.gearUid, componentIds);
    });
  }

  /**
   * Переставить вещь на позицию выше или ниже **внутри её группы**
   * (31.10.2026).
   *
   * Порядок групп задаёт админ, поэтому через границу группы стрелка
   * не переставляет: вещь остаётся на своей полке, меняются местами два
   * соседа. Список пересобирается целиком и перенумеровывается шагом 10:
   * если у нескольких вещей накопились одинаковые `sort_order` (старые
   * данные, ручная правка), простая перестановка двух цифр ничего бы
   * не изменила, а перенумерация чинит порядок заодно.
   *
   * Отвечаем списком целиком: после перестановки изменились две строки,
   * и отдавать одну значило бы заставлять клиент угадывать вторую.
   */
  async move(
    userId: string,
    id: number,
    direction: GearMoveDirection,
  ): Promise<GearListDto> {
    const manager = this.dataSource.manager;
    const item = await this.findOwned(manager, userId, id);

    await this.dataSource.transaction(async (tx) => {
      // Группа вещи выводится из её типа: соседи — вещи всех типов,
      // которые человек сложил в эту группу.
      const typeIds = await typeIdsOfTypeGroup(tx, userId, item.gearTypeId);
      const siblings = await tx.find(GearItem, {
        where: {
          ownerUserId: userId,
          gearTypeId: In(typeIds),
          deletedAt: IsNull(),
        },
        order: { sortOrder: 'ASC', id: 'ASC' },
      });
      const index = siblings.findIndex((row) => row.id === item.id);
      if (index === -1) throw new NotFoundException('Предмет не найден');

      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= siblings.length) return;

      const [moved] = siblings.splice(index, 1);
      if (!moved) return;
      siblings.splice(target, 0, moved);

      for (const [position, row] of siblings.entries()) {
        const sortOrder = (position + 1) * SORT_STEP;
        if (row.sortOrder !== sortOrder) {
          await tx.update(GearItem, { id: row.id }, { sortOrder });
        }
      }
    });

    return this.list(userId);
  }

  // ───────────────────────── внутреннее ─────────────────────────

  /**
   * Тип из тела запроса по `typeId`.
   *
   * Вида старого каталога (`kind`) в контракте больше нет: он был
   * прослойкой перехода, пока экраны читали вид, и удалён вместе
   * с последним потребителем (30.10.2026). Архивный тип не принимается:
   * вещь в архивном типе нечем показать и не по чему фильтровать.
   */
  private async resolveType(
    manager: EntityManager,
    typeId: number,
  ): Promise<GearType> {
    const type = await manager.findOne(GearType, { where: { id: typeId } });
    if (!type) throw new BadRequestException('Тип снаряжения не найден');
    this.assertTypeActive(type);

    return type;
  }

  private assertTypeActive(type: GearType): void {
    if (!type.isActive) {
      throw new BadRequestException(
        'Тип снаряжения в архиве — выберите действующий',
      );
    }
  }

  /** Группа вещи в раскладке человека; без раскладки — «Прочее». */
  private groupOf(item: GearItem, grouping: UserGrouping): GearGroup {
    return grouping.groupByType.get(item.gearTypeId) ?? grouping.defaultGroup;
  }

  /** Местоположение: пустое — `null`, лишние пробелы убираем. */
  private normalizeLocation(raw: string | null | undefined): string | null {
    if (raw === null || raw === undefined) return null;
    const location = raw.trim();

    return location.length === 0 ? null : location;
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
   * Id характеристик, у которых есть значение.
   *
   * `null` в карте — «стереть» / «не задано»: ключ при этом есть, и считать
   * его заполненным значило бы принимать `{ seats: null }` за ответ.
   */
  private filledIds(
    values: Map<number, GearValueColumns | null>,
  ): Set<number> {
    const ids = new Set<number>();
    for (const [attributeId, columns] of values) {
      if (columns !== null) ids.add(attributeId);
    }

    return ids;
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

  /**
   * Мой предмет каталога с типом и значениями — или 404.
   *
   * Одноразовая вещь похода здесь **не находится**: каталог её не отдаёт,
   * а по id её можно было бы править и удалять в обход похода.
   */
  private async loadItem(
    manager: EntityManager,
    userId: string,
    id: string,
  ): Promise<GearItemDto> {
    const grouping = await this.gearGroups.ensure(userId);
    const item = await manager.findOne(GearItem, {
      where: {
        id,
        ownerUserId: userId,
        isTripOnly: false,
        deletedAt: IsNull(),
      },
      relations: {
        gearType: true,
        attributes: { gearTypeAttribute: true },
      },
    });
    if (!item) throw new NotFoundException('Предмет не найден');

    this.sortValues(item);

    return GearItemDto.from(item, this.groupOf(item, grouping));
  }

  /**
   * Предмет каталога без связей: нужен только id и запрет на удаление.
   *
   * `isTripOnly: false` — то же правило, что в `loadItem`: одноразовая
   * вещь похода живёт в походе, и каталог про неё ничего не знает.
   */
  private async findOwned(
    manager: EntityManager,
    userId: string,
    id: number,
  ): Promise<GearItem> {
    const item = await manager.findOne(GearItem, {
      where: {
        id: String(id),
        ownerUserId: userId,
        isTripOnly: false,
        deletedAt: IsNull(),
      },
    });
    if (!item) throw new NotFoundException('Предмет не найден');

    return item;
  }

  /** Список с итогом: сумма известных весов и сколько осталось без веса. */
  private toList(
    items: GearItem[],
    grouping: UserGrouping,
  ): GearListDto {
    let totalWeightGrams = 0;
    let itemsWithoutWeight = 0;

    for (const item of items) {
      if (item.weightGrams === null) itemsWithoutWeight += 1;
      else totalWeightGrams += item.weightGrams;
    }

    return {
      items: items.map((item) =>
        GearItemDto.from(item, this.groupOf(item, grouping)),
      ),
      totalWeightGrams,
      itemsWithoutWeight,
    };
  }
}
