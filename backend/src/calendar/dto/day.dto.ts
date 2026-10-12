import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import type { CalendarDayType } from '../calendar.types';

/**
 * DTO календарных дней.
 *
 * Собраны в один файл, потому что описывают одно и то же — день и его
 * правку, — и разъехавшиеся по файлам четыре почти одинаковых класса
 * читать тяжелее, чем один.
 */

/** Строгая дата без времени: `2026-10-07`. Часовые пояса тут ни при чём. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const DAY_TYPES: CalendarDayType[] = ['workday', 'weekend', 'short_workday'];

const DATE_MESSAGE = 'Дата должна быть в формате ГГГГ-ММ-ДД';

/** Ответ: день персонального календаря. */
export class CalendarDayDto {
  @ApiProperty({ description: 'Дата', example: '2026-10-07' })
  date: string;

  @ApiProperty({
    description: 'Тип дня',
    enum: DAY_TYPES,
    example: 'workday',
  })
  dayType: CalendarDayType;

  @ApiProperty({
    description: 'Метка дня: «Понедельник», «Новый год», «ДР Любы».',
    example: 'Понедельник',
    nullable: true,
  })
  label: string | null;

  @ApiProperty({
    description: 'Заметка «поделиться». Пока никому не показывается — задел.',
    nullable: true,
  })
  notePublic: string | null;

  @ApiProperty({ description: 'Личная заметка дня', nullable: true })
  notePersonal: string | null;

  static from(day: {
    date: string;
    dayType: CalendarDayType;
    label: string | null;
    notePublic?: string | null;
    notePersonal?: string | null;
  }): CalendarDayDto {
    return {
      date: day.date,
      dayType: day.dayType,
      label: day.label,
      notePublic: day.notePublic ?? null,
      notePersonal: day.notePersonal ?? null,
    };
  }
}

/**
 * Параметры GET /api/calendar/days.
 *
 * Диапазон ограничен годом: фронт запрашивает месяц вместе с хвостами
 * соседних месяцев (42 дня), год — это уже запас на будущее.
 */
export class DayRangeQueryDto {
  @ApiProperty({ description: 'Начало диапазона', example: '2026-09-28' })
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  from: string;

  @ApiProperty({ description: 'Конец диапазона', example: '2026-11-01' })
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  to: string;
}

/**
 * Тело PATCH /api/calendar/days — правка одного дня из модалки дня.
 *
 * Оба поля, кроме даты, опциональны: можно поменять только статус
 * (сделать день выходным) или только метку («ДР Любы»), не пересылая
 * второе. `label: null` — осознанная очистка метки.
 */
export class UpdateDayDto {
  @ApiProperty({ description: 'Какой день правим', example: '2026-10-07' })
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  date: string;

  @ApiProperty({ description: 'Новый тип дня', enum: DAY_TYPES, required: false })
  @IsOptional()
  @IsIn(DAY_TYPES, { message: 'Недопустимый тип дня' })
  dayType?: CalendarDayType;

  @ApiProperty({
    description: 'Новая метка. null — очистить.',
    maxLength: 100,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Метка должна быть строкой' })
  @MaxLength(100, { message: 'Метка не должна превышать 100 символов' })
  label?: string | null;
}

/** Один день в пачке PUT /api/calendar/days. */
export class UpdateDaysItemDto {
  @ApiProperty({ description: 'Дата', example: '2026-10-07' })
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  date: string;

  @ApiProperty({ description: 'Тип дня', enum: DAY_TYPES })
  @IsIn(DAY_TYPES, { message: 'Недопустимый тип дня' })
  dayType: CalendarDayType;

  @ApiProperty({
    description: 'Метка дня',
    maxLength: 100,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Метка должна быть строкой' })
  @MaxLength(100, { message: 'Метка не должна превышать 100 символов' })
  label?: string | null;
}

/**
 * Тело PUT /api/calendar/days — «Сохранить» в модалке производственного
 * календаря, когда пользователь накопил несколько диапазонов.
 *
 * Тип дня здесь обязателен, метка — нет: диапазон «рабочие дни» ставит
 * только статус. Если в пачке одна дата встречается дважды — применяется
 * последняя запись, как договорились.
 */
export class UpdateDaysDto {
  @ApiProperty({ description: 'Дни для обновления', type: [UpdateDaysItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Нужен хотя бы один день' })
  @ArrayMaxSize(400, { message: 'За раз можно изменить не больше 400 дней' })
  @ValidateNested({ each: true })
  @Type(() => UpdateDaysItemDto)
  days: UpdateDaysItemDto[];
}
