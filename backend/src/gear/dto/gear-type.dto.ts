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

import { GearType } from '../entities/gear-type.entity';
import { GearTypeAttribute } from '../entities/gear-type-attribute.entity';
import {
  GEAR_CODE_MAX_LENGTH,
  GEAR_CODE_PATTERN,
  GEAR_VALUE_KINDS,
} from '../gear.types';
import type { GearValueKind } from '../gear.types';

/** Подсказка к коду — одна и та же в API, в сиде и в админке. */
const CODE_HINT = 'Код — латиница, начиная с буквы: ^[a-z][a-z0-9_]*$';

/**
 * Характеристика типа в ответе API.
 *
 * `valueKind` — не украшение: по нему фронт выбирает поле ввода (число,
 * строка, галочка), а Stage B — колонку для значения.
 */
export class GearTypeAttributeDto {
  @ApiProperty({ description: 'Id характеристики', example: 1 })
  id: number;

  @ApiProperty({ description: 'Код внутри типа', example: 'seats' })
  code: string;

  @ApiProperty({ description: 'Название', example: 'Вместимость' })
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

  @ApiProperty({ description: 'Обязательная характеристика', example: true })
  isRequired: boolean;

  @ApiProperty({ description: 'Порядок в форме', example: 0 })
  sortOrder: number;

  static from(attribute: GearTypeAttribute): GearTypeAttributeDto {
    return {
      id: attribute.id,
      code: attribute.code,
      name: attribute.name,
      valueKind: attribute.valueKind,
      unit: attribute.unit,
      isRequired: attribute.isRequired,
      sortOrder: attribute.sortOrder,
    };
  }
}

/**
 * Характеристика в админском ответе: то же плюс `isActive`.
 *
 * Архивные строки админке нужны — иначе «вернуть» нечего показывать.
 * В публичном ответе флага нет: там только активное.
 */
export class GearAdminTypeAttributeDto extends GearTypeAttributeDto {
  @ApiProperty({ description: 'Активна; false — в архиве', example: true })
  isActive: boolean;

  static fromAdmin(attribute: GearTypeAttribute): GearAdminTypeAttributeDto {
    return {
      ...GearTypeAttributeDto.from(attribute),
      isActive: attribute.isActive,
    };
  }
}

/** Тип снаряжения в публичном ответе: только активные атрибуты. */
export class GearTypeDto {
  @ApiProperty({ description: 'Id типа', example: 1 })
  id: number;

  @ApiProperty({ description: 'Стабильный код', example: 'tent' })
  code: string;

  @ApiProperty({ description: 'Название', example: 'Палатка' })
  name: string;

  @ApiProperty({ description: 'Порядок в списке', example: 0 })
  sortOrder: number;

  @ApiProperty({
    description: 'Характеристики типа в порядке показа',
    type: [GearTypeAttributeDto],
  })
  attributes: GearTypeAttributeDto[];

  /**
   * Архивные атрибуты отбрасываются здесь, а не в SQL: справочник
   * маленький, а отдельный запрос на связи ради флага `is_active` усложнил
   * бы код без выгоды.
   */
  static from(type: GearType): GearTypeDto {
    return {
      id: type.id,
      code: type.code,
      name: type.name,
      sortOrder: type.sortOrder,
      attributes: (type.attributes ?? [])
        .filter((attribute) => attribute.isActive)
        .map((attribute) => GearTypeAttributeDto.from(attribute)),
    };
  }
}

/** Тип в админском ответе: все атрибуты, включая архивные, плюс `isActive`. */
export class GearAdminTypeDto extends GearTypeDto {
  @ApiProperty({ description: 'Активен; false — в архиве', example: true })
  isActive: boolean;

  @ApiProperty({
    description: 'Все характеристики, включая архивные',
    type: [GearAdminTypeAttributeDto],
  })
  declare attributes: GearAdminTypeAttributeDto[];

  static fromAdmin(type: GearType): GearAdminTypeDto {
    return {
      id: type.id,
      code: type.code,
      name: type.name,
      sortOrder: type.sortOrder,
      isActive: type.isActive,
      attributes: (type.attributes ?? []).map((attribute) =>
        GearAdminTypeAttributeDto.fromAdmin(attribute),
      ),
    };
  }
}

/** Публичный список: `{ items: [...] }`, как у остальных списков проекта. */
export class GearTypeListDto {
  @ApiProperty({ description: 'Активные типы', type: [GearTypeDto] })
  items: GearTypeDto[];
}

/** Админский список: архивные типы и атрибуты тоже здесь. */
export class GearAdminTypeListDto {
  @ApiProperty({ description: 'Все типы', type: [GearAdminTypeDto] })
  items: GearAdminTypeDto[];
}

/** Тело `POST /api/gear/admin/types` — новый тип. */
export class CreateGearTypeDto {
  @ApiProperty({
    description: `${CODE_HINT}. Не меняется после создания`,
    example: 'tent',
    maxLength: GEAR_CODE_MAX_LENGTH,
  })
  @IsString({ message: 'Код должен быть строкой' })
  @Matches(GEAR_CODE_PATTERN, { message: CODE_HINT })
  @MaxLength(GEAR_CODE_MAX_LENGTH, {
    message: `Код не должен превышать ${GEAR_CODE_MAX_LENGTH} символов`,
  })
  code: string;

  @ApiProperty({
    description: 'Название: «Палатка»',
    example: 'Палатка',
    maxLength: 100,
  })
  @IsString({ message: 'Название должно быть строкой' })
  @MaxLength(100, { message: 'Название не должно превышать 100 символов' })
  name: string;

  @ApiProperty({
    description: 'Порядок в списке, по умолчанию 0',
    example: 10,
    required: false,
  })
  @IsOptional()
  @IsInt({ message: 'Порядок должен быть целым числом' })
  @Min(0, { message: 'Порядок не может быть отрицательным' })
  sortOrder?: number;
}

/**
 * Тело `PATCH /api/gear/admin/types/:id`.
 *
 * `code` объявлен намеренно, хотя менять его нельзя: без поля в DTO
 * `forbidNonWhitelisted` ответил бы общим 400 «лишнее поле», а сервис
 * объясняет причину — код меняется архивом и новым кодом, а не правкой.
 */
export class UpdateGearTypeDto {
  @ApiProperty({
    description: 'Только для понятной ошибки: код не меняется',
    required: false,
  })
  @IsOptional()
  code?: string;

  @ApiProperty({ description: 'Название', maxLength: 100, required: false })
  @IsOptional()
  @IsString({ message: 'Название должно быть строкой' })
  @MaxLength(100, { message: 'Название не должно превышать 100 символов' })
  name?: string;

  @ApiProperty({
    description: 'true — вернуть из архива, false — в архив',
    required: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'Активность должна быть boolean' })
  isActive?: boolean;

  @ApiProperty({ description: 'Порядок в списке', required: false })
  @IsOptional()
  @IsInt({ message: 'Порядок должен быть целым числом' })
  @Min(0, { message: 'Порядок не может быть отрицательным' })
  sortOrder?: number;
}

/** Тело `POST /api/gear/admin/types/:id/attributes`. */
export class CreateGearTypeAttributeDto {
  @ApiProperty({
    description: `${CODE_HINT}. Не меняется после создания`,
    example: 'seats',
    maxLength: GEAR_CODE_MAX_LENGTH,
  })
  @IsString({ message: 'Код должен быть строкой' })
  @Matches(GEAR_CODE_PATTERN, { message: CODE_HINT })
  @MaxLength(GEAR_CODE_MAX_LENGTH, {
    message: `Код не должен превышать ${GEAR_CODE_MAX_LENGTH} символов`,
  })
  code: string;

  @ApiProperty({
    description: 'Название: «Вместимость»',
    example: 'Вместимость',
    maxLength: 100,
  })
  @IsString({ message: 'Название должно быть строкой' })
  @MaxLength(100, { message: 'Название не должно превышать 100 символов' })
  name: string;

  @ApiProperty({
    description: 'Вид значения. Не меняется после создания',
    enum: GEAR_VALUE_KINDS,
    example: 'number',
  })
  @IsIn(GEAR_VALUE_KINDS, { message: 'Недопустимый вид значения' })
  valueKind: GearValueKind;

  @ApiProperty({
    description: 'Единица измерения: «мест», «см», «л»',
    example: 'мест',
    maxLength: 20,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: 'Единица должна быть строкой' })
  @MaxLength(20, { message: 'Единица не должна превышать 20 символов' })
  unit?: string | null;

  @ApiProperty({
    description:
      'Обязательная характеристика. При true нужен fillMissing — замещающее значение',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'Обязательность должна быть boolean' })
  isRequired?: boolean;

  @ApiProperty({ description: 'Порядок в форме', example: 0, required: false })
  @IsOptional()
  @IsInt({ message: 'Порядок должен быть целым числом' })
  @Min(0, { message: 'Порядок не может быть отрицательным' })
  sortOrder?: number;

  /**
   * Замещающее значение для обязательного атрибута.
   *
   * В Stage A **проверяется и отбрасывается**: таблицы значений
   * (`gear_item_attributes`) ещё нет, заполнять нечего. В Stage B тот же
   * вызов начнёт писать его пустым значениям — поэтому вид проверяется
   * сейчас, правило не поменяется.
   */
  @ApiProperty({
    description:
      'Замещающее значение: число / непустая строка / boolean по valueKind. В Stage A не применяется',
    example: 3,
    required: false,
  })
  @IsOptional()
  fillMissing?: number | string | boolean | null;
}

/**
 * Тело `PATCH /api/gear/admin/types/:id/attributes/:attrId`.
 *
 * `code` и `valueKind` объявлены намеренно, как и в типе: код — 400,
 * вид — 409 (смена вида означала бы перенос уже записанных в Stage B
 * значений). Ответы с причиной понятнее, чем общий отказ whitelist.
 */
export class UpdateGearTypeAttributeDto {
  @ApiProperty({
    description: 'Только для понятной ошибки: код не меняется',
    required: false,
  })
  @IsOptional()
  code?: string;

  @ApiProperty({
    description: 'Только для понятной ошибки: вид не меняется',
    required: false,
  })
  @IsOptional()
  valueKind?: string;

  @ApiProperty({ description: 'Название', maxLength: 100, required: false })
  @IsOptional()
  @IsString({ message: 'Название должно быть строкой' })
  @MaxLength(100, { message: 'Название не должно превышать 100 символов' })
  name?: string;

  @ApiProperty({
    description: 'Единица измерения. null — стереть',
    maxLength: 20,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: 'Единица должна быть строкой' })
  @MaxLength(20, { message: 'Единица не должна превышать 20 символов' })
  unit?: string | null;

  @ApiProperty({
    description:
      'Обязательность. При включении (false → true) нужен fillMissing',
    required: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'Обязательность должна быть boolean' })
  isRequired?: boolean;

  @ApiProperty({
    description: 'true — вернуть из архива, false — в архив',
    required: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'Активность должна быть boolean' })
  isActive?: boolean;

  @ApiProperty({ description: 'Порядок в форме', required: false })
  @IsOptional()
  @IsInt({ message: 'Порядок должен быть целым числом' })
  @Min(0, { message: 'Порядок не может быть отрицательным' })
  sortOrder?: number;

  /** См. `CreateGearTypeAttributeDto.fillMissing` — в Stage A только проверка. */
  @ApiProperty({
    description:
      'Замещающее значение: число / непустая строка / boolean по valueKind. В Stage A не применяется',
    required: false,
  })
  @IsOptional()
  fillMissing?: number | string | boolean | null;
}
