import { ApiProperty } from '@nestjs/swagger';
import type { Trip } from '../entities/trip.entity';

/**
 * Альманах похода — общий текст из помеченных записей дневников
 * (22.11.2026).
 *
 * Заказчик: «собирает организатор или соорганизатор кнопкой «Собрать
 * альманах» после завершения похода»; «формат: хронология по дате,
 * разделители «День N · дата», записи с автором, markdown; записи
 * не правятся».
 *
 * **Сборка живёт на чтении, а не в таблице.** Снимок пришлось бы
 * объяснять автору («почему я снял пометку, а текст остался»), а он
 * ничего не защищает: согласие автор снимает у записи, и альманах
 * обязан это уважать в тот же момент. Поэтому `GET` собирает альманах
 * из `trip_diary_entries` каждый раз.
 *
 * **Почему записи плоским списком, а не по дням.** «День N» считается
 * от даты старта **в часовом поясе смотрящего** (`utils/tripDay.ts`
 * на фронте): у похода за Байкалом день начинается не там, где у сервера.
 * Сервер отдаёт моменты времени и автора, разделители расставляет экран.
 */
export class AlmanacAuthorDto {
  @ApiProperty({ description: 'Id автора записи' })
  userId: string;

  @ApiProperty({ description: 'Имя автора на момент сборки' })
  displayName: string;

  @ApiProperty({ description: 'Аватарка автора', nullable: true })
  avatarUrl: string | null;
}

export class AlmanacEntryDto {
  @ApiProperty({ description: 'UUID записи дневника' })
  id: string;

  @ApiProperty({ description: 'Текст записи в markdown, как его написал автор' })
  body: string;

  @ApiProperty({ description: 'Когда запись написана (ISO)' })
  createdAt: string;

  @ApiProperty({ description: 'Автор записи', type: () => AlmanacAuthorDto })
  author: AlmanacAuthorDto;
}

/** Альманах целиком: записи в хронологии, старые сверху. */
export class TripAlmanacDto {
  @ApiProperty({ description: 'Id похода', example: '679' })
  tripId: string;

  @ApiProperty({ description: 'Когда поход завершён (ISO)' })
  completedAt: string;

  @ApiProperty({
    description: 'Записи, которые авторы разрешили включить, старые сверху',
    type: () => [AlmanacEntryDto],
  })
  entries: AlmanacEntryDto[];

  static from(
    trip: Trip,
    entries: AlmanacEntryDto[],
  ): TripAlmanacDto {
    return {
      tripId: trip.id,
      completedAt: (trip.completedAt as Date).toISOString(),
      entries,
    };
  }
}
