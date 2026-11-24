import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, type EntityManager, In, IsNull, Not } from 'typeorm';

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
} from './dto/notification.dto';
import { returningRows } from './query-rows';
import { tripNameOf } from './trip-name';

/** Денежные виды: только они уходят в архив и не закрываются «ОК». */
const MONEY_KINDS: NotificationKind[] = ['money_transfer', 'payment_request'];

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
  body: string;
  dedupKey: string;
  conversationId?: string | null;
  tripId?: string | null;
  compensationId?: string | null;
}

/**
 * Уведомления правой панели (24.11.2026, §14 `topics/messages.md`).
 *
 * **Что здесь есть.** Пять видов, два раздела, дедупликация ключом,
 * закрытие без архива и архив денежных. Создание разбросано по владельцам
 * событий (деньги — `TripFinanceService`, альманах — `trip-almanac-notify`,
 * чаты — `ConversationsService` и `TripsService`), потому что только они
 * знают контекст: имя похода, собеседника, текст перевода. Собирает
 * строки и решает, кому их видно, — этот сервис.
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
   * Два раздела панели с счётчиками.
   *
   * Отдаются только **активные** уведомления: архив в панель не попадает,
   * экрана архива в этом шаге нет (§14.2). Счётчик — длина списка, а не
   * непрочитанные сообщения: пять сообщений в чате — одна карточка.
   */
  async listMine(userId: string): Promise<NotificationListDto> {
    const manager = this.dataSource.manager;

    const rows = await manager.find(Notification, {
      where: { recipientUserId: userId, archivedAt: IsNull() },
      order: { updatedAt: 'DESC' },
    });

    const dtos: NotificationDto[] = [];
    for (const row of rows) {
      dtos.push(await this.toDto(manager, row));
    }

    const system = dtos.filter((dto) => dto.section === 'system');
    const personal = dtos.filter((dto) => dto.section === 'personal');

    return {
      system,
      personal,
      systemCount: system.length,
      personalCount: personal.length,
    };
  }

  /**
   * «ОК» — убрать карточку без архива.
   *
   * Только у чатов и альманаха. Деньги так закрывать нельзя: заказчик
   * подтвердил, что состояние перевода меняется подтверждением или
   * оплатой, а «убрать, чтобы не мешало» оставило бы деньги висеть
   * в расчёте без карточки.
   */
  async close(userId: string, id: string): Promise<void> {
    const manager = this.dataSource.manager;
    const row = await manager.findOne(Notification, {
      where: { id: String(id), recipientUserId: userId },
    });

    if (!row) throw new NotFoundException('Уведомление не найдено');

    if (MONEY_KINDS.includes(row.kind)) {
      throw new BadRequestException(
        'Денежное уведомление закрывается подтверждением или оплатой',
      );
    }

    await manager.delete(Notification, { id: row.id });
    this.events.emitNotifications([userId]);
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
    let title: string;

    if (isDirect) {
      const sender = await manager.findOne(User, { where: { id: senderId } });
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

    for (const recipientId of recipients) {
      await this.upsert(manager, {
        recipientUserId: recipientId,
        kind,
        title,
        body: previewText(body),
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
   */
  async notifyMoneyTransfer(
    manager: EntityManager,
    params: {
      recipientUserId: string;
      tripId: string;
      compensationId: string;
      conversationId: string;
      body: string;
    },
  ): Promise<void> {
    await this.upsert(manager, {
      recipientUserId: params.recipientUserId,
      kind: 'money_transfer',
      title: 'Денежный перевод',
      body: params.body,
      dedupKey: `money_transfer:${params.compensationId}`,
      conversationId: params.conversationId,
      tripId: params.tripId,
      compensationId: params.compensationId,
    });
  }

  /**
   * Просьба организатора о платеже — в транзакции `requestPayments`.
   *
   * Ключ — поход: должнику одна карточка, сколько бы раз организатор
   * ни нажимал кнопку. «Перейти» карточку не закрывает — только оплата.
   */
  async notifyPaymentRequest(
    manager: EntityManager,
    params: { recipientUserId: string; tripId: string; tripName: string },
  ): Promise<void> {
    await this.upsert(manager, {
      recipientUserId: params.recipientUserId,
      kind: 'payment_request',
      title: 'Запрос платежа',
      body: `Организатор запросил платёж по походу «${params.tripName}».`,
      dedupKey: `payment_request:${params.tripId}`,
      tripId: params.tripId,
    });
  }

  /**
   * Новая редакция альманаха — уведомления участникам (в их транзакции).
   *
   * Альманах закрывается «ОК» с удалением, поэтому каждая новая редакция
   * после закрытия создаёт карточку заново, а до закрытия — обновляет
   * существующую: ключ `almanac:<поход>`.
   */
  async upsertAlmanac(
    manager: EntityManager,
    params: { tripId: string; tripName: string; recipientIds: string[] },
  ): Promise<void> {
    for (const recipientId of params.recipientIds) {
      await this.upsert(manager, {
        recipientUserId: recipientId,
        kind: 'almanac',
        title: `Альманах «${params.tripName}»`,
        body: `В походе «${params.tripName}» новая редакция альманаха`,
        dedupKey: `almanac:${params.tripId}`,
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
      body: row.body,
      conversationId: row.conversationId,
      tripId: row.tripId,
      compensationId: row.compensationId,
      unreadCount,
      preview,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
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

      const participants = await manager.find(TripParticipant, {
        where: {
          tripId: conversation.tripId,
          status: Not('declined'),
          userId: Not(senderId),
        },
        relations: { user: true },
      });

      candidates = participants
        .filter((row) => row.user?.isVirtual !== true)
        .map((row) => row.userId);
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
         "recipient_user_id", "kind", "title", "body", "dedup_key",
         "conversation_id", "trip_id", "compensation_id"
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT ("recipient_user_id", "dedup_key") DO UPDATE
         SET "title" = EXCLUDED."title",
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
