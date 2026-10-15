import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';

import { CalendarActivityType } from '../calendar/entities/activity-type.entity';
import { CreateTripDto } from './dto/create-trip.dto';
import { TripListQueryDto } from './dto/trip-list-query.dto';
import { TripListResponseDto } from './dto/trip-list-response.dto';
import { TripResponseDto } from './dto/trip-response.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { Chat } from './entities/chat.entity';
import { GeoObject } from './entities/geo-object.entity';
import { Role } from './entities/role.entity';
import { TripDateVariant } from './entities/trip-date-variant.entity';
import { TripParticipantRole } from './entities/trip-participant-role.entity';
import { TripParticipant } from './entities/trip-participant.entity';
import { TripRouteElement } from './entities/trip-route-element.entity';
import { Trip } from './entities/trip.entity';
import { extractObjectIds } from './route-links';
import {
  ORGANIZER_ROLE_CODE,
  type TripStatus,
  type TripWhen,
} from './trip.types';

/** Размер страницы ленты по умолчанию и потолок — в DTO. */
const DEFAULT_PAGE_SIZE = 20;

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

    if (query.goalObjectId !== undefined) {
      qb.andWhere('trip.goal_object_id = :goalObjectId', {
        goalObjectId: query.goalObjectId,
      });
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

    if (query.organizerUserId !== undefined) {
      qb.andWhere('trip.organizer_user_id = :organizerUserId', {
        organizerUserId: query.organizerUserId,
      });
    }

    if (query.mine) {
      qb.andWhere(
        `EXISTS (
           SELECT 1 FROM trip_participants p
            WHERE p.trip_id = trip.id AND p.user_id = :userId
         )`,
      );
    }

    if (query.when !== undefined) {
      qb.andWhere(this.whenCondition(query.when));
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
   */
  private whenCondition(when: TripWhen): string {
    switch (when) {
      case 'upcoming':
        return 'COALESCE(trip.actual_started_at, trip.starts_at) > now()';
      case 'ongoing':
        // Поход без известного конца, но с прошедшим началом, «идёт»:
        // не знать, когда вернутся, — не то же самое, что уже вернулись.
        return `COALESCE(trip.actual_started_at, trip.starts_at) <= now()
            AND (COALESCE(trip.actual_finished_at, trip.ends_at) IS NULL
                 OR COALESCE(trip.actual_finished_at, trip.ends_at) >= now())`;
      case 'past':
        return 'COALESCE(trip.actual_finished_at, trip.ends_at) < now()';
      case 'undated':
        return 'trip.starts_at IS NULL AND trip.actual_started_at IS NULL';
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

      if (dto.title !== undefined) trip.title = dto.title;
      if (dto.requirementsText !== undefined) {
        trip.requirementsText = dto.requirementsText;
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
}
