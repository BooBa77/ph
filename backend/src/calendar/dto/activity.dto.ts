import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

import type { ActivityRequestStatus } from '../entities/activity-type-request.entity';

/**
 * DTO активностей: справочник, отметки, заметки и запросы на иконки.
 *
 * Собраны в один файл: они описывают одну тему и почти все маленькие.
 */

/** Тип активности в справочнике. */
export class ActivityTypeDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'run' })
  code: string;

  @ApiProperty({ example: 'Бег' })
  label: string;

  @ApiProperty({ example: 'run', description: 'Ключ иконки в файле фронтенда' })
  icon: string;

  @ApiProperty({ example: 1 })
  groupId: number;

  static from(type: {
    id: number;
    code: string;
    label: string;
    icon: string;
    groupId: number;
  }): ActivityTypeDto {
    return {
      id: type.id,
      code: type.code,
      label: type.label,
      icon: type.icon,
      groupId: type.groupId,
    };
  }
}

/** Группа активностей: закладка в модалке дня. */
export class ActivityGroupDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'sport' })
  code: string;

  @ApiProperty({ example: 'Спорт' })
  label: string;

  @ApiProperty({
    example: '#1d6fb8',
    description: 'Цвет обводки иконок группы',
  })
  color: string;

  @ApiProperty({ type: [ActivityTypeDto] })
  types: ActivityTypeDto[];
}

/** Запрос на новую активность: как его видит автор. */
export class ActivityRequestDto {
  @ApiProperty({ example: '12' })
  id: string;

  @ApiProperty({ example: 'борда' })
  label: string;

  @ApiProperty({ enum: ['pending', 'approved', 'rejected', 'revision'] })
  status: ActivityRequestStatus;

  @ApiProperty({ nullable: true, example: 'нужна доска, не борда' })
  adminComment: string | null;

  @ApiProperty({
    description: 'Кто попросил. Заполняется только для админа.',
    nullable: true,
    required: false,
  })
  userName?: string | null;

  static from(
    request: {
      id: string;
      label: string;
      status: ActivityRequestStatus;
      adminComment: string | null;
    },
    userName?: string | null,
  ): ActivityRequestDto {
    return {
      id: request.id,
      label: request.label,
      status: request.status,
      adminComment: request.adminComment,
      ...(userName === undefined ? {} : { userName }),
    };
  }
}

/**
 * Справочник целиком: нужен один раз при открытии календаря и живёт в Pinia.
 *
 * `favorites` — идентификаторы типов, отсортированные по частоте: закладка
 * «Избранное». Пустой список — пользователь ещё ничего не отмечал.
 */
export class ActivityDictionaryDto {
  @ApiProperty({ type: [ActivityGroupDto] })
  groups: ActivityGroupDto[];

  @ApiProperty({ type: [Number], example: [1, 3, 7] })
  favorites: number[];

  @ApiProperty({
    type: [ActivityRequestDto],
    description: 'Запросы самого пользователя',
  })
  requests: ActivityRequestDto[];

  @ApiProperty({
    description:
      'Админ ли запросивший: по этому флагу фронт показывает модерацию',
    example: false,
  })
  isAdmin: boolean;
}

/** Что видит админ в модерации: варианты иконок и заявки. */
export class ModerationDto {
  // Ссылка на класс объявлен ниже: в декораторе нужна ленивая функция,
  // иначе TypeScript ругается «used before its declaration».
  @ApiProperty({ type: () => [ModerationItemDto] })
  types: ModerationItemDto[];

  @ApiProperty({ type: [ActivityRequestDto] })
  requests: ActivityRequestDto[];
}

/** Отметка активности на дне. */
export class ToggleActivityDto {
  @ApiProperty({ example: '2026-10-07' })
  @IsString()
  date: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  activityTypeId: number;
}

/** Заметки дня: обе сразу, одним сохранением. */
export class DayNotesDto {
  @ApiProperty({ example: '2026-10-07' })
  @IsString()
  date: string;

  @ApiProperty({
    description: 'Публичная заметка. null — очистить.',
    maxLength: 2000,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Заметка должна быть строкой' })
  @MaxLength(2000, { message: 'Заметка не должна превышать 2000 символов' })
  notePublic?: string | null;

  @ApiProperty({
    description: 'Личная заметка. null — очистить.',
    maxLength: 2000,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Заметка должна быть строкой' })
  @MaxLength(2000, { message: 'Заметка не должна превышать 2000 символов' })
  notePersonal?: string | null;
}

/** Запрос пользователя на новую активность. */
export class CreateActivityRequestDto {
  @ApiProperty({ example: 'борда', maxLength: 100 })
  @IsString()
  @MaxLength(100, { message: 'Название не должно превышать 100 символов' })
  label: string;
}

/** Решение админа по запросу. */
export class DecideActivityRequestDto {
  @ApiProperty({ enum: ['approved', 'rejected', 'revision'] })
  @IsIn(['approved', 'rejected', 'revision'], {
    message: 'Решение: approved, rejected или revision',
  })
  status: Exclude<ActivityRequestStatus, 'pending'>;

  @ApiProperty({
    required: false,
    maxLength: 500,
    example: 'фигурка слишком мелкая',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Комментарий не должен превышать 500 символов' })
  comment?: string | null;
}

/**
 * Решение админа по типу: включить (одобрить вариант иконки) или погасить.
 *
 * `@IsBoolean` здесь обязателен, а не для красоты: ValidationPipe включён
 * с `whitelist` и `forbidNonWhitelisted`, поэтому поле без валидационного
 * декоратора считается лишним и запрос падает с 400 «property isActive
 * should not exist». Именно так клик по иконке в модерации и ломался.
 */
export class SetTypeActiveDto {
  @ApiProperty({ example: true })
  @IsBoolean({ message: 'isActive должен быть true или false' })
  isActive: boolean;
}

/** Готовый (или предлагаемый) тип для модерации. */
export class ModerationItemDto {
  @ApiProperty({ example: 15 })
  id: number;

  @ApiProperty({ example: 'борда' })
  label: string;

  @ApiProperty({
    example: 'board',
    description: 'Ключ иконки: по нему фронт рисует вариант',
  })
  icon: string;

  @ApiProperty({ example: 'sport' })
  groupCode: string;

  @ApiProperty({ example: 'Спорт' })
  groupLabel: string;

  @ApiProperty({ example: false, description: 'false — вариант ждёт решения' })
  isActive: boolean;

  @ApiProperty({ nullable: true, example: 'Сергей Трегубов' })
  requestedBy: string | null;
}
