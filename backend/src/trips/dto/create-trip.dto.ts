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
  Max,
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

/**
 * Вариант дат в запросе на создание похода — прогноз.
 *
 * Все компоненты необязательны, и это не небрежность: «когда-нибудь летом
 * на неделю» — это месяц плюс продолжительность и ничего больше. Что чего
 * требует (`день` без `месяца` нельзя, `дельта` без `продолжительности`
 * нельзя) проверяет база своими CHECK-ами, а здесь стоит только грубая
 * проверка диапазонов: чтобы мусор вроде месяца `13` не доезжал до БД
 * и не превращался в 500.
 */
export class TripDateVariantDto {
  @ApiProperty({
    description: 'Год',
    example: 2027,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsInt({ message: 'Год должен быть целым числом' })
  @Min(1960, { message: 'Год не может быть раньше 1960' })
  @Max(2100, { message: 'Год не может быть позже 2100' })
  year?: number | null;

  @ApiProperty({
    description: 'Месяц',
    example: 6,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsInt({ message: 'Месяц должен быть целым числом' })
  @Min(1, { message: 'Месяц — от 1 до 12' })
  @Max(12, { message: 'Месяц — от 1 до 12' })
  month?: number | null;

  @ApiProperty({
    description: 'День месяца',
    example: 5,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsInt({ message: 'День должен быть целым числом' })
  @Min(1, { message: 'День — от 1 до 31' })
  @Max(31, { message: 'День — от 1 до 31' })
  day?: number | null;

  @ApiProperty({
    description: 'Минимум продолжительности в днях',
    example: 7,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsInt({ message: 'Продолжительность должна быть целым числом' })
  @Min(1, { message: 'Продолжительность должна быть больше нуля' })
  durationDays?: number | null;

  @ApiProperty({
    description: 'Сколько дней сверху: «2–3 дня» — это 2 и 1',
    example: 1,
    required: false,
  })
  @IsOptional()
  @IsInt({ message: 'Дельта должна быть целым числом' })
  @Min(0, { message: 'Дельта не может быть отрицательной' })
  durationDelta?: number;
}

/**
 * Тело POST /api/trips — создание похода.
 *
 * Организатор не передаётся: им становится тот, кто прислал запрос, — id
 * берётся из токена. Передавать его полем значило бы позволить создать
 * поход от чужого имени.
 *
 * **Чего здесь нет намеренно.** Полей `actualStartedAt` / `actualFinishedAt`
 * (факт выхода и возвращения) — поход только создаётся, отмечать факт
 * нечего. Ролей и участников — организатор получает роль и место в составе
 * автоматически, остальные добавляются потом. Спортивных характеристик —
 * их в походе нет вовсе, см. `docs/ph/trips.md`.
 *
 * **Взаимозависимые проверки живут в сервисе, а не здесь.** «Коммерческий
 * обязан иметь цену», «некоммерческий не имеет её вовсе», «решённый поход
 * обязан иметь обе даты» — это условия на пару полей. `class-validator`
 * умеет их выражать через `ValidateIf`, но сообщения об ошибке после этого
 * читаются как шифр, поэтому проверки вынесены в сервис: текст ошибки там
 * человеческий, а статус ответа тот же — 400.
 */
export class CreateTripDto {
  @ApiProperty({
    description: 'Цель похода — id из справочника географических объектов',
    example: 2,
  })
  @IsInt({ message: 'Цель должна быть id из справочника' })
  @Min(1, { message: 'Цель должна быть id из справочника' })
  goalObjectId: number;

  @ApiProperty({
    description: 'Короткое имя похода. Пусто — показывается имя цели',
    example: 'Витязь на майские',
    maxLength: 120,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: 'Название должно быть строкой' })
  @MaxLength(120, { message: 'Название не должно превышать 120 символов' })
  title?: string | null;

  @ApiProperty({
    description: 'Маршрут: markdown со ссылками [[object:N]]',
    example: 'Подход от станции, заброска на [[object:2]]',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Маршрут должен быть строкой' })
  @MaxLength(20000, { message: 'Маршрут не должен превышать 20000 символов' })
  routeText?: string;

  @ApiProperty({
    description: 'Требования к участникам: опыт, снаряжение',
    example: 'Нужны свои кошки, опыт ночёвок зимой',
    maxLength: 5000,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: 'Требования должны быть строкой' })
  @MaxLength(5000, {
    message: 'Требования не должны превышать 5000 символов',
  })
  requirementsText?: string | null;

  @ApiProperty({
    description:
      'Видимость: public — всем зарегистрированным, private — участникам',
    enum: TRIP_VISIBILITIES,
    example: 'public',
    required: false,
  })
  @IsOptional()
  @IsIn(TRIP_VISIBILITIES, { message: 'Недопустимая видимость похода' })
  visibility?: TripVisibility;

  @ApiProperty({
    description: 'Стадия подготовки. decided требует обеих дат',
    enum: TRIP_STATUSES,
    example: 'planning',
    required: false,
  })
  @IsOptional()
  @IsIn(TRIP_STATUSES, { message: 'Недопустимый статус похода' })
  status?: TripStatus;

  @ApiProperty({
    description: 'Активности из справочника календаря',
    type: [Number],
    example: [1, 4],
    required: false,
  })
  @IsOptional()
  @IsArray({ message: 'Активности должны быть массивом' })
  @ArrayMaxSize(10, { message: 'У похода не больше 10 активностей' })
  @IsInt({ each: true, message: 'Активность должна быть id из справочника' })
  @Min(1, { each: true, message: 'Активность должна быть id из справочника' })
  activityTypeIds?: number[];

  @ApiProperty({
    description: 'Начало похода по решению организатора',
    example: '2027-05-05T01:00:00.000Z',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsISO8601({}, { message: 'Начало должно быть датой в формате ISO 8601' })
  startsAt?: string | null;

  @ApiProperty({
    description: 'Конец похода по решению организатора',
    example: '2027-05-09T10:00:00.000Z',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsISO8601({}, { message: 'Конец должен быть датой в формате ISO 8601' })
  endsAt?: string | null;

  @ApiProperty({
    description: 'Коммерческий поход: организатор зарабатывает',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean({
    message: 'Признак коммерческого похода должен быть true или false',
  })
  isCommercial?: boolean;

  @ApiProperty({
    description:
      'Цена участия в рублях. Только у коммерческого и там обязательна',
    example: 25000,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsInt({ message: 'Цена должна быть целым числом рублей' })
  @Min(1, { message: 'Цена должна быть больше нуля' })
  priceRub?: number | null;

  @ApiProperty({
    description: 'Что входит в стоимость: markdown. Только у коммерческого',
    example: 'Заброска, питание, прокат снаряжения',
    maxLength: 5000,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: 'Описание цены должно быть строкой' })
  @MaxLength(5000, {
    message: 'Описание цены не должно превышать 5000 символов',
  })
  priceNote?: string | null;

  @ApiProperty({
    description: 'Варианты дат — прогноз: «эти выходные или следующие»',
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
