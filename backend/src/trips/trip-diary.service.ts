import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { DataSource, IsNull, type EntityManager } from 'typeorm';

import { TripDiaryEntry } from './entities/trip-diary-entry.entity';
import { TripParticipant } from './entities/trip-participant.entity';
import type { DiarySyncEntryDto, SyncTripDiaryDto } from './dto/trip-diary.dto';
import { TripDiaryDto } from './dto/trip-diary.dto';
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

  /** Запись с проверенными временами и очищенным текстом. */
  private prepareEntry(entry: DiarySyncEntryDto): {
    id: string;
    body: string;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
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

    return { id: entry.id, body, createdAt, updatedAt, deletedAt };
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
    },
  ): Promise<void> {
    await manager.query(
      `INSERT INTO trip_diary_entries
         (id, trip_id, user_id, body, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE
         SET body = EXCLUDED.body,
             updated_at = EXCLUDED.updated_at,
             deleted_at = EXCLUDED.deleted_at
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
