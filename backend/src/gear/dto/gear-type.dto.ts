import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { GearAttributeOption } from '../entities/gear-attribute-option.entity';
import { GearType } from '../entities/gear-type.entity';
import { GearTypeAttribute } from '../entities/gear-type-attribute.entity';
import {
  GEAR_CODE_MAX_LENGTH,
  GEAR_CODE_PATTERN,
  GEAR_OPTIONS_MAX,
  GEAR_VALUE_KINDS,
} from '../gear.types';
import type { GearValueKind } from '../gear.types';

/** Подсказка к коду — одна и та же в API, в сиде и в админке. */
const CODE_HINT = 'Код — латиница, начиная с буквы: ^[a-z][a-z0-9_]*$';

/**
 * Вариант характеристики-списка в ответе API.
 *
 * `code` — контракт (на него опираются фильтры), `name` — то, что видит
 * человек и что в Stage B ляжет в `text_value` значения экземпляра.
 */
export class GearAttributeOptionDto {
  @ApiProperty({ description: 'Id варианта', example: 1 })
  id: number;

  @ApiProperty({ description: 'Код варианта', example: 'thread' })
  code: string;

  @ApiProperty({ description: 'Название для человека', example: 'резьбовой' })
  name: string;

  @ApiProperty({ description: 'Порядок в списке', example: 0 })
  sortOrder: number;

  static from(option: GearAttributeOption): GearAttributeOptionDto {
    return {
      id: option.id,
      code: option.code,
      name: option.name,
      sortOrder: option.sortOrder,
    };
  }
}

/**
 * Вариант в админском ответе: то же плюс `isActive`.
 *
 * Архивные варианты админке нужны — иначе «вернуть» нечего показывать.
 * В публичном ответе флага нет: там только активное.
 */
export class GearAdminAttributeOptionDto extends GearAttributeOptionDto {
  @ApiProperty({ description: 'Активен; false — в архиве', example: true })
  isActive: boolean;

  static fromAdmin(option: GearAttributeOption): GearAdminAttributeOptionDto {
    return {
      ...GearAttributeOptionDto.from(option),
      isActive: option.isActive,
    };
  }
}

/**
 * Характеристика типа в ответе API.
 *
 * `valueKind` — не украшение: по нему фронт выбирает поле ввода (число,
 * строка, галочка, список), а Stage B — колонку для значения.
 *
 * `options` есть всегда, даже у числа и строки — пустым массивом: клиенту
 * не приходится спрашивать «а это поле бывает?», а сервер не отдаёт
 * варианты там, где их не может быть.
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

  @ApiProperty({
    description:
      'Разрешить своё значение вместо выбора из списка. Только у valueKind = select',
    example: false,
  })
  allowCustomValue: boolean;

  @ApiProperty({ description: 'Обязательная характеристика', example: true })
  isRequired: boolean;

  @ApiProperty({ description: 'Порядок в форме', example: 0 })
  sortOrder: number;

  @ApiProperty({
    description: 'Варианты списка в порядке показа; у других видов пусто',
    type: [GearAttributeOptionDto],
  })
  options: GearAttributeOptionDto[];

  static from(attribute: GearTypeAttribute): GearTypeAttributeDto {
    return {
      id: attribute.id,
      code: attribute.code,
      name: attribute.name,
      valueKind: attribute.valueKind,
      unit: attribute.unit,
      allowCustomValue: attribute.allowCustomValue,
      isRequired: attribute.isRequired,
      sortOrder: attribute.sortOrder,
      options: (attribute.options ?? [])
        .filter((option) => option.isActive)
        .map((option) => GearAttributeOptionDto.from(option)),
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

  @ApiProperty({
    description: 'Все варианты списка, включая архивные',
    type: [GearAdminAttributeOptionDto],
  })
  declare options: GearAdminAttributeOptionDto[];

  static fromAdmin(attribute: GearTypeAttribute): GearAdminTypeAttributeDto {
    return {
      ...GearTypeAttributeDto.from(attribute),
      isActive: attribute.isActive,
      options: (attribute.options ?? []).map((option) =>
        GearAdminAttributeOptionDto.fromAdmin(option),
      ),
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

/**
 * Новый вариант характеристики-списка.
 *
 * Используется в двух местах и намеренно одной формой: в теле
 * `POST …/attributes` (админ заводит список сразу с вариантами — чтобы
 * не получить «мёртвую» характеристику без единого варианта) и в теле
 * `POST …/options` (добавить вариант к уже существующему списку).
 *
 * `code` — стабильный контракт, в `PATCH` его нет; `name` — то, что видит
 * человек и что попадёт в значение экземпляра в Stage B.
 */
export class CreateGearAttributeOptionDto {
  @ApiProperty({
    description: `${CODE_HINT}. Не меняется после создания`,
    example: 'thread',
    maxLength: GEAR_CODE_MAX_LENGTH,
  })
  @IsString({ message: 'Код варианта должен быть строкой' })
  @Matches(GEAR_CODE_PATTERN, { message: CODE_HINT })
  @MaxLength(GEAR_CODE_MAX_LENGTH, {
    message: `Код варианта не должен превышать ${GEAR_CODE_MAX_LENGTH} символов`,
  })
  code: string;

  @ApiProperty({
    description: 'Название варианта: «резьбовой»',
    example: 'резьбовой',
    maxLength: 100,
  })
  @IsString({ message: 'Название варианта должно быть строкой' })
  @MaxLength(100, {
    message: 'Название варианта не должно превышать 100 символов',
  })
  name: string;

  @ApiProperty({
    description: 'Порядок в списке, по умолчанию 0',
    example: 10,
    required: false,
  })
  @IsOptional()
  @IsInt({ message: 'Порядок варианта должен быть целым числом' })
  @Min(0, { message: 'Порядок варианта не может быть отрицательным' })
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

  /**
   * Разрешить своё значение. **Только для `valueKind = 'select'`.**
   *
   * Для числа, строки и галочки сервис отвечает 400: там своё значение
   * и так единственное, и флаг означал бы галочку, которая ничего не делает.
   */
  @ApiProperty({
    description:
      'Разрешить своё значение вместо выбора из списка. Только для valueKind = select',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'Флаг «своё значение» должен быть boolean' })
  allowCustomValue?: boolean;

  /**
   * Варианты списка — сразу при создании характеристики.
   *
   * Так админ заводит «Соединение» вместе с «резьбовой» и «цанговый» одним
   * действием: иначе он получил бы характеристику без вариантов, которая
   * ничего не предлагает, и добавлял бы их по одному. Пустой список у
   * `select` допустим только с разрешённым своим значением — иначе выбирать
   * не из чего.
   */
  @ApiProperty({
    description:
      'Варианты списка: создаются вместе с характеристикой. Только для valueKind = select',
    type: [CreateGearAttributeOptionDto],
    required: false,
  })
  @IsOptional()
  @IsArray({ message: 'Варианты должны быть списком' })
  @ArrayMaxSize(GEAR_OPTIONS_MAX, {
    message: `Вариантов не может быть больше ${GEAR_OPTIONS_MAX}`,
  })
  @ValidateNested({ each: true })
  @Type(() => CreateGearAttributeOptionDto)
  options?: CreateGearAttributeOptionDto[];

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
      'Замещающее значение: число / непустая строка / boolean / название варианта по valueKind. В Stage A не применяется',
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
    description: 'Обязательность. При включении (false → true) нужен fillMissing',
    required: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'Обязательность должна быть boolean' })
  isRequired?: boolean;

  @ApiProperty({
    description:
      'Разрешить своё значение. Только для списка; запретить при пустом списке нельзя',
    required: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'Флаг «своё значение» должен быть boolean' })
  allowCustomValue?: boolean;

  /**
   * Варианты здесь не меняются.
   *
   * Поле объявлено, чтобы админка получила причину («варианты меняются
   * отдельными ручками»), а не общий отказ whitelist. Вариант добавляют,
   * переименовывают и архивируют по одному — тогда каждое действие видно
   * в ответе и в журнале, а замена «набора» целиком молча архивировала бы
   * всё, чего не оказалось в теле.
   */
  @ApiProperty({
    description: 'Только для понятной ошибки: варианты меняются отдельными ручками',
    required: false,
  })
  @IsOptional()
  options?: unknown;

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
      'Замещающее значение: число / непустая строка / boolean / название варианта по valueKind. В Stage A не применяется',
    required: false,
  })
  @IsOptional()
  fillMissing?: number | string | boolean | null;
}

/**
 * Тело `PATCH …/attributes/:attributeId/options/:optionId`.
 *
 * `code` объявлен для понятной ошибки (400), как у типов и характеристик;
 * переименование меняет `name`, а `code` остаётся контрактом.
 *
 * Переименование варианта в Stage B будет обязано одной транзакцией обновить
 * `gear_item_attributes.text_value`, где хранится имя варианта: иначе старые
 * вещи разойдутся с новым именем. Сейчас таблицы значений нет, но правило
 * записано в `docs/ph/gear-types.md`, чтобы Stage B не узнал о нём случайно.
 */
export class UpdateGearAttributeOptionDto {
  @ApiProperty({
    description: 'Только для понятной ошибки: код варианта не меняется',
    required: false,
  })
  @IsOptional()
  code?: string;

  @ApiProperty({
    description: 'Название варианта',
    maxLength: 100,
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Название варианта должно быть строкой' })
  @MaxLength(100, {
    message: 'Название варианта не должно превышать 100 символов',
  })
  name?: string;

  @ApiProperty({ description: 'Порядок в списке', required: false })
  @IsOptional()
  @IsInt({ message: 'Порядок варианта должен быть целым числом' })
  @Min(0, { message: 'Порядок варианта не может быть отрицательным' })
  sortOrder?: number;

  @ApiProperty({
    description: 'true — вернуть из архива, false — в архив',
    required: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'Активность должна быть boolean' })
  isActive?: boolean;
}
