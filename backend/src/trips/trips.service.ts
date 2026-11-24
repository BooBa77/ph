import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Not, Repository } from 'typeorm';

import { CalendarActivityGroup } from '../calendar/entities/activity-group.entity';
import { CalendarActivityType } from '../calendar/entities/activity-type.entity';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import type { CreateVirtualUserDto } from '../users/dto/virtual-user.dto';
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
  UpdateParticipantDietDto,
} from './dto/participant.dto';
import {
  CreateRequestDto,
  TripRequestDto,
  TripRequestListDto,
} from './dto/request.dto';
import { TripListQueryDto } from './dto/trip-list-query.dto';
import { TripListResponseDto } from './dto/trip-list-response.dto';
import {
  GuestTripDto,
  RoleListDto,
  SetParticipantRolesDto,
  TripTabListDto,
} from './dto/trip-access.dto';
import { TripResponseDto } from './dto/trip-response.dto';
import { TripTypeListDto, TripTypeOptionDto } from './dto/trip-type.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { TripCacheStateDto } from './dto/trip-cache-state.dto';
import { Conversation } from './entities/conversation.entity';
import { ConversationMember } from './entities/conversation-member.entity';
import { GeoObject } from './entities/geo-object.entity';
import { Message } from './entities/message.entity';
import { Role } from './entities/role.entity';
import { RoleTabPermission } from './entities/role-tab-permission.entity';
import { TripDateVariant } from './entities/trip-date-variant.entity';
import { TripMembershipRequest } from './entities/trip-membership-request.entity';
import { TripParticipantRole } from './entities/trip-participant-role.entity';
import { TripParticipant } from './entities/trip-participant.entity';
import { TripRouteElement } from './entities/trip-route-element.entity';
import { TripRouteLodger } from './entities/trip-route-lodger.entity';
import { TripRouteNight } from './entities/trip-route-night.entity';
import { TripTransferLeg } from './entities/trip-transfer-leg.entity';
import { TripType } from './entities/trip-type.entity';
import { Trip } from './entities/trip.entity';
import { conflictMessage, removeConflictingGear } from '../gear/gear-uid';
import { TripGear } from '../gear/entities/trip-gear.entity';
import { extractObjectIds } from './route-links';
import {
  COMPLETED_EDITABLE_TABS,
  COORGANIZER_ROLE_CODE,
  MEMBERS_TAB,
  NIGHTS_TAB,
  OFFICIAL_ONLY_TAB,
  TRIP_TABS,
  type TripTab,
} from './trip-tabs';
import { PARTICIPANT_ONLY_CHAT_KINDS } from './trip-transfer.types';
import {
  detachTripParticipant,
  postTripSystemMessage,
  releaseTripTransfers,
} from './trip-participant-detach';
import {
  CHAT_KINDS,
  DEFAULT_TRIP_TYPE_CODE,
  ORGANIZER_ROLE_CODE,
  type ChatKind,
  type ParticipantDecision,
  type ParticipantStatus,
  type PresenceAction,
  type TripStatus,
  type TripWhen,
} from './trip.types';
import { nextWeekendRange } from './weekend';
import { TripEventsService } from './trip-events.service';
import { ConversationsService } from './conversations.service';
import { NotificationsService } from './notifications.service';
import { readTripCacheState } from './trip-cache-state';
import { recalculateCommonEaterShares } from './trip-finance-shares';

/** Размер страницы ленты по умолчанию и потолок — в DTO. */
const DEFAULT_PAGE_SIZE = 20;

/** Сколько сообщений чата отдавать за раз, если клиент не попросил иначе. */
const DEFAULT_MESSAGE_PAGE_SIZE = 50;

/**
 * Сколько **календарных дней** между двумя моментами.
 *
 * Часы не в счёт: поход «5 мая 09:00 — 5 мая 18:00» однодневный, и ночи
 * у него нет, хотя между моментами десять часов. Считаем по датам в UTC —
 * сервер живёт в UTC, и результат не должен зависеть от перехода на летнее
 * время ни в одном из поясов.
 */
function dayDistance(from: Date, to: Date): number {
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());

  return Math.round((end - start) / 86_400_000);
}

/**
 * Совпадают ли два момента времени (включая «оба null»).
 *
 * Нужно, чтобы отличить «даты похода изменились» от «прислали те же даты»:
 * `PATCH` формы присылает их всегда, а снимать снаряжение из-за повторной
 * отправки того же числа нельзя (11.11.2026).
 */
function sameInstant(left: Date | null, right: Date | null): boolean {
  if (left === null || right === null) return left === right;
  return left.getTime() === right.getTime();
}

/** Как статус участия читается в системном сообщении чата. */
function statusText(status: ParticipantStatus): string {  switch (status) {
    case 'going':
      return 'идёт';
    case 'maybe':
      return 'пока не решил';
    case 'helping':
      return 'помогает, но не идёт';
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
 * Набор закрыт: поход уже начался по плановым датам (20.11.2026).
 *
 * Заказчик: «набор закрывается на старте, но организатор и соорганизатор
 * могут добавить человека и после». Отдельного поля в базе нет — старт
 * уже есть в `starts_at`, и второе «набор закрыт» разошлось бы с ним
 * при первой же смене дат.
 */
function hasStarted(trip: Trip, now: Date = new Date()): boolean {
  return trip.startsAt !== null && trip.startsAt.getTime() <= now.getTime();
}

/** Поход уже закончился по плановым датам. */
function hasEnded(trip: Trip, now: Date = new Date()): boolean {
  return trip.endsAt !== null && trip.endsAt.getTime() <= now.getTime();
}

/**
 * Поход завершён — содержимое закрыто навсегда (20.11.2026).
 *
 * Заказчик: «После завершения закрыто всё и навсегда, даже админу:
 * снаряжение, питание, трансфер, ночёвки, состав, даты, роли». Поэтому
 * проверка стоит на всех изменяющих ручках похода, кроме «Дневника»,
 * «Бухгалтерии» (в ней свои ограничения: новые чеки можно, правку
 * прежних — нет) и присутствия: перекличка — не содержимое, её собирают
 * и после возвращения ([lifecycle.md](../docs/ph/lifecycle.md) §4.4).
 *
 * **Права вкладок — не замена этой проверке.** `editableTabs` уже отдаёт
 * после завершения только «Дневник» и «Бухгалтерию», но часть ручек
 * (правка шапки, отмена, состав, тикеты) прав вкладок не спрашивает —
 * у них своё правило «только организатор». Без этой проверки автор
 * продолжал бы менять даты уже состоявшегося похода.
 */
function assertTripOpen(trip: Trip): void {
  if (trip.completedAt === null) return;

  throw new ConflictException(
    'Поход завершён: здесь уже ничего не меняется. Открыты «Дневник» и «Бухгалтерия»',
  );
}

/**
 * Поставить человеку «на маршруте» без вопроса (20.11.2026).
 *
 * Заказчик: «оба случая сразу ставят „на маршруте“: статус плюс отметка
 * присутствия, автор — организатор. Отдельного вопроса „он вышел
 * на маршрут?“ не задаём». Автор — тот, кто добавил: `self` остаётся
 * только за организатором, который перевёл в «иду» себя.
 *
 * Первый выход не переписывается: если отметка уже была, остаётся её
 * время, а «вернулся» снимается — человек снова в поле, а не дома.
 */
function markOnRoute(
  participant: TripParticipant,
  authorUserId: string,
  at: Date,
): void {
  participant.startedAt = participant.startedAt ?? at;
  participant.returnedAt = null;
  participant.presenceUpdatedBy = authorUserId;
  participant.presenceSource =
    authorUserId === participant.userId ? 'self' : 'other';
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
    /**
     * Заведение человека без аккаунта живёт в `UsersService`: это строка
     * `users`, и правило «`is_virtual` и создатель пишутся вместе» должно
     * быть одно. Здесь — только состав похода.
     */
    private readonly users: UsersService,
    /**
     * Смена дат решённого похода снимает ставшие занятыми строки снаряжения
     * (11.11.2026, шаг 2). Вкладка «Снаряжение» должна об этом узнать без
     * перезагрузки — канал тот же, что у перетаскивания вещи.
     */
    private readonly events: TripEventsService,
    /**
     * Переписка (24.11.2026). Сообщение в чат похода пишется здесь, но
     * событие «новое сообщение» уходит в общий канал переписки — иначе
     * вкладка чата похода осталась бы без живой переписки, а лента её
     * получала бы. Кому слать, решает `ConversationsService`: там же
     * состав диалога для личных.
     */
    private readonly conversations: ConversationsService,
    /**
     * Уведомления правой панели (24.11.2026, §14). Сообщение в чат похода
     * пишется здесь мимо `ConversationsService.sendMessage`, поэтому
     * карточку «об этом чате» заводим явно — иначе панель не узнала бы
     * о новом сообщении из вкладки чата.
     */
    private readonly notifications: NotificationsService,
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
    // прислать `[1, 1]`, и это не повод падать — ни на проверке количества,
    // ни на составном ключе `trip_types`.
    const activityTypeIds = [...new Set(dto.activityTypeIds ?? [])];
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    const isCommercial = dto.isCommercial ?? false;
    const status = dto.status ?? 'idea';

    /**
     * «Мечта» — не поход, а вишлист (`tabs.md` §7): у неё нет участников,
     * ролей и членского чата, только гостевой чат. Связанные таблицы пустые,
     * а организатор в составе, роль и членский чат появятся при переходе
     * в «Планирую» (`prepareTripFromIdea`).
     */
    const isIdea = status === 'idea';

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
       * внешний ключ `trip_types.activity_type_id`. Причина простая:
       * внешний ключ бросает исключение, и наружу ушёл бы 500 «внутренняя
       * ошибка» — а это ошибка клиента, и сказать о ней надо 400-м
       * с внятным текстом. Ключ остаётся второй линией обороны для правок
       * мимо API.
       */
      await this.assertActivityTypes(manager, activityTypeIds);

      /**
       * Роль организатора обязана быть в справочнике. Мечте она не нужна:
       * у неё нет состава. Если её нет — это не ошибка клиента, а
       * незалитый справочник, поэтому 500 и подсказка с командой.
       */
      let organizerRole: Role | null = null;
      if (!isIdea) {
        organizerRole = await manager.findOne(Role, {
          where: { code: ORGANIZER_ROLE_CODE },
        });
        if (!organizerRole) {
          throw new InternalServerErrorException(
            'В справочнике ролей нет роли организатора: выполните npm run seed:roles',
          );
        }
      }

      const trip = await manager.save(
        manager.create(Trip, {
          organizerUserId,
          goalObjectId: String(dto.goalObjectId),
          announcement: dto.announcement ?? null,
          routeText: dto.routeText ?? '',
          requirementsText: dto.requirementsText ?? null,
          hasGuitar: dto.hasGuitar ?? false,
          visibility: dto.visibility ?? 'public',
          status,
          startsAt,
          endsAt,
          isCommercial,
          isOfficial: dto.isOfficial ?? false,
          openParticipation: dto.openParticipation ?? true,
          priceRub: dto.priceRub ?? null,
          priceNote: dto.priceNote ?? null,
          depositRub: dto.depositRub ?? null,
        }),
      );

      if (!isIdea && organizerRole) {
        /**
         * Организатор сразу в составе, со статусом `going`. «Организую,
         * но сам не иду» — законная ситуация, но она требует явного
         * действия человека, а не является значением по умолчанию.
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
      }

      /**
       * Гостевой чат есть у любого похода, даже у мечты: это единственное
       * место, где гости могут спросить о вишлисте. Остальные — только
       * у настоящего похода: у мечты нет ни состава, ни подготовки, а чат
       * вкладки без вкладки — это переписка в пустоту.
       */
      await manager.insert(
        Conversation,
        isIdea
          ? [{ kind: 'trip_guest', tripId: trip.id }]
          : [
              { kind: 'trip_guest', tripId: trip.id },
              { kind: 'trip_members', tripId: trip.id },
              { kind: 'trip_meals', tripId: trip.id },
              { kind: 'trip_transfer', tripId: trip.id },
              { kind: 'trip_route', tripId: trip.id },
              { kind: 'trip_gear', tripId: trip.id },
              { kind: 'trip_first_aid', tripId: trip.id },
              { kind: 'trip_finance', tripId: trip.id },
            ],
      );

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
       * Типы похода — строками в связке и в той же транзакции: тип,
       * потерянный при создании, восстанавливать будет не из чего — в теле
       * запроса его уже нет, а поход к этому моменту считается созданным.
       * `Set` выше схлопнул дубликаты, поэтому составной ключ
       * `(trip_id, activity_type_id)` повторов не увидит.
       */
      if (activityTypeIds.length > 0) {
        await manager.insert(
          TripType,
          activityTypeIds.map((activityTypeId) => ({
            tripId: trip.id,
            activityTypeId,
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

      // Типы только что вставлены — читать их обратно из базы незачем.
      trip.activityTypeIds = activityTypeIds;

      // Варианты читаем из базы: форме правки они нужны, чтобы смена
      // готовности не стирала введённую продолжительность.
      const dateVariants = await manager.find(TripDateVariant, {
        where: { tripId: trip.id },
        order: { id: 'ASC' },
      });

      return TripResponseDto.from(trip, dateVariants);
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

    if (trip.visibility === 'private' && trip.organizerUserId !== userId) {
      const isParticipant = await this.participantsRepository.count({
        where: { tripId: trip.id, userId },
      });
      if (isParticipant === 0) {
        throw new NotFoundException('Поход не найден');
      }
    }

    // Типы похода живут в связке — подтягиваем перед отдачей наружу.
    await this.fillTypes(this.dataSource.manager, [trip]);

    const dateVariants = await this.dataSource.manager.find(TripDateVariant, {
      where: { tripId: trip.id },
      order: { id: 'ASC' },
    });

    const response = TripResponseDto.from(trip, dateVariants);
    // Вопрос «поход состоялся?» и кнопка «Завершить поход» показываются
    // по одному флагу, а правило считает сервер: состав и присутствие
    // фронту для этого не нужны.
    response.canComplete = await this.isCompletionReady(
      this.dataSource.manager,
      trip,
      userId,
    );

    return response;
  }

  /**
   * Пора завершать поход: конец прошёл, все идущие отметили «вернулся»,
   * поход не завершён (20.11.2026).
   *
   * Заказчик: «когда `ends_at` прошёл и все идущие отметили „вернулся“,
   * организатору (только автору) приходит вопрос». Условие «все вернулись»
   * нельзя выразить в DTO похода: присутствие живёт в составе, и второй
   * запрос здесь дешевле, чем флаг в каждой строке списка походов.
   *
   * `going === 0` — не повод спрашивать: «все участники благополучно
   * вернулись» о походе без идущих было бы неправдой. Автор — тот, кому
   * вопрос вообще задают, поэтому проверка автора здесь же.
   */
  private async isCompletionReady(
    manager: EntityManager,
    trip: Trip,
    userId: string,
  ): Promise<boolean> {
    if (trip.completedAt !== null) return false;
    if (trip.organizerUserId !== userId) return false;
    if (!hasEnded(trip)) return false;

    const going = await manager.count(TripParticipant, {
      where: { tripId: trip.id, status: 'going' },
    });
    if (going === 0) return false;

    const onRoute = await manager.count(TripParticipant, {
      where: {
        tripId: trip.id,
        status: 'going',
        returnedAt: IsNull(),
      },
    });

    return onRoute === 0;
  }

  /**
   * Вкладки похода и права на правку (Ф6 карты вкладок).
   *
   * **Видят вкладки все участники** — решение заказчика 21.10.2026:
   * роль отвечает на вопрос «кто ведёт», а не «кому видно». Поэтому
   * `canEdit` — про правку, а не про доступ к экрану.
   *
   * **Готовность похода меняет набор** (`tabs.md` §7):
   *
   * - «Мечта» — вишлист, а не поход: у владельца «Инфо» и «Гостевая»,
   *   у остальных только «Гостевая»; участников и подготовки нет;
   * - «Планирую» без конкретного числа (дня месяца) — «Инфо» и «Участники»:
   *   люди и состав есть, но готовить ещё нечего;
   * - «Решено» и «Планирую» с конкретным числом — все вкладки.
   *
   * Гость (зарегистрированный, но не в походе) видит только гостевую
   * вкладку, и править ему нечего. Приватный чужой поход — 404: правило
   * одно на весь домен (`findVisibleTrip`).
   *
   * Отказ от участия (`declined`) прав лишает: он в подготовке
   * не участвует — то же правило, что у чатов и чек-листов.
   */
  async listTabs(userId: string, id: number): Promise<TripTabListDto> {
    const manager = this.dataSource.manager;
    const trip = await this.findVisibleTrip(manager, userId, id);

    // Мечта — вишлист: одна «Гостевая», одинаковая для владельца и гостей.
    // Правка — кнопкой «Редактировать» в шапке, отдельной вкладки «Инфо» нет.
    if (trip.status === 'idea') {
      return { tabs: [{ code: 'guest', canEdit: false }] };
    }

    const participant = await manager.findOne(TripParticipant, {
      where: { tripId: trip.id, userId },
    });
    const isParticipant =
      participant !== null && participant.status !== 'declined';

    if (!isParticipant) {
      /**
       * Гость видит только «Гостевую» (21.10.2026). Альманах больше
       * не отдельная вкладка (22.11.2026): он — секция «Гостевой», и гость
       * читает его там же, куда и так имеет доступ.
       */
      return { tabs: [{ code: 'guest', canEdit: false }] };
    }

    const editable = await this.editableTabs(manager, trip, userId);

    /**
     * «Планирую» без конкретного числа — «Гостевая» и «Участники»:
     * информация и состав есть, готовить ещё нечего. Конкретное число
     * (день месяца) — точка, после которой открывается вся подготовка;
     * см. `hasConcreteDate`.
     */
    if (
      trip.status === 'planning' &&
      !(await this.hasConcreteDate(manager, trip))
    ) {
      return {
        tabs: (['guest', 'members'] as const).map((code) => ({
          code,
          canEdit: editable.has(code),
        })),
      };
    }

    /**
     * «Выпуск» есть только у официального похода (`OFFICIAL_ONLY_TAB`):
     * вкладка про выпуск группы по правилам Федерации, и у обычного похода
     * выпуска нет. «Ночёвки» — только когда есть хотя бы одна ночь
     * (`NIGHTS_TAB`): пустой табор не о чем вести. Оба фильтра стоят здесь —
     * в единственном месте, где список вкладок собирается, — поэтому фронт
     * ничего не досчитывает и меню не может разойтись с ответом сервера.
     */
    const hasNights = await this.hasNights(manager, trip);

    return {
      tabs: TRIP_TABS.filter(
        (code) =>
          (code !== OFFICIAL_ONLY_TAB || trip.isOfficial) &&
          (code !== NIGHTS_TAB || hasNights),
      ).map((code) => ({ code, canEdit: editable.has(code) })),
    };
  }

  /**
   * Есть ли у похода хотя бы одна ночь — то, что открывает вкладку «Ночёвки».
   *
   * **Источник — сама таблица ночёвок** (`trip_route_nights`, с 31.10.2026):
   * записал хотя бы одну ночь — вкладка есть. Пока не записано ни одной,
   * работает прежнее правило по датам (`NIGHTS_TAB`): решённые даты
   * считаются по календарным дням, прогноз — по минимальной
   * продолжительности варианта с конкретным числом. Иначе вкладка
   * пропадала бы у похода с датами, но с пустой таблицей, — а именно
   * с неё и начинают. Часы в решённых датах не в счёт: поход «5 мая
   * 09:00 — 5 мая 18:00» однодневный, ночи нет, хотя между моментами
   * десять часов.
   */
  private async hasNights(
    manager: EntityManager,
    trip: Trip,
  ): Promise<boolean> {
    const stored = await manager.count(TripRouteNight, {
      where: { tripId: trip.id },
    });

    if (stored > 0) return true;

    if (trip.startsAt !== null && trip.endsAt !== null) {
      return dayDistance(trip.startsAt, trip.endsAt) >= 1;
    }

    const variants = await manager.find(TripDateVariant, {
      where: { tripId: trip.id, day: Not(IsNull()) },
    });

    return variants.some((variant) => (variant.durationDays ?? 0) >= 2);
  }

  /**
   * Есть ли у похода **конкретное число** — день месяца в прогнозе или
   * решённые даты. Месяц без числа сроком не считается: «в июле» — это
   * ещё не дата, а «5 июля» — да (`tabs.md` §7).
   */
  private async hasConcreteDate(
    manager: EntityManager,
    trip: Trip,
  ): Promise<boolean> {
    if (trip.startsAt !== null) return true;

    const variants = await manager.count(TripDateVariant, {
      where: { tripId: trip.id, day: Not(IsNull()) },
    });

    return variants > 0;
  }

  /**
   * Достроить «Планирую» из «Мечты»: организатор в составе, роль
   * организатора и членский чат. У мечты этого нет намеренно — она
   * вишлист, а не поход; появляется всё при первом повышении готовности.
   * Идемпотентно: повторный переход ничего не дублирует.
   */
  private async prepareTripFromIdea(
    manager: EntityManager,
    trip: Trip,
  ): Promise<void> {
    const organizerRole = await manager.findOne(Role, {
      where: { code: ORGANIZER_ROLE_CODE },
    });
    if (!organizerRole) {
      throw new InternalServerErrorException(
        'В справочнике ролей нет роли организатора: выполните npm run seed:roles',
      );
    }

    const hasParticipant = await manager.exists(TripParticipant, {
      where: { tripId: trip.id, userId: trip.organizerUserId },
    });
    if (!hasParticipant) {
      await manager.insert(TripParticipant, {
        tripId: trip.id,
        userId: trip.organizerUserId,
        status: 'going',
      });
    }

    const hasRole = await manager.exists(TripParticipantRole, {
      where: {
        tripId: trip.id,
        userId: trip.organizerUserId,
        roleId: organizerRole.id,
      },
    });
    if (!hasRole) {
      await manager.insert(TripParticipantRole, {
        tripId: trip.id,
        userId: trip.organizerUserId,
        roleId: organizerRole.id,
      });
    }

    // Гостевой чат у мечты уже есть; остальные появляются здесь. Проверка
    // на существование нужна и для старых мечт, созданных до правила.
    for (const kind of [
      'trip_guest',
      'trip_members',
      'trip_meals',
      'trip_transfer',
      'trip_route',
      'trip_gear',
      'trip_first_aid',
      'trip_finance',
    ] as const) {
      const hasChat = await manager.exists(Conversation, {
        where: { tripId: trip.id, kind },
      });
      if (!hasChat) {
        await manager.insert(Conversation, { kind, tripId: trip.id });
      }
    }
  }

  /**
   * Может ли человек **править** вкладку — для доменов самих вкладок.
   *
   * Нужно снаряжению (Ф7): «Берём / Не берём» решает тот, кому роль дала
   * вкладку «Снаряжение» — завхоз, ремонтник, организатор. Проверка живёт
   * здесь, а не в сервисе снаряжения: матрица прав — правило походов,
   * и вторая её копия однажды разошлась бы с первой.
   *
   * Поход передаётся уже полученным (`getVisibleTrip`): вызывающему он
   * всё равно нужен, и второй запрос ради той же строки был бы лишним
   * кругом до базы.
   */
  async canEditTab(
    userId: string,
    trip: Trip,
    tab: TripTab,
  ): Promise<boolean> {
    const editable = await this.editableTabs(
      this.dataSource.manager,
      trip,
      userId,
    );

    return editable.has(tab);
  }

  /** Активные роли — для выбора при назначении. */
  async listRoles(): Promise<RoleListDto> {
    const roles = await this.dataSource.manager.find(Role, {
      where: { isActive: true },
      order: { id: 'ASC' },
    });

    return { roles: roles.map((role) => TripRoleDto.from(role)) };
  }

  /**
   * Назначить роли участнику: присланный список **заменяет** прежние.
   *
   * Роли назначают организатор и соорганизатор (20.11.2026: права вкладки
   * «Участники» у соорганизатора — правило кода в `tabsByRole`, а не строка
   * матрицы). Сами участники ролями не управляют, даже своими (решение
   * заказчика 21.10.2026): роль — это обязательство перед походом,
   * а не нашивка.
   *
   * Организатор похода роль `organizer` сохраняет при любом теле, и выдать
   * её другому нельзя: она производная от `trips.organizer_user_id`,
   * и «второй организатор» в этом проекте — это `coOrganizer`.
   */
  async setParticipantRoles(
    userId: string,
    id: number,
    targetUserId: string,
    dto: SetParticipantRolesDto,
  ): Promise<TripParticipantDto> {
    return this.dataSource.transaction(async (manager) => {
      const trip = await this.findVisibleTrip(manager, userId, id);

      const editable = await this.editableTabs(manager, trip, userId);
      if (!editable.has(MEMBERS_TAB)) {
        throw new ForbiddenException(
          'Роли назначает организатор похода или соорганизатор',
        );
      }

      const participant = await manager.findOne(TripParticipant, {
        where: { tripId: trip.id, userId: targetUserId },
        relations: { user: true },
      });
      if (!participant) {
        throw new NotFoundException('Такого участника в походе нет');
      }

      const codes = [...new Set(dto.roleCodes)];
      const isTargetOrganizer = participant.userId === trip.organizerUserId;

      /**
       * Полномочия снимает только организатор (20.11.2026).
       *
       * Заказчик: «организатор может снять роль соорганизатора;
       * соорганизатор — ни с себя, ни с другого»
       * ([lifecycle.md](../docs/ph/lifecycle.md) §4.5). Назначать других
       * он может — а снимать нет, иначе «второй организатор» снимал бы
       * с себя ограничения сам, и пять отличий превращались бы в ноль
       * на первом же шаге.
       *
       * Проверяем присланный набор целиком: роль `coOrganizer` есть
       * у цели сейчас, а в новом списке её нет.
       */
      const isActorOrganizer = trip.organizerUserId === userId;
      if (!isActorOrganizer && !codes.includes(COORGANIZER_ROLE_CODE)) {
        const targetRoles = await this.loadRoles(
          manager,
          trip.id,
          targetUserId,
        );
        const wasCoOrganizer = targetRoles.some(
          (role) => role.code === COORGANIZER_ROLE_CODE,
        );

        if (wasCoOrganizer) {
          throw new ForbiddenException(
            'Снять полномочия соорганизатора может только организатор похода',
          );
        }
      }

      /**
       * Виртуальным соорганизатором не бывает (20.11.2026).
       *
       * Соорганизатор — второй организатор, он ведёт поход сам: отвечает
       * за вкладки, набор и приглашения. У человека без аккаунта входа нет,
       * и за него всё делал бы тот, кто его завёл, — то есть полномочий
       * ни у кого не прибавилось бы, а в составе появилась бы строка
       * «соорганизатор», которой некому соответствовать. Роль ему никто
       * не выключит: в интерфейсе роли людям без аккаунта не предлагаются,
       * здесь — проверка для API.
       */
      if (codes.includes(COORGANIZER_ROLE_CODE) && participant.user?.isVirtual) {
        throw new BadRequestException(
          'Соорганизатором может быть только человек с аккаунтом',
        );
      }

      if (codes.includes(ORGANIZER_ROLE_CODE) && !isTargetOrganizer) {
        throw new BadRequestException(
          'Организатор у похода один — он автор похода; вместо этого назначь соорганизатора',
        );
      }

      const roles: Role[] =
        codes.length > 0
          ? await manager.find(Role, {
              where: { code: In(codes), isActive: true },
            })
          : [];

      if (roles.length !== codes.length) {
        throw new BadRequestException(
          'Среди ролей есть неизвестные — выбери из справочника',
        );
      }

      /**
       * Роль организатора возвращается на место молча: если человек прислал
       * список без неё, он мог просто не знать, что она там есть, а убрать
       * её всё равно нельзя.
       */
      const organizerRole = isTargetOrganizer
        ? await manager.findOne(Role, { where: { code: ORGANIZER_ROLE_CODE } })
        : null;

      if (isTargetOrganizer && !organizerRole) {
        throw new InternalServerErrorException(
          'В справочнике ролей нет роли организатора: выполните npm run seed:roles',
        );
      }

      const roleIds = roles
        .map((role) => role.id)
        .filter((roleId) => roleId !== organizerRole?.id);
      if (organizerRole) roleIds.push(organizerRole.id);

      await manager.delete(TripParticipantRole, {
        tripId: trip.id,
        userId: targetUserId,
      });
      if (roleIds.length > 0) {
        await manager.insert(
          TripParticipantRole,
          roleIds.map((roleId) => ({
            tripId: trip.id,
            userId: targetUserId,
            roleId,
          })),
        );
      }

      const savedRoles = await this.loadRoles(manager, trip.id, targetUserId);

      return TripParticipantDto.from(
        participant,
        savedRoles,
        trip.organizerUserId,
      );
    });
  }

  /**
   * Поход глазами гостя — урезанное представление для гостевой вкладки.
   *
   * Приватный поход гостю не виден — 404, как и сам поход. Участнику
   * эндпоинт тоже отвечает: организатору он нужен как превью того, что
   * увидит гость.
   */
  async guestView(userId: string, id: number): Promise<GuestTripDto> {
    const manager = this.dataSource.manager;

    const trip = await manager.findOne(Trip, {
      where: { id: String(id) },
      relations: { goalObject: true },
    });
    if (!trip) throw new NotFoundException('Поход не найден');

    if (trip.visibility === 'private' && trip.organizerUserId !== userId) {
      const isParticipant = await manager.count(TripParticipant, {
        where: { tripId: trip.id, userId },
      });
      if (isParticipant === 0) {
        throw new NotFoundException('Поход не найден');
      }
    }

    // «Гостевая» одна для всех: состав участников — часть анонса, и он
    // виден гостю. Место сбора сюда не входит — оно в «Трансфере».
    const participants = await this.loadParticipants(manager, trip);

    return GuestTripDto.from(trip, participants);
  }

  /**
   * Вкладки, которые этот человек вправе **править**.
   *
   * Организатор — все, независимо от матрицы: это правило кода, а не строка
   * в базе (организатор не должен зависеть от того, засеян ли справочник).
   * Остальным — объединение прав их ролей; матрица живёт в
   * `role_tab_permissions` и правится сидом.
   *
   * С 20.11.2026 у завершённого похода права сужаются до двух вкладок
   * (`COMPLETED_EDITABLE_TABS`) для всех, включая организатора: правило
   * стоит после матрицы, поэтому роли его не расширяют.
   */
  private async editableTabs(
    manager: EntityManager,
    trip: Trip,
    userId: string,
  ): Promise<Set<TripTab>> {
    const base = await this.tabsByRole(manager, trip, userId);

    /**
     * Завершённый поход правится только в двух разделах (20.11.2026):
     * «Дневник» дополняется, «Бухгалтерия» считает деньги. Всё остальное —
     * снаряжение, питание, трансфер, ночёвки, состав, даты, роли — история.
     * Роли не расширяют этот список: закрыто даже автору и админу, поэтому
     * фильтр стоит после матрицы, а не вместо неё.
     */
    if (trip.completedAt !== null) {
      return new Set(
        [...base].filter((tab) => COMPLETED_EDITABLE_TABS.includes(tab)),
      );
    }

    return base;
  }

  /** Права на правку вкладок по ролям — без поправки на завершение. */
  private async tabsByRole(
    manager: EntityManager,
    trip: Trip,
    userId: string,
  ): Promise<Set<TripTab>> {
    if (trip.organizerUserId === userId) return new Set(TRIP_TABS);

    const participant = await manager.findOne(TripParticipant, {
      where: { tripId: trip.id, userId },
    });
    if (!participant || participant.status === 'declined') return new Set();

    /**
     * Соорганизатор правит всё то же, что организатор (20.11.2026).
     *
     * Заказчик: «соорганизатор равен организатору во всём, отличий ровно
     * пять» ([lifecycle.md](../docs/ph/lifecycle.md) §4.5). Отличия
     * (не удаляет поход, не снимает полномочия, свой выход, не бывает
     * виртуальным, может быть `helping`/`maybe`) проверяются там, где они
     * есть, — а права вкладок у него **полные в коде**, а не в матрице
     * ролей. Иначе прод без `seed:role-tabs` оставил бы соорганизатора
     * бесправным: строка в `role_tab_permissions` — это данные, которых
     * на проде может не быть, а роль `coOrganizer` его же и назначает.
     *
     * Вышедший (`declined`) прав не имеет — как и все: он уже не в походе,
     * а роль за ним остаётся, пока организатор её не снимет, поэтому
     * вернувшись в состав (его вернут организатор или соорганизатор) он
     * получит права снова без повторного назначения.
     */
    if (await this.isCoOrganizer(manager, trip, userId)) {
      return new Set(TRIP_TABS);
    }

    const roleRows = await manager.find(TripParticipantRole, {
      where: { tripId: trip.id, userId },
    });
    if (roleRows.length === 0) return new Set();

    const permissions = await manager.find(RoleTabPermission, {
      where: { roleId: In(roleRows.map((row) => row.roleId)) },
    });

    return new Set(permissions.map((permission) => permission.tab));
  }

  /**
   * Типы похода для выбора в форме и для подписи на странице.
   *
   * Источник — **общий справочник активностей**, а не отдельная таблица:
   * тип похода и активность календаря — это одно и то же по смыслу
   * («пеший поход», «альпинизм»), и второй словарь однажды разошёлся бы
   * с первым (см. `trip-tabs.md`, решение 20.10.2026). Место сужает
   * `scope` группы: календарные группы («Спорт», «Дом») сюда не попадают,
   * а календарь не показывает «Туризм» — правило живёт в данных, а не
   * в списке кодов в коде.
   *
   * Два запроса вместо одного с `relations`: типов в группе единицы,
   * и плоский список — это ровно то, что нужно и чипсам, и подписи;
   * вложенность «группа → типы» пришлось бы разворачивать на клиенте.
   *
   * Авторизация — как у всего модуля (глобальный `JwtAuthGuard`): это
   * справочник, но и он не должен отдаваться анонимам — иначе форма
   * оказалась бы единственным открытым местом API.
   */
  async listTypes(): Promise<TripTypeListDto> {
    const groups = await this.dataSource.manager.find(CalendarActivityGroup, {
      where: { isActive: true, scope: In(['trips', 'both']) },
      order: { id: 'ASC' },
    });

    // Пустой `In([])` — это заведомо ложное условие в SQL; без раннего
    // выхода TypeORM сгенерировал бы `IN ()` и запрос упал бы.
    if (groups.length === 0) return { types: [], defaultTypeId: null };

    const types = await this.dataSource.manager.find(CalendarActivityType, {
      where: { isActive: true, groupId: In(groups.map((group) => group.id)) },
      order: { id: 'ASC' },
    });

    const options = types.map((type) => TripTypeOptionDto.from(type));

    return {
      types: options,
      defaultTypeId:
        options.find((option) => option.code === DEFAULT_TRIP_TYPE_CODE)?.id ??
        null,
    };
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
        'Среди активностей есть несуществующие — проверь идентификаторы',
      );
    }
  }

  /**
   * Разложить типы похода из связки по сущностям — и одним запросом.
   *
   * `Trip.activityTypeIds` в базе не хранится (типы живут в `trip_types`),
   * и это единственное место, где поле наполняется. Отдельный метод —
   * потому что мест, откуда поход уходит наружу, несколько (`list`,
   * `findOne`, `update`, `cancel`/`restore`), и забыть заполнить в одном
   * из них значило бы отдать наружу пустой массив вместо типов: фронт
   * разницы с «типов нет» не увидит.
   *
   * Запрос **один на весь список**, а не по одному на поход: лента
   * двадцати карточек иначе стоила бы двадцать лишних кругов до базы.
   * `order` здесь не про сортировку ленты: `tripId` первым — чтобы строки
   * одного похода шли подряд, `activityTypeId` — чтобы массив в ответе
   * не менял порядок от прогона к прогону.
   */
  private async fillTypes(
    manager: EntityManager,
    trips: Trip[],
  ): Promise<void> {
    if (trips.length === 0) return;

    const rows = await manager.find(TripType, {
      where: { tripId: In(trips.map((trip) => trip.id)) },
      order: { tripId: 'ASC', activityTypeId: 'ASC' },
    });

    const byTrip = new Map<string, number[]>();
    for (const row of rows) {
      const list = byTrip.get(row.tripId) ?? [];
      list.push(row.activityTypeId);
      byTrip.set(row.tripId, list);
    }

    for (const trip of trips) {
      trip.activityTypeIds = byTrip.get(trip.id) ?? [];
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

  /**
   * Даты похода сдвинулись — ночи идут за ними (19.11.2026).
   *
   * Заказчик 19.11.2026: «в свойствах похода меняю даты, „Ночёвки“ вообще
   * не реагируют». Причина была не в SSE: записанная ночь хранила дату
   * навсегда, поэтому таблица показывала прежние числа даже после
   * перезагрузки. Здесь ночи перенумеровываются от нового начала: дата
   * меняется по номеру, лишние в конце удаляются, недостающие добавляются
   * пустыми. Место, вариант и готовка у оставшихся ночей сохраняются —
   * теряется только то, что оказалось за концом похода.
   *
   * Даты считаются по UTC, как `dayDistance` и `night_date`: дата похода
   * приходит полуночью UTC, и смена часового пояса сервера таблицу
   * не двигает. Дат нет (или конец раньше начала — это отбивает
   * `assertDates`) — ночи не трогаем.
   */
  private async syncRouteNightDates(
    manager: EntityManager,
    tripId: string,
    startsAt: Date | null,
    endsAt: Date | null,
  ): Promise<void> {
    if (startsAt === null || endsAt === null) return;

    const total = dayDistance(startsAt, endsAt);
    if (total < 1) return;

    const nights = await manager.find(TripRouteNight, {
      where: { tripId },
      order: { position: 'ASC', id: 'ASC' },
    });

    // Пустая таблица рисуется по датам на клиенте — записывать её незачем.
    if (nights.length === 0) return;

    const byPosition = new Map(nights.map((night) => [night.position, night]));
    const start = Date.UTC(
      startsAt.getUTCFullYear(),
      startsAt.getUTCMonth(),
      startsAt.getUTCDate(),
    );

    for (let position = 1; position <= total; position += 1) {
      const date = new Date(start + (position - 1) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const night = byPosition.get(position);

      if (night === undefined) {
        await manager.insert(TripRouteNight, {
          tripId,
          position,
          nightDate: date,
        });
      } else if (night.nightDate !== date) {
        await manager.update(TripRouteNight, { id: night.id }, { nightDate: date });
      }
    }

    for (const night of nights) {
      if (night.position > total) {
        await manager.delete(TripRouteNight, { id: night.id });
      }
    }
  }

  /**
   * Даты похода сдвинулись — рейсы «Трансфера» идут за ними (19.11.2026).
   *
   * Заказчик: «Трансфер не реагирует на изменения дат ровно как Ночёвки до
   * правок». У рейса одно время — `departs_at`, абсолютный момент, и от дат
   * похода он не пересчитывался: сдвинули поход на четыре дня — все рейсы
   * остались на прежних числах, то есть вне похода. Хуже того, после этого
   * их не даёт поправить `assertWithinTrip`: «рейс раньше начала похода».
   *
   * Сдвигаем **все** рейсы похода на ту же разницу календарных дней, на
   * которую уехало начало. Часы не трогаем: автобус в шесть утра остаётся
   * автобусом в шесть утра, а не переезжает вместе со временем старта
   * (`dayDistance` считает дни, как у ночей). Рейсы не удаляем, даже если
   * новый конец похода стал раньше: у рейса пассажиры, места и деньги,
   * и молча стереть его значит стереть чужую работу — это отдельное решение
   * заказчика, а не побочный эффект правки дат.
   *
   * Дат нет (или начало не менялось) — рейсы не трогаем.
   */
  private async syncTransferLegDates(
    manager: EntityManager,
    tripId: string,
    previousStartsAt: Date | null,
    startsAt: Date | null,
  ): Promise<void> {
    if (previousStartsAt === null || startsAt === null) return;

    const shiftDays = dayDistance(previousStartsAt, startsAt);
    if (shiftDays === 0) return;

    // Один `UPDATE` на все рейсы: их у похода единицы, и построчный проход
    // здесь только ради того, чтобы у каждого рейса была своя ошибка.
    await manager
      .createQueryBuilder()
      .update(TripTransferLeg)
      .set({
        departsAt: () => `"departs_at" + ${shiftDays} * interval '1 day'`,
      })
      .where('"trip_id" = :tripId', { tripId })
      .execute();
  }

  /** `null` и `undefined` — «даты нет»; строка — момент времени. */
  private toDate(value: string | null | undefined): Date | null {
    return value ? new Date(value) : null;
  }

  /**
   * Поход по id вместе с целью — для действий **автора похода**.
   *
   * Проверка здесь же: правило одно на все изменяющие операции, и держать
   * его в каждой по копии — способ однажды забыть. Постороннему публичный
   * поход виден, но менять его нельзя, поэтому здесь именно **403, а не
   * 404**: скрывать нечего, поход и так открыт.
   *
   * **Кто сюда ходит (20.11.2026).** Только те действия, которые за
   * соорганизатором не идут: завершение похода — решение автора
   * ([lifecycle.md](../docs/ph/lifecycle.md) §4.4) и удаление похода, если
   * оно появится. Всё остальное — правка шапки и дат, отмена, состав —
   * ходит в `findManagedTrip`: соорганизатор равен организатору во всём,
   * кроме пяти отличий (§4.5).
   */
  private async findOwnedTrip(
    manager: EntityManager,
    userId: string,
    id: number,
  ): Promise<Trip> {
    const trip = await this.loadTripForChange(manager, id);

    if (trip.organizerUserId !== userId) {
      throw new ForbiddenException(
        'Это решение автора похода: его принимает только организатор',
      );
    }

    return trip;
  }

  /**
   * Поход по id вместе с целью — для действий организатора **и
   * соорганизатора** (20.11.2026).
   *
   * Заказчик: «все проверки „только организатор“ переводятся на
   * „организатор или соорганизатор“» ([lifecycle.md](../docs/ph/lifecycle.md)
   * §4.5). Права вкладок для соорганизатора считает `tabsByRole` в коде,
   * а не матрица ролей, — поэтому и здесь проверка идёт по роли, а не по
   * `role_tab_permissions`: на проде без `seed:role-tabs` матрицы может
   * не быть, а организатор похода быть не перестаёт.
   */
  private async findManagedTrip(
    manager: EntityManager,
    userId: string,
    id: number,
  ): Promise<Trip> {
    const trip = await this.loadTripForChange(manager, id);

    if (!(await this.isOrganizerOrCoOrganizer(manager, trip, userId))) {
      throw new ForbiddenException(
        'Менять поход может организатор или соорганизатор',
      );
    }

    return trip;
  }

  /** Поход с целью или 404 — общая часть двух проверок выше. */
  private async loadTripForChange(
    manager: EntityManager,
    id: number,
  ): Promise<Trip> {
    const trip = await manager.findOne(Trip, {
      where: { id: String(id) },
      relations: { goalObject: true },
    });

    if (!trip) {
      throw new NotFoundException('Поход не найден');
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
        `(trip.visibility = 'public'
          OR trip.organizer_user_id = :userId
          OR EXISTS (
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

    /**
     * Тип похода — через связку, а не по массиву, как было. `EXISTS`
     * укладывается в `IDX_trip_types_activity`: «есть ли у похода этот
     * тип» решается индексным поиском, а не перебором массива у каждой
     * строки ленты.
     */
    if (query.activityTypeId !== undefined) {
      qb.andWhere(
        `EXISTS (
           SELECT 1 FROM trip_types tt
            WHERE tt.trip_id = trip.id AND tt.activity_type_id = :activityTypeId
         )`,
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
      // «Мои» — где я организатор или участник. Организатор важен отдельно:
      // у мечты состава нет, и без этой ветки свои же мечты исчезли бы
      // из «Моих походов» (`tabs.md` §7).
      qb.andWhere(
        `${query.mine ? '' : 'NOT '}(
           trip.organizer_user_id = :userId
           OR EXISTS (
             SELECT 1 FROM trip_participants p
              WHERE p.trip_id = trip.id AND p.user_id = :userId
           )
         )`,
      );
    }

    if (query.when !== undefined) {
      const condition = this.whenCondition(query.when);
      qb.andWhere(condition.sql, condition.params ?? {});
    }

    /**
     * `offline` — набор походов, которые хранятся на устройстве.
     *
     * Три условия из `lifecycle.md` §2.1: поход решён (`decided`), я в нём
     * **иду** (`going`) и он ещё не закончился по плановой дате. Отменённые
     * отсечены выше, «мечты» и «планирую» не подходят по статусу, а
     * `maybe`/`helping`/`invited`/`declined` — по участию: кэш нужен тому,
     * кто в поле, а не тому, кто ещё думает.
     *
     * Конец берётся **плановый** (`ends_at`), а не фактический: слоя
     * «план/факт» больше нет (решение 16.11.2026). Поход, задержавшийся
     * в горах, из набора выпадет — но уже сохранённую копию клиент
     * не стирает без подтверждённого возвращения (`offline.md` §12).
     */
    if (query.offline === true) {
      qb.andWhere(`trip.status = 'decided'`)
        .andWhere(`(trip.ends_at IS NULL OR trip.ends_at >= now())`)
        .andWhere(
          `EXISTS (
             SELECT 1 FROM trip_participants p_going
              WHERE p_going.trip_id = trip.id
                AND p_going.user_id = :userId
                AND p_going.status = 'going'
           )`,
        );
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

    // Типы — одним запросом на всю страницу, а не по запросу на поход:
    // иначе лента из двадцати карточек стоила бы двадцать один круг до базы.
    await this.fillTypes(this.tripsRepository.manager, trips);

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
         * Начало и конец — только плановые (`starts_at` / `ends_at`): факта
         * в `trips` больше нет, его место заняли отметки присутствия
         * (миграция 96). Если конца нет, им считается начало: «поход без
         * известного конца» — это не повод показать его в любые выходные
         * до скончания века. Из этого правила следуют два разумных случая:
         * поход, начинающийся в субботу (конца нет — значит он в этих
         * выходных), и поход с пятницы по воскресенье (конец заходит
         * в окно).
         */
        return {
          sql: `trip.starts_at < :weekendEnd
            AND COALESCE(trip.ends_at, trip.starts_at) >= :weekendStart`,
          params: { weekendStart: start, weekendEnd: end },
        };
      }
      case 'upcoming':
        return {
          sql: 'trip.starts_at > now()',
        };
      case 'ongoing':
        // Поход без известного конца, но с прошедшим началом, «идёт»:
        // не знать, когда вернутся, — не то же самое, что уже вернулись.
        return {
          sql: `trip.starts_at <= now()
            AND (trip.ends_at IS NULL OR trip.ends_at >= now())`,
        };
      case 'past':
        return {
          sql: 'trip.ends_at < now()',
        };
      case 'undated':
        return {
          sql: 'trip.starts_at IS NULL',
        };
    }
  }

  /**
   * Правка похода организатором или соорганизатором (20.11.2026).
   *
   * Заказчик: «все проверки „только организатор“ переводятся на
   * „организатор или соорганизатор“: правка похода и дат…». Отличие одно:
   * удаления похода здесь нет — оно остаётся за автором (§4.5).
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
    const { response, gearChanged, depositChanged, datesChanged } =
      await this.dataSource.transaction(async (manager) => {
        const trip = await this.findManagedTrip(manager, userId, id);

        // Завершённый поход закрыт навсегда (20.11.2026): даты, шапка,
        // видимость, залог и роли в нём уже не меняются.
        assertTripOpen(trip);

        /**
         * Правила готовности (`tabs.md` §7) требуют знать, чем поход был:
         * из «Мечты» в «Планирую» достраивается состав и чаты, а обратно
         * и к «без конкретного числа» пути нет. Оба факта снимаем до правок.
         */
        const previousStatus = trip.status;
        const previousStartsAt = trip.startsAt;
        const previousEndsAt = trip.endsAt;
        /**
         * Сумма залога до правки. «Бухгалтерия» рисует блок залога по
         * `GET /finance`, и правка «Правки похода» сама по себе её не
         * обновляла: на экране оставалась прежняя сумма до перезагрузки.
         * Сравниваем здесь, чтобы событие ушло только при настоящем
         * изменении, а не на каждый `PATCH`.
         */
        const previousDepositRub = trip.depositRub;
        const previousHasConcreteDate = await this.hasConcreteDate(
          manager,
          trip,
        );

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

        this.assertPriceRules(isCommercial, priceRub, priceNote);
        this.assertDates(status, startsAt, endsAt);

        /**
         * Назад в «Мечту» нельзя: поход уже готовится, у него есть состав
         * и подготовка, а «мечта» — это вишлист без данных (`tabs.md` §7).
         */
        if (status === 'idea' && previousStatus !== 'idea') {
          throw new BadRequestException(
            'Поход уже запланирован, назад пути нет',
          );
        }

        /**
         * Конкретное число — точка невозврата: как только по нему открылись
         * закладки подготовки, убрать его нельзя. Вернуться к «без числа»
         * значит вернуть поход в состояние, из которого он вышел.
         */
        const nextVariants =
          dto.dateVariants !== undefined
            ? dto.dateVariants
            : await manager.find(TripDateVariant, { where: { tripId: trip.id } });
        const willHaveConcreteDate =
          startsAt !== null ||
          nextVariants.some((variant) => variant.day != null);

        if (previousHasConcreteDate && !willHaveConcreteDate) {
          throw new BadRequestException(
            'Конкретное число у похода уже было — вернуться к «без числа» нельзя',
          );
        }

        /**
         * Типы похода — тоже «замена целиком», как варианты дат ниже:
         * у пары нет стабильного внешнего идентификатора, и «третий тип»
         * после правки списка означал бы уже другой. Поэтому присланный
         * массив снимается и вставляется заново, а `null` — «не трогать»,
         * иначе `PATCH` без поля стирал бы типы.
         */
        const activityTypeIds =
          dto.activityTypeIds !== undefined
            ? [...new Set(dto.activityTypeIds)]
            : null;
        if (activityTypeIds !== null) {
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
        if (dto.hasGuitar !== undefined) trip.hasGuitar = dto.hasGuitar;
        if (dto.visibility !== undefined) trip.visibility = dto.visibility;
        if (dto.isRecruitmentClosed !== undefined) {
          trip.isRecruitmentClosed = dto.isRecruitmentClosed;
        }
        if (dto.openParticipation !== undefined) {
          trip.openParticipation = dto.openParticipation;
        }
        if (dto.routeText !== undefined) trip.routeText = dto.routeText;

        trip.status = status;
        trip.startsAt = startsAt;
        trip.endsAt = endsAt;
        trip.isCommercial = isCommercial;
        if (dto.isOfficial !== undefined) trip.isOfficial = dto.isOfficial;
        trip.priceRub = priceRub;
        trip.priceNote = priceNote;
        // Залог — обеспечительный платёж, а не цена: снимается `null`-ом
        // независимо от коммерции, и на балансы похода не влияет.
        if (dto.depositRub !== undefined) trip.depositRub = dto.depositRub;

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

        // Мечта становится походом: состав, роль организатора и членский чат
        // появляются здесь — до этого их не было.
        if (previousStatus === 'idea' && status !== 'idea') {
          await this.prepareTripFromIdea(manager, saved);
        }

        // Снимаем и ставим заново в той же транзакции: половина типов
        // в ответе была бы хуже прежних, а `UPDATE` на связке не выдаётся.
        if (activityTypeIds !== null) {
          await manager.delete(TripType, { tripId: saved.id });
          if (activityTypeIds.length > 0) {
            await manager.insert(
              TripType,
              activityTypeIds.map((activityTypeId) => ({
                tripId: saved.id,
                activityTypeId,
              })),
            );
          }
        }

        /**
         * Смена дат решённого похода и переход в `decided` (11.11.2026,
         * шаг 2). Заказчик: «сдвигаемый поход теряет вещь, второй
         * сохраняет», а в чаты `trip_route` и `trip_gear` уходит одно
         * сообщение со списком. Снимаем строки здесь же, в транзакции:
         * между правкой дат и уборкой вещь успела бы «поехать» в двух
         * походах.
         */
        const becameDecided =
          previousStatus !== 'decided' && status === 'decided';
        const datesChanged =
          !sameInstant(previousStartsAt, startsAt) ||
          !sameInstant(previousEndsAt, endsAt);

        // Дата ночи — производная от дат похода, а не вечная запись:
        // иначе таблица показывала бы старые числа после каждой правки.
        if (datesChanged) {
          await this.syncRouteNightDates(manager, saved.id, startsAt, endsAt);
          // Рейс «Трансфера» — тоже не вечная запись: его время едет вместе
          // с началом похода, иначе рейс остаётся вне новых дат.
          await this.syncTransferLegDates(
            manager,
            saved.id,
            previousStartsAt,
            startsAt,
          );
        }

        const conflictText =
          status === 'decided' && (becameDecided || datesChanged)
            ? conflictMessage(
                await removeConflictingGear(manager, saved),
                becameDecided ? 'decided' : 'dates',
              )
            : null;

        if (conflictText !== null) {
          // Одно сообщение в оба чата: правка одна, и два разных текста
          // в двух чатах читались бы как два события.
          await postTripSystemMessage(
            manager,
            saved.id,
            'trip_route',
            conflictText,
          );
          await postTripSystemMessage(
            manager,
            saved.id,
            'trip_gear',
            conflictText,
          );
        }

        // Читаем типы из базы, а не подставляем присланные: `PATCH` без поля
        // типов их не меняет, и ответ должен показать то, что реально лежит.
        await this.fillTypes(manager, [saved]);

        // Ответ несёт варианты: форма правки инициализирует ими черновики,
        // иначе смена готовности теряла бы продолжительность.
        const savedVariants = await manager.find(TripDateVariant, {
          where: { tripId: saved.id },
          order: { id: 'ASC' },
        });

        return {
          response: TripResponseDto.from(saved, savedVariants),
          gearChanged: conflictText !== null,
          depositChanged: previousDepositRub !== saved.depositRub,
          datesChanged,
        };
      },
    );

    // Вкладка «Снаряжение» перечитывает данные сама, без перезагрузки:
    // строки снял сервер, и человек должен увидеть это сразу.
    if (gearChanged) this.events.emitGear(String(id), userId);

    // Сумма залога живёт в шапке похода, а её блок — в «Бухгалтерии».
    // Правили в «Правке похода» — вкладка должна узнать об этом по SSE,
    // а не ждать перезагрузки.
    if (depositChanged) this.events.emitFinance(String(id), userId);

    /**
     * Смена дат двигает плашки пустой таблицы «Ночёвок» (19.11.2026):
     * записанные ночи хранят свои даты и правку переживают, а у похода
     * без таблицы ночи считаются от `starts_at`/`ends_at`. Раньше вкладка
     * об этом не узнавала до перезагрузки.
     */
    if (datesChanged) this.events.emitRoute(String(id), userId);

    /**
     * Свойства похода для шапки страницы (19.11.2026): даты, видимость,
     * набор, залог, название. Шапка — не вкладка, своего потока у неё нет,
     * и без этого события подписи на других вкладках оставались прежними
     * до перезахода в поход.
     */
    this.events.emitTrip(String(id), userId);

    return response;
  }

  /**
   * Завершить поход — решением автора (20.11.2026).
   *
   * Заказчик: «Поход заканчивается решением автора, а не по дате». Условия
   * сервер проверяет сам, а не верит кнопке: `ends_at` прошёл, все идущие
   * отметили «вернулся», спрашивает и завершает только автор. Вопрос
   * «Поход состоялся?» приходит при входе, а эта ручка — его ответ «Да»
   * и кнопка «Завершить поход» после «Ещё остались правки».
   *
   * **Завершение необратимо** (заказчик: «отменить завершение нельзя»),
   * поэтому повтор — не «уже так», а 409: молчаливое «ладно» скрыло бы
   * от человека, что он давит на кнопку, которой больше нет.
   *
   * **Почему `completed_at`, а не `status`.** Стадия подготовки остаётся
   * `decided`: завершённый поход — не другая стадия, а итог этой.
   *
   * Права вкладок после завершения считает `editableTabs`: остаются
   * «Дневник» и «Бухгалтерия». Здесь их не дублируем — правило живёт
   * в одном месте, иначе разошлось бы с меню.
   */
  async complete(userId: string, id: number): Promise<TripResponseDto> {
    const response = await this.dataSource.transaction(async (manager) => {
      const trip = await this.findOwnedTrip(manager, userId, id);

      if (trip.completedAt !== null) {
        throw new ConflictException(
          'Поход уже завершён — отменить это нельзя',
        );
      }

      if (!(await this.isCompletionReady(manager, trip, userId))) {
        throw new ConflictException(
          'Завершить поход можно, когда он закончился по датам и все идущие отметили возвращение',
        );
      }

      trip.completedAt = new Date();
      const saved = await manager.save(trip);

      // Типы — не персистентное поле: без этого ответ был бы беднее,
      // чем `GET /trips/:id`, и шапка потеряла бы подписи до перезахода.
      await this.fillTypes(manager, [saved]);

      return TripResponseDto.from(saved);
    });

    // Шапка на других вкладках перечитывает поход тем же событием,
    // что и правка свойств: правки закрылись, меню и кнопки изменились.
    this.events.emitTrip(String(id), userId);

    return response;
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
    const { response, gearChanged } = await this.dataSource.transaction(
      async (manager) => {
        const trip = await this.findManagedTrip(manager, userId, id);

        // Отменять и возвращать завершённый поход нельзя: завершение
        // необратимо (20.11.2026).
        assertTripOpen(trip);

        // Типы заполняем один раз, до всех выходов: поле не персистентное,
        // `save` его не тронет, поэтому и повторная отмена, и настоящая
        // отмена отдают одинаково полный ответ.
        await this.fillTypes(manager, [trip]);

        if (cancelled && trip.status === 'idea') {
          throw new BadRequestException(
            'Идею не отменяют: у неё нет дат и договорённостей — её просто забывают',
          );
        }

        if (cancelled === (trip.cancelledAt !== null)) {
          return { response: TripResponseDto.from(trip), gearChanged: false };
        }

        trip.cancelledAt = cancelled ? new Date() : null;
        const saved = await manager.save(trip);

        /**
         * Возврат в строй (11.11.2026, шаг 2). Отменённый поход не занимает
         * снаряжение, поэтому за время отмены вещь могли взять в другой
         * решённый поход. Тогда строка этого похода снимается, как при смене
         * дат: «сдвигаемый поход теряет вещь, второй сохраняет».
         */
        const conflictText = !cancelled
          ? conflictMessage(
              await removeConflictingGear(manager, saved),
              'restore',
            )
          : null;

        if (conflictText !== null) {
          await postTripSystemMessage(
            manager,
            saved.id,
            'trip_route',
            conflictText,
          );
          await postTripSystemMessage(
            manager,
            saved.id,
            'trip_gear',
            conflictText,
          );
        }

        return {
          response: TripResponseDto.from(saved),
          gearChanged: conflictText !== null,
        };
      },
    );

    if (gearChanged) this.events.emitGear(String(id), userId);

    return response;
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

    if (trip.visibility === 'private' && trip.organizerUserId !== userId) {
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
   * тикетов живёт в чатах, поэтому у тикета нет статуса. Сама запись —
   * в `trip-participant-detach.ts`: тот же код нужен «Контактам», когда
   * удаляют человека без аккаунта из похода на стадии подготовки.
   */
  private async postSystemMessage(
    manager: EntityManager,
    tripId: string,
    kind: ChatKind,
    body: string,
  ): Promise<void> {
    return postTripSystemMessage(manager, tripId, kind, body);
  }

  /**
   * Поход, который этому человеку вообще видно, — для других доменов.
   *
   * Существует публично ровно для того, чтобы правило «приватный чужой —
   * 404» не копировалось: им пользуются чек-листы и всё, что появится
   * рядом (снаряжение, раскладка, деньги). Второй экземпляр проверки
   * означал бы, что однажды поход закроют, а соседний домен об этом
   * не узнает.
   */
  async getVisibleTrip(userId: string, id: number): Promise<Trip> {
    return this.findVisibleTrip(this.dataSource.manager, userId, id);
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
   *
   * **Смена питания пересобирает чеки с общего стола (12.11.2026).**
   * Заказчик: «поставил галочки „питаюсь отдельно“ троим после закупки
   * общих продуктов, балансы участников не изменились». Доли расхода
   * `commonEaters` — проекция состава едоков, поэтому после смены флага
   * они пересчитываются; расходы «на всех» и «на группу» не трогаются.
   * События уходят после коммита: подписчики читают базу заново и должны
   * увидеть уже сохранённое.
   */
  async updateMyStatus(
    userId: string,
    id: number,
    status: ParticipantStatus,
    eatsSeparately?: boolean,
  ): Promise<TripParticipantDto> {
    const result = await this.dataSource.transaction(async (manager) => {
      const trip = await this.findVisibleTrip(manager, userId, id);

      const participant = await manager.findOne(TripParticipant, {
        where: { tripId: trip.id, userId },
        relations: { user: true },
      });
      if (!participant) {
        throw new NotFoundException('Ты не в составе этого похода');
      }

      // После завершения состав — история: свой статус не меняется
      // (20.11.2026). Присутствие — можно, оно отдельной ручкой.
      assertTripOpen(trip);

      /**
       * Организатор может быть `declined` (17.11.2026).
       *
       * Решение 16.11.2026 «организатор — автор похода, значит идёт»
       * отменено заказчиком: «организатор может быть инвалидом лежачим,
       * организовывать людей и не ходить в действительности». Авторство
       * похода и факт участия — разные вещи, и статус `declined` его
       * не отменяет.
       */
      const statusChanged = participant.status !== status;
      const dietChanged =
        eatsSeparately !== undefined &&
        participant.eatsSeparately !== eatsSeparately;

      /**
       * После старта сам человек в «иду» не переводится (20.11.2026).
       *
       * Заказчик: «сам человек после старта в `going` не переводится — это
       * делают только организатор или соорганизатор». До старта всё как
       * раньше: приглашённый и «пока не решил» отвечают сами. Дверь
       * закрывается здесь, на сервере: кнопка — не защита.
       */
      const becameGoing = statusChanged && status === 'going';

      if (becameGoing) {
        await this.assertCanBecomeGoing(manager, trip, userId);
      }

      if (dietChanged) {
        participant.eatsSeparately = eatsSeparately as boolean;
      }

      if (statusChanged) {
        participant.status = status;
        // Добавили или перевели в «иду» уже на маршруте — отметку ставим
        // сразу, без отдельного вопроса: человек в поле.
        if (becameGoing && hasStarted(trip)) {
          markOnRoute(participant, userId, new Date());
        }
      }

      if (statusChanged || dietChanged) {
        await manager.save(participant);
      }

      if (dietChanged) {
        await recalculateCommonEaterShares(manager, String(trip.id));
      }

      if (statusChanged) {
        await this.postSystemMessage(
          manager,
          trip.id,
          'trip_members',
          `${displayNameOf(participant.user)}: ${statusText(status)}`,
        );

        // Больше не идёт — снимаем с рейсов, и машина освобождается.
        if (status !== 'going') {
          await this.releaseTransfers(manager, trip.id, userId);
        }

        /**
         * Вышел из похода — его снаряжение больше не за ним (20.11.2026).
         *
         * Уведомление при выходе обещает: «Твоё снаряжение будет исключено
         * из снаряжения похода». Поэтому несущий освобождается (вещь
         * остаётся в походе и ждёт нового), личный раздел «Взял» у него
         * забирается, а место в палатке снимается — в поле он не едет.
         */
        if (status === 'declined') {
          await manager.update(
            TripGear,
            { tripId: trip.id, assignedUserId: userId },
            { assignedUserId: null, personalSectionId: null },
          );
          await manager.delete(TripRouteLodger, {
            tripId: trip.id,
            userId,
          });
        }
      }

      return {
        participant: TripParticipantDto.from(
          participant,
          await this.loadRoles(manager, trip.id, userId),
          trip.organizerUserId,
        ),
        dietChanged,
        statusChanged,
        left: statusChanged && status === 'declined',
      };
    });

    if (result.dietChanged) {
      this.events.emitMeals(String(id), userId);
      this.events.emitFinance(String(id), userId);
    }
    if (result.statusChanged) {
      // Состав едоков и состав балансов меняются вместе с участием.
      this.events.emitMeals(String(id), userId);
      this.events.emitFinance(String(id), userId);
    }
    if (result.left) {
      // Вещи освободились, места в палатках снялись — обе вкладки читают
      // данные заново, иначе список показывал бы человека, которого нет.
      this.events.emitGear(String(id), userId);
      this.events.emitRoute(String(id), userId);
    }

    return result.participant;
  }

  /**
   * Перевести участника в «иду» — организатору или соорганизатору (20.11.2026).
   *
   * Зачем отдельная ручка: после старта человек **сам** в `going` не
   * переходит (см. `assertCanBecomeGoing`), а «в пути как раз многое
   * вспоминается»: тот, кто был `maybe` или вышел, может догнать группу.
   * Заказчик: «перевод из maybe/declined в going — только организатор или
   * соорганизатор», и оба случая сразу дают «на маршруте».
   *
   * Почему только `going`: ручка — не замена `updateMyStatus`, а одна
   * дверь. Уйти из похода человек по-прежнему может сам (поздний отказ),
   * «пока не решил» ставит себе сам, а `invited` — вообще состояние тикета:
   * его закрывают ответом на приглашение или отказом, а не правкой статуса.
   *
   * Позднее присоединение не даёт долгов за прошлые закупки: доли прежних
   * чеков не пересобираются, человек просто появляется в составе (решение
   * 16.11.2026, §4.2).
   */
  async setParticipantStatus(
    userId: string,
    id: number,
    targetUserId: string,
    status: ParticipantStatus,
  ): Promise<TripParticipantDto> {
    const result = await this.dataSource.transaction(async (manager) => {
      const trip = await this.findVisibleTrip(manager, userId, id);

      if (!(await this.isOrganizerOrCoOrganizer(manager, trip, userId))) {
        throw new ForbiddenException(
          'Перевести человека в «иду» может организатор или соорганизатор',
        );
      }

      assertTripOpen(trip);

      const participant = await manager.findOne(TripParticipant, {
        where: { tripId: trip.id, userId: targetUserId },
        relations: { user: true },
      });
      if (!participant) {
        throw new NotFoundException('Такого участника нет в походе');
      }
      if (status !== 'going') {
        throw new BadRequestException(
          'Здесь можно только перевести человека в «иду»',
        );
      }
      if (participant.status === 'going') {
        throw new ConflictException('Этот человек уже идёт в походе');
      }
      if (participant.status === 'invited') {
        throw new ConflictException(
          'Человек ещё не ответил на приглашение: пусть ответит сам или закрой приглашение',
        );
      }

      participant.status = 'going';
      if (hasStarted(trip)) {
        markOnRoute(participant, userId, new Date());
      }
      await manager.save(participant);

      await this.postSystemMessage(
        manager,
        trip.id,
        'trip_members',
        `${displayNameOf(participant.user)}: ${statusText('going')}`,
      );

      return TripParticipantDto.from(
        participant,
        await this.loadRoles(manager, trip.id, targetUserId),
        trip.organizerUserId,
      );
    });

    // Состав едоков и балансов меняется вместе с участием — обе вкладки
    // должны прочитать данные заново.
    this.events.emitMeals(String(id), userId);
    this.events.emitFinance(String(id), userId);

    return result;
  }

  /**
   * Отметка присутствия: «на маршруте», «вернулся» или снять отметки.
   *
   * **Отмечает любой идущий** — себе и любому другому участнику, включая
   * человека без аккаунта (решение 16.11.2026: «они теперь в одной лодке»).
   * Организатор и соорганизатор отдельных прав здесь не имеют: в поле все
   * равны, а присутствие нужно от тех, кто идёт.
   *
   * **Отметка прихода — за любого, возвращение — только своё.** С 17.11.2026
   * «вернулся» за другого живого участника сервер не принимает: возвращение
   * человек отмечает сам, а за человека без аккаунта — тот, кто его ведёт
   * (у того нет входа). Приход по-прежнему отмечают за любого: телефон
   * мог остаться дома, а группа на старте видит всех.
   *
   * **Цель — любой участник, кроме `declined`.** Вышел из похода — залога
   * с него нет и отметки тоже; `maybe` и `invited` отметить можно: человек
   * мог выйти на маршрут, не ответив в приложении.
   *
   * **Отметка не меняет даты похода.** Это перекличка, а не факт: поход
   * живёт по плановым датам, присутствие показывает реальность. «Вернулся»
   * при идущем походе — норма, а не ошибка.
   *
   * Время ставит сервер: часы устройства в горах врут, а вопрос «когда
   * отметил» задаётся уже после возвращения. Повторная отметка «на маршруте»
   * не переписывает первый выход, если он уже был, — иначе «день 3» стал бы
   * «днём 1» после случайного нажатия.
   */
  async setPresence(
    userId: string,
    id: number,
    targetUserId: string,
    action: PresenceAction,
  ): Promise<TripParticipantDto> {
    return this.dataSource.transaction(async (manager) => {
      const trip = await this.findVisibleTrip(manager, userId, id);

      const actor = await manager.findOne(TripParticipant, {
        where: { tripId: trip.id, userId },
      });
      if (!actor || actor.status !== 'going') {
        throw new ForbiddenException(
          'Отмечать присутствие может только идущий участник',
        );
      }

      const target = await manager.findOne(TripParticipant, {
        where: { tripId: trip.id, userId: targetUserId },
        relations: { user: true },
      });
      if (!target) {
        throw new NotFoundException('Такого участника нет в походе');
      }
      if (target.status === 'declined') {
        throw new BadRequestException(
          'Этот человек вышел из похода — отметить присутствие нельзя',
        );
      }

      /**
       * «Вернулся» за другого живого участника не ставим (17.11.2026).
       *
       * Заказчик: «уберём возможность отмечать возвращение за других живых
       * участников. Отметку прихода других участников оставим». Приход
       * группа видит и может отметить за того, кто забыл телефон; возвращение
       * человек отмечает сам, уже дома. За человека без аккаунта отметку
       * ставит тот, кто его ведёт: своего входа у него нет.
       */
      if (
        action === 'returned' &&
        targetUserId !== userId &&
        target.user?.isVirtual !== true
      ) {
        throw new BadRequestException(
          'Вернулся участник отмечает сам; за человека без аккаунта это делает участник похода',
        );
      }

      const now = new Date();

      if (action === 'route') {
        target.startedAt = target.startedAt ?? now;
        target.returnedAt = null;
      } else if (action === 'returned') {
        // Вернуться, не выходя, нельзя: CHECK в базе держит то же правило,
        // а здесь оно объясняется человеку текстом, а не 500-й.
        target.startedAt = target.startedAt ?? now;
        target.returnedAt = now;
      } else {
        target.startedAt = null;
        target.returnedAt = null;
      }

      if (action === 'none') {
        target.presenceUpdatedBy = null;
        target.presenceSource = null;
      } else {
        target.presenceUpdatedBy = userId;
        target.presenceSource = userId === targetUserId ? 'self' : 'other';
      }

      await manager.save(target);

      return TripParticipantDto.from(
        target,
        await this.loadRoles(manager, trip.id, targetUserId),
        trip.organizerUserId,
      );
    });
  }

  /**
   * Питание человека без аккаунта: «отдельно» и «вегетарианец».
   *
   * **Почему отдельная ручка, а не `PATCH …/participants/me`.** Свой статус
   * человек меняет сам, но у виртуального входа нет — за него это делает
   * тот, кто его ведёт. Ограничение «только организатор» снято 12.11.2026
   * по слову заказчика: завести и вести человека без аккаунта может любой
   * идущий участник.
   *
   * Менять можно только виртуального: настоящий участник отмечает своё
   * питание сам, и чужая галочка не должна менять чужую раскладку.
   */
  async updateParticipantDiet(
    userId: string,
    id: number,
    targetUserId: string,
    dto: UpdateParticipantDietDto,
  ): Promise<TripParticipantDto> {
    const result = await this.dataSource.transaction(async (manager) => {
      const trip = await this.findVisibleTrip(manager, userId, id);
      await this.assertCanTendVirtuals(manager, trip, userId);

      const participant = await manager.findOne(TripParticipant, {
        where: { tripId: trip.id, userId: targetUserId },
        relations: { user: true },
      });
      if (!participant || !participant.user) {
        throw new NotFoundException('Такого участника нет в походе');
      }
      if (!participant.user.isVirtual) {
        throw new BadRequestException(
          'Питание участника с аккаунтом он отмечает сам',
        );
      }

      const dietChanged =
        dto.eatsSeparately !== undefined &&
        participant.eatsSeparately !== dto.eatsSeparately;
      const vegetarianChanged =
        dto.isVegetarian !== undefined &&
        participant.user.isVegetarian !== dto.isVegetarian;

      if (dietChanged) {
        participant.eatsSeparately = dto.eatsSeparately as boolean;
        await manager.save(participant);
        // Едок вышел из общего котла — чеки с общего стола пересобираются
        // на оставшихся (12.11.2026, см. `updateMyStatus`).
        await recalculateCommonEaterShares(manager, String(trip.id));
      }
      if (vegetarianChanged) {
        participant.user.isVegetarian = dto.isVegetarian as boolean;
        await manager.save(participant.user);
      }

      return {
        participant: TripParticipantDto.from(
          participant,
          await this.loadRoles(manager, trip.id, targetUserId),
          trip.organizerUserId,
        ),
        dietChanged,
        vegetarianChanged,
      };
    });

    if (result.dietChanged) {
      this.events.emitMeals(String(id), userId);
      this.events.emitFinance(String(id), userId);
    }
    if (result.vegetarianChanged) {
      // Вегетарианец меняет «надо» в раскладке и чек-листе.
      this.events.emitMeals(String(id), userId);
    }

    return result.participant;
  }

  /**
   * Убрать человека из состава. Организатор или соорганизатор.
   *
   * Организатора убрать нельзя: он автор похода, и даже триггер в базе
   * это запрещает. Если поход не состоится — его отменяют, а не разбирают
   * по частям.
   *
   * **Соорганизатор у другого соорганизатора — 403 (20.11.2026).**
   * Заказчик: «полномочия снимает только организатор; соорганизатор —
   * ни с себя, ни с другого». Убрать второго соорганизатора из состава —
   * это и есть снять с него полномочия, только другим способом: роль
   * живёт на участии и уходит вместе с ним. Поэтому дверь закрыта здесь,
   * а не только в `setParticipantRoles`.
   *
   * Тикет удаляется вместе с участием: приглашённый в составе **и** имеет
   * тикет, поэтому «убрать из состава» без удаления тикета оставило бы
   * висящее приглашение человеку, которого уже убрали.
   */
  async removeParticipant(
    actorUserId: string,
    id: number,
    targetUserId: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const trip = await this.findManagedTrip(manager, actorUserId, id);

      if (targetUserId === trip.organizerUserId) {
        throw new BadRequestException(
          'Организатора нельзя убрать из состава: он автор похода. Если поход не состоится — отмени его',
        );
      }

      if (
        trip.organizerUserId !== actorUserId &&
        (await this.isCoOrganizer(manager, trip, targetUserId))
      ) {
        throw new ForbiddenException(
          'Снять полномочия соорганизатора может только организатор похода',
        );
      }

      const participant = await manager.findOne(TripParticipant, {
        where: { tripId: trip.id, userId: targetUserId },
        relations: { user: true },
      });
      if (!participant) {
        throw new NotFoundException('Такого участника в походе нет');
      }

      // Уборка — в общем помощнике (`trip-participant-detach.ts`): тем же
      // путём удаляют человека без аккаунта из «Контактов», и второй
      // экземпляр этой логики однажды разошёлся бы с первым.
      await detachTripParticipant(
        manager,
        trip.id,
        targetUserId,
        displayNameOf(participant.user),
      );
    });
  }

  /**
   * Завести человека без аккаунта и сразу добавить его в поход (30.10.2026).
   *
   * Заказчик: «организаторам доступно добавление виртуальных участников —
   * людей, не пользователей нашего сайта, он сам управляет ими». С
   * 12.11.2026 ограничение снято: «должен быть любой участник», поэтому
   * заводит и ведёт его любой идущий (организатор — всегда).
   * Статус — сразу `going`: приглашать виртуального некуда, входа
   * у него нет, и «приглашён» он не ответит никогда.
   *
   * Человек и участие создаются **одной транзакцией**: «завёл, но в состав
   * не попал» — это строка `users`, которой никто не видит, а починить её
   * нечем.
   *
   * Ролей у нового участника нет, но получить их он может: роли — про
   * задачи, и запрещать «завхозу Дяде Вите» быть завхозом незачем
   * (решение заказчика 31.10.2026: «может, но по факту это только для
   * информации другим участникам, все действия совершает организатор»).
   */
  async createVirtualParticipant(
    userId: string,
    id: number,
    dto: CreateVirtualUserDto,
  ): Promise<TripParticipantDto> {
    return this.dataSource.transaction(async (manager) => {
      const trip = await this.findVisibleTrip(manager, userId, id);
      this.assertNotIdea(trip);
      await this.assertCanManageParticipants(manager, trip, userId);

      const user = await this.users.createVirtual(userId, dto, manager);

      const created = manager.create(TripParticipant, {
        tripId: trip.id,
        userId: user.id,
        status: 'going' as ParticipantStatus,
      });
      // Человека добавили уже на маршруте — отметка ставится сразу, без
      // отдельного вопроса (20.11.2026).
      if (hasStarted(trip)) markOnRoute(created, userId, new Date());

      const participant = await manager.save(created);
      participant.user = user;

      await this.postSystemMessage(
        manager,
        trip.id,
        'trip_members',
        `${user.displayName} без аккаунта`,
      );

      return TripParticipantDto.from(participant, [], trip.organizerUserId);
    });
  }

  /**
   * Добавить в этот поход **своего** человека без аккаунта.
   *
   * «Своего» — заведённого этим участником: чужой для него не существует
   * (404, как чужой предмет каталога). Так работает обещанное заказчиком
   * «быстрое добавление в следующий поход»: одна строка `users` на человека,
   * и в новый поход он приходит той же строкой, а не копией. С 12.11.2026
   * в поход его так же добавляет любой идущий участник — свой, а не чужой.
   *
   * Уже в составе — 409, а не молчаливое «ну и хорошо»: повторное нажатие
   * не должно выглядеть как добавление.
   */
  async addVirtualParticipant(
    userId: string,
    id: number,
    targetUserId: string,
  ): Promise<TripParticipantDto> {
    return this.dataSource.transaction(async (manager) => {
      const trip = await this.findVisibleTrip(manager, userId, id);
      this.assertNotIdea(trip);
      await this.assertCanManageParticipants(manager, trip, userId);

      const user = await this.users.findOwnedVirtual(
        userId,
        targetUserId,
        manager,
      );

      const existing = await manager.findOne(TripParticipant, {
        where: { tripId: trip.id, userId: user.id },
      });
      if (existing) {
        throw new ConflictException(
          'Этот человек уже в составе похода',
        );
      }

      const created = manager.create(TripParticipant, {
        tripId: trip.id,
        userId: user.id,
        status: 'going' as ParticipantStatus,
      });
      // Добавили после старта — человек уже в поле, отметка сразу.
      if (hasStarted(trip)) markOnRoute(created, userId, new Date());

      const participant = await manager.save(created);
      participant.user = user;

      await this.postSystemMessage(
        manager,
        trip.id,
        'trip_members',
        `${user.displayName} без аккаунта`,
      );

      return TripParticipantDto.from(participant, [], trip.organizerUserId);
    });
  }

  /**
   * Кто приводит своих людей в поход: приглашает и заводит без аккаунта.
   *
   * Организатор — всегда (даже если сам не идёт: он ведёт подготовку).
   * Идущий участник — только пока у похода включено открытое участие
   * (`open_participation`, по умолчанию да). Это правило 13.11.2026:
   * заказчик попросил чек-бокс «Открытое участие. Участники могут
   * приглашать своих», а прежнее расширение 12.11.2026 («любой участник»
   * для людей без аккаунта) стало его частным случаем.
   *
   * Приглашённый не считается: он ещё не участник, и распоряжаться
   * составом ему рано.
   */
  private async canBringPeople(
    manager: EntityManager,
    trip: Trip,
    userId: string,
  ): Promise<boolean> {
    /**
     * Организатор и соорганизатор приводят людей всегда (20.11.2026):
     * заказчик перевёл «только организатор» на «организатор или
     * соорганизатор» — приглашения и набор в их числе. Раньше соорганизатор
     * попадал сюда только после старта, и до старта с выключенным открытым
     * участием он не мог позвать никого, хотя поход ведёт наравне.
     */
    if (await this.isOrganizerOrCoOrganizer(manager, trip, userId)) return true;

    // После старта — только роли: открытое участие закрыто, добирают
    // состав организатор и соорганизатор (20.11.2026).
    if (hasStarted(trip)) return false;

    // Поле есть у любого похода из базы; `undefined` — объект, собранный
    // в тесте или вызовом без полного набора колонок, и умолчание у него
    // то же, что в базе.
    if (trip.openParticipation === false) return false;

    const participant = await manager.findOne(TripParticipant, {
      where: { tripId: trip.id, userId },
    });
    return participant?.status === 'going';
  }

  private async assertCanManageParticipants(
    manager: EntityManager,
    trip: Trip,
    userId: string,
  ): Promise<void> {
    // Завершённый поход — история: состав в нём больше не меняется
    // (20.11.2026), даже автору.
    assertTripOpen(trip);

    if (await this.canBringPeople(manager, trip, userId)) return;

    throw new ForbiddenException(
      trip.openParticipation === false
        ? 'Открытое участие выключено: людей без аккаунта заводят организатор и соорганизатор'
        : 'Людей без аккаунта ведёт участник похода',
    );
  }

  /**
   * Организатор или соорганизатор: двери, открытые только им.
   *
   * Организатор — всегда, и это правило кода, а не строка матрицы прав.
   * Соорганизатор — по роли `coOrganizer`, пока он в составе: он равен
   * организатору (решения 16.11.2026 п. 11 и 20.11.2026,
   * [lifecycle.md](../docs/ph/lifecycle.md) §4.5).
   *
   * **Метод публичный** (20.11.2026): то же правило нужно «Снаряжению» —
   * вещь человеку без аккаунта добавляет не только автор похода. Держать
   * вторую копию проверки в другом сервисе значило бы однажды разойтись
   * с этой.
   */
  async isOrganizerOrCoOrganizer(
    manager: EntityManager,
    trip: Trip,
    userId: string,
  ): Promise<boolean> {
    if (trip.organizerUserId === userId) return true;
    return this.isCoOrganizer(manager, trip, userId);
  }

  private async isCoOrganizer(
    manager: EntityManager,
    trip: Trip,
    userId: string,
  ): Promise<boolean> {
    const role = await manager.findOne(Role, {
      where: { code: COORGANIZER_ROLE_CODE },
    });
    if (role === null) return false;

    const row = await manager.findOne(TripParticipantRole, {
      where: { tripId: trip.id, userId, roleId: role.id },
    });
    return row !== null;
  }

  /**
   * Можно ли этому человеку стать «иду» после старта похода (20.11.2026).
   *
   * До старта — можно всем: это обычный ответ на приглашение. После старта
   * состав добирают только организатор и соорганизатор, иначе вышедший
   * «не иду» вернул бы себя в поход сам, а посторонний приписался бы
   * к группе, которая уже в поле.
   */
  private async assertCanBecomeGoing(
    manager: EntityManager,
    trip: Trip,
    actorUserId: string,
  ): Promise<void> {
    assertTripOpen(trip);

    if (!hasStarted(trip)) return;
    if (await this.isOrganizerOrCoOrganizer(manager, trip, actorUserId)) return;

    throw new ConflictException(
      'Поход уже начался: в «иду» переводит организатор или соорганизатор',
    );
  }

  /**
   * Кто ведёт **уже заведённого** человека без аккаунта: галочки питания.
   *
   * Здесь открытое участие ни при чём: флаг отвечает за то, кого приводят
   * в поход, а не за то, кто отмечает «питается отдельно» человеку, который
   * в составе уже есть. Правило прежнее (12.11.2026): организатор или любой
   * идущий участник; соорганизатор — всегда, даже если сам он `helping`
   * или `maybe` (20.11.2026): роль не зависит от того, идёт он сам.
   */
  private async assertCanTendVirtuals(
    manager: EntityManager,
    trip: Trip,
    userId: string,
  ): Promise<void> {
    assertTripOpen(trip);

    if (await this.isOrganizerOrCoOrganizer(manager, trip, userId)) return;

    const participant = await manager.findOne(TripParticipant, {
      where: { tripId: trip.id, userId },
    });
    if (!participant || participant.status !== 'going') {
      throw new ForbiddenException('Людей без аккаунта ведёт участник похода');
    }
  }

  /**
   * Право пригласить человека. То же правило, другая подсказка: человек
   * нажал «Пригласить», и «людей без аккаунта ведёт участник» ему ничего
   * не объяснит.
   */
  private async assertCanInvite(
    manager: EntityManager,
    trip: Trip,
    userId: string,
  ): Promise<void> {
    assertTripOpen(trip);

    if (await this.canBringPeople(manager, trip, userId)) return;

    if (hasStarted(trip)) {
      throw new ForbiddenException(
        'Поход уже начался: приглашать может организатор или соорганизатор',
      );
    }

    throw new ForbiddenException(
      trip.openParticipation === false
        ? 'Открытое участие выключено: приглашает организатор'
        : 'Приглашать может участник похода',
    );
  }

  /**
   * У мечты состава нет: у неё даже гостевой чат один. Виртуальный
   * участник — часть подготовки, а подготовка начинается с настоящего
   * похода (та же граница, что у вкладок).
   */
  private assertNotIdea(trip: Trip): void {
    if (trip.status === 'idea') {
      throw new BadRequestException(
        'У мечты нет состава: человека без аккаунта заводят в настоящем походе',
      );
    }
  }

  /**
   * Снять человека с рейсов похода.
   *
   * Заказчик 28.10.2026: «сменили готовность со 100% — выпиливаются
   * с трансфера, вместе с личным авто. Снимаем с рейсов, машина
   * освобождается». Поэтому:
   *
   * - его строки-пассажиры уходят из всех рейсов — «принятый пассажир»,
   *   который в поход не идёт, это ложь в списке мест;
   * - его собственные рейсы («наше ТС») удаляются целиком: машина не едет,
   *   а ссылка на неё в походе держала бы каталог занятым. Пассажиры его
   *   машины после этого снова видны в «Не распределены» — их надо
   *   рассаживать заново, и это видно.
   *
   * Вернулся в состав — ничего восстанавливать не нужно: он просто
   * появляется среди нераспределённых.
   */
  private async releaseTransfers(
    manager: EntityManager,
    tripId: string,
    userId: string,
  ): Promise<void> {
    return releaseTripTransfers(manager, tripId, userId);
  }

  /**
   * Тикеты похода.
   *
   * Организатор видит все — ему их и обрабатывать. Остальные видят **свои**:
   * тот, кого пригласили (или кто подал заявку), и тот, **кто завёл тикет**.
   * Второе появилось 13.11.2026 вместе с открытым участием: пригласивший
   * участник должен видеть, что человек ещё не ответил, и уметь отозвать
   * приглашение. Чужие заявки по-прежнему не показываются: заявка человека
   * к организатору других не касается.
   */
  async listRequests(userId: string, id: number): Promise<TripRequestListDto> {
    const manager = this.dataSource.manager;
    const trip = await this.findVisibleTrip(manager, userId, id);
    // Заявки решает организатор и, с 20.11.2026, соорганизатор: после
    // старта состав добирают они вдвоём, значит и тикеты видят оба.
    const isOrganizer = await this.isOrganizerOrCoOrganizer(
      manager,
      trip,
      userId,
    );

    const requests = await manager.find(TripMembershipRequest, {
      where: isOrganizer
        ? { tripId: trip.id }
        : [
            { tripId: trip.id, userId },
            { tripId: trip.id, createdByUserId: userId },
          ],
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
   * Приглашение создаёт организатор, а с 13.11.2026 — и любой **идущий**
   * участник, пока у похода включено открытое участие («участники могут
   * приглашать своих», решение заказчика). Оно **сразу** добавляет человека
   * в состав со статусом `invited`: приглашённый должен видеть поход, иначе
   * он не сможет решить, идти ли. Заявка участия не создаёт — сначала
   * решение организатора.
   *
   * Автор тикета пишется в `created_by_user_id`: по нему пригласивший
   * видит своё приглашение и может его отозвать, а не только организатор.
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

      // Тикеты — часть состава: после завершения их не заводят (20.11.2026).
      assertTripOpen(trip);

      if (dto.direction === 'invite') {
        await this.assertCanInvite(manager, trip, userId);
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
        // Человека без аккаунта не приглашают: приглашение ему некуда
        // приходит, а в составе он и так — сразу и со статусом `going`.
        // Без этой проверки организатор мог бы прислать id виртуального
        // руками и получить участника, который «приглашён» навсегда.
        if (invited.isVirtual) {
          throw new BadRequestException(
            'Человека без аккаунта не приглашают: его добавляют в состав сразу — «Добавить человека без аккаунта»',
          );
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
            createdByUserId: userId,
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
      /**
       * Набор закрывается на старте (20.11.2026): «Хочу с вами» после
       * начала похода не работает. Дверь для организатора и соорганизатора
       * — не здесь, а в приглашении и в одобрении заявки.
       */
      if (hasStarted(trip)) {
        throw new ConflictException(
          'Поход уже начался — заявки не принимаются; в состав добавляет организатор',
        );
      }

      await this.assertFreeOfTicketAndParticipation(manager, trip, userId);

      const request = await manager.save(
        manager.create(TripMembershipRequest, {
          tripId: trip.id,
          userId,
          direction: 'apply',
          createdByUserId: userId,
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
   * (или соорганизатор) одобряет заявку.
   *
   * Кто вправе — зависит от направления тикета, и это единственное место,
   * где направление определяет права: приглашение принимает тот, кого
   * позвали, заявку одобряет тот, кого просили. С 20.11.2026 заявку
   * одобряет и соорганизатор: после старта состав добирают они вдвоём.
   *
   * **После старта «идёт» сразу даёт «на маршруте»** (20.11.2026):
   * «оба случая сразу ставят „на маршруте“: статус плюс отметка
   * присутствия, автор — организатор». Для приглашения автор — тот, кто
   * позвал (`created_by_user_id`): человек ответил «иду», но в состав его
   * позвал организатор.
   *
   * **После `ends_at` заявку подтвердить нельзя** (20.11.2026): поход
   * закончился, состав — история. Сама заявка при этом не удаляется:
   * «висят, организатор разбирается».
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

      // Завершённый поход — история: тикетов в нём больше не разбирают
      // (20.11.2026). Присутствие ставить по-прежнему можно.
      assertTripOpen(trip);

      const isOrganizer = await this.isOrganizerOrCoOrganizer(
        manager,
        trip,
        userId,
      );
      const isTarget = targetUserId === userId;

      if (request.direction === 'invite' ? !isTarget : !isOrganizer) {
        throw new ForbiddenException(
          request.direction === 'invite'
            ? 'Принять приглашение может только тот, кого пригласили'
            : 'Одобрить заявку может только организатор или соорганизатор',
        );
      }

      if (request.direction === 'apply' && hasEnded(trip)) {
        throw new ConflictException(
          'Поход уже закончился — подтвердить заявку нельзя',
        );
      }

      const now = new Date();
      const putOnRoute = status === 'going' && hasStarted(trip, now);
      const presenceAuthor =
        request.direction === 'invite'
          ? (request.createdByUserId ?? trip.organizerUserId)
          : userId;

      const participant = await manager.findOne(TripParticipant, {
        where: { tripId: trip.id, userId: targetUserId },
      });
      if (participant) {
        participant.status = status;
        if (putOnRoute) markOnRoute(participant, presenceAuthor, now);
        await manager.save(participant);
      } else {
        const created = manager.create(TripParticipant, {
          tripId: trip.id,
          userId: targetUserId,
          status,
        });
        if (putOnRoute) markOnRoute(created, presenceAuthor, now);
        await manager.insert(TripParticipant, created);
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

      /**
       * Закрыть тикет может организатор **или соорганизатор** (20.11.2026):
       * отказ и отклонение заявки — такие же двери похода, как набор.
       */
      const isManager = await this.isOrganizerOrCoOrganizer(
        manager,
        trip,
        userId,
      );
      const isTarget = targetUserId === userId;
      /**
       * Приглашение может отозвать и тот, кто его завёл: с открытым участием
       * это не обязательно организатор (13.11.2026). Заявку «завёл» сам
       * заявитель, и для него это то же `isTarget`.
       */
      const isCreator = request.createdByUserId === userId;
      if (!isManager && !isTarget && !isCreator) {
        throw new ForbiddenException(
          'Закрыть тикет может организатор, соорганизатор, пригласивший или сам человек',
        );
      }

      // Состав завершённого похода заморожен: отозвать приглашение или
      // отказаться от него уже нельзя, заявки остались историей.
      assertTripOpen(trip);

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
          isManager || isCreator
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
        isManager ? `Заявка от ${name} отклонена` : `${name} отозвал заявку`,
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
   * Чат только для состава: членский, питания, трансфера.
   *
   * Гостевой видят все, кому виден публичный поход. Признак «только своим»
   * живёт одним списком (`PARTICIPANT_ONLY_CHAT_KINDS`), потому что правило
   * проверяется в трёх местах, и третья копия условия однажды разошлась бы
   * с первыми двумя — ровно так новый чат вкладки и открылся бы гостю.
   */
  private isMemberOnlyChat(kind: ChatKind): boolean {
    return (PARTICIPANT_ONLY_CHAT_KINDS as readonly ChatKind[]).includes(kind);
  }

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

    const memberOnly = this.isMemberOnlyChat(kind);
    const allowed = memberOnly
      ? isParticipant
      : isParticipant || trip.visibility === 'public';

    if (!allowed) {
      throw new ForbiddenException(
        memberOnly
          ? 'Этот чат доступен только участникам похода'
          : 'Этот чат похода тебе недоступен',
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
   * Свежесть данных похода для офлайн-копии.
   *
   * Отдаёт только отметку, без самих данных: клиент сравнивает её с тем,
   * что запомнил при сохранении, и решает, перечитывать ли вкладки.
   * Права — как на чтение похода: гость публичного похода тоже может
   * посмотреть, не устарела ли его копия.
   */
  async cacheState(userId: string, id: number): Promise<TripCacheStateDto> {
    const manager = this.dataSource.manager;
    const trip = await this.findVisibleTrip(manager, userId, id);

    return readTripCacheState(manager, trip.id);
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
    const participantRow = await manager.findOne(TripParticipant, {
      where: { tripId: trip.id, userId },
    });
    const isParticipant = participantRow !== null;
    /**
     * Можно ли глушить уведомления по чату.
     *
     * Право на галочку — то же, что у ручки `POST /conversations/:id/mute`:
     * состав похода без отказавшихся. Гостю публичного похода глушить
     * нечего — уведомлений о чужом походе у него нет, и ручка ответила бы
     * ему 403. Фронт по `null` просто не рисует галочку.
     */
    const canMute =
      participantRow !== null && participantRow.status !== 'declined';

    const chats = await manager.find(Conversation, {
      where: { tripId: trip.id },
      order: { id: 'ASC' },
    });

    /**
     * Строки состава — одним запросом на все чаты похода.
     *
     * Нужны только ради галочки «Уведомлять об этом чате»: она живёт
     * в `conversation_members.muted_at`, и без флага под чатом человек
     * видел бы выключенные уведомления включёнными.
     */
    const memberRows =
      chats.length > 0
        ? await manager.find(ConversationMember, {
            where: {
              conversationId: In(chats.map((chat) => chat.id)),
              userId,
            },
          })
        : [];

    const visible: TripChatDto[] = [];

    for (const chat of chats) {
      const kind = chat.kind as ChatKind;
      if (!CHAT_KINDS.includes(kind)) continue;

      const memberOnly = this.isMemberOnlyChat(kind);
      const allowed = memberOnly
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
          last ? TripMessageDto.from(last, userId) : null,
          canMute
            ? memberRows.some(
                (row) => row.conversationId === chat.id && row.mutedAt !== null,
              )
            : null,
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
      .leftJoinAndSelect('message.action', 'action')
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
      messages: page.map((message) => TripMessageDto.from(message, userId)),
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

    // После вставки: событие — сигнал «перечитай», а не сами данные.
    await this.conversations.notifyMessage(chat.id, userId);

    // Карточка уведомления о чате: двойная запись, пока панель не переехала
    // на уведомления целиком (фронтенд — следующий шаг, §14.4).
    await this.notifications.notifyChatMessage(chat.id, userId, body);

    return TripMessageDto.from(saved, userId);
  }
}
