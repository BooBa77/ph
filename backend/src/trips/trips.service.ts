import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { CalendarActivityType } from '../calendar/entities/activity-type.entity';
import { CreateTripDto } from './dto/create-trip.dto';
import { TripResponseDto } from './dto/trip-response.dto';
import { Chat } from './entities/chat.entity';
import { GeoObject } from './entities/geo-object.entity';
import { Role } from './entities/role.entity';
import { TripDateVariant } from './entities/trip-date-variant.entity';
import { TripParticipantRole } from './entities/trip-participant-role.entity';
import { TripParticipant } from './entities/trip-participant.entity';
import { Trip } from './entities/trip.entity';
import { ORGANIZER_ROLE_CODE, type TripStatus } from './trip.types';

/**
 * Походы: создание и чтение.
 *
 * Пока это весь API — список с фильтрами, правка, участники и заявки
 * впереди. Задача сервиса сейчас одна: собрать поход так, чтобы он был
 * целым с первой секунды.
 */
@Injectable()
export class TripsService {
  constructor(
    @InjectRepository(Trip)
    private readonly tripsRepository: Repository<Trip>,
    @InjectRepository(TripParticipant)
    private readonly participantsRepository: Repository<TripParticipant>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Создать поход.
   *
   * **Всё в одной транзакции, и это не формальность.** Поход без
   * организатора в составе, без его роли или без чатов — это сломанная
   * запись: организатора из состава потом не добавить (его роль
   * и участие подразумеваются с создания), а чаты некому создать.
   * Поэтому пять вставок в пяти таблицах идут вместе: либо поход целиком,
   * либо ничего.
   *
   * Порядок вставок продиктован внешними ключами: сначала `trips`,
   * потом всё, что на него ссылается.
   */
  async create(
    organizerUserId: string,
    dto: CreateTripDto,
  ): Promise<TripResponseDto> {
    // Дубликаты в массиве активностей схлопываем: пользователь вправе
    // прислать `[1, 1]`, и это не повод падать на проверке количества.
    const activityTypeIds = [...new Set(dto.activityTypeIds ?? [])];
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    const isCommercial = dto.isCommercial ?? false;
    const status = dto.status ?? 'idea';

    this.assertPriceRules(isCommercial, dto.priceRub, dto.priceNote);
    this.assertDates(status, startsAt, endsAt);

    return this.dataSource.transaction(async (manager) => {
      const goal = await manager.findOne(GeoObject, {
        where: { id: String(dto.goalObjectId) },
      });
      if (!goal) {
        throw new BadRequestException(
          'Цель не найдена в справочнике географических объектов',
        );
      }

      /**
       * Существование активностей проверяем здесь, хотя в базе есть
       * триггер. Причина простая: триггер бросает исключение, и наружу
       * ушёл бы 500 «внутренняя ошибка» — а это ошибка клиента, и сказать
       * о ней надо 400-м с внятным текстом. Триггер остаётся второй линией
       * обороны для правок мимо API.
       *
       * На `is_active` не смотрим: архивный тип в старом походе — норма.
       */
      if (activityTypeIds.length > 0) {
        const found = await manager.count(CalendarActivityType, {
          where: { id: In(activityTypeIds) },
        });
        if (found !== activityTypeIds.length) {
          throw new BadRequestException(
            'Среди активностей есть несуществующие — проверьте идентификаторы',
          );
        }
      }

      /**
       * Роль организатора обязана быть в справочнике. Если её нет — это
       * не ошибка клиента, а незалитый справочник, поэтому 500 и подсказка
       * с командой: без неё сообщение «роль не найдена» не говорит, что
       * делать.
       */
      const organizerRole = await manager.findOne(Role, {
        where: { code: ORGANIZER_ROLE_CODE },
      });
      if (!organizerRole) {
        throw new InternalServerErrorException(
          'В справочнике ролей нет роли организатора: выполните npm run seed:roles',
        );
      }

      const trip = await manager.save(
        manager.create(Trip, {
          organizerUserId,
          goalObjectId: String(dto.goalObjectId),
          title: dto.title ?? null,
          routeText: dto.routeText ?? '',
          requirementsText: dto.requirementsText ?? null,
          visibility: dto.visibility ?? 'public',
          status,
          activityTypeIds,
          startsAt,
          endsAt,
          isCommercial,
          priceRub: dto.priceRub ?? null,
          priceNote: dto.priceNote ?? null,
        }),
      );

      /**
       * Организатор сразу в составе, со статусом `going`. «Организую,
       * но сам не иду» — законная ситуация, но она требует явного действия
       * человека, а не является значением по умолчанию.
       */
      await manager.insert(TripParticipant, {
        tripId: trip.id,
        userId: organizerUserId,
        status: 'going',
      });

      await manager.insert(TripParticipantRole, {
        tripId: trip.id,
        userId: organizerUserId,
        roleId: organizerRole.id,
      });

      /**
       * Оба чата создаются сразу, даже для приватного похода: чат
       * существует всегда, а кто в него впущен — вопрос доступа, а не
       * наличия строки.
       */
      await manager.insert(Chat, [
        { kind: 'trip_guest', tripId: trip.id },
        { kind: 'trip_members', tripId: trip.id },
      ]);

      if (dto.dateVariants?.length) {
        await manager.insert(
          TripDateVariant,
          dto.dateVariants.map((variant) => ({
            tripId: trip.id,
            year: variant.year ?? null,
            month: variant.month ?? null,
            day: variant.day ?? null,
            durationDays: variant.durationDays ?? null,
            durationDelta: variant.durationDelta ?? 0,
          })),
        );
      }

      return TripResponseDto.from(trip);
    });
  }

  /**
   * Поход по id.
   *
   * Приватный поход невидим для тех, кто в нём не участвует, и наружу
   * отдаётся **404, а не 403**. Разница существенная: 403 подтверждает,
   * что поход существует, и превращает перебор id в способ узнать, кто
   * и куда собирается. Приватный поход для постороннего не существует —
   * так об этом и надо сказать.
   *
   * Статус участия не проверяем: приглашённый, но не ответивший (`invited`)
   * тоже вправе видеть поход — иначе он не сможет решить, идти ли.
   */
  async findOne(userId: string, id: number): Promise<TripResponseDto> {
    const trip = await this.tripsRepository.findOne({
      where: { id: String(id) },
    });
    if (!trip) {
      throw new NotFoundException('Поход не найден');
    }

    if (trip.visibility === 'private') {
      const isParticipant = await this.participantsRepository.count({
        where: { tripId: trip.id, userId },
      });
      if (isParticipant === 0) {
        throw new NotFoundException('Поход не найден');
      }
    }

    return TripResponseDto.from(trip);
  }

  /**
   * Цена участия бывает только у коммерческого похода и там обязательна.
   *
   * Проверка двусторонняя, потому что в базе стоят два CHECK-а, и обойти
   * их API не должен: иначе коммерческий поход без цены («потом скажу»)
   * или некоммерческий с ценой («это не плата, это взнос») доехали бы
   * до 500 вместо понятного отказа.
   */
  private assertPriceRules(
    isCommercial: boolean,
    priceRub: number | null | undefined,
    priceNote: string | null | undefined,
  ): void {
    if (isCommercial && priceRub == null) {
      throw new BadRequestException(
        'У коммерческого похода должна быть указана цена участия',
      );
    }
    if (!isCommercial && (priceRub != null || priceNote != null)) {
      throw new BadRequestException(
        'У некоммерческого похода платы за участие нет: цена и её описание допустимы только у коммерческого',
      );
    }
  }

  /**
   * Даты: решённый поход обязан иметь обе, конец не может быть раньше
   * начала.
   *
   * Это те же условия, что в CHECK-ах `chk_trips_decided_dates`
   * и `chk_trips_dates_order`. Дублирование намеренное: CHECK ловит правку
   * мимо API, а здесь ошибка превращается в 400 с человеческим текстом,
   * а не в 500 от базы.
   */
  private assertDates(
    status: TripStatus,
    startsAt: Date | null,
    endsAt: Date | null,
  ): void {
    if (status === 'decided' && (startsAt === null || endsAt === null)) {
      throw new BadRequestException(
        'У решённого похода должны быть обе даты — начало и конец',
      );
    }
    if (startsAt !== null && endsAt !== null && endsAt < startsAt) {
      throw new BadRequestException('Конец похода раньше начала');
    }
  }
}
