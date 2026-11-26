import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, type EntityManager, In, IsNull } from 'typeorm';

import { User } from '../users/entities/user.entity';
import { ConversationEventsService } from './conversation-events.service';
import { Conversation } from './entities/conversation.entity';
import { ConversationMember } from './entities/conversation-member.entity';
import {
  NOTIFICATION_KINDS,
  Notification,
  type ArchiveReason,
  type NotificationKind,
  type NotificationSection,
} from './entities/notification.entity';
import { TripParticipant } from './entities/trip-participant.entity';
import { Trip } from './entities/trip.entity';
import {
  NOTIFICATION_PREVIEW_CHARS,
  NOTIFICATION_PREVIEW_LIMIT,
  type NotificationDto,
  type NotificationListDto,
  type NotificationPreviewDto,
  type NotificationSectionDto,
  type ReadAllNotificationsResultDto,
} from './dto/notification.dto';
import {
  almanacChangedText,
  chatAnnounce,
  depositText,
  notificationPriority,
  paymentRequestText,
} from './notification-text';
import { type ParticipantStatus } from './trip.types';
import { returningRows } from './query-rows';
import { tripNameOf } from './trip-name';

/**
 * Денежные виды: только они уходят в архив.
 *
 * «ОК» у `money_transfer` запрещён, у `payment_request` разрешён
 * (26.11.2026, §2.4): перевод меняет состояние только подтверждением
 * или автосогласием, а напоминание об оплате человек вправе закрыть сам.
 */
const MONEY_KINDS: NotificationKind[] = [
  'money_transfer',
  'payment_request',
];

/**
 * Что двойная галочка не трогает (§1.3): деньги к действию.
 *
 * `money_transfer` висит до подтверждения или 72 часов, `payment_request` —
 * до оплаты или собственного «ОК». Остальное удаляется без архива.
 */
const READ_ALL_KEEPS: NotificationKind[] = ['money_transfer', 'payment_request'];

/**
 * Активный состав (§4.1): `going`, `maybe`, `helping`.
 *
 * `invited` — ещё не участник, а приглашение, `declined` — уже не
 * участник. Ни те, ни другие уведомлений похода не получают; ушедшему
 * остаются только переводы (§4.4).
 */
const ACTIVE_STATUSES: ParticipantStatus[] = ['going', 'maybe', 'helping'];

/** Ключ карточки о залоге: одна на поход (§2.3). */
function tripDepositKey(tripId: string): string {
  return `trip_deposit:${tripId}`;
}

/** Виды чатов: их карточки показывают последние сообщения и непрочитанное. */
const CHAT_KINDS: NotificationKind[] = ['trip_chat', 'direct_chat'];

/**
 * Подписи чатов похода — те же, что в интерфейсе (`frontend/src/types/trips.ts`).
 *
 * Копия на бэкенде появилась осознанно: заголовок карточки хранится
 * в `notifications.title` (этого требует §14.1), и собирать его должен
 * сервер. Общего пакета у фронта и бэка нет, а тянуть сюда весь список
 * вкладок ради восьми строк было бы хуже, чем сверить две таблицы при
 * добавлении чата.
 */
const CHAT_TITLES: Record<string, string> = {
  trip_guest: 'Гостевой чат',
  trip_members: 'Чат участников',
  trip_meals: 'Чат питания',
  trip_transfer: 'Чат трансфера',
  trip_route: 'Чат табора',
  trip_gear: 'Чат снаряжения',
  trip_first_aid: 'Чат аптечки',
  trip_finance: 'Чат бухгалтерии',
};

/** Раздел панели по виду уведомления. */
export function sectionOf(kind: NotificationKind): NotificationSection {
  return kind === 'direct_chat' ? 'personal' : 'system';
}

/** Текст карточки чата: одна строка не длиннее 300 символов (§14.2). */
export function previewText(body: string): string {
  const trimmed = body.trim();
  return trimmed.length > NOTIFICATION_PREVIEW_CHARS
    ? `${trimmed.slice(0, NOTIFICATION_PREVIEW_CHARS)}…`
    : trimmed;
}

/** Заголовок карточки чата похода: «Чат табора «Хамар-Дабан»». */
export function tripChatTitle(kind: string, tripName: string): string {
  return `${CHAT_TITLES[kind] ?? 'Чат похода'} «${tripName}»`;
}

/** Что кладём в `notifications` одной строкой. */
interface NotificationInsert {
  recipientUserId: string;
  kind: NotificationKind;
  title: string;
  announce: string;
  body: string;
  dedupKey: string;
  conversationId?: string | null;
  tripId?: string | null;
  compensationId?: string | null;
}

/**
 * Уведомления правой панели (24.11.2026, §14 `topics/messages.md`).
 *
 * **Что здесь есть.** Двадцать видов походов и личный чат, секции по
 * походам, дедупликация ключом, закрытие без архива и архив денежных.
 * Создание разбросано по владельцам событий (деньги — `TripFinanceService`,
 * залог — `TripsService`, альманах — `trip-almanac-notify`, чаты —
 * `ConversationsService` и `TripsService`), потому что только они
 * знают контекст: имя похода, собеседника, текст перевода. Собирает
 * строки и решает, кому их видно, — этот сервис.
 *
 * **Аудитории.** §4 `topics/notifications.md`: получатели групповых
 * карточек — активный состав (`going`, `maybe`, `helping`) без людей без
 * аккаунта; автор действия исключён всегда, виртуальный автор — вместе
 * с ведущим; личное уведомление виртуальному уходит его ведущему.
 * Правила живут в `tripAudience` и `personalRecipientUserId`, чтобы
 * сервисы-владельцы не собирали состав каждый по-своему.
 *
 * **Почему создание принимает `EntityManager`.** Деньги и альманах пишут
 * уведомление в той же транзакции, что и само событие: карточка не должна
 * появиться, если перевод откатился. Транзакционные методы здесь
 * (`notifyMoneyTransfer`, `notifyPaymentRequest`, `upsertAlmanac`,
 * `archiveCompensation`, `archivePaymentRequestsFor`) менеджер получают
 * снаружи, а кадр в поток шлёт вызывающий **после COMMIT**.
 *
 * **Почему чат — отдельный метод без менеджера.** Сообщение уже вставлено
 * (`sendMessage` не транзакционный), и второй транзакции ради карточки
 * не нужно: дедупликация держится уникальным индексом, а не проверкой
 * «прочитай и вставь». Поэтому `notifyChatMessage` сама берёт менеджер,
 * пишет и сейчас же шлёт кадр.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: ConversationEventsService,
  ) {}

  /**
   * Секции походов, «Сообщения» и счётчики (26.11.2026, §6).
   *
   * Отдаются только **активные** уведомления: архив в панель не попадает,
   * экрана архива в этом шаге нет (§2.4). Счётчик секции — число активных
   * карточек, а не непрочитанные сообщения: пять сообщений в чате —
   * одна карточка.
   *
   * **Порядок задаёт сервер.** Секции — по дате похода (§1.1): идущие
   * и предстоящие по возрастанию начала, прошедшие по убыванию, походы
   * без дат последними по имени. Карточки внутри — по шкале приоритета,
   * при равенстве свежие сверху. Клиент порядок не пересортировывает.
   *
   * **Легаси `system` и `section`** остаются до переезда фронта: dev-панель
   * этой сессии ещё читает плоский список и делит его по полю карточки.
   */
  async listMine(userId: string): Promise<NotificationListDto> {
    const manager = this.dataSource.manager;

    const rows = await manager.find(Notification, {
      where: { recipientUserId: userId, archivedAt: IsNull() },
      order: { updatedAt: 'DESC' },
    });

    // Вышел ли смотрящий из похода — один запрос на весь список: от этого
    // зависит объяснение в карточке перевода (25.11.2026).
    const declinedTrips = await this.declinedTripsOf(manager, userId, rows);

    const dtos: NotificationDto[] = [];
    for (const row of rows) {
      dtos.push(await this.toDto(manager, row, declinedTrips));
    }

    const personal = dtos
      .filter((dto) => dto.section === 'personal')
      .sort(
        (left, right) =>
          (right.unreadCount ?? 0) - (left.unreadCount ?? 0) ||
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      );

    const system = dtos
      .filter((dto) => dto.section === 'system')
      .sort(
        (left, right) =>
          notificationPriority(right.kind) - notificationPriority(left.kind) ||
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      );

    const sections = await this.buildSections(manager, system);

    return {
      sections,
      personal,
      tripCount: sections.length,
      personalCount: personal.length,
      total: system.length + personal.length,
      system,
      systemCount: system.length,
    };
  }

  /**
   * Группировка системных карточек по походам и порядок секций (§1.1).
   *
   * Карточки без `trip_id` в секции не попадают: у всех видов, кроме
   * `direct_chat`, поход обязателен (§2.1), а строка без него — легаси-
   * аномалия. В плоском `system` она остаётся, чтобы старый фронт её видел.
   */
  private async buildSections(
    manager: EntityManager,
    system: readonly NotificationDto[],
  ): Promise<NotificationSectionDto[]> {
    const byTrip = new Map<string, NotificationDto[]>();

    for (const dto of system) {
      if (dto.tripId === null) continue;

      const items = byTrip.get(dto.tripId) ?? [];
      items.push(dto);
      byTrip.set(dto.tripId, items);
    }

    if (byTrip.size === 0) return [];

    const trips = await manager.find(Trip, {
      where: { id: In([...byTrip.keys()]) },
      relations: { goalObject: true },
    });
    const tripById = new Map(trips.map((trip) => [String(trip.id), trip]));

    const now = Date.now();
    const sections: Array<{
      trip: Trip;
      tripName: string;
      section: NotificationSectionDto;
      bucket: number;
      startsAtMs: number | null;
    }> = [];

    for (const [tripId, items] of byTrip) {
      const trip = tripById.get(tripId);
      // Поход удалён, а карточка осталась? FK `ON DELETE CASCADE` этого
      // не допускает, но секция без даты и имени всё равно читаемее 500-й.
      if (!trip) continue;

      const tripName = await tripNameOf(manager, trip);
      const startsAtMs = trip.startsAt ? trip.startsAt.getTime() : null;
      const past =
        trip.completedAt !== null ||
        (trip.endsAt !== null && trip.endsAt.getTime() < now);

      items.sort(
        (left, right) =>
          notificationPriority(right.kind) - notificationPriority(left.kind) ||
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      );

      sections.push({
        trip,
        tripName,
        bucket: startsAtMs === null ? 2 : past ? 1 : 0,
        startsAtMs,
        section: {
          tripId,
          tripName,
          startsAt: trip.startsAt ? trip.startsAt.toISOString() : null,
          items,
        },
      });
    }

    sections.sort((left, right) => {
      if (left.bucket !== right.bucket) return left.bucket - right.bucket;

      // Предстоящие — ближайшие первыми; прошедшие — свежие первыми.
      if (left.startsAtMs !== null && right.startsAtMs !== null) {
        const byDate =
          left.bucket === 1
            ? right.startsAtMs - left.startsAtMs
            : left.startsAtMs - right.startsAtMs;

        if (byDate !== 0) return byDate;
      }

      // Без дат — по имени; при равенстве id, чтобы порядок не прыгал.
      const byName = left.tripName.localeCompare(right.tripName, 'ru');
      return byName !== 0 ? byName : left.section.tripId.localeCompare(right.section.tripId);
    });

    return sections.map((item) => item.section);
  }

  /**
   * «ОК» — убрать карточку без архива.
   *
   * Нельзя только у перевода: его состояние меняется подтверждением или
   * автосогласием, а «убрать, чтобы не мешало» оставило бы деньги висеть
   * в расчёте без карточки. Запрос платежа закрывается «ОК» (26.11.2026,
   * §2.4): это напоминание, а не обязательство подтвердить получение.
   */
  async close(userId: string, id: string): Promise<void> {
    const manager = this.dataSource.manager;
    const row = await manager.findOne(Notification, {
      where: { id: String(id), recipientUserId: userId },
    });

    if (!row) throw new NotFoundException('Уведомление не найдено');

    if (row.kind === 'money_transfer') {
      throw new BadRequestException(
        'Перевод закрывается подтверждением или истечением 72 часов',
      );
    }

    await manager.delete(Notification, { id: row.id });
    this.events.emitNotifications([userId]);
  }

  /**
   * «прочитать все» в секции похода — двойная зелёная галочка (§1.3, §5.3).
   *
   * Удаляет активные карточки смотрящего по этому походу, **кроме денег
   * к действию**: `money_transfer` ждёт подтверждения, `payment_request` —
   * оплаты или собственного «ОК». Всё остальное удаляется без архива —
   * это и есть «прочитано»; следующее событие заведёт карточку заново.
   *
   * `left` — сколько активных карточек в секции осталось. По нему клиент
   * решает, исчезает ли секция, и не считает второй раз на своей стороне.
   */
  async readAll(
    userId: string,
    tripId: string,
  ): Promise<ReadAllNotificationsResultDto> {
    const manager = this.dataSource.manager;

    const closed = returningRows<{ id: string }>(
      await manager.query(
        `DELETE FROM "notifications"
          WHERE "recipient_user_id" = $1
            AND "trip_id" = $2
            AND "archived_at" IS NULL
            AND "kind" NOT IN ($3, $4)
        RETURNING "id"`,
        [userId, String(tripId), READ_ALL_KEEPS[0], READ_ALL_KEEPS[1]],
      ),
    );

    const left = await manager.count(Notification, {
      where: {
        recipientUserId: userId,
        tripId: String(tripId),
        archivedAt: IsNull(),
      },
    });

    if (closed.length > 0) this.events.emitNotifications([userId]);

    return { closed: closed.length, left };
  }

  /**
   * Ушёл из похода — убрать его активные карточки этого похода (§4.4).
   *
   * Остаётся только `money_transfer`: для покинувших поход это единственный
   * тип, а перевод, который уже висит, подтверждается из карточки.
   * Возвращает число удалённых строк — вызывающий по нему решает, слать ли
   * кадр «перечитай уведомления» после COMMIT.
   */
  async dropForTripUser(
    manager: EntityManager,
    tripId: string,
    userId: string,
  ): Promise<number> {
    const closed = returningRows<{ id: string }>(
      await manager.query(
        `DELETE FROM "notifications"
          WHERE "recipient_user_id" = $1
            AND "trip_id" = $2
            AND "kind" <> 'money_transfer'
        RETURNING "id"`,
        [userId, String(tripId)],
      ),
    );

    return closed.length;
  }

  /**
   * Архив денежного уведомления.
   *
   * Причина по умолчанию — по виду: перевод архивируется подтверждением,
   * запрос платежа — оплатой. Приходят сюда и явные причины:
   * `expired72` — из автосогласия, `confirmed`/`paid` — из действий денег.
   */
  async archive(userId: string, id: string, reason?: ArchiveReason): Promise<void> {
    const manager = this.dataSource.manager;
    const row = await manager.findOne(Notification, {
      where: { id: String(id), recipientUserId: userId },
    });

    if (!row) throw new NotFoundException('Уведомление не найдено');

    if (!MONEY_KINDS.includes(row.kind)) {
      throw new BadRequestException(
        'В архив уходят только денежные уведомления',
      );
    }

    const resolved =
      reason ?? (row.kind === 'payment_request' ? 'paid' : 'confirmed');

    if (row.kind === 'payment_request' && resolved !== 'paid') {
      throw new BadRequestException(
        'Запрос платежа закрывается оплатой — причина paid',
      );
    }

    if (row.kind === 'money_transfer' && resolved === 'paid') {
      throw new BadRequestException('Перевод закрывается подтверждением');
    }

    // Повторная архивация — не ошибка: кнопку могли нажать дважды.
    if (row.archivedAt === null) {
      await manager.update(
        Notification,
        { id: row.id },
        { archivedAt: new Date(), archivedReason: resolved },
      );
    }

    this.events.emitNotifications([userId]);
  }

  /**
   * Новое сообщение в чате — карточка получателю.
   *
   * Личный диалог — только второму человеку; чат похода — всему составу
   * без отказавшихся. Автор себе не уведомляет: он и так знает.
   *
   * Заголовок личного — имя автора: для получателя это «собеседник».
   * Дедупликация — по диалогу, поэтому пять сообщений подряд обновляют
   * одну карточку, а не заводят пять.
   */
  async notifyChatMessage(
    conversationId: string | number,
    senderId: string,
    body: string,
  ): Promise<void> {
    const manager = this.dataSource.manager;
    const conversation = await manager.findOne(Conversation, {
      where: { id: String(conversationId) },
    });

    if (!conversation) return;

    const recipients = await this.chatRecipients(manager, conversation, senderId);
    if (recipients.length === 0) return;

    const isDirect = conversation.kind === 'direct';
    const sender = await manager.findOne(User, { where: { id: senderId } });
    let title: string;

    if (isDirect) {
      title = sender?.displayName ?? 'Личное сообщение';
    } else {
      const trip = conversation.tripId
        ? await manager.findOne(Trip, {
            where: { id: conversation.tripId },
            relations: { goalObject: true },
          })
        : null;
      title = tripChatTitle(
        conversation.kind,
        trip ? await tripNameOf(manager, trip) : '',
      );
    }

    const kind: NotificationKind = isDirect ? 'direct_chat' : 'trip_chat';
    const shortBody = previewText(body);

    for (const recipientId of recipients) {
      await this.upsert(manager, {
        recipientUserId: recipientId,
        kind,
        title,
        // Анонс свёрнутой карточки — «автор: текст» (§3.20); содержимое
        // по-прежнему только текст, его рисует старый фронт.
        announce: chatAnnounce(sender?.displayName ?? null, shortBody),
        body: shortBody,
        dedupKey: `${kind}:${conversation.id}`,
        conversationId: conversation.id,
        tripId: conversation.tripId,
      });
    }

    this.events.emitNotifications(recipients);
  }

  /**
   * Уведомление о переводе — в транзакции `createCompensation`.
   *
   * Текст — тот же, что у личного сообщения: заказчик назвал формулировку
   * дословно, и второй её вариант разошёлся бы с первым при первой правке.
   *
   * **Получатель-виртуальный (25.11.2026).** У человека без аккаунта входа
   * нет, поэтому карточка уходит его владельцу, а `conversation_id` пуст:
   * диалога с виртуальным не заводят, и поле «Сообщение отправителю» на
   * такой карточке не рисуется. Текст называет участника по имени, чтобы
   * владелец понял, за кого перевод.
   */
  async notifyMoneyTransfer(
    manager: EntityManager,
    params: {
      recipientUserId: string;
      tripId: string;
      compensationId: string;
      conversationId: string | null;
      body: string;
    },
  ): Promise<void> {
    await this.upsert(manager, {
      recipientUserId: params.recipientUserId,
      kind: 'money_transfer',
      title: 'Денежный перевод',
      // Текст перевода не меняется (п.8 решения заказчика): анонс и
      // содержимое совпадают, для этого вида так и должно быть.
      announce: params.body,
      body: params.body,
      dedupKey: `money_transfer:${params.compensationId}`,
      conversationId: params.conversationId,
      tripId: params.tripId,
      compensationId: params.compensationId,
    });
  }

  /**
   * «Установлен залог» — активному составу (26.11.2026, §3.7).
   *
   * Это **не** персональное «ты должен»: участник сам решает
   * в «Бухгалтерии», покрыть залог расходами или переводом. Получатели —
   * `going`, `maybe`, `helping` (§4.1), кроме автора действия; людям без
   * аккаунта карточка не нужна — войти в приложение им нечем.
   *
   * Ключ `trip_deposit:<поход>`: повторное изменение суммы обновляет ту же
   * карточку. Снятие залога удаляет её — `dropTripDeposit`.
   */
  async notifyTripDeposit(
    manager: EntityManager,
    params: {
      tripId: string;
      tripName: string;
      amountRub: number;
      recipientIds: readonly string[];
    },
  ): Promise<void> {
    const text = depositText(params.tripName, params.amountRub);

    for (const recipientId of params.recipientIds) {
      await this.upsert(manager, {
        recipientUserId: recipientId,
        kind: 'trip_deposit',
        ...text,
        dedupKey: tripDepositKey(params.tripId),
        tripId: params.tripId,
      });
    }
  }

  /**
   * Залог снят — карточки «Установлен залог» больше нет.
   *
   * Возвращает получателей, чтобы вызывающий после COMMIT разослал
   * сигнал «перечитай уведомления»: удаление строки само по себе кадр
   * не порождает.
   */
  async dropTripDeposit(
    manager: EntityManager,
    tripId: string,
  ): Promise<string[]> {
    const rows = returningRows<{ recipient_user_id: string }>(
      await manager.query(
        `DELETE FROM "notifications"
          WHERE "kind" = 'trip_deposit'
            AND "dedup_key" = $1
        RETURNING "recipient_user_id"`,
        [tripDepositKey(tripId)],
      ),
    );

    return rows.map((row) => row.recipient_user_id);
  }

  /**
   * «Запрос платежа» — снова адресный: только должникам (§3.6).
   *
   * Решение 26.11.2026 отменяет групповое «всем идущим» 25.11.2026.
   * Карточку получает конкретный человек с отрицательным балансом (или
   * с нулём при установленном залоге); сумму и формулу считает
   * `TripFinanceService`, здесь только текст.
   *
   * Одна карточка на пару «поход + человек»: повторное нажатие обновляет
   * её. Ключ содержит id получателя, а не похода, — иначе второй должник
   * не смог бы получить свою.
   */
  async notifyPaymentRequest(
    manager: EntityManager,
    params: {
      recipientUserId: string;
      tripId: string;
      authorName: string;
    },
  ): Promise<void> {
    await this.upsert(manager, {
      recipientUserId: params.recipientUserId,
      kind: 'payment_request',
      ...paymentRequestText(params.authorName),
      dedupKey: `payment_request:${params.tripId}:${params.recipientUserId}`,
      tripId: params.tripId,
    });
  }

  /**
   * Аудитория групповой карточки — активный состав похода (§4.1).
   *
   * `going`, `maybe`, `helping`; `invited` — ещё приглашение, `declined` —
   * уже не участник. Виртуальные исключаются: у них нет входа, а их
   * ведущий получает карточку как обычный участник, только если сам идёт.
   *
   * Автор действия исключается **всегда**, а если автор — виртуальный,
   * то и его ведущий: действие совершил он, уведомлять его же о своём
   * действии незачем (§4.2).
   *
   * `exceptUserIds` — субъект уведомления («новый участник», назначенная
   * роль) и любые дополнительные исключения конкретного вида.
   */
  async tripAudience(
    manager: EntityManager,
    tripId: string,
    options: {
      actorUserId?: string | null;
      exceptUserIds?: readonly string[];
    } = {},
  ): Promise<string[]> {
    const participants = await manager.find(TripParticipant, {
      where: { tripId, status: In(ACTIVE_STATUSES) },
      relations: { user: true },
      order: { createdAt: 'ASC', userId: 'ASC' },
    });

    const except = new Set(options.exceptUserIds ?? []);

    if (options.actorUserId) {
      except.add(options.actorUserId);

      const actor = await manager.findOne(User, {
        where: { id: options.actorUserId },
      });

      if (actor?.isVirtual && actor.virtualOwnerUserId) {
        except.add(actor.virtualOwnerUserId);
      }
    }

    return [
      ...new Set(
        participants
          .filter(
            (row) => row.user?.isVirtual !== true && !except.has(row.userId),
          )
          .map((row) => row.userId),
      ),
    ];
  }

  /**
   * Кому лично адресована карточка (§4.2): виртуальному — его ведущему.
   *
   * У человека без аккаунта входа нет. Если владельца нет (так не должно
   * быть, но данные могли остаться от удалённого пользователя), карточку
   * класть некуда — `null`, и вызывающий её не создаёт.
   */
  async personalRecipientUserId(
    manager: EntityManager,
    userId: string,
  ): Promise<string | null> {
    const user = await manager.findOne(User, { where: { id: userId } });
    if (!user) return null;
    if (user.isVirtual) return user.virtualOwnerUserId ?? null;

    return user.id;
  }

  /**
   * Новая редакция альманаха — уведомления участникам (в их транзакции).
   *
   * Вид `almanac_changed` (миграция 103), ключ `almanac_changed:<поход>`:
   * «ОК» удаляет карточку, следующая редакция заводит её заново, а до
   * закрытия — обновляет существующую. Текст прежний (п.8 решения
   * заказчика): меняется только код вида.
   */
  async upsertAlmanac(
    manager: EntityManager,
    params: { tripId: string; tripName: string; recipientIds: string[] },
  ): Promise<void> {
    const text = almanacChangedText(params.tripName);

    for (const recipientId of params.recipientIds) {
      await this.upsert(manager, {
        recipientUserId: recipientId,
        kind: 'almanac_changed',
        ...text,
        dedupKey: `almanac_changed:${params.tripId}`,
        tripId: params.tripId,
      });
    }
  }

  /**
   * Перевод подтверждён или истёк — в архив.
   *
   * Возвращает получателей, чьи карточки изменились: кадр в поток шлёт
   * вызывающий после COMMIT.
   */
  async archiveCompensation(
    manager: EntityManager,
    compensationId: string,
    reason: Extract<ArchiveReason, 'confirmed' | 'expired72'>,
  ): Promise<string[]> {
    const rows = returningRows<{ recipient_user_id: string }>(
      await manager.query(
        `UPDATE "notifications"
            SET "archived_at" = now(), "archived_reason" = $2, "updated_at" = now()
          WHERE "kind" = 'money_transfer'
            AND "compensation_id" = $1
            AND "archived_at" IS NULL
        RETURNING "recipient_user_id"`,
        [String(compensationId), reason],
      ),
    );

    return rows.map((row) => row.recipient_user_id);
  }

  /**
   * Перевод отменён — карточка удаляется вместе с ним.
   *
   * Отмена действия в переписке («мой косяк») удаляет сообщение и действие,
   * но строка компенсации живёт своей жизнью; карточка про перевод, которого
   * больше нет, висела бы с кнопкой «Подтвердить». Поэтому уведомление
   * удаляем здесь, а не ждём каскада по компенсации.
   */
  async dropForCompensation(
    manager: EntityManager,
    compensationId: string,
  ): Promise<string[]> {
    const rows = returningRows<{ recipient_user_id: string }>(
      await manager.query(
        `DELETE FROM "notifications"
          WHERE "kind" = 'money_transfer'
            AND "compensation_id" = $1
        RETURNING "recipient_user_id"`,
        [String(compensationId)],
      ),
    );

    return rows.map((row) => row.recipient_user_id);
  }

  /**
   * Долг закрыт оплатой — запрос платежа в архив.
   *
   * Проверяется при чтении «Бухгалтерии» (и сразу после перевода): остаток
   * с учётом ожидающих считается там же, второго расчёта денег нет.
   */
  async archivePaymentRequestsFor(
    manager: EntityManager,
    tripId: string,
    userId: string,
  ): Promise<string[]> {
    const rows = returningRows<{ recipient_user_id: string }>(
      await manager.query(
        `UPDATE "notifications"
            SET "archived_at" = now(), "archived_reason" = 'paid', "updated_at" = now()
          WHERE "kind" = 'payment_request'
            AND "trip_id" = $1
            AND "recipient_user_id" = $2
            AND "archived_at" IS NULL
        RETURNING "recipient_user_id"`,
        [tripId, userId],
      ),
    );

    return rows.map((row) => row.recipient_user_id);
  }

  /**
   * Диалог прочитан — уведомление о нём исчезает (§14.2).
   *
   * Удаление, а не архив: следующее новое сообщение создаст карточку
   * заново, и это ровно то поведение, которое заказчик описал словами
   * «следующее новое сообщение создаёт его заново».
   */
  async closeForConversation(
    conversationId: string | number,
    userId: string,
  ): Promise<void> {
    const rows = returningRows<{ id: string }>(
      await this.dataSource.manager.query(
        `DELETE FROM "notifications"
          WHERE "conversation_id" = $1
            AND "recipient_user_id" = $2
            AND "kind" IN ('trip_chat', 'direct_chat')
        RETURNING "id"`,
        [String(conversationId), userId],
      ),
    );

    if (rows.length > 0) this.events.emitNotifications([userId]);
  }

  /**
   * Сигнал «перечитай уведомления» — в существующий поток на человека.
   *
   * Отдельного потока нет (§14.2): вид `notifications` едет по
   * `GET /api/conversations/events`, и клиент перечитывает обе секции.
   */
  emitChanged(recipientIds: string[]): void {
    this.events.emitNotifications(recipientIds);
  }

  // ─────────────────────────────── внутреннее ───────────────────────────────

  private async toDto(
    manager: EntityManager,
    row: Notification,
    declinedTrips: ReadonlySet<string>,
  ): Promise<NotificationDto> {
    const isChat = CHAT_KINDS.includes(row.kind) && row.conversationId !== null;

    const unreadCount = isChat
      ? await this.unreadCount(manager, row.conversationId!, row.recipientUserId)
      : null;

    const preview = isChat
      ? await this.previewOf(manager, row.conversationId!)
      : [];

    return {
      id: row.id,
      kind: row.kind,
      section: sectionOf(row.kind),
      title: row.title,
      // Старое поле миграция заполняет из `body`; пустая строка возможна
      // только у строки, вставленной в обход миграции, — отдаём `body`.
      announce: row.announce || row.body,
      body: row.body,
      conversationId: row.conversationId,
      tripId: row.tripId,
      compensationId: row.compensationId,
      unreadCount,
      /**
       * Ушёл ли смотрящий из похода — только для перевода (25.11.2026).
       * «Бухгалтерия» ему закрыта (`assertParticipant`), а подтвердить
       * получение он теперь может прямо в карточке: клиент по этому флагу
       * объясняет, почему кнопка здесь, а не во вкладке.
       */
      viewerDeclined:
        row.kind === 'money_transfer' && row.tripId !== null
          ? declinedTrips.has(row.tripId)
          : null,
      preview,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Походы, из которых смотрящий вышел (`declined`).
   *
   * Считается для списка целиком, а не для каждой карточки: походов
   * у человека немного, но лишний запрос на каждое уведомление — это та же
   * N+1, которую здесь уже даёт непрочитанное у чатов.
   */
  private async declinedTripsOf(
    manager: EntityManager,
    userId: string,
    rows: readonly Notification[],
  ): Promise<Set<string>> {
    const tripIds = [
      ...new Set(
        rows
          .filter((row) => row.kind === 'money_transfer' && row.tripId !== null)
          .map((row) => row.tripId!),
      ),
    ];
    if (tripIds.length === 0) return new Set();

    const participants = await manager.find(TripParticipant, {
      where: { userId, tripId: In(tripIds), status: 'declined' },
    });

    return new Set(participants.map((participant) => participant.tripId));
  }

  /**
   * Кому доступен диалог, кроме автора.
   *
   * Личный — второй человек пары. Чат похода — состав похода без
   * отказавшихся (`declined`) и без «виртуальных» людей: у них нет
   * аккаунта, войти в приложение им нечем. Заглушённый диалог
   * (`conversation_members.muted_at`) уведомлений не даёт — та же галочка,
   * что гасила ленту.
   */
  private async chatRecipients(
    manager: EntityManager,
    conversation: Conversation,
    senderId: string,
  ): Promise<string[]> {
    let candidates: string[];

    if (conversation.kind === 'direct') {
      candidates = [conversation.directA, conversation.directB].filter(
        (id): id is string => Boolean(id) && id !== senderId,
      );
    } else {
      if (!conversation.tripId) return [];

      // Активный состав без автора и виртуальных (§4.1): `invited` ещё
      // не участник, `declined` уже нет.
      candidates = await this.tripAudience(manager, conversation.tripId, {
        actorUserId: senderId,
      });
    }

    if (candidates.length === 0) return [];

    const members = await manager.find(ConversationMember, {
      where: { conversationId: conversation.id, userId: In(candidates) },
    });
    const muted = new Set(
      members.filter((row) => row.mutedAt !== null).map((row) => row.userId),
    );

    return [...new Set(candidates)].filter((id) => !muted.has(id));
  }

  /**
   * Вставка с дедупликацией.
   *
   * `ON CONFLICT` по `(recipient_user_id, dedup_key)` — единственный
   * способ не завести две карточки при двух одновременных событиях:
   * проверка «прочитай и вставь» на READ COMMITTED этого не умеет
   * (та же грабля, что у альманаха 24.11.2026).
   *
   * Повторное событие **снимает архив**: новая редакция альманаха или
   * повторная просьба о платеже делают карточку активной снова. Для
   * перевода это недостижимо: ключ содержит id компенсации, а она одна.
   */
  private async upsert(
    manager: EntityManager,
    insert: NotificationInsert,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO "notifications" (
         "recipient_user_id", "kind", "title", "announce", "body", "dedup_key",
         "conversation_id", "trip_id", "compensation_id"
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT ("recipient_user_id", "dedup_key") DO UPDATE
         SET "title" = EXCLUDED."title",
             "announce" = EXCLUDED."announce",
             "body" = EXCLUDED."body",
             "conversation_id" = EXCLUDED."conversation_id",
             "trip_id" = EXCLUDED."trip_id",
             "compensation_id" = EXCLUDED."compensation_id",
             "archived_at" = NULL,
             "archived_reason" = NULL,
             "updated_at" = now()`,
      [
        insert.recipientUserId,
        insert.kind,
        insert.title,
        insert.announce,
        insert.body,
        insert.dedupKey,
        insert.conversationId ?? null,
        insert.tripId ?? null,
        insert.compensationId ?? null,
      ],
    );
  }

  /**
   * Последние сообщения карточки чата — до трёх, каждое до 300 символов.
   *
   * Берём из `messages`, а не храним в уведомлении: сообщение могли
   * переписать (автосогласие), и копия в карточке разошлась бы с чатом.
   */
  private async previewOf(
    manager: EntityManager,
    conversationId: string,
  ): Promise<NotificationPreviewDto[]> {
    const rows = (await manager.query(
      `SELECT m."id", m."body", m."sender_id", m."created_at", u."display_name"
         FROM "messages" m
         LEFT JOIN "users" u ON u."id" = m."sender_id"
        WHERE m."conversation_id" = $1
        ORDER BY m."id" DESC
        LIMIT $2`,
      [conversationId, NOTIFICATION_PREVIEW_LIMIT],
    )) as Array<{
      id: string;
      body: string;
      sender_id: string | null;
      created_at: Date | string;
      display_name: string | null;
    }>;

    return rows.reverse().map((row) => ({
      id: String(row.id),
      body: previewText(row.body),
      senderId: row.sender_id,
      senderName: row.display_name,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  /**
   * Непрочитанное в диалоге — по тому же правилу, что счётчик ленты.
   *
   * `last_read_at` пуст у чата, который ни разу не открывали; тогда отсчёт
   * идёт с момента вступления в поход (`trip_participants.created_at`),
   * иначе на старом походе карточка показала бы сотни сообщений.
   */
  private async unreadCount(
    manager: EntityManager,
    conversationId: string,
    userId: string,
  ): Promise<number> {
    const rows = (await manager.query(
      `SELECT count(*)::int AS "count"
         FROM "messages" m
         LEFT JOIN "conversation_members" cm
           ON cm."conversation_id" = m."conversation_id"
          AND cm."user_id" = $2
        WHERE m."conversation_id" = $1
          AND m."sender_id" IS NOT NULL
          AND m."sender_id" <> $2
          AND m."created_at" > COALESCE(
            cm."last_read_at",
            (SELECT tp."created_at"
               FROM "trip_participants" tp
               JOIN "conversations" c ON c."trip_id" = tp."trip_id"
              WHERE c."id" = $1 AND tp."user_id" = $2),
            '-infinity'::timestamptz
          )`,
      [conversationId, userId],
    )) as Array<{ count: number }>;

    return rows[0]?.count ?? 0;
  }
}

/** Все виды уведомлений — для проверок и Swagger. */
export const ALL_NOTIFICATION_KINDS = NOTIFICATION_KINDS;
