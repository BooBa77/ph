import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

import type { GearGroup } from '../entities/gear-group.entity';
import { GEAR_CODE_MAX_LENGTH, GEAR_CODE_PATTERN } from '../gear.types';

/**
 * Группа снаряжения в ответе API — полка каталога (31.10.2026).
 *
 * `code` — стабильный контракт (по нему находится группа по умолчанию
 * `other`), `name` — то, что видит человек. `sortOrder` задаёт порядок
 * секций каталога: его ведёт админ, а не алфавит.
 */
export class GearGroupDto {
  @ApiProperty({ description: 'Id группы', example: 2 })
  id: number;

  @ApiProperty({ description: 'Код группы', example: 'campfire' })
  code: string;

  @ApiProperty({ description: 'Название для человека', example: 'Костровое' })
  name: string;

  @ApiProperty({ description: 'Порядок секций каталога', example: 20 })
  sortOrder: number;

  static from(group: GearGroup): GearGroupDto {
    return {
      id: group.id,
      code: group.code,
      name: group.name,
      sortOrder: group.sortOrder,
    };
  }
}

/** Публичный список: только действующие группы, в порядке админа. */
export class GearGroupListDto {
  @ApiProperty({ description: 'Группы снаряжения', type: [GearGroupDto] })
  items: GearGroupDto[];
}

/**
 * Группа в админском ответе: с архивом и числом вещей.
 *
 * `itemsCount` нужен не для красоты: админ видит, что в группе лежит,
 * прежде чем отправить её в архив, — вещи при этом остаются на месте
 * и просто уезжают в конец каталога.
 */
export class GearAdminGroupDto extends GearGroupDto {
  @ApiProperty({ description: 'Группа активна', example: true })
  isActive: boolean;

  @ApiProperty({ description: 'Сколько вещей лежит в группе', example: 3 })
  itemsCount: number;

  static fromAdmin(group: GearGroup, itemsCount: number): GearAdminGroupDto {
    return {
      ...GearGroupDto.from(group),
      isActive: group.isActive,
      itemsCount,
    };
  }
}

/** Админский список: архивные группы тоже. */
export class GearAdminGroupListDto {
  @ApiProperty({ description: 'Все группы, включая архивные', type: [GearAdminGroupDto] })
  items: GearAdminGroupDto[];
}

/**
 * Тело `POST /api/gear/admin/groups`.
 *
 * `code` занимается навсегда: в `PATCH` его нет, ошибку исправляют архивом
 * и новым кодом (как у типов). `isActive` в создании нет — новая группа
 * создаётся действующей; вернуть её из архива можно через `PATCH`.
 */
export class CreateGearGroupDto {
  @ApiProperty({ description: 'Код группы', example: 'campfire', maxLength: GEAR_CODE_MAX_LENGTH })
  @IsString({ message: 'Код группы должен быть строкой' })
  @MaxLength(GEAR_CODE_MAX_LENGTH, {
    message: `Код группы не должен превышать ${GEAR_CODE_MAX_LENGTH} символов`,
  })
  @Matches(GEAR_CODE_PATTERN, {
    message: 'Код группы — латиница, начиная с буквы: a-z, цифры и подчёркивание',
  })
  code: string;

  @ApiProperty({ description: 'Название для человека', example: 'Костровое', maxLength: 100 })
  @IsString({ message: 'Название группы должно быть строкой' })
  @MaxLength(100, { message: 'Название группы не должно превышать 100 символов' })
  name: string;

  @ApiProperty({ description: 'Порядок секций каталога', example: 20, required: false })
  @IsOptional()
  @IsInt({ message: 'Порядок должен быть целым числом' })
  @Min(0, { message: 'Порядок не может быть отрицательным' })
  sortOrder?: number;
}

/**
 * Тело `PATCH /api/gear/admin/groups/:id`.
 *
 * `code` объявлен, чтобы фильтр валидации не ответил общим «лишнее поле»:
 * сервис отвечает причиной — 400 «код менять нельзя».
 */
export class UpdateGearGroupDto {
  @ApiProperty({ description: 'Код группы (менять нельзя)', required: false })
  @IsOptional()
  code?: string;

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

  @ApiProperty({ description: 'Группа активна', required: false })
  @IsOptional()
  @IsBoolean({ message: 'Признак активности должен быть true или false' })
  isActive?: boolean;
}
