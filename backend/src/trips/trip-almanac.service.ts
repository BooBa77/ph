import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import {
  AlmanacEntryDto,
  TripAlmanacDto,
  type CreateAlmanacEntryDto,
  type UpdateAlmanacEntryDto,
} from './dto/trip-almanac.dto';
import type { AlmanacPlacement } from './entities/trip-almanac-entry.entity';
import { TripParticipant } from './entities/trip-participant.entity';
import { returningRows } from './query-rows';
import { NotificationsService } from './notifications.service';
import { notifyAlmanacUpdated } from './trip-almanac-notify';
import type { Trip } from './entities/trip.entity';
import { TripsService } from './trips.service';

/**
 * Альманах похода — секция «Гостевой» (22.11.2026).
 *
 * Заказчик переделал прежнюю вкладку:
 *
 * 1. «Всё таки не будем создавать отдельную вкладку Альманах. Сделаем это
 *    секцией в Гостевой».
 * 2. «Формирует и редактирует альманах только админ похода (организатор),
 *    ему доступна кнопочка „Удалить запись“».
 * 3. «Участникам в альманахе можно выбирать место вставки воспоминания —
 *    день похода (номер, не дата), до похода, без указания дня».
 * 4. «На каждый день отводим одну запись участнику, после создания он может
 *    её редактировать/дописывать, положение её после редактирования
 *    не изменяется».
 *
 * Отсюда разделение прав:
 *
 * - **читать** — кто видит поход, включая гостя (альманах — общий текст,
 *   и в него попадает только то, что авторы разрешили);
 * - **писать воспоминание и править своё** — участник похода;
 * - **удалять любую строку** — только организатор. Для записи дневника
 *   «удалить» значит снять пометку «в альманах»: личный текст автора
 *   не стирается, а слот воспоминания освобождается.
 *
 * **Сборка идёт на чтении.** Дневниковые строки берутся из
 * `trip_diary_entries` по пометке автора, воспоминания — из
 * `trip_almanac_entries`. Снимка нет: снятая пометка должна убирать строку
 * сразу, иначе альманах врал бы о согласии.
 */
@Injectable()
export class TripAlmanacService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly trips: TripsService,
    /** Уведомления правой панели: «Альманах» — карточка, а не сообщение. */
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Альманах целиком.
   *
   * До завершения похода — `409`: записи ещё пишутся, а «до похода» и дни
   * ещё не сложились в историю. Порядок строк экран собирает сам: день
   * дневниковой записи считается в часовом поясе смотрящего, а не сервера.
   */
  async getAlmanac(userId: string, tripId: number): Promise<TripAlmanacDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);

    if (trip.completedAt === null && trip.cancelledAt === null) {
      throw new ConflictException(
        'Альманах собирается после завершения или отмены похода',
      );
    }

    const participant = await manager.findOne(TripParticipant, {
      where: { tripId: trip.id, userId },
    });

    const canWrite = participant !== null && participant.status !== 'declined';
    const canManage = trip.organizerUserId === userId;

    const entries = await this.loadEntries(manager, trip.id, userId, canManage);

    return TripAlmanacDto.from(trip, entries, { canWrite, canManage });
  }

  /**
   * Создать воспоминание в выбранном слоте.
   *
   * Слот — это `(placement, dayIndex)`: на каждый день у человека одна
   * запись, «до похода» и «в конце» — тоже по одной. Повтор упирается
   * в уникальный индекс; `ON CONFLICT DO NOTHING` превращает гонку двух
   * вкладок в понятный `409`, а не в 500 от базы.
   */
  async createEntry(
    userId: string,
    tripId: number,
    dto: CreateAlmanacEntryDto,
  ): Promise<TripAlmanacDto> {
    const trip = await this.trips.getVisibleTrip(userId, tripId);

    if (trip.completedAt === null && trip.cancelledAt === null) {
      throw new ConflictException(
        'Альманах собирается после завершения или отмены похода',
      );
    }

    /**
     * Организатор пишет всегда, даже если не числится в составе: у отменённой
     * «Мечты» состава нет вовсе (26.11.2026, §4.6), а альманах подготовки
     * ей открыт — и первое слово там его. У обычного похода организатор
     * и так участник, так что проверка ничего не ослабляет.
     */
    if (trip.organizerUserId !== userId) {
      await this.assertParticipant(trip.id, userId);
    }

    const body = dto.body.trim();
    if (body.length === 0) {
      throw new BadRequestException('Воспоминание не может быть пустым');
    }

    const dayIndex = this.dayIndexOf(dto.placement, dto.dayIndex);

    const inserted = returningRows<{ id: string }>(
      await this.dataSource.query(
        `INSERT INTO trip_almanac_entries
           (trip_id, user_id, placement, day_index, body, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, now(), now())
         ON CONFLICT (trip_id, user_id, placement, day_index) DO NOTHING
         RETURNING id`,
        [trip.id, userId, dto.placement, dayIndex, body],
      ),
    );

    if (inserted.length === 0) {
      throw new ConflictException(
        dto.placement === 'day'
          ? 'На этот день у тебя уже есть воспоминание — открой его и допиши'
          : 'Такое воспоминание у тебя уже есть — открой его и допиши',
      );
    }

    await this.notifyAlmanac(trip, userId, { created: true });

    return this.getAlmanac(userId, tripId);
  }

  /**
   * Дописать своё воспоминание.
   *
   * Место вставки не меняется — «положение её после редактирования
   * не изменяется». Поэтому `placement`/`dayIndex` из тела не читаются
   * вовсе: даже если клиент пришлёт их, строка останется на месте.
   */
  async updateEntry(
    userId: string,
    tripId: number,
    entryId: string,
    dto: UpdateAlmanacEntryDto,
  ): Promise<TripAlmanacDto> {
    const trip = await this.trips.getVisibleTrip(userId, tripId);

    if (trip.completedAt === null && trip.cancelledAt === null) {
      throw new ConflictException(
        'Альманах собирается после завершения или отмены похода',
      );
    }

    const body = dto.body.trim();
    if (body.length === 0) {
      throw new BadRequestException('Воспоминание не может быть пустым');
    }

    const rows = returningRows<{ id: string }>(
      await this.dataSource.query(
        `UPDATE trip_almanac_entries
            SET body = $1, updated_at = now()
          WHERE id = $2 AND trip_id = $3 AND user_id = $4
        RETURNING id`,
        [body, entryId, trip.id, userId],
      ),
    );

    if (rows.length === 0) {
      throw new NotFoundException('Воспоминание не найдено');
    }

    await this.notifyAlmanac(trip, userId);

    return this.getAlmanac(userId, tripId);
  }

  /**
   * Удалить строку альманаха — право организатора.
   *
   * - **Воспоминание** удаляется физически, и слот освобождается: участник
   *   может написать заново (заказчик: «участник может заново написать»).
   * - **Запись дневника** не стирается: это личный текст автора. Снимается
   *   только пометка «в альманах», и строка уходит из общего текста.
   *   `updated_at` записи при этом не трогаем: его ставит устройство автора,
   *   и серверная правка сломала бы правило «побеждает более поздняя правка»
   *   — следующая же правка с телефона не применилась бы.
   *
   * Результат обоих запросов разбирается `returningRows` (`query-rows.ts`):
   * для `DELETE`/`UPDATE` TypeORM отдаёт пару `[rows, rowCount]`, и проверка
   * по длине пары не отличила бы «удалили» от «нечего удалять».
   *
   * Уведомление здесь не рассылается: удаление — это уборка организатора,
   * а не новое воспоминание. Заказчик просил уведомлять о правках, иначе
   * участники получали бы письмо на каждое удаление.
   */
  async deleteEntry(
    userId: string,
    tripId: number,
    entryId: string,
  ): Promise<TripAlmanacDto> {
    const trip = await this.trips.getVisibleTrip(userId, tripId);

    if (trip.organizerUserId !== userId) {
      throw new ForbiddenException('Удалять записи альманаха может только организатор');
    }

    const removed = returningRows<{ id: string }>(
      await this.dataSource.query(
        `DELETE FROM trip_almanac_entries
          WHERE id = $1 AND trip_id = $2
        RETURNING id`,
        [entryId, trip.id],
      ),
    );

    if (removed.length === 0) {
      const unmarked = returningRows<{ id: string }>(
        await this.dataSource.query(
          `UPDATE trip_diary_entries
              SET shared_with_trip = false
            WHERE id = $1 AND trip_id = $2 AND shared_with_trip
          RETURNING id`,
          [entryId, trip.id],
        ),
      );

      if (unmarked.length === 0) {
        throw new NotFoundException('Запись альманаха не найдена');
      }
    }

    return this.getAlmanac(userId, tripId);
  }

  /**
   * «Альманах похода обновлён» — карточка получателям (24.11.2026).
   *
   * Личного сообщения больше нет: панель читает уведомления, и двойная
   * запись выключена (§14.4 п.2). Кадр `message` тоже не нужен — сообщения
   * не существует; о карточке подписчиков извещает сам
   * `notifyAlmanacUpdated` (`notifications.emitChanged` после записи).
   */
  private async notifyAlmanac(
    trip: Trip,
    userId: string,
    options: { created?: boolean } = {},
  ): Promise<void> {
    await notifyAlmanacUpdated(
      this.dataSource,
      this.notifications,
      trip,
      userId,
      options,
    );
  }

  /** Участник похода, а не отказавшийся. */
  private async assertParticipant(tripId: string, userId: string): Promise<void> {
    const participant = await this.dataSource.manager.findOne(TripParticipant, {
      where: { tripId, userId },
    });

    if (!participant || participant.status === 'declined') {
      throw new ForbiddenException('Альманах похода доступен только его участникам');
    }
  }

  /** Согласованность места и номера дня: `day` требует дня, остальным он запрещён. */
  private dayIndexOf(
    placement: AlmanacPlacement,
    dayIndex: number | undefined,
  ): number {
    if (placement === 'day') {
      if (dayIndex === undefined) {
        throw new BadRequestException('Для воспоминания дня нужен его номер');
      }

      return dayIndex;
    }

    return 0;
  }

  /** Строки альманаха одним чтением: помеченные дневники и воспоминания. */
  private async loadEntries(
    manager: EntityManager,
    tripId: string,
    viewerId: string,
    canManage: boolean,
  ): Promise<AlmanacEntryDto[]> {
    const diaryRows = (await manager.query(
      `SELECT e.id,
              e.body,
              e.created_at  AS "createdAt",
              e.user_id     AS "userId",
              u.display_name AS "displayName",
              u.avatar_url   AS "avatarUrl"
         FROM trip_diary_entries e
         JOIN users u ON u.id = e.user_id
        WHERE e.trip_id = $1
          AND e.shared_with_trip
          AND e.deleted_at IS NULL
        ORDER BY e.created_at ASC, e.id ASC`,
      [tripId],
    )) as Array<Record<string, unknown>>;

    const memoryRows = (await manager.query(
      `SELECT a.id,
              a.body,
              a.created_at  AS "createdAt",
              a.updated_at  AS "updatedAt",
              a.placement,
              a.day_index   AS "dayIndex",
              a.user_id     AS "userId",
              u.display_name AS "displayName",
              u.avatar_url   AS "avatarUrl"
         FROM trip_almanac_entries a
         JOIN users u ON u.id = a.user_id
        WHERE a.trip_id = $1
        ORDER BY a.created_at ASC, a.id ASC`,
      [tripId],
    )) as Array<Record<string, unknown>>;

    const author = (row: Record<string, unknown>) => ({
      userId: row.userId as string,
      displayName: (row.displayName as string | null) ?? 'Неизвестный',
      avatarUrl: (row.avatarUrl as string | null) ?? null,
    });

    const diary: AlmanacEntryDto[] = diaryRows.map((row) => ({
      id: row.id as string,
      kind: 'diary',
      body: row.body as string,
      createdAt: new Date(row.createdAt as string | Date).toISOString(),
      updatedAt: null,
      placement: null,
      dayIndex: null,
      author: author(row),
      canEdit: false,
      canDelete: canManage,
    }));

    const memories: AlmanacEntryDto[] = memoryRows.map((row) => ({
      id: row.id as string,
      kind: 'memory',
      body: row.body as string,
      createdAt: new Date(row.createdAt as string | Date).toISOString(),
      updatedAt: new Date(row.updatedAt as string | Date).toISOString(),
      placement: row.placement as AlmanacPlacement,
      dayIndex: Number(row.dayIndex ?? 0) || null,
      author: author(row),
      canEdit: row.userId === viewerId,
      canDelete: canManage,
    }));

    return [...diary, ...memories];
  }
}
