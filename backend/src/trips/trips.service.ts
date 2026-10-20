import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';

import { CalendarActivityType } from '../calendar/entities/activity-type.entity';
import { User } from '../users/entities/user.entity';
import { CreateTripDto } from './dto/create-trip.dto';
import {
  SendTripMessageDto,
  TripChatDto,
  TripChatListDto,
  TripMessageDto,
  TripMessageListDto,
  TripMessageQueryDto,
} from './dto/message.dto';
import {
  ParticipantListDto,
  TripParticipantDto,
  TripRoleDto,
} from './dto/participant.dto';
import {
  CreateRequestDto,
  TripRequestDto,
  TripRequestListDto,
} from './dto/request.dto';
import { TripListQueryDto } from './dto/trip-list-query.dto';
import { TripListResponseDto } from './dto/trip-list-response.dto';
import { TripResponseDto } from './dto/trip-response.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { Conversation } from './entities/conversation.entity';
import { GeoObject } from './entities/geo-object.entity';
import { Message } from './entities/message.entity';
import { Role } from './entities/role.entity';
import { TripDateVariant } from './entities/trip-date-variant.entity';
import { TripMembershipRequest } from './entities/trip-membership-request.entity';
import { TripParticipantRole } from './entities/trip-participant-role.entity';
import { TripParticipant } from './entities/trip-participant.entity';
import { TripRouteElement } from './entities/trip-route-element.entity';
import { Trip } from './entities/trip.entity';
import { extractObjectIds } from './route-links';
import {
  CHAT_KINDS,
  ORGANIZER_ROLE_CODE,
  type ChatKind,
  type ParticipantDecision,
  type ParticipantStatus,
  type TripStatus,
  type TripWhen,
} from './trip.types';
import { nextWeekendRange } from './weekend';

/** Размер страницы ленты по умолчанию и потолок — в DTO. */
const DEFAULT_PAGE_SIZE = 20;

/** Сколько сообщений чата отдавать за раз, если клиент не попросил иначе. */
const DEFAULT_MESSAGE_PAGE_SIZE = 50;

/** Как статус участия читается в системном сообщении чата. */
function statusText(status: ParticipantStatus): string {
  switch (status) {
    case 'going':
      return 'идёт';
    case 'maybe':
      return 'пока не решил';
    case 'declined':
      return 'не идёт';
    case 'invited':
      return 'приглашён';
  }
}

/** Имя для системного сообщения: чужой профиль может быть уже удалён. */
function displayNameOf(user: User | null | undefined): string {
  return user?.displayName ?? 'Участник';
}

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
       */
      await this.assertActivityTypes(manager, activityTypeIds);

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
          announcement: dto.announcement ?? null,
          routeText: dto.routeText ?? '',
          requirementsText: dto.requirementsText ?? null,
          meetingPlace: dto.meetingPlace ?? null,
          meetingAt: dto.meetingAt ? this.toDate(dto.meetingAt) : null,
          transferText: dto.transferText ?? null,
          visibility: dto.visibility ?? 'public',
          status,
          activityTypeIds,
          startsAt,
          endsAt,
          isCommercial,
          isOfficial: dto.isOfficial ?? false,
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
      await manager.insert(Conversation, [
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

      /**
       * Индекс упоминаний собирается из текста сразу при создании: маршрут
       * можно прислать уже со ссылками, и оставлять `trip_route_elements`
       * пустым до первой правки значило бы врать поиску «где упомянут
       * объект» с первой же секунды жизни похода.
       */
      await this.syncRouteElements(manager, trip.id, trip.routeText);

      // Цель уже прочитана — подставляем её в ответ, чтобы фронт не ходил
      // за именем отдельным запросом.
      trip.goalObject = goal;

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
      // Цель подтягиваем сразу: карточка показывает её имя и ссылку,
      // и отдельный запрос за ними был бы лишним кругом до базы.
      relations: { goalObject: true },
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

  /**
   * Факт: возвращение не может быть раньше выхода, и возвращение без выхода
   * не бывает.
   *
   * Это те же условия, что в `chk_trips_actual_dates_order` и
   * `chk_trips_actual_finish_needs_start`: снять только `actualFinishedAt`,
   * оставив выход, — законно (передумали отмечать?), а вот записать
   * возвращение, не записав выход, нельзя.
   */
  private assertActualDates(
    actualStartedAt: Date | null,
    actualFinishedAt: Date | null,
  ): void {
    if (actualFinishedAt === null) return;
    if (actualStartedAt === null) {
      throw new BadRequestException(
        'Нельзя отметить возвращение, не отметив выход на маршрут',
      );
    }
    if (actualFinishedAt < actualStartedAt) {
      throw new BadRequestException('Возвращение раньше выхода на маршрут');
    }
  }

  /**
   * Все переданные id активностей должны существовать.
   *
   * На `is_active` не смотрим: архивный тип в старом походе — норма,
   * и поход, у которого активность перестали предлагать, не должен
   * от этого ломаться.
   */
  private async assertActivityTypes(
    manager: EntityManager,
    activityTypeIds: number[],
  ): Promise<void> {
    if (activityTypeIds.length === 0) return;

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
   * Пересобрать индекс упоминаний объектов по тексту маршрута.
   *
   * `trip_route_elements` — производная от `route_text`, и единственный
   * надёжный способ её поддерживать — перезапись целиком: удалить старые
   * связи и вставить те, что нашлись в новом тексте. Сравнивать построчно
   * «что добавить, что убрать» здесь нечего, связей единицы.
   *
   * Ссылки на несуществующие объекты — отказ. Внешнего ключа у связей нет
   * только в одну сторону: `trip_route_elements.object_id` ссылается
   * на `objects`, и вставка несуществующего id упала бы 500-й. Проверяем
   * до вставки, чтобы ошибка была 400-й и говорила, что случилось.
   */
  private async syncRouteElements(
    manager: EntityManager,
    tripId: string,
    routeText: string,
  ): Promise<void> {
    const objectIds = extractObjectIds(routeText);

    await manager.delete(TripRouteElement, { tripId });

    if (objectIds.length === 0) return;

    const found = await manager.count(GeoObject, {
      where: { id: In(objectIds.map(String)) },
    });
    if (found !== objectIds.length) {
      throw new BadRequestException(
        'В маршруте есть ссылки на несуществующие объекты справочника',
      );
    }

    await manager.insert(
      TripRouteElement,
      objectIds.map((objectId) => ({ tripId, objectId: String(objectId) })),
    );
  }

  /** `null` и `undefined` — «даты нет»; строка — момент времени. */
  private toDate(value: string | null | undefined): Date | null {
    return value ? new Date(value) : null;
  }

  /**
   * Поход по id вместе с целью — для правок и отмены.
   *
   * Организатор проверяется здесь же: правило одно на все изменяющие
   * операции, и держать его в каждой по копии — способ однажды забыть.
   * Постороннему публичный поход виден, но менять его нельзя, поэтому
   * здесь именно **403, а не 404**: скрывать нечего, поход и так открыт.
   */
  private async findOwnedTrip(
    manager: EntityManager,
    userId: string,
    id: number,
  ): Promise<Trip> {
    const trip = await manager.findOne(Trip, {
      where: { id: String(id) },
      relations: { goalObject: true },
    });

    if (!trip) {
      throw new NotFoundException('Поход не найден');
    }
    if (trip.organizerUserId !== userId) {
      throw new ForbiddenException('Менять поход может только организатор');
    }

    return trip;
  }

  /**
   * Лента походов.
   *
   * **Видимость учитывается всегда и параметром не управляется.** Приватный
   * поход показывается только тем, кто в нём участвует; посторонний
   * не увидит его ни при каком наборе фильтров, и отдельного «покажи всё»
   * здесь нет намеренно — такая ручка однажды окажется доступна не тому.
   *
   * Отменённые походы в ленту не попадают: они остаются в базе для истории
   * и находятся по id, но «покажи, куда можно пойти» отменённое не украшает.
   *
   * Порядок — «сначала ближайшие, потом идеи по свежести»: `starts_at`
   * по возрастанию с пустыми в конце, затем `created_at` по убыванию.
   */
  async list(
    userId: string,
    query: TripListQueryDto,
  ): Promise<TripListResponseDto> {
    const qb = this.tripsRepository
      .createQueryBuilder('trip')
      .leftJoinAndSelect('trip.goalObject', 'goal')
      .where(
        `(trip.visibility = 'public' OR EXISTS (
           SELECT 1 FROM trip_participants p
            WHERE p.trip_id = trip.id AND p.user_id = :userId
         ))`,
        { userId },
      )
      .andWhere('trip.cancelled_at IS NULL');

    /**
     * Объект — это **цель или упоминание в маршруте**, и это не одно и то же.
     *
     * «Хочу на Витязь» — поход с целью Витязь. «Иду на пик, а по дороге
     * заглянем на Витязь» — цель другая, а Витязь в маршруте. Человеку,
     * который ищет походы про Витязь, нужны оба, и различать их он не
     * обязан: фильтр в интерфейсе один, значит и параметр один.
     *
     * Индекс упоминаний (`trip_route_elements`) собирается из `[[object:N]]`
     * в тексте маршрута при каждом сохранении, и по `object_id` у него
     * отдельный индекс — поэтому `EXISTS` здесь не seq scan.
     */
    if (query.objectId !== undefined) {
      qb.andWhere(
        `(trip.goal_object_id = :objectId OR EXISTS (
           SELECT 1 FROM trip_route_elements element
            WHERE element.trip_id = trip.id AND element.object_id = :objectId
         ))`,
        { objectId: query.objectId },
      );
    }

    if (query.activityTypeId !== undefined) {
      qb.andWhere(
        'CAST(:activityTypeId AS int) = ANY(trip.activity_type_ids)',
        {
          activityTypeId: query.activityTypeId,
        },
      );
    }

    if (query.status !== undefined) {
      qb.andWhere('trip.status = :status', { status: query.status });
    }

    if (query.isCommercial !== undefined) {
      qb.andWhere('trip.is_commercial = :isCommercial', {
        isCommercial: query.isCommercial,
      });
    }

    if (query.isOfficial !== undefined) {
      qb.andWhere('trip.is_official = :isOfficial', {
        isOfficial: query.isOfficial,
      });
    }

    if (query.organizerUserId !== undefined) {
      qb.andWhere('trip.organizer_user_id = :organizerUserId', {
        organizerUserId: query.organizerUserId,
      });
    }

    /**
     * `mine` — три состояния, а не два: без параметра лента показывает всё,
     * `true` — только мои походы, `false` — только чужие. Именно так раздел
     * и устроен: «Мои походы» и «Анонсы» — две разные страницы, и вторая
     * обязана не повторять первую. Участие определяется составом: поход,
     * который я организовал, но не иду, — всё равно мой.
     */
    if (query.mine !== undefined) {
      qb.andWhere(
        `${query.mine ? '' : 'NOT '}EXISTS (
           SELECT 1 FROM trip_participants p
            WHERE p.trip_id = trip.id AND p.user_id = :userId
         )`,
      );
    }

    if (query.when !== undefined) {
      const condition = this.whenCondition(query.when);
      qb.andWhere(condition.sql, condition.params ?? {});
    }

    /**
     * Порядок задаётся **именами свойств** (`startsAt`, `createdAt`),
     * а не колонками (`starts_at`) — и это не стилистика. При `skip`/`take`
     * TypeORM строит запрос иначе: выбирает разные id подзапросом
     * и пересобирает `ORDER BY`, разыскивая колонку по имени свойства
     * (`findColumnWithPropertyPath`). На имени колонки поиск возвращает
     * `undefined`, и запрос падает с 500 ещё до обращения к базе.
     * Проверено на живой проверке API.
     */
    qb.orderBy('trip.startsAt', 'ASC', 'NULLS LAST')
      .addOrderBy('trip.createdAt', 'DESC')
      .skip(query.offset ?? 0)
      .take(query.limit ?? DEFAULT_PAGE_SIZE);

    const [trips, total] = await qb.getManyAndCount();

    return { trips: trips.map((trip) => TripResponseDto.from(trip)), total };
  }

  /**
   * Условие «когда» для фильтра.
   *
   * Везде, где есть факт, он важнее плана: поход, который вышел на маршрут
   * и отметил это, перестаёт быть предстоящим независимо от запланированной
   * даты. Обратное неверно — поход с планом в прошлом и без факта считается
   * прошедшим, потому что отмечать факт никто не обязан.
   *
   * Условие возвращается вместе с параметрами: у «выходных» они свои
   * (границы окна считаются в поясе проекта, а не в SQL — см. `weekend.ts`).
   */
  private whenCondition(when: TripWhen): {
    sql: string;
    params?: Record<string, Date>;
  } {
    switch (when) {
      case 'weekend': {
        const { start, end } = nextWeekendRange();

        /**
         * Поход попадает в выходные, если его отрезок пересекает окно.
         *
         * Начало берётся по факту, если он есть. Конец — тоже, а если конца
         * нет, им считается начало: «поход без известного конца» — это не
         * повод показать его в любые выходные до скончания века. Из этого
         * правила следуют два разумных случая: поход, начинающийся
         * в субботу (конца нет — значит он в этих выходных), и поход
         * с пятницы по воскресенье (конец заходит в окно).
         */
        return {
          sql: `COALESCE(trip.actual_started_at, trip.starts_at) < :weekendEnd
            AND COALESCE(
                  COALESCE(trip.actual_finished_at, trip.ends_at),
                  COALESCE(trip.actual_started_at, trip.starts_at)
                ) >= :weekendStart`,
          params: { weekendStart: start, weekendEnd: end },
        };
      }
      case 'upcoming':
        return {
          sql: 'COALESCE(trip.actual_started_at, trip.starts_at) > now()',
        };
      case 'ongoing':
        // Поход без известного конца, но с прошедшим началом, «идёт»:
        // не знать, когда вернутся, — не то же самое, что уже вернулись.
        return {
          sql: `COALESCE(trip.actual_started_at, trip.starts_at) <= now()
            AND (COALESCE(trip.actual_finished_at, trip.ends_at) IS NULL
                 OR COALESCE(trip.actual_finished_at, trip.ends_at) >= now())`,
        };
      case 'past':
        return {
          sql: 'COALESCE(trip.actual_finished_at, trip.ends_at) < now()',
        };
      case 'undated':
        return {
          sql: 'trip.starts_at IS NULL AND trip.actual_started_at IS NULL',
        };
    }
  }

  /**
   * Правка похода организатором.
   *
   * Проверяются **итоговые** значения, а не тело запроса: поход уже может
   * быть коммерческим с ценой, а в `PATCH` прийти только `isCommercial:
   * false`. Условия на пару полей считаются по состоянию «что было + что
   * пришло», и только потом пишутся — ровно то же, что сделал бы CHECK
   * в базе, но с внятным текстом и до записи.
   *
   * Присваивается тоже не всё подряд, а только присланное: `PATCH {}` —
   * не ошибка, он ничего не меняет, а `null` в поле означает «стереть».
   * Различить их можно только по факту наличия свойства, потому что
   * `@IsOptional()` пропускает и `null`, и `undefined`.
   */
  async update(
    userId: string,
    id: number,
    dto: UpdateTripDto,
  ): Promise<TripResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const trip = await this.findOwnedTrip(manager, userId, id);

      const isCommercial = dto.isCommercial ?? trip.isCommercial;
      const priceRub =
        dto.priceRub !== undefined ? dto.priceRub : trip.priceRub;
      const priceNote =
        dto.priceNote !== undefined ? dto.priceNote : trip.priceNote;
      const status = dto.status ?? trip.status;
      const startsAt =
        dto.startsAt !== undefined ? this.toDate(dto.startsAt) : trip.startsAt;
      const endsAt =
        dto.endsAt !== undefined ? this.toDate(dto.endsAt) : trip.endsAt;
      const actualStartedAt =
        dto.actualStartedAt !== undefined
          ? this.toDate(dto.actualStartedAt)
          : trip.actualStartedAt;
      const actualFinishedAt =
        dto.actualFinishedAt !== undefined
          ? this.toDate(dto.actualFinishedAt)
          : trip.actualFinishedAt;

      this.assertPriceRules(isCommercial, priceRub, priceNote);
      this.assertDates(status, startsAt, endsAt);
      this.assertActualDates(actualStartedAt, actualFinishedAt);

      const activityTypeIds =
        dto.activityTypeIds !== undefined
          ? [...new Set(dto.activityTypeIds)]
          : trip.activityTypeIds;
      if (dto.activityTypeIds !== undefined) {
        await this.assertActivityTypes(manager, activityTypeIds);
      }

      if (dto.goalObjectId !== undefined) {
        const goal = await manager.findOne(GeoObject, {
          where: { id: String(dto.goalObjectId) },
        });
        if (!goal) {
          throw new BadRequestException(
            'Цель не найдена в справочнике географических объектов',
          );
        }
        trip.goalObjectId = goal.id;
        trip.goalObject = goal;
      }

      if (dto.announcement !== undefined) trip.announcement = dto.announcement;
      if (dto.requirementsText !== undefined) {
        trip.requirementsText = dto.requirementsText;
      }
      if (dto.meetingPlace !== undefined) trip.meetingPlace = dto.meetingPlace;
      if (dto.meetingAt !== undefined) {
        trip.meetingAt = this.toDate(dto.meetingAt);
      }
      if (dto.transferText !== undefined) {
        trip.transferText = dto.transferText;
      }
      if (dto.visibility !== undefined) trip.visibility = dto.visibility;
      if (dto.isRecruitmentClosed !== undefined) {
        trip.isRecruitmentClosed = dto.isRecruitmentClosed;
      }
      if (dto.routeText !== undefined) trip.routeText = dto.routeText;
      if (dto.activityTypeIds !== undefined) {
        trip.activityTypeIds = activityTypeIds;
      }

      trip.status = status;
      trip.startsAt = startsAt;
      trip.endsAt = endsAt;
      trip.actualStartedAt = actualStartedAt;
      trip.actualFinishedAt = actualFinishedAt;
      trip.isCommercial = isCommercial;
      if (dto.isOfficial !== undefined) trip.isOfficial = dto.isOfficial;
      trip.priceRub = priceRub;
      trip.priceNote = priceNote;

      const saved = await manager.save(trip);

      if (dto.routeText !== undefined) {
        await this.syncRouteElements(manager, saved.id, saved.routeText);
      }

      /**
       * Присланный массив вариантов заменяет прежний целиком, пустой —
       * убирает все. Патчить отдельные варианты нечем: у них нет
       * стабильного внешнего идентификатора, и «вариант №2» после правки
       * списка означал бы уже другое.
       */
      if (dto.dateVariants !== undefined) {
        await manager.delete(TripDateVariant, { tripId: saved.id });
        if (dto.dateVariants.length > 0) {
          await manager.insert(
            TripDateVariant,
            dto.dateVariants.map((variant) => ({
              tripId: saved.id,
              year: variant.year ?? null,
              month: variant.month ?? null,
              day: variant.day ?? null,
              durationDays: variant.durationDays ?? null,
              durationDelta: variant.durationDelta ?? 0,
            })),
          );
        }
      }

      return TripResponseDto.from(saved);
    });
  }

  /** Отменить поход. Отмена — отдельная ось, статус она не затирает. */
  async cancel(userId: string, id: number): Promise<TripResponseDto> {
    return this.setCancelled(userId, id, true);
  }

  /** Вернуть отменённый поход в строй: «решили всё-таки идти». */
  async restore(userId: string, id: number): Promise<TripResponseDto> {
    return this.setCancelled(userId, id, false);
  }

  /**
   * Поставить или снять отметку отмены.
   *
   * **Идею отменить нельзя.** У неё нет дат и обязательств, отменять нечего:
   * «идея, которую передумали» — это просто идея, и она тихо живёт дальше
   * или так же тихо забывается. Остальные статусы отменяются, потому что
   * за ними стоят договорённости с людьми.
   *
   * Повторная отмена не ошибка: состояние уже такое, какое просили.
   * Возвращать 409 значило бы заставлять клиента разбираться, кто первый.
   */
  private async setCancelled(
    userId: string,
    id: number,
    cancelled: boolean,
  ): Promise<TripResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const trip = await this.findOwnedTrip(manager, userId, id);

      if (cancelled && trip.status === 'idea') {
        throw new BadRequestException(
          'Идею не отменяют: у неё нет дат и договорённостей — её просто забывают',
        );
      }

      if (cancelled === (trip.cancelledAt !== null)) {
        return TripResponseDto.from(trip);
      }

      trip.cancelledAt = cancelled ? new Date() : null;
      const saved = await manager.save(trip);

      return TripResponseDto.from(saved);
    });
  }

  /**
   * Поход, который этому пользователю вообще видно.
   *
   * Приватный поход постороннему не существует — 404, а не 403: 403
   * подтверждает, что поход есть, и превращает перебор id в способ узнать,
   * кто и куда собирается. Все операции с составом и тикетами начинаются
   * отсюда, чтобы правило было ровно одно и в одном месте.
   */
  private async findVisibleTrip(
    manager: EntityManager,
    userId: string,
    id: number,
  ): Promise<Trip> {
    const trip = await manager.findOne(Trip, { where: { id: String(id) } });
    if (!trip) {
      throw new NotFoundException('Поход не найден');
    }

    if (trip.visibility === 'private') {
      const isParticipant = await manager.count(TripParticipant, {
        where: { tripId: trip.id, userId },
      });
      if (isParticipant === 0) {
        throw new NotFoundException('Поход не найден');
      }
    }

    return trip;
  }

  /** Состав похода с ролями — одним запросом на участников, одним на роли. */
  private async loadParticipants(
    manager: EntityManager,
    trip: Trip,
  ): Promise<TripParticipantDto[]> {
    const participants = await manager.find(TripParticipant, {
      where: { tripId: trip.id },
      relations: { user: true },
      order: { createdAt: 'ASC' },
    });

    const roleRows = await manager.find(TripParticipantRole, {
      where: { tripId: trip.id },
      relations: { role: true },
    });

    const rolesByUser = new Map<string, TripRoleDto[]>();
    for (const row of roleRows) {
      if (!row.role) continue;
      const list = rolesByUser.get(row.userId) ?? [];
      list.push(TripRoleDto.from(row.role));
      rolesByUser.set(row.userId, list);
    }

    return participants.map((participant) =>
      TripParticipantDto.from(
        participant,
        rolesByUser.get(participant.userId) ?? [],
        trip.organizerUserId,
      ),
    );
  }

  private async loadRoles(
    manager: EntityManager,
    tripId: string,
    userId: string,
  ): Promise<TripRoleDto[]> {
    const rows = await manager.find(TripParticipantRole, {
      where: { tripId, userId },
      relations: { role: true },
    });

    return rows
      .filter((row) => row.role !== null && row.role !== undefined)
      .map((row) => TripRoleDto.from(row.role));
  }

  /**
   * Системное сообщение в чат похода.
   *
   * `sender_id = NULL` — так помечены системные сообщения, отдельного флага
   * для этого нет. Пишутся они здесь и только здесь: история обработки
   * тикетов живёт в чатах, поэтому у тикета нет статуса.
   *
   * Отсутствие чата — не «молча пропустить», а поломка данных: оба чата
   * создаются в одной транзакции с походом. Проглотить это значило бы
   * потерять сообщение и не сказать никому.
   */
  private async postSystemMessage(
    manager: EntityManager,
    tripId: string,
    kind: ChatKind,
    body: string,
  ): Promise<void> {
    const chat = await manager.findOne(Conversation, { where: { tripId, kind } });
    if (!chat) {
      throw new InternalServerErrorException(
        `У похода нет чата «${kind}» — данные похода повреждены`,
      );
    }

    await manager.insert(Message, {
      conversationId: chat.id,
      senderId: null,
      body,
    });
  }

  /** Состав похода. Виден всем, кому виден сам поход. */
  async listParticipants(
    userId: string,
    id: number,
  ): Promise<ParticipantListDto> {
    const manager = this.dataSource.manager;
    const trip = await this.findVisibleTrip(manager, userId, id);

    return { participants: await this.loadParticipants(manager, trip) };
  }

  /**
   * Сменить свой статус участия.
   *
   * Доступно и организатору: «организую, но сам не иду» — законная
   * ситуация, ради которой у него и может быть `declined`. Смена статуса
   * попадает системным сообщением в чат участников: состав — общее дело,
   * и «пока не решил» через месяц должно быть видно, а не раствориться.
   */
  async updateMyStatus(
    userId: string,
    id: number,
    status: ParticipantStatus,
  ): Promise<TripParticipantDto> {
    return this.dataSource.transaction(async (manager) => {
      const trip = await this.findVisibleTrip(manager, userId, id);

      const participant = await manager.findOne(TripParticipant, {
        where: { tripId: trip.id, userId },
        relations: { user: true },
      });
      if (!participant) {
        throw new NotFoundException('Вы не в составе этого похода');
      }

      if (participant.status !== status) {
        participant.status = status;
        await manager.save(participant);
        await this.postSystemMessage(
          manager,
          trip.id,
          'trip_members',
          `${displayNameOf(participant.user)}: ${statusText(status)}`,
        );
      }

      return TripParticipantDto.from(
        participant,
        await this.loadRoles(manager, trip.id, userId),
        trip.organizerUserId,
      );
    });
  }

  /**
   * Убрать человека из состава. Только организатор.
   *
   * Организатора убрать нельзя: он автор похода, и даже триггер в базе
   * это запрещает. Если поход не состоится — его отменяют, а не разбирают
   * по частям.
   *
   * Тикет удаляется вместе с участием: приглашённый в составе **и** имеет
   * тикет, поэтому «убрать из состава» без удаления тикета оставило бы
   * висящее приглашение человеку, которого уже убрали.
   */
  async removeParticipant(
    organizerUserId: string,
    id: number,
    targetUserId: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const trip = await this.findOwnedTrip(manager, organizerUserId, id);

      if (targetUserId === trip.organizerUserId) {
        throw new BadRequestException(
          'Организатора нельзя убрать из состава: он автор похода. Если поход не состоится — отмените его',
        );
      }

      const participant = await manager.findOne(TripParticipant, {
        where: { tripId: trip.id, userId: targetUserId },
        relations: { user: true },
      });
      if (!participant) {
        throw new NotFoundException('Такого участника в походе нет');
      }

      await manager.delete(TripParticipant, {
        tripId: trip.id,
        userId: targetUserId,
      });
      await manager.delete(TripMembershipRequest, {
        tripId: trip.id,
        userId: targetUserId,
      });

      await this.postSystemMessage(
        manager,
        trip.id,
        'trip_members',
        `${displayNameOf(participant.user)} больше не в составе`,
      );
    });
  }

  /**
   * Тикеты похода.
   *
   * Организатор видит все — ему их и обрабатывать. Остальные видят **только
   * свои**: заявка человека к организатору других не касается, и показывать
   * её участникам значило бы раскрывать чужие планы.
   */
  async listRequests(userId: string, id: number): Promise<TripRequestListDto> {
    const manager = this.dataSource.manager;
    const trip = await this.findVisibleTrip(manager, userId, id);
    const isOrganizer = trip.organizerUserId === userId;

    const requests = await manager.find(TripMembershipRequest, {
      where: isOrganizer ? { tripId: trip.id } : { tripId: trip.id, userId },
      relations: { user: true },
      order: { createdAt: 'ASC' },
    });

    return {
      requests: requests.map((request) => TripRequestDto.from(request)),
    };
  }

  /**
   * Завести тикет: приглашение или заявку.
   *
   * Приглашение создаёт организатор и оно **сразу** добавляет человека
   * в состав со статусом `invited`: приглашённый должен видеть поход, иначе
   * он не сможет решить, идти ли. Заявка участия не создаёт — сначала
   * решение организатора.
   *
   * В гостевом чате заявка отмечается системным сообщением: подавший должен
   * видеть, что она ушла организатору, а не пропала.
   */
  async createRequest(
    userId: string,
    id: number,
    dto: CreateRequestDto,
  ): Promise<TripRequestDto> {
    return this.dataSource.transaction(async (manager) => {
      const trip = await this.findVisibleTrip(manager, userId, id);
      const isOrganizer = trip.organizerUserId === userId;

      if (dto.direction === 'invite') {
        if (!isOrganizer) {
          throw new ForbiddenException('Приглашать может только организатор');
        }
        if (!dto.userId) {
          throw new BadRequestException(
            'Для приглашения нужно указать, кого приглашаем',
          );
        }
        if (dto.userId === trip.organizerUserId) {
          throw new BadRequestException('Организатор уже в походе');
        }

        const invited = await manager.findOne(User, {
          where: { id: dto.userId },
        });
        if (!invited) {
          throw new BadRequestException('Пользователь не найден');
        }

        await this.assertFreeOfTicketAndParticipation(
          manager,
          trip,
          dto.userId,
        );

        const request = await manager.save(
          manager.create(TripMembershipRequest, {
            tripId: trip.id,
            userId: dto.userId,
            direction: 'invite',
            message: dto.message ?? null,
          }),
        );
        await manager.insert(TripParticipant, {
          tripId: trip.id,
          userId: dto.userId,
          status: 'invited',
        });

        request.user = invited;
        return TripRequestDto.from(request);
      }

      // Заявка. `userId` в ней лишний: её подают от своего имени, и чужой
      // id здесь означал бы заявку от лица другого человека.
      if (dto.userId !== undefined) {
        throw new BadRequestException(
          'Заявку подают от своего имени: поле userId здесь лишнее',
        );
      }
      if (isOrganizer) {
        throw new BadRequestException('Организатор уже в походе');
      }
      if (trip.isRecruitmentClosed) {
        throw new ConflictException('Набор в этот поход закрыт');
      }

      await this.assertFreeOfTicketAndParticipation(manager, trip, userId);

      const request = await manager.save(
        manager.create(TripMembershipRequest, {
          tripId: trip.id,
          userId,
          direction: 'apply',
          message: dto.message ?? null,
        }),
      );

      const applicant = await manager.findOne(User, { where: { id: userId } });
      if (!applicant) {
        throw new NotFoundException('Пользователь не найден');
      }
      request.user = applicant;

      await this.postSystemMessage(
        manager,
        trip.id,
        'trip_guest',
        `Заявка на участие от ${displayNameOf(applicant)}`,
      );

      return TripRequestDto.from(request);
    });
  }

  /**
   * Принять: приглашённый отвечает «иду» или «пока не решил», организатор
   * одобряет заявку.
   *
   * Кто вправе — зависит от направления тикета, и это единственное место,
   * где направление определяет права: приглашение принимает тот, кого
   * позвали, заявку одобряет тот, кого просили.
   */
  async acceptRequest(
    userId: string,
    id: number,
    targetUserId: string,
    status: ParticipantDecision,
  ): Promise<TripParticipantDto> {
    return this.dataSource.transaction(async (manager) => {
      const trip = await manager.findOne(Trip, { where: { id: String(id) } });
      if (!trip) {
        throw new NotFoundException('Поход не найден');
      }

      const request = await manager.findOne(TripMembershipRequest, {
        where: { tripId: trip.id, userId: targetUserId },
        relations: { user: true },
      });
      if (!request) {
        throw new NotFoundException('Приглашение или заявка не найдены');
      }

      const isOrganizer = trip.organizerUserId === userId;
      const isTarget = targetUserId === userId;

      if (request.direction === 'invite' ? !isTarget : !isOrganizer) {
        throw new ForbiddenException(
          request.direction === 'invite'
            ? 'Принять приглашение может только тот, кого пригласили'
            : 'Одобрить заявку может только организатор',
        );
      }

      const participant = await manager.findOne(TripParticipant, {
        where: { tripId: trip.id, userId: targetUserId },
      });
      if (participant) {
        participant.status = status;
        await manager.save(participant);
      } else {
        await manager.insert(TripParticipant, {
          tripId: trip.id,
          userId: targetUserId,
          status,
        });
      }

      await manager.delete(TripMembershipRequest, {
        tripId: trip.id,
        userId: targetUserId,
      });

      await this.postSystemMessage(
        manager,
        trip.id,
        'trip_members',
        `${displayNameOf(request.user)}: ${statusText(status)}`,
      );

      const saved = await manager.findOne(TripParticipant, {
        where: { tripId: trip.id, userId: targetUserId },
        relations: { user: true },
      });

      return TripParticipantDto.from(
        saved!,
        await this.loadRoles(manager, trip.id, targetUserId),
        trip.organizerUserId,
      );
    });
  }

  /**
   * Отказаться, отозвать или отклонить — одним действием «тикет закрыт».
   *
   * Четыре случая, и все они означают одно: тикета больше нет. Разница
   * только в том, кто это сделал и куда смотреть истории:
   *
   * | тикет | кто | что происходит |
   * |---|---|---|
   * | приглашение | организатор | отозвал: человека убираем из состава |
   * | приглашение | приглашённый | отказался: то же самое |
   * | заявка | организатор | отклонил: состав не меняется |
   * | заявка | заявитель | отозвал: состав не меняется |
   *
   * Сообщение идёт туда, где его увидят: про приглашения — в чат
   * участников, про заявки — в гостевой. Заявка в чате участников была бы
   * сообщением о человеке, которого в походе нет.
   */
  async deleteRequest(
    userId: string,
    id: number,
    targetUserId: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const trip = await manager.findOne(Trip, { where: { id: String(id) } });
      if (!trip) {
        throw new NotFoundException('Поход не найден');
      }

      const request = await manager.findOne(TripMembershipRequest, {
        where: { tripId: trip.id, userId: targetUserId },
        relations: { user: true },
      });
      if (!request) {
        throw new NotFoundException('Приглашение или заявка не найдены');
      }

      const isOrganizer = trip.organizerUserId === userId;
      const isTarget = targetUserId === userId;
      if (!isOrganizer && !isTarget) {
        throw new ForbiddenException(
          'Закрыть тикет может организатор или сам человек',
        );
      }

      const name = displayNameOf(request.user);

      if (request.direction === 'invite') {
        await manager.delete(TripParticipant, {
          tripId: trip.id,
          userId: targetUserId,
        });
        await manager.delete(TripMembershipRequest, {
          tripId: trip.id,
          userId: targetUserId,
        });

        await this.postSystemMessage(
          manager,
          trip.id,
          'trip_members',
          isOrganizer
            ? `Приглашение для ${name} отозвано`
            : `${name} не идёт в поход`,
        );
        return;
      }

      await manager.delete(TripMembershipRequest, {
        tripId: trip.id,
        userId: targetUserId,
      });

      await this.postSystemMessage(
        manager,
        trip.id,
        'trip_guest',
        isOrganizer ? `Заявка от ${name} отклонена` : `${name} отозвал заявку`,
      );
    });
  }

  /**
   * Человек не должен одновременно быть в составе или уже иметь тикет.
   *
   * Два разных отказа, а не один: «уже в походе» и «уже приглашён» — разные
   * ситуации для того, кто нажал кнопку. `UNIQUE (trip_id, user_id)` в базе
   * поймал бы второе, но это 500, а не объяснение.
   */
  private async assertFreeOfTicketAndParticipation(
    manager: EntityManager,
    trip: Trip,
    userId: string,
  ): Promise<void> {
    const inTrip = await manager.count(TripParticipant, {
      where: { tripId: trip.id, userId },
    });
    if (inTrip > 0) {
      throw new ConflictException('Человек уже в составе похода');
    }

    const ticket = await manager.count(TripMembershipRequest, {
      where: { tripId: trip.id, userId },
    });
    if (ticket > 0) {
      throw new ConflictException(
        'По этому человеку уже есть приглашение или заявка',
      );
    }
  }

  // ─────────────────────────── переписка ───────────────────────────

  /**
   * Чат похода и право им пользоваться.
   *
   * Правила из `docs/ph/trips.md`, раздел 6, и они разные для двух чатов:
   * чат участников доступен только составу — **любого статуса, включая
   * `invited`**, иначе приглашённый не сможет ничего спросить; гостевой —
   * составу и, у публичного похода, всем зарегистрированным.
   *
   * **Читать и писать здесь одно право, а не два.** Разделять их значило бы
   * отвечать «читай, но не пиши» — правила, которого в требованиях нет,
   * а проверять его пришлось бы в каждом месте.
   */
  private async findChatForUser(
    manager: EntityManager,
    trip: Trip,
    userId: string,
    kind: ChatKind,
  ): Promise<Conversation> {
    const isParticipant =
      (await manager.count(TripParticipant, {
        where: { tripId: trip.id, userId },
      })) > 0;

    const allowed =
      kind === 'trip_members'
        ? isParticipant
        : isParticipant || trip.visibility === 'public';

    if (!allowed) {
      throw new ForbiddenException(
        kind === 'trip_members'
          ? 'Чат участников доступен только участникам похода'
          : 'Этот чат похода вам недоступен',
      );
    }

    const chat = await manager.findOne(Conversation, {
      where: { tripId: trip.id, kind },
    });
    if (!chat) {
      throw new InternalServerErrorException(
        `У похода нет чата «${kind}» — данные похода повреждены`,
      );
    }

    return chat;
  }

  /**
   * Чаты похода, доступные этому человеку, с последним сообщением.
   *
   * Последнее сообщение нужно, чтобы показать в списке, о чём в чате речь,
   * не открывая его. Чатов у похода два, поэтому запрос на каждый — это два
   * запроса, а не N+1: усложнять одним `DISTINCT ON` здесь нечего.
   *
   * Незнакомый `kind` пропускается: колонка без CHECK, и новый вид чата
   * может появиться в базе раньше, чем этот код о нём узнает. Показать его
   * как есть — значит отдать фронту чат, которого он не умеет рисовать.
   */
  async listChats(userId: string, id: number): Promise<TripChatListDto> {
    const manager = this.dataSource.manager;
    const trip = await this.findVisibleTrip(manager, userId, id);
    const isParticipant =
      (await manager.count(TripParticipant, {
        where: { tripId: trip.id, userId },
      })) > 0;

    const chats = await manager.find(Conversation, {
      where: { tripId: trip.id },
      order: { id: 'ASC' },
    });

    const visible: TripChatDto[] = [];

    for (const chat of chats) {
      const kind = chat.kind as ChatKind;
      if (!CHAT_KINDS.includes(kind)) continue;

      const allowed =
        kind === 'trip_members'
          ? isParticipant
          : isParticipant || trip.visibility === 'public';
      if (!allowed) continue;

      const last = await manager.findOne(Message, {
        where: { conversationId: chat.id },
        relations: { sender: true },
        order: { id: 'DESC' },
      });

      visible.push(
        TripChatDto.from(
          { id: chat.id, kind },
          last ? TripMessageDto.from(last) : null,
        ),
      );
    }

    return { chats: visible };
  }

  /**
   * Сообщения чата страницей от старых к новым.
   *
   * Запрос идёт **от новых к старым** — так работает курсор `before`:
   * клиент присылает id самого старого сообщения, которое у него есть,
   * и получает предыдущую страницу. В ответе порядок разворачивается
   * в хронологический: чат читают сверху вниз, и переворачивать его
   * на клиенте — работа, которую незачем делать дважды.
   *
   * Листаем по `id`, а не по `created_at`: две записи с одинаковой меткой
   * времени — обычное дело, и страница либо зациклилась бы, либо теряла
   * сообщения.
   */
  async listMessages(
    userId: string,
    id: number,
    query: TripMessageQueryDto,
  ): Promise<TripMessageListDto> {
    const manager = this.dataSource.manager;
    const trip = await this.findVisibleTrip(manager, userId, id);
    const chat = await this.findChatForUser(manager, trip, userId, query.kind);
    const limit = query.limit ?? DEFAULT_MESSAGE_PAGE_SIZE;

    const qb = manager
      .createQueryBuilder(Message, 'message')
      .leftJoinAndSelect('message.sender', 'sender')
      .where('message.conversationId = :conversationId', { conversationId: chat.id })
      // Имя свойства, а не колонки: при `take` TypeORM пересобирает
      // ORDER BY и ищет колонку через `findColumnWithPropertyPath`.
      .orderBy('message.id', 'DESC')
      // На одно больше запрошенного — так и узнаётся, есть ли ещё страница.
      .take(limit + 1);

    if (query.before !== undefined) {
      qb.andWhere('message.id < :before', { before: query.before });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    page.reverse();

    return {
      messages: page.map((message) => TripMessageDto.from(message)),
      hasMore,
    };
  }

  /**
   * Отправить сообщение в чат.
   *
   * Текст обрезается по краям и пустым быть не может: сообщение из одних
   * пробелов неотличимо от пустого, а в ленте выглядит как сбой вёрстки.
   * В базе остаётся исходник markdown — санитайз делается при рендере.
   */
  async sendMessage(
    userId: string,
    id: number,
    dto: SendTripMessageDto,
  ): Promise<TripMessageDto> {
    const manager = this.dataSource.manager;
    const trip = await this.findVisibleTrip(manager, userId, id);
    const chat = await this.findChatForUser(manager, trip, userId, dto.kind);

    const body = dto.body.trim();
    if (body.length === 0) {
      throw new BadRequestException('Сообщение не может состоять из пробелов');
    }

    const sender = await manager.findOne(User, { where: { id: userId } });
    if (!sender) {
      throw new NotFoundException('Пользователь не найден');
    }

    const saved = await manager.save(
      manager.create(Message, {
        conversationId: chat.id,
        senderId: userId,
        body,
      }),
    );
    saved.sender = sender;

    return TripMessageDto.from(saved);
  }
}
