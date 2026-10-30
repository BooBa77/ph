import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

import type { GearValueKind } from '../gear.types';
import { GEAR_VALUE_KINDS } from '../gear.types';
import type { GearItemAttribute } from '../entities/gear-item-attribute.entity';
import type { GearItem } from '../entities/gear-item.entity';

/**
 * Значение характеристики у вещи, как его видит API.
 *
 * `code` — код характеристики внутри типа (`seats`, `model`), `value` —
 * само значение в своём типе: число, строка или галочка. Вид отдаётся
 * рядом, чтобы фронт показал «3 места», а не «3»: единица живёт
 * у характеристики, а не у значения.
 */
export class GearItemAttributeDto {
  @ApiProperty({ description: 'Id характеристики', example: 12 })
  attributeId: number;

  @ApiProperty({ description: 'Код характеристики', example: 'seats' })
  code: string;

  @ApiProperty({ description: 'Название характеристики', example: 'Вместимость' })
  name: string;

  @ApiProperty({
    description: 'Вид значения',
    enum: GEAR_VALUE_KINDS,
    example: 'number',
  })
  valueKind: GearValueKind;

  @ApiProperty({
    description: 'Единица измерения',
    example: 'мест',
    nullable: true,
  })
  unit: string | null;

  @ApiProperty({
    description: 'Значение: число, строка (для списка — имя варианта) или галочка',
    example: 3,
  })
  value: number | string | boolean;

  static from(row: GearItemAttribute): GearItemAttributeDto {
    return {
      attributeId: row.gearTypeAttributeId,
      code: row.gearTypeAttribute.code,
      name: row.gearTypeAttribute.name,
      valueKind: row.gearTypeAttribute.valueKind,
      unit: row.gearTypeAttribute.unit,
      // `??` умышленно: `false` у галочки — значение, а не «пусто».
      value: row.numberValue ?? row.textValue ?? row.boolValue ?? '',
    };
  }
}

/** Предмет снаряжения в ответе API. */
export class GearItemDto {
  @ApiProperty({ description: 'Id предмета', example: '5' })
  id: string;

  @ApiProperty({ description: 'Id типа снаряжения', example: 1 })
  typeId: number;

  @ApiProperty({ description: 'Код типа', example: 'tent' })
  typeCode: string;

  @ApiProperty({ description: 'Название типа', example: 'Палатка' })
  typeName: string;

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

  @ApiProperty({
    description: 'Значения характеристик в порядке справочника',
    type: [GearItemAttributeDto],
  })
  attributes: GearItemAttributeDto[];

  @ApiProperty({ description: 'Создан', example: '2026-10-21T08:00:00.000Z' })
  createdAt: string;

  static from(item: GearItem): GearItemDto {
    return {
      id: item.id,
      typeId: item.gearTypeId,
      typeCode: item.gearType.code,
      typeName: item.gearType.name,
      title: item.title,
      weightGrams: item.weightGrams,
      note: item.note,
      attributes: (item.attributes ?? []).map((row) =>
        GearItemAttributeDto.from(row),
      ),
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

/**
 * Тело `POST /api/gear` — новый предмет.
 *
 * **Тип обязателен** (30.10.2026): вид старого каталога удалён из контракта
 * вместе с прослойкой перехода. `typeId` — единственный способ сказать,
 * что это за вещь, и единственный источник набора характеристик: без типа
 * неизвестно даже, какие значения спрашивать.
 *
 * `attributes` — **карта** «код характеристики → значение», а не список
 * пар: код уникален внутри типа, и карта не даёт прислать одну
 * характеристику дважды. Неизвестный код — 400: молча игнорировать
 * опечатку значило бы сохранить вещь без значения и не сказать об этом.
 * `null` или пустая строка — стереть значение.
 */
export class CreateGearItemDto {
  @ApiProperty({ description: 'Id типа снаряжения', example: 1 })
  @IsInt({ message: 'Тип снаряжения должен быть указан числом' })
  @Min(1, { message: 'Некорректный тип снаряжения' })
  typeId: number;

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

  @ApiProperty({
    description: 'Значения характеристик: { код: значение }',
    example: { seats: 3, model: 'MSR' },
    required: false,
  })
  @IsOptional()
  @IsObject({ message: 'Значения характеристик — объект «код: значение»' })
  attributes?: Record<string, unknown>;
}

/**
 * Тело `PATCH /api/gear/:id`.
 *
 * `weightGrams: null` — осознанно стереть вес: «не знаю, взвешу позже».
 * Поэтому поле принимает `null`, а не только число. Так же ведёт себя
 * `attributes`: ключа нет — значение не трогаем, `null` — стираем.
 */
export class UpdateGearItemDto {
  @ApiProperty({ description: 'Id типа снаряжения', required: false })
  @IsOptional()
  @IsInt({ message: 'Тип снаряжения должен быть указан числом' })
  @Min(1, { message: 'Некорректный тип снаряжения' })
  typeId?: number;

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

  @ApiProperty({
    description: 'Значения характеристик: { код: значение }. null — стереть',
    example: { seats: 4 },
    required: false,
  })
  @IsOptional()
  @IsObject({ message: 'Значения характеристик — объект «код: значение»' })
  attributes?: Record<string, unknown>;
}
