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
  CreateGearGroupDto,
  GearAdminGroupDto,
  GearAdminGroupListDto,
  GearGroupDto,
  GearGroupListDto,
  UpdateGearGroupDto,
} from './dto/gear-group.dto';
import { GearGroup } from './entities/gear-group.entity';
import { GearItem } from './entities/gear-item.entity';
import {
  GEAR_CODE_PATTERN,
  GEAR_DEFAULT_GROUP_CODE,
} from './gear.types';

/**
 * Группы снаряжения — полки каталога (31.10.2026).
 *
 * Два контракта в одном сервисе, как у типов: **публичный** список
 * (только действующие группы) нужен экрану каталога, **админский**
 * (с архивом и числом вещей) — `/admin/gear`.
 *
 * **Группы — данные, а не код.** Их заводит и упорядочивает админ, поэтому
 * появление новой полки («Рыбалка», «Фото») не требует миграции. Код
 * остаётся контрактом: он неизменяем и уникален даже у архивной строки.
 *
 * **`other` защищена от архива.** Группа у вещи обязательна, а умолчание
 * для пропущенного `groupId` — «Прочее». Если её погасить, API не сможет
 * завести вещь без явной группы. Поэтому `archiveGroup` отвечает 409
 * на `code = 'other'`; переименовать её можно (имя — не контракт).
 *
 * **Удаления нет, есть архив.** Вещи в архивной группе остаются на месте:
 * каталог покажет её после действующих групп, а не молча потеряет вещи.
 */
@Injectable()
export class GearGroupsService {
  constructor(private readonly dataSource: DataSource) {}

  /** Публичный список: действующие группы в порядке админа. */
  async listPublic(): Promise<GearGroupListDto> {
    const groups = await this.dataSource.manager.find(GearGroup, {
      where: { isActive: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });

    return { items: groups.map((group) => GearGroupDto.from(group)) };
  }

  /** Админский список: архивные группы тоже, с числом вещей. */
  async listAdmin(userId: string): Promise<GearAdminGroupListDto> {
    this.assertAdmin(userId);
    const manager = this.dataSource.manager;
    const groups = await manager.find(GearGroup, {
      order: { isActive: 'DESC', sortOrder: 'ASC', name: 'ASC' },
    });

    const items: GearAdminGroupDto[] = [];
    for (const group of groups) {
      const itemsCount = await manager.count(GearItem, {
        where: { groupId: group.id },
      });
      items.push(GearAdminGroupDto.fromAdmin(group, itemsCount));
    }

    return { items };
  }

  /** Новая группа. Код занимается навсегда, даже если группу заархивируют. */
  async createGroup(
    userId: string,
    dto: CreateGearGroupDto,
  ): Promise<GearAdminGroupDto> {
    this.assertAdmin(userId);

    const code = this.normalizeCode(dto.code);
    const name = this.normalizeName(dto.name);
    const manager = this.dataSource.manager;

    const taken = await manager.findOne(GearGroup, { where: { code } });
    if (taken) throw this.duplicateGroup(code);

    try {
      const saved = await manager.save(
        manager.create(GearGroup, {
          code,
          name,
          isActive: true,
          sortOrder: dto.sortOrder ?? 0,
        }),
      );

      return GearAdminGroupDto.fromAdmin(saved, 0);
    } catch (error) {
      // Между проверкой и вставкой код мог занять другой запрос: unique
      // в базе остаётся последним словом, и ответ должен быть тот же 409.
      if (this.isUniqueViolation(error)) throw this.duplicateGroup(code);
      throw error;
    }
  }

  /**
   * Правка группы: имя, порядок, активность.
   *
   * `code` меняться не может: на него опирается умолчание `other`.
   * Если поле пришло, отвечаем 400 с причиной, а не молча игнорируем.
   */
  async updateGroup(
    userId: string,
    id: number,
    dto: UpdateGearGroupDto,
  ): Promise<GearAdminGroupDto> {
    this.assertAdmin(userId);

    if (dto.code !== undefined) {
      throw new BadRequestException(
        'Код группы менять нельзя: ошибку исправляют архивом и новым кодом',
      );
    }

    const manager = this.dataSource.manager;
    const group = await this.findGroup(manager, id);

    if (dto.name !== undefined) group.name = this.normalizeName(dto.name);
    if (dto.sortOrder !== undefined) group.sortOrder = dto.sortOrder;

    // «Прочее» возвращать из архива можно, а убирать — нет. Если строка
    // каким-то образом уже в архиве (руками в базе), `isActive: true`
    // её починит; `false` для неё по-прежнему 409.
    if (dto.isActive !== undefined) {
      if (!dto.isActive && group.code === GEAR_DEFAULT_GROUP_CODE) {
        throw this.defaultGroupArchive();
      }
      group.isActive = dto.isActive;
    }

    await manager.save(group);

    const itemsCount = await manager.count(GearItem, {
      where: { groupId: group.id },
    });

    return GearAdminGroupDto.fromAdmin(group, itemsCount);
  }

  /**
   * Архив группы. Ответ 204, повторный вызов идемпотентен.
   *
   * «Прочее» в архив не уходит (409): это группа по умолчанию. Вещи
   * остальных групп архив не трогает — у вещи остаётся полка, просто
   * она перестаёт предлагаться новым вещам.
   */
  async archiveGroup(userId: string, id: number): Promise<void> {
    this.assertAdmin(userId);

    const manager = this.dataSource.manager;
    const group = await this.findGroup(manager, id);

    if (group.code === GEAR_DEFAULT_GROUP_CODE) {
      throw this.defaultGroupArchive();
    }

    if (group.isActive) {
      group.isActive = false;
      await manager.save(group);
    }
  }

  // ───────────────────────── внутреннее ─────────────────────────

  private assertAdmin(userId: string): void {
    if (!isAdminUser(userId)) {
      throw new ForbiddenException('Раздел только для администратора');
    }
  }

  private async findGroup(
    manager: EntityManager,
    id: number,
  ): Promise<GearGroup> {
    const group = await manager.findOne(GearGroup, { where: { id } });
    if (!group) throw new NotFoundException('Группа снаряжения не найдена');

    return group;
  }

  private normalizeCode(raw: string): string {
    const code = raw.trim().toLowerCase();
    if (code.length === 0) {
      throw new BadRequestException('Код группы не может быть пустым');
    }
    if (!GEAR_CODE_PATTERN.test(code) || code.length > 40) {
      throw new BadRequestException(
        'Код группы — латиница, начиная с буквы: a-z, цифры и подчёркивание, до 40 символов',
      );
    }

    return code;
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

  private duplicateGroup(code: string): ConflictException {
    return new ConflictException(
      `Группа с кодом «${code}» уже есть — код занимается навсегда`,
    );
  }

  private defaultGroupArchive(): ConflictException {
    return new ConflictException(
      '«Прочее» — группа по умолчанию: её нельзя убрать в архив, вещи без явной полки кладутся в неё. Переименовать её можно',
    );
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    );
  }
}
