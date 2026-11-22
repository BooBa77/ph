import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';

import {
  MAX_DIARY_BODY_LENGTH,
  MAX_DIARY_SYNC_ENTRIES,
} from '../trip-diary.types';
import type { TripDiaryEntry } from '../entities/trip-diary-entry.entity';

/**
 * Запись дневника в ответе сервера.
 *
 * Времена — ISO-строки: устройство показывает их в своей зоне, а сервер
 * хранит момент времени (`timestamptz`), а не календарную дату.
 */
export class TripDiaryEntryDto {
  @ApiProperty({ description: 'UUID записи, выданный устройством', example: '9f1c…' })
  id: string;

  @ApiProperty({ description: 'Текст записи в markdown' })
  body: string;

  @ApiProperty({ description: 'Когда запись написана (ISO)', example: '2026-11-16T03:20:00.000Z' })
  createdAt: string;

  @ApiProperty({ description: 'Когда запись правили (ISO)', example: '2026-11-16T03:25:00.000Z' })
  updatedAt: string;

  @ApiProperty({
    description:
      'Можно ли этой записи попасть в альманах. По умолчанию — да (решение заказчика 22.11.2026)',
    example: true,
  })
  sharedWithTrip: boolean;

  static from(entry: TripDiaryEntry): TripDiaryEntryDto {
    return {
      id: entry.id,
      body: entry.body,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
      sharedWithTrip: entry.sharedWithTrip,
    };
  }
}

/** Вкладка «Дневник» целиком: только записи смотрящего. */
export class TripDiaryDto {
  @ApiProperty({
    description: 'Мои записи, старые сверху. Чужие не приходят никогда',
    type: () => [TripDiaryEntryDto],
  })
  entries: TripDiaryEntryDto[];

  static from(entries: TripDiaryEntry[]): TripDiaryDto {
    return { entries: entries.map((entry) => TripDiaryEntryDto.from(entry)) };
  }
}

/**
 * Одна запись в пачке синхронизации.
 *
 * `deletedAt` — могильник: устройство могло удалить запись без связи,
 * и сервер должен узнать об этом не меньше, чем о новой записи.
 * Поле `body` при удалении не обязательно — текст могильника не нужен,
 * но и стирать его не запрещено: `GET` удалённые не отдаёт.
 */
export class DiarySyncEntryDto {
  @ApiProperty({ description: 'UUID записи, выданный устройством' })
  @IsUUID('all', { message: 'Запись дневника — UUID с устройства' })
  id: string;

  @ApiProperty({ description: 'Текст записи в markdown' })
  @IsString({ message: 'Текст записи — строка' })
  @Length(1, MAX_DIARY_BODY_LENGTH, {
    message: `Текст записи — от 1 до ${MAX_DIARY_BODY_LENGTH} символов`,
  })
  body: string;

  @ApiProperty({ description: 'Когда запись написана (ISO)' })
  @IsDateString({}, { message: 'Дата создания записи — ISO 8601' })
  createdAt: string;

  @ApiProperty({ description: 'Когда запись правили (ISO)' })
  @IsDateString({}, { message: 'Дата правки записи — ISO 8601' })
  updatedAt: string;

  @ApiProperty({
    description: 'Когда запись удалена (ISO), если её удалили',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsDateString({}, { message: 'Дата удаления записи — ISO 8601' })
  deletedAt?: string | null;

  /**
   * Согласие на альманах (22.11.2026).
   *
   * Поле **необязательное**, и это не поблажка: устройство могло обновиться
   * не сразу, а в его офлайн-очереди лежит запись без пометки. Отсутствие
   * поля сервер читает как «как было» (`COALESCE` в `upsert`), поэтому старая
   * копия не переключит согласие молча ни в одну сторону. Новые записи
   * получают `true` — по умолчанию заказчика.
   */
  @ApiProperty({
    description: 'Можно ли записи попасть в альманах (по умолчанию — да)',
    required: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'Пометка «в альманах» — boolean' })
  sharedWithTrip?: boolean;
}

/**
 * Пачка изменений с устройства.
 *
 * Создание, правка и удаление идут одной дверью: на устройстве все три
 * действия дают «запись с новым состоянием», и держать три разные ручки
 * значило бы в офлайне помнить ещё и порядок, в котором их отправлять.
 * Повторная отправка той же пачки безопасна — это и есть идемпотентность.
 */
export class SyncTripDiaryDto {
  @ApiProperty({
    description: 'Мои записи, которые нужно применить',
    type: () => [DiarySyncEntryDto],
  })
  @IsArray({ message: 'Пришли список записей' })
  @ArrayMaxSize(MAX_DIARY_SYNC_ENTRIES, {
    message: `За один раз можно отправить не больше ${MAX_DIARY_SYNC_ENTRIES} записей`,
  })
  @ValidateNested({ each: true })
  @Type(() => DiarySyncEntryDto)
  entries: DiarySyncEntryDto[];
}
