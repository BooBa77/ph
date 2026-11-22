import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { DataSource, IsNull, type EntityManager } from 'typeorm';

import { TripDiaryEntry } from './entities/trip-diary-entry.entity';
import { TripParticipant } from './entities/trip-participant.entity';
import type { DiarySyncEntryDto, SyncTripDiaryDto } from './dto/trip-diary.dto';
import { TripDiaryDto } from './dto/trip-diary.dto';
import type { AlmanacEntryDto } from './dto/trip-almanac.dto';
import { TripAlmanacDto } from './dto/trip-almanac.dto';
import { TripEventsService } from './trip-events.service';
import { isValidDiaryTimes } from './trip-diary.types';
import { TripsService } from './trips.service';

/**
 * «Дневник» похода — личные записи участника (16.11.2026).
 *
 * Заказчик: «это личная закладка, выглядит как большой чат… Дневник ведётся
 * онлайн и оффлайн (синхронизация при возвращении связи)».
 *
 * **Только свои записи.** Сервер отдаёт пару «поход + человек» и никогда
 * не смешивает авторов: организатор тоже видит лишь свой дневник. Поэтому
 * здесь нет `canEdit` вкладки: право пишется по факту участия, а роль
 * фотографа — про будущий альманах, а не про личный журнал.
 *
 * **Синхронизация — одна ручка на три действия.** Создание, правка
 * и удаление на устройстве выглядят одинаково — «запись с новым
 * состоянием». Отправка пачкой делает офлайн-очередь простой: не нужно
 * помнить порядок «создать, потом поправить», а повторная отправка
 * безопасна. Спор двух устройств решает `updated_at` (last-write-wins,
 * `shouldApplyDiaryUpdate`), а совпавшие отметки оставляют серверную
 * версию — пачка, отправленная дважды, ничего не меняет.
 *
 * **Почему `INSERT … ON CONFLICT`, а не чтение и запись.** Два устройства
 * одного человека могут отправить одну запись одновременно; проверка
 * «прочитать → сравнить → записать» в этом случае проигрывает гонку.
 * Условие в `ON CONFLICT … WHERE` атомарно: чужая запись (другой поход
 * или другой автор) не перезаписывается никогда, даже если UUID совпал.
 */
@Injectable()
export class TripDiaryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly trips: TripsService,
    private readonly events: TripEventsService,
  ) {}

  /** Мои записи похода, старые сверху. */
  async getDiary(userId: string, tripId: number): Promise<TripDiaryDto> {
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    const manager = this.dataSource.manager;

    await this.assertParticipant(manager, trip.id, userId);

    return this.build(manager, trip.id, userId);
  }

  /**
   * Применить пачку изменений с устройства и вернуть дневник целиком.
   *
   * Ответ — весь мой список, а не только применённое: устройство после
   * синхронизации должно увидеть серверную правду (в том числе чужую
   * правку с другого устройства, которая оказалась новее).
   */
  async sync(
    userId: string,
    tripId: number,
    dto: SyncTripDiaryDto,
  ): Promise<TripDiaryDto> {
    const trip = await this.trips.getVisibleTrip(userId, tripId);

    await this.assertParticipant(this.dataSource.manager, trip.id, userId);

    const prepared = dto.entries.map((entry) => this.prepareEntry(entry));

    await this.dataSource.transaction(async (manager) => {
      for (const entry of prepared) {
        await this.upsert(manager, trip.id, userId, entry);
      }
    });

    // Событие — после коммита: подписчик должен перечитать уже сохранённое.
    // Дневник личный, но у одного человека бывает два устройства и две
    // вкладки — «второе окно» должно увидеть запись без перезагрузки.
    this.events.emitDiary(trip.id, userId);

    return this.build(this.dataSource.manager, trip.id, userId);
  }

  /**
   * Проверка доступа к потоку событий: 403 нужно отдать **до** заголовков
   * `text/event-stream`, иначе поток уже открыт и ошибку не отправить.
   */
  async assertCanWatch(userId: string, tripId: number): Promise<void> {
    const trip = await this.trips.getVisibleTrip(userId, tripId);

    await this.assertParticipant(this.dataSource.manager, trip.id, userId);
  }

  /**
   * Альманах похода: записи, которые авторы разрешили включить (22.11.2026).
   *
   * Заказчик: «собирает организатор или соорганизатор кнопкой «Собрать
   * альманах» после завершения похода»; «в альманах попадают только записи,
   * помеченные автором «можно в альманах»»; «записи не правятся».
   *
   * Отсюда три правила:
   *
   * 1. **Только после завершения** — иначе `409`: пока поход идёт, записи
   *    ещё пишутся, и «собранный» текст устарел бы к вечеру.
   * 2. **Только помеченные** — дневник остаётся личным, и сервер не отдаёт
   *    чужих записей даже организатору; в общий текст попадает лишь то,
   *    что автор пометил сам.
   * 3. **Видят все, кто видит поход** (решение заказчика 22.11.2026), —
   *    включая гостя. Это единственное место, где общий текст выходит
   *    за правило «гостю — только Гостевая»: чужих дневников он не открывает.
   *
   * Сборка идёт на чтении, без таблицы-снимка: пометку автор снимает
   * в любой момент, и альманах обязан это уважать. Порядок — хронология
   * по времени записи; разделители «День N · дата» расставляет экран
   * в часовом поясе смотрящего (`utils/tripDay.ts`).
   */
  async getAlmanac(userId: string, tripId: number): Promise<TripAlmanacDto> {
    const trip = await this.trips.getVisibleTrip(userId, tripId);

    if (trip.completedAt === null) {
      throw new ConflictException(
        'Альманах собирается после завершения похода',
      );
    }

    /**
     * Один запрос с `JOIN`: автор нужен у каждой записи, и походный дневник
     * у небольшой группы — это десятки строк, а не тысячи, но `relations`
     * здесь всё равно дал бы N+1 на подгрузке пользователя у записи.
     */
    const rows = await this.dataSource.manager.query(
      `SELECT e.id,
              e.body,
              e.created_at AS "createdAt",
              e.user_id    AS "userId",
              u.display_name AS "displayName",
              u.avatar_url   AS "avatarUrl"
         FROM trip_diary_entries e
         JOIN users u ON u.id = e.user_id
        WHERE e.trip_id = $1
          AND e.shared_with_trip
          AND e.deleted_at IS NULL
        ORDER BY e.created_at ASC, e.id ASC`,
      [trip.id],
    );

    const entries: AlmanacEntryDto[] = (rows as Array<Record<string, unknown>>).map(
      (row) => ({
        id: row.id as string,
        body: row.body as string,
        createdAt: new Date(row.createdAt as string | Date).toISOString(),
        author: {
          userId: row.userId as string,
          displayName: (row.displayName as string | null) ?? 'Неизвестный',
          avatarUrl: (row.avatarUrl as string | null) ?? null,
        },
      }),
    );

    return TripAlmanacDto.from(trip, entries);
  }

  /** Запись с проверенными временами и очищенным текстом. */
  private prepareEntry(entry: DiarySyncEntryDto): {
    id: string;
    body: string;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
    sharedWithTrip: boolean | undefined;
  } {
    const createdAt = new Date(entry.createdAt);
    const updatedAt = new Date(entry.updatedAt);
    const deletedAt = entry.deletedAt ? new Date(entry.deletedAt) : null;

    if (!isValidDiaryTimes(createdAt, updatedAt, deletedAt)) {
      throw new BadRequestException(
        'Время записи дневника противоречиво: правка и удаление не могут быть раньше создания',
      );
    }

    // Пробелы по краям не несут смысла, а пустую после очистки запись
    // сохранять нечего: это не «пустая заметка», а случайное нажатие.
    const body = entry.body.trim();
    if (body.length === 0) {
      throw new BadRequestException('Запись дневника не может быть пустой');
    }

    // Пометка «в альманах» может не прийти: устройство с прежней версией
    // приложения держит в офлайн-очереди запись без неё. `undefined` значит
    // «как было» — решает это `COALESCE` в `upsert`, а не этот метод.
    return {
      id: entry.id,
      body,
      createdAt,
      updatedAt,
      deletedAt,
      sharedWithTrip: entry.sharedWithTrip,
    };
  }
  /**
   * Вставить или обновить запись по правилу «позже — значит главнее».
   *
   * `created_at` при обновлении не меняется: у записи одно время рождения,
   * даже если её правили на другом устройстве с чуть сдвинутыми часами.
   */
  private async upsert(
    manager: EntityManager,
    tripId: string,
    userId: string,
    entry: {
      id: string;
      body: string;
      createdAt: Date;
      updatedAt: Date;
      deletedAt: Date | null;
      sharedWithTrip: boolean | undefined;
    },
  ): Promise<void> {
    /**
     * `COALESCE` у пометки «в альманах» — не украшение.
     *
     * Синхронизация присылает запись целиком, и присланное `false` обязано
     * снимать согласие. Но старая версия приложения поля не знает вовсе;
     * `NULL` в этом месте значит «как было»: иначе правка текста с телефона
     * с необновлённой копией молча вернула бы пометку, которую автор снял
     * на другом устройстве. Для новой записи «как было» — это `true`,
     * решение заказчика 22.11.2026.
     */
    await manager.query(
      `INSERT INTO trip_diary_entries
         (id, trip_id, user_id, body, created_at, updated_at, deleted_at,
          shared_with_trip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::boolean, true))
       ON CONFLICT (id) DO UPDATE
         SET body = EXCLUDED.body,
             updated_at = EXCLUDED.updated_at,
             deleted_at = EXCLUDED.deleted_at,
             shared_with_trip = COALESCE(
               $8::boolean,
               trip_diary_entries.shared_with_trip
             )
       WHERE trip_diary_entries.trip_id = EXCLUDED.trip_id
         AND trip_diary_entries.user_id = EXCLUDED.user_id
         AND EXCLUDED.updated_at > trip_diary_entries.updated_at`,
      [
        entry.id,
        tripId,
        userId,
        entry.body,
        entry.createdAt,
        entry.updatedAt,
        entry.deletedAt,
        entry.sharedWithTrip ?? null,
      ],
    );
  }

  private async build(
    manager: EntityManager,
    tripId: string,
    userId: string,
  ): Promise<TripDiaryDto> {
    const entries = await manager.find(TripDiaryEntry, {
      where: { tripId, userId, deletedAt: IsNull() },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    return TripDiaryDto.from(entries);
  }

  /** Дневник доступен только участникам похода; `declined` — уже не участник. */
  private async assertParticipant(
    manager: EntityManager,
    tripId: string,
    userId: string,
  ): Promise<void> {
    const participant = await manager.findOne(TripParticipant, {
      where: { tripId, userId },
    });

    if (!participant || participant.status === 'declined') {
      throw new ForbiddenException('Дневник похода доступен только его участникам');
    }
  }
}
