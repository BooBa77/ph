import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

import type { GearGroupTemplate } from '../entities/gear-group-template.entity';
import type { GearGroup } from '../entities/gear-group.entity';
import type { GearType } from '../entities/gear-type.entity';
import {
  GEAR_CODE_MAX_LENGTH,
  GEAR_CODE_PATTERN,
  GEAR_GROUP_MOVE_DIRECTIONS,
  GEAR_DEFAULT_GROUP_CODE,
} from '../gear.types';
import type { GearGroupMoveDirection } from '../gear.types';

/**
 * Тип внутри личной группы (02.11.2026).
 *
 * Настройщику группировки нужно показать, что уже лежит в группе, и дать
 * переложить это в другую. Достаточно id, кода и имени: характеристики
 * типов здесь не нужны — их знает справочник.
 *
 * `isActive` отдаётся, чтобы архивный тип не предлагали перекладывать:
 * он не показывается новым вещам, но вещи в нём остаются.
 */
export class GearGroupTypeDto {
  @ApiProperty({ description: 'Id типа', example: 1 })
  id: number;

  @ApiProperty({ description: 'Код типа', example: 'tent' })
  code: string;

  @ApiProperty({ description: 'Название типа', example: 'Палатка' })
  name: string;

  @ApiProperty({ description: 'Тип активен; false — в архиве', example: true })
  isActive: boolean;

  static from(type: GearType): GearGroupTypeDto {
    return {
      id: type.id,
      code: type.code,
      name: type.name,
      isActive: type.isActive,
    };
  }
}

/**
 * Личная группа снаряжения в ответе API.
 *
 * `templateCode` — след рекомендуемой группы: по нему фронт понимает, что
 * это копия шаблона, а `isDefault` отмечает неудаляемое «Прочее». Своего
 * `code` у личной группы нет: человек может её переименовать, а стабильный
 * код — свойство шаблона.
 */
export class GearGroupDto {
  @ApiProperty({ description: 'Id личной группы', example: 2 })
  id: number;

  @ApiProperty({ description: 'Название для человека', example: 'Костровое' })
  name: string;

  @ApiProperty({ description: 'Порядок секций каталога', example: 20 })
  sortOrder: number;

  @ApiProperty({
    description: 'Код шаблона, из которого пришла группа; null — своя группа',
    example: 'campfire',
    nullable: true,
  })
  templateCode: string | null;

  @ApiProperty({
    description: '«Прочее»: неудаляемое умолчание, всегда последнее',
    example: false,
  })
  isDefault: boolean;

  @ApiProperty({
    description: 'Типы, которые лежат в этой группе',
    type: [GearGroupTypeDto],
  })
  types: GearGroupTypeDto[];

  static from(group: GearGroup, types: GearType[]): GearGroupDto {
    return {
      id: group.id,
      name: group.name,
      sortOrder: group.sortOrder,
      templateCode: group.templateCode,
      isDefault: group.templateCode === GEAR_DEFAULT_GROUP_CODE,
      types: types.map((type) => GearGroupTypeDto.from(type)),
    };
  }
}

/** Ответ `GET /api/gear-groups`: личные группы человека. */
export class GearGroupListDto {
  @ApiProperty({ description: 'Личные группы снаряжения', type: [GearGroupDto] })
  items: GearGroupDto[];
}

/** Тело `POST /api/gear-groups` — своя группа. */
export class CreateGearGroupDto {
  @ApiProperty({ description: 'Название: «Рыбалка»', example: 'Рыбалка', maxLength: 100 })
  @IsString({ message: 'Название группы должно быть строкой' })
  @MaxLength(100, { message: 'Название группы не должно превышать 100 символов' })
  name: string;

  @ApiProperty({
    description: 'Порядок; по умолчанию — перед «Прочим»',
    example: 45,
    required: false,
  })
  @IsOptional()
  @IsInt({ message: 'Порядок должен быть целым числом' })
  @Min(0, { message: 'Порядок не может быть отрицательным' })
  sortOrder?: number;
}

/**
 * Тело `PATCH /api/gear-groups/:id`.
 *
 * `templateCode` здесь нет: из какого шаблона пришла группа — не то, что
 * человек меняет. Переименование и порядок — да.
 */
export class UpdateGearGroupDto {
  @ApiProperty({ description: 'Название для человека', required: false, maxLength: 100 })
  @IsOptional()
  @IsString({ message: 'Название группы должно быть строкой' })
  @MaxLength(100, { message: 'Название группы не должно превышать 100 символов' })
  name?: string;

  @ApiProperty({ description: 'Порядок секций каталога', required: false })
  @IsOptional()
  @IsInt({ message: 'Порядок должен быть целым числом' })
  @Min(0, { message: 'Порядок не может быть отрицательным' })
  sortOrder?: number;
}

/** Тело `POST /api/gear-groups/:id/move`: переставить группу ↑/↓. */
export class MoveGearGroupDto {
  @ApiProperty({
    description: 'Направление: up — выше, down — ниже',
    enum: GEAR_GROUP_MOVE_DIRECTIONS,
    example: 'up',
  })
  @IsIn(GEAR_GROUP_MOVE_DIRECTIONS, {
    message: 'Направление — «up» или «down»',
  })
  direction: GearGroupMoveDirection;
}

/** Тело `POST /api/gear-groups/:id/types`: переложить тип в эту группу. */
export class AssignGearGroupTypeDto {
  @ApiProperty({ description: 'Id типа, который переезжает в группу', example: 3 })
  @IsInt({ message: 'Тип снаряжения должен быть указан числом' })
  @Min(1, { message: 'Некорректный тип снаряжения' })
  typeId: number;
}

/**
 * Рекомендуемая группа в ответе API (шаблон админа).
 *
 * Публично не отдаётся: человек видит свои копии. Нужна админке типов
 * (выбрать рекомендуемую группу) и админке шаблонов.
 */
export class GearGroupTemplateDto {
  @ApiProperty({ description: 'Id шаблона', example: 1 })
  id: number;

  @ApiProperty({ description: 'Код шаблона', example: 'campfire' })
  code: string;

  @ApiProperty({ description: 'Название для человека', example: 'Костровое' })
  name: string;

  @ApiProperty({ description: 'Порядок', example: 20 })
  sortOrder: number;

  static from(template: GearGroupTemplate): GearGroupTemplateDto {
    return {
      id: template.id,
      code: template.code,
      name: template.name,
      sortOrder: template.sortOrder,
    };
  }
}

/** Шаблон в админском ответе: с архивом и числом рекомендованных типов. */
export class GearAdminGroupTemplateDto extends GearGroupTemplateDto {
  @ApiProperty({ description: 'Шаблон активен', example: true })
  isActive: boolean;

  @ApiProperty({ description: 'Сколько типов рекомендуют эту группу', example: 4 })
  typesCount: number;

  static fromAdmin(
    template: GearGroupTemplate,
    typesCount: number,
  ): GearAdminGroupTemplateDto {
    return {
      ...GearGroupTemplateDto.from(template),
      isActive: template.isActive,
      typesCount,
    };
  }
}

/** Админский список: архивные шаблоны тоже. */
export class GearAdminGroupTemplateListDto {
  @ApiProperty({
    description: 'Все шаблоны, включая архивные',
    type: [GearAdminGroupTemplateDto],
  })
  items: GearAdminGroupTemplateDto[];
}

/** Тело `POST /api/gear/admin/group-templates`. */
export class CreateGearGroupTemplateDto {
  @ApiProperty({
    description: 'Код шаблона',
    example: 'fishing',
    maxLength: GEAR_CODE_MAX_LENGTH,
  })
  @IsString({ message: 'Код группы должен быть строкой' })
  @MaxLength(GEAR_CODE_MAX_LENGTH, {
    message: `Код группы не должен превышать ${GEAR_CODE_MAX_LENGTH} символов`,
  })
  @Matches(GEAR_CODE_PATTERN, {
    message: 'Код группы — латиница, начиная с буквы: a-z, цифры и подчёркивание',
  })
  code: string;

  @ApiProperty({ description: 'Название для человека', example: 'Рыбалка', maxLength: 100 })
  @IsString({ message: 'Название группы должно быть строкой' })
  @MaxLength(100, { message: 'Название группы не должно превышать 100 символов' })
  name: string;

  @ApiProperty({ description: 'Порядок', example: 50, required: false })
  @IsOptional()
  @IsInt({ message: 'Порядок должен быть целым числом' })
  @Min(0, { message: 'Порядок не может быть отрицательным' })
  sortOrder?: number;
}

/** Тело `PATCH /api/gear/admin/group-templates/:id`. */
export class UpdateGearGroupTemplateDto {
  @ApiProperty({ description: 'Код (менять нельзя)', required: false })
  @IsOptional()
  code?: string;

  @ApiProperty({ description: 'Название для человека', required: false, maxLength: 100 })
  @IsOptional()
  @IsString({ message: 'Название группы должно быть строкой' })
  @MaxLength(100, { message: 'Название группы не должно превышать 100 символов' })
  name?: string;

  @ApiProperty({ description: 'Порядок', required: false })
  @IsOptional()
  @IsInt({ message: 'Порядок должен быть целым числом' })
  @Min(0, { message: 'Порядок не может быть отрицательным' })
  sortOrder?: number;

  @ApiProperty({ description: 'Шаблон активен', required: false })
  @IsOptional()
  @IsBoolean({ message: 'Признак активности должен быть true или false' })
  isActive?: boolean;
}
