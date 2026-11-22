import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

import { MAX_DIARY_BODY_LENGTH } from '../trip-diary.types';
import type { AlmanacPlacement } from '../entities/trip-almanac-entry.entity';
import type { Trip } from '../entities/trip.entity';

/**
 * Альманах похода — общий текст из помеченных записей дневников
 * и воспоминаний участников (22.11.2026, переделан в секцию «Гостевой»).
 *
 * Заказчик: «Всё таки не будем создавать отдельную вкладку Альманах.
 * Сделаем это секцией в Гостевой»; «Участникам в альманахе можно выбирать
 * место вставки воспоминания — день похода (номер, не дата), до похода,
 * без указания дня»; «Формирует и редактирует альманах только админ похода
 * (организатор), ему доступна кнопочка „Удалить запись“».
 *
 * **Два вида строк в одной выдаче.** Запись дневника (`kind: 'diary'`)
 * попадает в альманах, когда автор оставил пометку «в альманах»; её день
 * считает экран по часовому поясу смотрящего, поэтому `placement` у неё
 * `null`. Воспоминание (`kind: 'memory'`) приносит место вставки с собой:
 * день выбрал автор при создании, и правка его не меняет.
 *
 * **Права — в ответе, а не в шаблоне.** `canManage` — «это организатор»,
 * `canWrite` — «участник похода»; флаги `canEdit`/`canDelete` у каждой
 * строки считает сервер. Экран не повторяет правила и не может разойтись
 * с API.
 */
export class AlmanacAuthorDto {
  @ApiProperty({ description: 'Id автора записи' })
  userId: string;

  @ApiProperty({ description: 'Имя автора на момент сборки' })
  displayName: string;

  @ApiProperty({ description: 'Аватарка автора', nullable: true })
  avatarUrl: string | null;
}

/** Одна строка альманаха: запись дневника или воспоминание участника. */
export class AlmanacEntryDto {
  @ApiProperty({ description: 'UUID строки (записи дневника или воспоминания)' })
  id: string;

  @ApiProperty({
    description: 'Откуда строка: запись дневника или воспоминание',
    enum: ['diary', 'memory'],
  })
  kind: 'diary' | 'memory';

  @ApiProperty({ description: 'Текст записи в markdown, как его написал автор' })
  body: string;

  @ApiProperty({ description: 'Когда запись написана (ISO)' })
  createdAt: string;

  @ApiProperty({ description: 'Когда воспоминание правили (ISO)', nullable: true })
  updatedAt: string | null;

  @ApiProperty({
    description:
      'Место вставки воспоминания; у записи дневника — null (день считает экран)',
    enum: ['before', 'day', 'after'],
    nullable: true,
  })
  placement: AlmanacPlacement | null;

  @ApiProperty({
    description: 'Номер дня похода у воспоминания, иначе null',
    nullable: true,
  })
  dayIndex: number | null;

  @ApiProperty({ description: 'Автор записи', type: () => AlmanacAuthorDto })
  author: AlmanacAuthorDto;

  @ApiProperty({ description: 'Можно ли править текст этому смотрящему' })
  canEdit: boolean;

  @ApiProperty({ description: 'Можно ли удалить строку этому смотрящему' })
  canDelete: boolean;
}

/** Альманах целиком: строки вперемешку, порядок расставляет экран. */
export class TripAlmanacDto {
  @ApiProperty({ description: 'Id похода', example: '679' })
  tripId: string;

  @ApiProperty({ description: 'Когда поход завершён (ISO)' })
  completedAt: string;

  @ApiProperty({
    description: 'Смотрящий — участник похода и может писать воспоминания',
  })
  canWrite: boolean;

  @ApiProperty({
    description: 'Смотрящий — организатор: правит альманах и удаляет строки',
  })
  canManage: boolean;

  @ApiProperty({
    description: 'Строки альманаха: записи дневников и воспоминания',
    type: () => [AlmanacEntryDto],
  })
  entries: AlmanacEntryDto[];

  static from(
    trip: Trip,
    entries: AlmanacEntryDto[],
    rights: { canWrite: boolean; canManage: boolean },
  ): TripAlmanacDto {
    return {
      tripId: trip.id,
      completedAt: (trip.completedAt as Date).toISOString(),
      canWrite: rights.canWrite,
      canManage: rights.canManage,
      entries,
    };
  }
}

/**
 * Создание воспоминания.
 *
 * `dayIndex` обязателен только для `placement = 'day'`; проверка
 * согласованности стоит в сервисе, потому что зависит от значения
 * `placement` и даёт понятный текст ошибки, а не общий отказ валидации.
 */
export class CreateAlmanacEntryDto {
  @ApiProperty({
    description: 'Место вставки: до похода, конкретный день, самый конец',
    enum: ['before', 'day', 'after'],
  })
  @IsIn(['before', 'day', 'after'], {
    message: 'Место воспоминания — before, day или after',
  })
  placement: AlmanacPlacement;

  @ApiProperty({
    description: 'Номер дня похода (1…), нужен при placement = day',
    required: false,
  })
  @IsOptional()
  @IsInt({ message: 'Номер дня — целое число' })
  @Min(1, { message: 'Номер дня начинается с 1' })
  @Max(366, { message: 'Номер дня не больше 366' })
  dayIndex?: number;

  @ApiProperty({ description: 'Текст воспоминания в markdown' })
  @IsString({ message: 'Текст воспоминания — строка' })
  @Length(1, MAX_DIARY_BODY_LENGTH, {
    message: `Текст воспоминания — от 1 до ${MAX_DIARY_BODY_LENGTH} символов`,
  })
  body: string;
}

/**
 * Правка воспоминания: только текст.
 *
 * Место вставки не принимается намеренно — «положение её после
 * редактирования не изменяется» (решение заказчика). Присланные
 * `placement`/`dayIndex` сервер просто не читает.
 */
export class UpdateAlmanacEntryDto {
  @ApiProperty({ description: 'Новый текст воспоминания в markdown' })
  @IsString({ message: 'Текст воспоминания — строка' })
  @Length(1, MAX_DIARY_BODY_LENGTH, {
    message: `Текст воспоминания — от 1 до ${MAX_DIARY_BODY_LENGTH} символов`,
  })
  body: string;
}
