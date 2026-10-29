import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { isAdminUser } from '../calendar/admin';
import {
  CreateGearTypeAttributeDto,
  CreateGearTypeDto,
  GearAdminTypeAttributeDto,
  GearAdminTypeDto,
  GearAdminTypeListDto,
  GearTypeDto,
  GearTypeListDto,
  UpdateGearTypeAttributeDto,
  UpdateGearTypeDto,
} from './dto/gear-type.dto';
import { GearType } from './entities/gear-type.entity';
import { GearTypeAttribute } from './entities/gear-type-attribute.entity';
import { GEAR_CODE_PATTERN } from './gear.types';
import type { GearValueKind } from './gear.types';

/**
 * Справочник типов снаряжения и их характеристик (Stage A).
 *
 * Два контракта в одном сервисе, и это осознанно: **публичный** список
 * (только активное) — то, на что будет опираться Stage B, а **админский**
 * (всё, включая архив) — то, чем правит админ. Логика у них общая, разница
 * только в выборке и в флаге `isActive`, поэтому отдельные сервисы
 * разошлись бы копией правил валидации.
 *
 * **Права — `isAdminUser`** (захардкоженный UUID, как в календаре): не-админ
 * получает 403, без токена отвечает глобальный guard 401-м. Таблица
 * `admin_users` в базе — приманка, код в неё не смотрит.
 *
 * **Удаления нет, есть архив.** `DELETE` ставит `is_active = false` и
 * идемпотентен: повторный ответ — снова 204. Физическое удаление выдернуло
 * бы в Stage B вещи, которые на этот тип ссылаются, и значения
 * характеристик.
 *
 * **`code` и `valueKind` неизменяемы.** Код — контракт для фильтров
 * и фронта, вид — тип колонки, в которую ляжет значение в Stage B.
 * Исправление ошибки — архив и новая строка с новым кодом.
 */
@Injectable()
export class GearTypesService {
  constructor(private readonly dataSource: DataSource) {}

  /** Публичный справочник: активные типы с активными характеристиками. */
  async listPublic(): Promise<GearTypeListDto> {
    const types = await this.findTypes(true);

    return { items: types.map((type) => GearTypeDto.from(type)) };
  }

  /** Админский справочник: архивные типы и характеристики тоже. */
  async listAdmin(userId: string): Promise<GearAdminTypeListDto> {
    this.assertAdmin(userId);
    const types = await this.findTypes(false);

    return { items: types.map((type) => GearAdminTypeDto.fromAdmin(type)) };
  }

  /** Новый тип. Код занимается навсегда, даже если тип потом уйдёт в архив. */
  async createType(
    userId: string,
    dto: CreateGearTypeDto,
  ): Promise<GearAdminTypeDto> {
    this.assertAdmin(userId);

    const code = this.normalizeCode(dto.code);
    const name = this.normalizeName(dto.name);
    const manager = this.dataSource.manager;

    const taken = await manager.findOne(GearType, { where: { code } });
    if (taken) throw this.duplicateType(code);

    try {
      const saved = await manager.save(
        manager.create(GearType, {
          code,
          name,
          isActive: true,
          sortOrder: dto.sortOrder ?? 0,
          attributes: [],
        }),
      );

      return GearAdminTypeDto.fromAdmin(saved);
    } catch (error) {
      // Между проверкой и вставкой код мог занять другой запрос: unique
      // в базе остаётся последним словом, и ответ должен быть тот же 409.
      if (this.isUniqueViolation(error)) throw this.duplicateType(code);
      throw error;
    }
  }

  /**
   * Правка типа: имя, порядок, активность.
   *
   * `code` меняться не может — в Stage B на него опираются фильтры.
   * Если поле пришло, отвечаем 400 с причиной, а не молча игнорируем.
   */
  async updateType(
    userId: string,
    id: number,
    dto: UpdateGearTypeDto,
  ): Promise<GearAdminTypeDto> {
    this.assertAdmin(userId);

    if (dto.code !== undefined) {
      throw new BadRequestException(
        'Код типа менять нельзя: ошибку исправляют архивом и новым кодом',
      );
    }

    const manager = this.dataSource.manager;
    const type = await this.findType(manager, id);

    if (dto.name !== undefined) type.name = this.normalizeName(dto.name);
    if (dto.sortOrder !== undefined) type.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) type.isActive = dto.isActive;

    await manager.save(type);

    return this.adminType(manager, type.id);
  }

  /**
   * Архив типа. Ответ 204 и никакого тела — как у удаления.
   *
   * Характеристики типа архив не трогает: у них свой флаг, и вернуть тип
   * из архива должно быть достаточно, чтобы справочник стал прежним.
   */
  async archiveType(userId: string, id: number): Promise<void> {
    this.assertAdmin(userId);

    const manager = this.dataSource.manager;
    const type = await this.findType(manager, id);

    if (type.isActive) {
      type.isActive = false;
      await manager.save(type);
    }
  }

  /** Новая характеристика типа. */
  async createAttribute(
    userId: string,
    typeId: number,
    dto: CreateGearTypeAttributeDto,
  ): Promise<GearAdminTypeAttributeDto> {
    this.assertAdmin(userId);

    const manager = this.dataSource.manager;
    const type = await this.findType(manager, typeId);

    const code = this.normalizeCode(dto.code);
    const name = this.normalizeName(dto.name);
    const isRequired = dto.isRequired ?? false;

    // `fillMissing` в Stage A проверяется и отбрасывается: таблицы значений
    // (`gear_item_attributes`) ещё нет, заполнять нечего. В Stage B тот же
    // вызов начнёт писать его пустым значениям.
    if (isRequired || this.hasFillMissing(dto.fillMissing)) {
      this.assertFillMissing(dto.valueKind, dto.fillMissing);
    }

    const taken = await manager.findOne(GearTypeAttribute, {
      where: { gearTypeId: type.id, code },
    });
    if (taken) throw this.duplicateAttribute(code);

    try {
      const saved = await manager.save(
        manager.create(GearTypeAttribute, {
          gearTypeId: type.id,
          code,
          name,
          valueKind: dto.valueKind,
          unit: this.normalizeUnit(dto.unit),
          isRequired,
          isActive: true,
          sortOrder: dto.sortOrder ?? 0,
        }),
      );

      return GearAdminTypeAttributeDto.fromAdmin(saved);
    } catch (error) {
      if (this.isUniqueViolation(error)) throw this.duplicateAttribute(code);
      throw error;
    }
  }

  /**
   * Правка характеристики: имя, единица, обязательность, порядок, архив.
   *
   * `valueKind` не меняется даже на «тот же самый»: 409. Смена вида
   * означала бы перенос уже записанных в Stage B значений, а правило
   * ставят сразу, чтобы контракт не менялся между шагами.
   */
  async updateAttribute(
    userId: string,
    typeId: number,
    attributeId: number,
    dto: UpdateGearTypeAttributeDto,
  ): Promise<GearAdminTypeAttributeDto> {
    this.assertAdmin(userId);

    if (dto.code !== undefined) {
      throw new BadRequestException(
        'Код характеристики менять нельзя: ошибку исправляют архивом и новым кодом',
      );
    }
    if (dto.valueKind !== undefined) {
      throw new ConflictException(
        'Вид характеристики менять нельзя: заведите в архив и новую характеристику с новым кодом',
      );
    }

    const manager = this.dataSource.manager;
    await this.findType(manager, typeId);
    const attribute = await this.findAttribute(manager, typeId, attributeId);

    // Обязательность включается — нужно замещающее значение: иначе в Stage B
    // старые вещи без значения станут невалидными молча.
    if (dto.isRequired === true && !attribute.isRequired) {
      this.assertFillMissing(attribute.valueKind, dto.fillMissing);
    } else if (this.hasFillMissing(dto.fillMissing)) {
      this.assertFillMissing(attribute.valueKind, dto.fillMissing);
    }

    if (dto.name !== undefined) attribute.name = this.normalizeName(dto.name);
    if (dto.unit !== undefined) attribute.unit = this.normalizeUnit(dto.unit);
    if (dto.isRequired !== undefined) attribute.isRequired = dto.isRequired;
    if (dto.isActive !== undefined) attribute.isActive = dto.isActive;
    if (dto.sortOrder !== undefined) attribute.sortOrder = dto.sortOrder;

    return GearAdminTypeAttributeDto.fromAdmin(
      await manager.save(attribute),
    );
  }

  /** Архив характеристики. Повторный вызов — снова 204. */
  async archiveAttribute(
    userId: string,
    typeId: number,
    attributeId: number,
  ): Promise<void> {
    this.assertAdmin(userId);

    const manager = this.dataSource.manager;
    await this.findType(manager, typeId);
    const attribute = await this.findAttribute(manager, typeId, attributeId);

    if (attribute.isActive) {
      attribute.isActive = false;
      await manager.save(attribute);
    }
  }

  /**
   * Типы со связью характеристик, в порядке показа.
   *
   * Атрибуты сортируются здесь, а не вложенным `order`: их единицы на тип,
   * а порядок «активные сверху, потом sort_order, потом id» проще прочитать
   * в одном месте, чем в опциях запроса.
   */
  private async findTypes(activeOnly: boolean): Promise<GearType[]> {
    const manager = this.dataSource.manager;
    const types = await manager.find(GearType, {
      where: activeOnly ? { isActive: true } : {},
      relations: { attributes: true },
      order: { isActive: 'DESC', sortOrder: 'ASC', name: 'ASC' },
    });

    for (const type of types) {
      type.attributes = this.sortAttributes(type.attributes ?? [], activeOnly);
    }

    return types;
  }

  /** Тип с характеристиками в порядке показа — ответ админской ручки. */
  private async adminType(
    manager: EntityManager,
    id: number,
  ): Promise<GearAdminTypeDto> {
    const type = await manager.findOne(GearType, {
      where: { id },
      relations: { attributes: true },
    });
    if (!type) throw new NotFoundException('Тип снаряжения не найден');

    type.attributes = this.sortAttributes(type.attributes ?? [], false);

    return GearAdminTypeDto.fromAdmin(type);
  }

  private sortAttributes(
    attributes: GearTypeAttribute[],
    activeOnly: boolean,
  ): GearTypeAttribute[] {
    return [...attributes]
      .filter((attribute) => !activeOnly || attribute.isActive)
      .sort((left, right) => {
        if (!activeOnly && left.isActive !== right.isActive) {
          return left.isActive ? -1 : 1;
        }
        if (left.sortOrder !== right.sortOrder) {
          return left.sortOrder - right.sortOrder;
        }
        return left.id - right.id;
      });
  }

  private async findType(
    manager: EntityManager,
    id: number,
  ): Promise<GearType> {
    const type = await manager.findOne(GearType, { where: { id } });
    if (!type) throw new NotFoundException('Тип снаряжения не найден');

    return type;
  }

  /**
   * Характеристика внутри типа.
   *
   * Внешний id проверяется тоже: `/types/1/attributes/7` для атрибута типа 2
   * — это 404, а не «поменяли что-то не то». Иначе админка с перепутанным
   * id правила бы чужую характеристику.
   */
  private async findAttribute(
    manager: EntityManager,
    typeId: number,
    attributeId: number,
  ): Promise<GearTypeAttribute> {
    const attribute = await manager.findOne(GearTypeAttribute, {
      where: { id: attributeId, gearTypeId: typeId },
    });
    if (!attribute) throw new NotFoundException('Характеристика не найдена');

    return attribute;
  }

  private assertAdmin(userId: string): void {
    if (!isAdminUser(userId)) {
      throw new ForbiddenException('Раздел только для администратора');
    }
  }

  /** Код: латиница по регулярке, до 40 символов. */
  private normalizeCode(raw: string): string {
    const code = raw.trim();
    if (!GEAR_CODE_PATTERN.test(code) || code.length > 40) {
      throw new BadRequestException(
        'Код — латиница, начиная с буквы: ^[a-z][a-z0-9_]*$, до 40 символов',
      );
    }

    return code;
  }

  /** Название: непустое после `btrim`, до 100 символов. */
  private normalizeName(raw: string): string {
    const name = raw.trim();
    if (name.length === 0) {
      throw new BadRequestException('Название не может быть пустым');
    }
    if (name.length > 100) {
      throw new BadRequestException('Название не должно превышать 100 символов');
    }

    return name;
  }

  /**
   * Единица: пустая строка — это «нет единицы», а не пустая строка в базе.
   *
   * CHECK в базе запрещает `''` (он неотличим от случайной пробелки),
   * поэтому `''` и `null` сходятся в `NULL`: форма приходит с пустым полем,
   * и это осознанное стирание.
   */
  private normalizeUnit(unit: string | null | undefined): string | null {
    if (unit === undefined || unit === null) return null;

    const trimmed = unit.trim();

    return trimmed.length === 0 ? null : trimmed;
  }

  private hasFillMissing(value: unknown): boolean {
    return value !== undefined && value !== null;
  }

  /**
   * Замещающее значение по виду характеристики.
   *
   * В Stage A оно никуда не пишется — таблицы значений ещё нет. Проверяем
   * его сейчас, чтобы правило не появилось впервые в Stage B вместе
   * с записью: `0` для числа, непустая строка для текста, `true`/`false`
   * для галочки.
   */
  private assertFillMissing(valueKind: GearValueKind, value: unknown): void {
    if (valueKind === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new BadRequestException(
          'Для числовой характеристики замещающее значение — число, например 0',
        );
      }

      return;
    }

    if (valueKind === 'text') {
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new BadRequestException(
          'Для текстовой характеристики замещающее значение — непустая строка',
        );
      }

      return;
    }

    if (typeof value !== 'boolean') {
      throw new BadRequestException(
        'Для характеристики-галочки замещающее значение — true или false',
      );
    }
  }

  private duplicateType(code: string): ConflictException {
    return new ConflictException(`Тип с кодом «${code}» уже есть`);
  }

  private duplicateAttribute(code: string): ConflictException {
    return new ConflictException(
      `Характеристика с кодом «${code}» у этого типа уже есть`,
    );
  }

  /**
   * Гонка на уникальном индексе — это 409, остальное пробрасываем.
   *
   * Предварительная проверка закрывает обычный путь, но два запроса могут
   * пройти её одновременно; тогда ответ базы `23505` должен дать тот же 409,
   * а не 500.
   */
  private isUniqueViolation(error: unknown): boolean {
    const code =
      (error as { driverError?: { code?: string } })?.driverError?.code ??
      (error as { code?: string })?.code;

    return code === '23505';
  }
}
