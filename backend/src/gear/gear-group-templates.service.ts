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
  CreateGearGroupTemplateDto,
  GearAdminGroupTemplateDto,
  GearAdminGroupTemplateListDto,
  UpdateGearGroupTemplateDto,
} from './dto/gear-group.dto';
import { GearGroupTemplate } from './entities/gear-group-template.entity';
import { GearType } from './entities/gear-type.entity';
import {
  GEAR_CODE_PATTERN,
  GEAR_DEFAULT_GROUP_CODE,
} from './gear.types';

/**
 * Рекомендуемые группы снаряжения — шаблоны админа (02.11.2026).
 *
 * Заказчик: «Заводим рекомендуемые группы, они управляются админом,
 * приходят новым пользователям и с новыми типами». Шаблон — это образец,
 * а не рабочая группа: человек получает его копию (`gear_groups`), которую
 * вправе переименовать, переставить или удалить.
 *
 * **`code` неизменяем и уникален** — по нему личная копия находит «Прочее»
 * и понимает, куда положить новый тип. Ошибку исправляют архивом и новой
 * строкой с новым кодом, как у типов.
 *
 * **Удаления нет, есть архив.** Архивный шаблон не приходит новым
 * пользователям и не предлагается в выборе рекомендуемой группы, но
 * у существующих людей копии остаются. «Прочее» архивировать нельзя (409):
 * это умолчание для типа без рекомендации.
 */
@Injectable()
export class GearGroupTemplatesService {
  constructor(private readonly dataSource: DataSource) {}

  /** Админский список: архивные шаблоны и число рекомендованных типов. */
  async listAdmin(userId: string): Promise<GearAdminGroupTemplateListDto> {
    this.assertAdmin(userId);
    const manager = this.dataSource.manager;
    const templates = await manager.find(GearGroupTemplate, {
      order: { isActive: 'DESC', sortOrder: 'ASC', name: 'ASC' },
    });

    const items: GearAdminGroupTemplateDto[] = [];
    for (const template of templates) {
      const typesCount = await manager.count(GearType, {
        where: { recommendedGroupId: template.id },
      });
      items.push(GearAdminGroupTemplateDto.fromAdmin(template, typesCount));
    }

    return { items };
  }

  /** Новый шаблон. Код занимается навсегда, даже если шаблон уйдёт в архив. */
  async create(
    userId: string,
    dto: CreateGearGroupTemplateDto,
  ): Promise<GearAdminGroupTemplateDto> {
    this.assertAdmin(userId);

    const code = this.normalizeCode(dto.code);
    const name = this.normalizeName(dto.name);
    const manager = this.dataSource.manager;

    const taken = await manager.findOne(GearGroupTemplate, { where: { code } });
    if (taken) throw this.duplicateTemplate(code);

    try {
      const saved = await manager.save(
        manager.create(GearGroupTemplate, {
          code,
          name,
          isActive: true,
          sortOrder: dto.sortOrder ?? 0,
        }),
      );

      return GearAdminGroupTemplateDto.fromAdmin(saved, 0);
    } catch (error) {
      if (this.isUniqueViolation(error)) throw this.duplicateTemplate(code);
      throw error;
    }
  }

  /**
   * Правка шаблона: имя, порядок, активность. `code` не меняется.
   */
  async update(
    userId: string,
    id: number,
    dto: UpdateGearGroupTemplateDto,
  ): Promise<GearAdminGroupTemplateDto> {
    this.assertAdmin(userId);

    if (dto.code !== undefined) {
      throw new BadRequestException(
        'Код группы менять нельзя: ошибку исправляют архивом и новым кодом',
      );
    }

    const manager = this.dataSource.manager;
    const template = await this.findTemplate(manager, id);

    if (dto.name !== undefined) template.name = this.normalizeName(dto.name);
    if (dto.sortOrder !== undefined) template.sortOrder = dto.sortOrder;

    if (dto.isActive !== undefined) {
      if (!dto.isActive && template.code === GEAR_DEFAULT_GROUP_CODE) {
        throw this.defaultTemplateArchive();
      }
      template.isActive = dto.isActive;
    }

    await manager.save(template);

    const typesCount = await manager.count(GearType, {
      where: { recommendedGroupId: template.id },
    });

    return GearAdminGroupTemplateDto.fromAdmin(template, typesCount);
  }

  /**
   * Архив шаблона. 204 и идемпотентно; «Прочее» — 409.
   *
   * Личные копии у людей архив не трогает: это их группы, и человек
   * разбирается с ними сам.
   */
  async archive(userId: string, id: number): Promise<void> {
    this.assertAdmin(userId);

    const manager = this.dataSource.manager;
    const template = await this.findTemplate(manager, id);

    if (template.code === GEAR_DEFAULT_GROUP_CODE) {
      throw this.defaultTemplateArchive();
    }

    if (template.isActive) {
      template.isActive = false;
      await manager.save(template);
    }
  }

  // ───────────────────────── внутреннее ─────────────────────────

  private assertAdmin(userId: string): void {
    if (!isAdminUser(userId)) {
      throw new ForbiddenException('Раздел только для администратора');
    }
  }

  private async findTemplate(
    manager: EntityManager,
    id: number,
  ): Promise<GearGroupTemplate> {
    const template = await manager.findOne(GearGroupTemplate, {
      where: { id },
    });
    if (!template) {
      throw new NotFoundException('Рекомендуемая группа не найдена');
    }

    return template;
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

  private duplicateTemplate(code: string): ConflictException {
    return new ConflictException(
      `Рекомендуемая группа с кодом «${code}» уже есть — код занимается навсегда`,
    );
  }

  private defaultTemplateArchive(): ConflictException {
    return new ConflictException(
      '«Прочее» — умолчание для типа без рекомендованной группы: в архив её убрать нельзя. Переименовать можно',
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
