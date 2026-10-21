import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

import type { GearKind } from '../gear.types';
import { GEAR_KINDS } from '../gear.types';
import type { GearItem } from '../entities/gear-item.entity';

/** Предмет снаряжения в ответе API. */
export class GearItemDto {
  @ApiProperty({ description: 'Id предмета', example: '5' })
  id: string;

  @ApiProperty({ description: 'Вид снаряжения', enum: GEAR_KINDS, example: 'tent' })
  kind: GearKind;

  @ApiProperty({ description: 'Название', example: 'Палатка на четверых' })
  title: string;

  @ApiProperty({
    description: 'Вес в граммах. null — не указан',
    example: 2400,
    nullable: true,
  })
  weightGrams: number | null;

  @ApiProperty({
    description: 'Комментарий',
    example: 'проклеена, течёт по шву',
    nullable: true,
  })
  note: string | null;

  @ApiProperty({ description: 'Создан', example: '2026-10-21T08:00:00.000Z' })
  createdAt: string;

  static from(item: GearItem): GearItemDto {
    return {
      id: item.id,
      kind: item.kind,
      title: item.title,
      weightGrams: item.weightGrams,
      note: item.note,
      createdAt: item.createdAt.toISOString(),
    };
  }
}

/**
 * Мой список снаряжения и итог по весу.
 *
 * `totalWeightGrams` — сумма **только известных** весов, а
 * `itemsWithoutWeight` — сколько предметов в неё не попало. Без второго
 * числа итог выглядел бы точным, хотя половина рюкзака не взвешена.
 */
export class GearListDto {
  @ApiProperty({ description: 'Предметы', type: [GearItemDto] })
  items: GearItemDto[];

  @ApiProperty({
    description: 'Сумма известных весов, граммы',
    example: 5400,
  })
  totalWeightGrams: number;

  @ApiProperty({
    description: 'Сколько предметов без веса — они в сумму не входят',
    example: 2,
  })
  itemsWithoutWeight: number;
}

/** Тело `POST /api/gear` — новый предмет. */
export class CreateGearItemDto {
  @ApiProperty({ description: 'Вид снаряжения', enum: GEAR_KINDS, example: 'tent' })
  @IsIn(GEAR_KINDS, { message: 'Недопустимый вид снаряжения' })
  kind: GearKind;

  @ApiProperty({
    description: 'Название: «Палатка на четверых»',
    example: 'Палатка на четверых',
    maxLength: 120,
  })
  @IsString({ message: 'Название должно быть строкой' })
  @MaxLength(120, { message: 'Название не должно превышать 120 символов' })
  title: string;

  @ApiProperty({
    description: 'Вес в граммах. Не указан — не считается',
    example: 2400,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsInt({ message: 'Вес должен быть целым числом граммов' })
  @Min(1, { message: 'Вес должен быть больше нуля' })
  weightGrams?: number | null;

  @ApiProperty({
    description: 'Комментарий',
    maxLength: 500,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: 'Комментарий должен быть строкой' })
  @MaxLength(500, { message: 'Комментарий не должен превышать 500 символов' })
  note?: string | null;
}

/**
 * Тело `PATCH /api/gear/:id`.
 *
 * `weightGrams: null` — осознанно стереть вес: «не знаю, взвешу позже».
 * Поэтому поле принимает `null`, а не только число.
 */
export class UpdateGearItemDto {
  @ApiProperty({ description: 'Вид снаряжения', enum: GEAR_KINDS, required: false })
  @IsOptional()
  @IsIn(GEAR_KINDS, { message: 'Недопустимый вид снаряжения' })
  kind?: GearKind;

  @ApiProperty({ description: 'Название', maxLength: 120, required: false })
  @IsOptional()
  @IsString({ message: 'Название должно быть строкой' })
  @MaxLength(120, { message: 'Название не должно превышать 120 символов' })
  title?: string;

  @ApiProperty({
    description: 'Вес в граммах. null — стереть',
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsInt({ message: 'Вес должен быть целым числом граммов' })
  @Min(1, { message: 'Вес должен быть больше нуля' })
  weightGrams?: number | null;

  @ApiProperty({
    description: 'Комментарий. null — стереть',
    maxLength: 500,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Комментарий должен быть строкой' })
  @MaxLength(500, { message: 'Комментарий не должен превышать 500 символов' })
  note?: string | null;
}
