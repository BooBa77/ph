import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { DataSource, In, IsNull, type EntityManager } from 'typeorm';

import { TripDiaryEntry } from './entities/trip-diary-entry.entity';
import { TripParticipant } from './entities/trip-participant.entity';
import type { DiarySyncEntryDto, SyncTripDiaryDto } from './dto/trip-diary.dto';
import { TripDiaryDto } from './dto/trip-diary.dto';
import { TripEventsService } from './trip-events.service';
import { NotificationsService } from './notifications.service';
import { isValidDiaryTimes } from './trip-diary.types';
import { notifyAlmanacUpdated } from './trip-almanac-notify';
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
    /** Уведомления правой панели: «Альманах» — карточка, а не сообщение. */
    private readonly notifications: NotificationsService,
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

    /**
     * После возвращения дневник не пополняется (22.11.2026).
     *
     * Заказчик: «Дневник вообще для хранения полевых записей и доступ ему
     * оставляем для редактирования созданных в походе записей. Записи после
     * возвращения — это уже воспоминания и их будем создавать в
     * Гостевая/Альманах». Поэтому пропускаем только записи, **написанные
     * до завершения похода**: офлайн-очередь из поля приезжает позже
     * и должна дойти, даже если поход уже закрыли. Удаление не ограничиваем:
     * убрать старую запись человек вправе когда угодно.
     */
    const completedAt = trip.completedAt;
    for (const entry of prepared) {
      if (
        completedAt !== null &&
        entry.deletedAt === null &&
        entry.createdAt.getTime() > completedAt.getTime()
      ) {
        throw new BadRequestException(
          'После возвращения дневник не пополняется — воспоминание пишется в альманахе',
        );
      }
    }

    /**
     * Смена пометки «в альманах» и правка помеченной записи — тоже событие
     * для общего текста (решение заказчика 22.11.2026): «Это в первую
     * очередь для того, чтобы админ видел чего там пишут и мог вовремя
     * дельнуть». Считаем по текущему состоянию строки и по присланному.
     */
    let almanacTouched = false;

    await this.dataSource.transaction(async (manager) => {
      const stored =
        prepared.length === 0
          ? []
          : await manager.find(TripDiaryEntry, {
              where: {
                id: In(prepared.map((entry) => entry.id)),
                tripId: trip.id,
                userId,
              },
            });
      const before = new Map(stored.map((row) => [row.id, row]));

      for (const entry of prepared) {
        const previous = before.get(entry.id);
        await this.upsert(manager, trip.id, userId, entry);

        if (completedAt === null || previous === undefined) continue;

        const sharedBefore = previous.sharedWithTrip;
        const sharedAfter = entry.sharedWithTrip ?? sharedBefore;
        const flagChanged =
          entry.sharedWithTrip !== undefined &&
          entry.sharedWithTrip !== sharedBefore;
        const bodyChanged = previous.body !== entry.body;
        const deletionChanged =
          (previous.deletedAt !== null) !== (entry.deletedAt !== null);

        if (
          (sharedBefore || sharedAfter) &&
          (flagChanged || bodyChanged || deletionChanged)
        ) {
          almanacTouched = true;
        }
      }
    });

    // Уведомления — после коммита: получатель откроет уже сохранённое.
    // Карточка «Альманах» — без личного сообщения (24.11.2026, §14.4 п.2):
    // панель больше не читает диалоги, и двойная запись выключена. Кадр
    // `message` поэтому не нужен — сообщения нет; о карточке подписчиков
    // извещает сам `notifyAlmanacUpdated`.
    if (almanacTouched) {
      await notifyAlmanacUpdated(this.dataSource, this.notifications, trip, userId);
    }

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
