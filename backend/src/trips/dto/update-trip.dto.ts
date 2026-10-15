import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  TRIP_STATUSES,
  TRIP_VISIBILITIES,
  type TripStatus,
  type TripVisibility,
} from '../trip.types';
import { TripDateVariantDto } from './create-trip.dto';

/**
 * Тело `PATCH /api/trips/:id` — правка похода.
 *
 * ## Три состояния поля, и их надо различать
 *
 * 1. **Поля нет в запросе** — не трогаем. Так PATCH и должен работать:
 *    прислали одно поле, остальные остались как были.
 * 2. **`null`** — осознанная очистка (снять дату, стереть требования).
 * 3. **Значение** — записать.
 *
 * `@IsOptional()` в `class-validator` пропускает и `null`, и `undefined`,
 * поэтому различить их можно только по факту наличия свойства в объекте —
 * этим и занимается сервис. Ни одно поле здесь не обязательно: `PATCH {}`
 * не ошибка, он ничего не меняет.
 *
 * `routeText` в `null` не бывает: колонка `NOT NULL`, пустой маршрут — это
 * пустая строка, а не отсутствие.
 *
 * ## Взаимозависимые условия проверяются по итогу, а не по патчу
 *
 * «Коммерческий обязан иметь цену» нельзя проверить на одном лишь теле:
 * поход уже может быть коммерческим с ценой, а в запросе пришло только
 * `isCommercial: false`. Поэтому сервис считает **итоговое** состояние
 * (что было + что пришло) и проверяет его — ровно то же, что сделает CHECK
 * в базе, только с внятным текстом и до записи.
 */
export class UpdateTripDto {
  @ApiProperty({
    description: 'Новая цель похода',
    example: 14,
    required: false,
  })
  @IsOptional()
  @IsInt({ message: 'Цель должна быть id из справочника' })
  @Min(1, { message: 'Цель должна быть id из справочника' })
  goalObjectId?: number;

  @ApiProperty({
    description: 'Анонс: короткий текст для ленты. null — убрать анонс',
    maxLength: 120,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Анонс должен быть строкой' })
  @MaxLength(120, { message: 'Анонс не должен превышать 120 символов' })
  announcement?: string | null;

  @ApiProperty({
    description:
      'Маршрут: markdown со ссылками [[object:N]]. При сохранении индекс упоминаний пересобирается',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Маршрут должен быть строкой' })
  @MaxLength(20000, { message: 'Маршрут не должен превышать 20000 символов' })
  routeText?: string;

  @ApiProperty({
    description: 'Требования к участникам. null — стереть',
    maxLength: 5000,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Требования должны быть строкой' })
  @MaxLength(5000, {
    message: 'Требования не должны превышать 5000 символов',
  })
  requirementsText?: string | null;

  @ApiProperty({
    description: 'Видимость похода',
    enum: TRIP_VISIBILITIES,
    required: false,
  })
  @IsOptional()
  @IsIn(TRIP_VISIBILITIES, { message: 'Недопустимая видимость похода' })
  visibility?: TripVisibility;

  @ApiProperty({
    description: 'Стадия подготовки. decided требует обеих дат',
    enum: TRIP_STATUSES,
    required: false,
  })
  @IsOptional()
  @IsIn(TRIP_STATUSES, { message: 'Недопустимый статус похода' })
  status?: TripStatus;

  @ApiProperty({
    description: 'Начало по решению организатора. null — снять решение',
    example: '2027-05-05T01:00:00.000Z',
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsISO8601({}, { message: 'Начало должно быть датой в формате ISO 8601' })
  startsAt?: string | null;

  @ApiProperty({
    description: 'Конец по решению организатора. null — снять решение',
    example: '2027-05-09T10:00:00.000Z',
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsISO8601({}, { message: 'Конец должен быть датой в формате ISO 8601' })
  endsAt?: string | null;

  @ApiProperty({
    description:
      'Фактический выход на маршрут. Заполняется после похода, план не затирает',
    example: '2027-05-06T01:30:00.000Z',
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsISO8601(
    {},
    { message: 'Фактический выход должен быть датой в формате ISO 8601' },
  )
  actualStartedAt?: string | null;

  @ApiProperty({
    description: 'Фактическое возвращение с маршрута',
    example: '2027-05-10T11:00:00.000Z',
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsISO8601(
    {},
    { message: 'Фактическое возвращение должно быть датой в формате ISO 8601' },
  )
  actualFinishedAt?: string | null;

  @ApiProperty({
    description: 'Набор закрыт: заявки не принимаются',
    required: false,
  })
  @IsOptional()
  @IsBoolean({
    message: 'Признак закрытого набора должен быть true или false',
  })
  isRecruitmentClosed?: boolean;

  @ApiProperty({
    description: 'Коммерческий поход: организатор зарабатывает',
    required: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'Признак коммерции должен быть true или false' })
  isCommercial?: boolean;

  @ApiProperty({
    description:
      'Спортивное мероприятие: официальный поход с зачётом, соревнование, сборы',
    required: false,
  })
  @IsOptional()
  @IsBoolean({
    message: 'Признак спортивного мероприятия должен быть true или false',
  })
  isSport?: boolean;

  @ApiProperty({
    description: 'Цена участия в рублях. null — снять',
    example: 25000,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsInt({ message: 'Цена должна быть целым числом рублей' })
  @Min(1, { message: 'Цена должна быть больше нуля' })
  priceRub?: number | null;

  @ApiProperty({
    description: 'Что входит в стоимость. null — стереть',
    maxLength: 5000,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Описание цены должно быть строкой' })
  @MaxLength(5000, {
    message: 'Описание цены не должно превышать 5000 символов',
  })
  priceNote?: string | null;

  @ApiProperty({
    description: 'Активности из справочника календаря',
    type: [Number],
    required: false,
  })
  @IsOptional()
  @IsArray({ message: 'Активности должны быть массивом' })
  @ArrayMaxSize(10, { message: 'У похода не больше 10 активностей' })
  @IsInt({ each: true, message: 'Активность должна быть id из справочника' })
  @Min(1, { each: true, message: 'Активность должна быть id из справочника' })
  activityTypeIds?: number[];

  @ApiProperty({
    description:
      'Варианты дат. Присланный массив заменяет прежний целиком; пустой массив убирает все',
    type: [TripDateVariantDto],
    required: false,
  })
  @IsOptional()
  @IsArray({ message: 'Варианты дат должны быть массивом' })
  @ArrayMaxSize(20, { message: 'У похода не больше 20 вариантов дат' })
  @ValidateNested({ each: true })
  @Type(() => TripDateVariantDto)
  dateVariants?: TripDateVariantDto[];
}
