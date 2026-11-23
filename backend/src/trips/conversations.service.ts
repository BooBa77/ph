import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In, Not } from 'typeorm';

import {
  ConversationDto,
  ConversationListDto,
  ConversationMessageQueryDto,
  ConversationPeerDto,
  type OpenDirectDto,
  type SendConversationMessageDto,
} from './dto/conversation.dto';
import {
  TripMessageDto,
  type TripMessageListDto,
} from './dto/message.dto';
import { Conversation } from './entities/conversation.entity';
import { ConversationMember } from './entities/conversation-member.entity';
import { Message } from './entities/message.entity';
import { Trip } from './entities/trip.entity';
import { TripParticipant } from './entities/trip-participant.entity';
import { User } from '../users/entities/user.entity';

/** Сколько сообщений диалога отдаём по умолчанию — как у чатов похода. */
const DEFAULT_CONVERSATION_PAGE_SIZE = 50;

/**
 * Диалоги человека: походные чаты и личные — в одном списке.
 *
 * Список нужен конвертику в шапке: «что новое и где». Правила доступа
 * разные (личный — по составу, походный — по составу похода), поэтому
 * список собирается **двумя запросами и склейкой в памяти**, а не одним
 * хитрым UNION: диалогов у человека единицы, а читаемость важнее.
 *
 * Непрочитанное считается по `last_read_at`, а не хранится числом:
 * счётчик-поле разошёлся бы с сообщениями при первой же правке.
 *
 * Участник со статусом `declined` в чат участников не попадает: он
 * «не участник», и это единственное место, где статус влияет на доступ
 * к чтению.
 */
@Injectable()
export class ConversationsService {
  constructor(private readonly dataSource: DataSource) {}

  /** Диалоги, которые видит человек, с последним сообщением и непрочитанным. */
  async listMine(userId: string): Promise<ConversationListDto> {
    const manager = this.dataSource.manager;

    // Личные — по составу диалога.
    const memberRows = await manager.find(ConversationMember, {
      where: { userId },
    });

    // Походные — по составу похода, кроме отказавшихся.
    const participation = await manager.find(TripParticipant, {
      where: { userId, status: Not('declined') },
    });

    const conversations: Conversation[] = [];

    if (memberRows.length > 0) {
      conversations.push(
        ...(await manager.find(Conversation, {
          where: { id: In(memberRows.map((row) => row.conversationId)) },
        })),
      );
    }

    if (participation.length > 0) {
      const tripIds = participation.map((row) => row.tripId);
      conversations.push(
        ...(await manager.find(Conversation, {
          where: { tripId: In(tripIds) },
        })),
      );
    }

    // Названия походов одним запросом: «Чат бухгалтерии» без названия
    // похода не говорит, куда идти.
    const tripTitles = await this.tripTitlesOf(manager, conversations);

    const dtos: ConversationDto[] = [];

    for (const conversation of conversations) {
      const member = memberRows.find(
        (row) => row.conversationId === conversation.id,
      );

      const lastMessage = await manager.findOne(Message, {
        where: { conversationId: conversation.id },
        // `action` нужен ленте: по нему рисуются кнопки «Подтверждаю».
        relations: { sender: true, action: true },
        order: { id: 'DESC' },
      });

      /**
       * Отсчёт непрочитанного для чата, который ни разу не открывали.
       *
       * `last_read_at` пуст, а строки состава у чатов похода ленивые:
       * «всё непрочитано» показало бы всю историю похода — на старом
       * походе это сотни сообщений и бейдж «312». Считаем с момента,
       * когда человек попал в состав: до него он этих сообщений не видел.
       */
      const since =
        member?.lastReadAt ??
        participation.find((row) => row.tripId === conversation.tripId)
          ?.createdAt ??
        null;

      const unreadCount = await this.countUnread(
        manager,
        conversation.id,
        userId,
        since,
      );

      const peer =
        conversation.kind === 'direct'
          ? await this.peerOf(manager, conversation, userId)
          : null;

      const peerLastReadAt =
        conversation.kind === 'direct'
          ? await this.peerReadAt(manager, conversation, peer?.id ?? null)
          : null;

      dtos.push(
        ConversationDto.from(conversation, {
          peer,
          lastMessage,
          unreadCount,
          viewerId: userId,
          tripTitle: conversation.tripId
            ? (tripTitles.get(conversation.tripId) ?? null)
            : null,
          muted: Boolean(member?.mutedAt),
          peerLastReadAt,
        }),
      );
    }

    // Свежие сверху; пустые — в конце, чтобы не занимать первый экран.
    dtos.sort((a, b) => {
      const left = a.lastMessage?.createdAt ?? '';
      const right = b.lastMessage?.createdAt ?? '';
      return right.localeCompare(left);
    });

    return { conversations: dtos };
  }

  /**
   * Открыть личный диалог — существующий или новый.
   *
   * Пара хранится отсортированной (`direct_a < direct_b`), поэтому повторный
   * запрос в любую сторону находит тот же диалог. Оба участника сразу
   * попадают в `conversation_members`: для личного диалога состав — это и
   * есть доступ.
   */
  async openDirect(userId: string, dto: OpenDirectDto): Promise<ConversationDto> {
    if (dto.userId === userId) {
      throw new BadRequestException('Диалог с самим собой не нужен');
    }

    return this.dataSource.transaction(async (manager) => {
      const [a, b] = [userId, dto.userId].sort();

      let conversation = await manager.findOne(Conversation, {
        where: { kind: 'direct', directA: a, directB: b },
      });

      if (!conversation) {
        conversation = await manager.save(
          manager.create(Conversation, {
            kind: 'direct',
            directA: a,
            directB: b,
          }),
        );

        await manager.insert(ConversationMember, [
          { conversationId: conversation.id, userId: a },
          { conversationId: conversation.id, userId: b },
        ]);
      } else {
        // Диалог мог быть создан раньше без строк состава — чиним.
        for (const memberId of [a, b]) {
          await manager
            .createQueryBuilder()
            .insert()
            .into(ConversationMember)
            .values({ conversationId: conversation.id, userId: memberId })
            .orIgnore()
            .execute();
        }
      }

      const peer = await this.peerOf(manager, conversation, userId);

      return ConversationDto.from(conversation, {
        peer,
        lastMessage: null,
        unreadCount: 0,
        viewerId: userId,
      });
    });
  }

  /** Отметить диалог прочитанным: `last_read_at = now`. */
  async markRead(userId: string, conversationId: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const conversation = await this.accessible(manager, userId, conversationId);

      const existing = await manager.findOne(ConversationMember, {
        where: { conversationId: conversation.id, userId },
      });

      if (existing) {
        existing.lastReadAt = new Date();
        await manager.save(existing);
        return;
      }

      // Для чата похода строки состава могло не быть — она ленивая.
      await manager.insert(ConversationMember, {
        conversationId: conversation.id,
        userId,
        lastReadAt: new Date(),
      });
    });
  }

  /**
   * Сообщения диалога страницей — от старых к новым.
   *
   * Тот же курсор и то же правило, что у чатов похода: листаем по `id`,
   * потому что две записи с одинаковым `created_at` — обычное дело,
   * и страница на дате либо зациклилась бы, либо теряла сообщения.
   * В ответе порядок хронологический: лента читается сверху вниз.
   */
  async listMessages(
    userId: string,
    conversationId: number,
    query: ConversationMessageQueryDto,
  ): Promise<TripMessageListDto> {
    const manager = this.dataSource.manager;
    const conversation = await this.accessible(
      manager,
      userId,
      conversationId,
    );
    const limit = query.limit ?? DEFAULT_CONVERSATION_PAGE_SIZE;

    const qb = manager
      .createQueryBuilder(Message, 'message')
      .leftJoinAndSelect('message.sender', 'sender')
      .leftJoinAndSelect('message.action', 'action')
      .where('message.conversationId = :conversationId', {
        conversationId: conversation.id,
      })
      // Имя свойства, а не колонки: при `take` TypeORM пересобирает
      // ORDER BY и ищет колонку через `findColumnWithPropertyPath`.
      .orderBy('message.id', 'DESC')
      .take(limit + 1);

    if (query.before !== undefined) {
      qb.andWhere('message.id < :before', { before: query.before });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    page.reverse();

    return {
      messages: page.map((row) => TripMessageDto.from(row, userId)),
      hasMore,
    };
  }

  /**
   * Отправить сообщение в диалог.
   *
   * Право писать здесь не отдельное: доступ к диалогу и есть право
   * писать. Гость публичного похода читает гостевой чат по другой ручке
   * (`GET /trips/:id/messages`), и в ленте у него этого диалога нет.
   *
   * Текст обрезается по краям и пустым быть не может: сообщение из одних
   * пробелов неотличимо от пустого, а в ленте выглядит как сбой вёрстки.
   */
  async sendMessage(
    userId: string,
    conversationId: number,
    dto: SendConversationMessageDto,
  ): Promise<TripMessageDto> {
    const manager = this.dataSource.manager;
    const conversation = await this.accessible(
      manager,
      userId,
      conversationId,
    );

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
        conversationId: conversation.id,
        senderId: userId,
        body,
      }),
    );
    saved.sender = sender;

    return TripMessageDto.from(saved, userId);
  }

  /**
   * Заглушить или вернуть уведомления по диалогу.
   *
   * Строки состава у чата похода может не быть — создаём её здесь же:
   * настройка живёт в ней. `last_read_at` не трогаем: выключение
   * уведомлений не делает диалог прочитанным.
   */
  async setMuted(
    userId: string,
    conversationId: number,
    muted: boolean,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const conversation = await this.accessible(
        manager,
        userId,
        conversationId,
      );

      const existing = await manager.findOne(ConversationMember, {
        where: { conversationId: conversation.id, userId },
      });

      if (existing) {
        existing.mutedAt = muted ? new Date() : null;
        await manager.save(existing);
        return;
      }

      await manager.insert(ConversationMember, {
        conversationId: conversation.id,
        userId,
        mutedAt: muted ? new Date() : null,
      });
    });
  }

  /**
   * Названия походов для чатов похода — одним запросом.
   *
   * `announcement` — подпись похода в остальных экранах, но он необязателен;
   * если пуст, берём цель (она у похода обязательна). Тот же порядок, что
   * в уведомлении альманаха: человек видит одно и то же название везде.
   */
  private async tripTitlesOf(
    manager: EntityManager,
    conversations: Conversation[],
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(
        conversations
          .map((row) => row.tripId)
          .filter((id): id is string => id !== null && id !== undefined),
      ),
    ];

    if (ids.length === 0) return new Map();

    const trips = await manager.find(Trip, {
      where: { id: In(ids) },
      relations: { goalObject: true },
    });

    return new Map(
      trips.map((trip) => [
        trip.id,
        trip.announcement ?? trip.goalObject?.name ?? `поход #${trip.id}`,
      ]),
    );
  }

  /** Когда собеседник личного диалога читал его в последний раз. */
  private async peerReadAt(
    manager: EntityManager,
    conversation: Conversation,
    peerId: string | null,
  ): Promise<Date | null> {
    if (!peerId) return null;

    const row = await manager.findOne(ConversationMember, {
      where: { conversationId: conversation.id, userId: peerId },
    });

    return row?.lastReadAt ?? null;
  }

  /** Сколько новых сообщений в диалоге для этого человека. */
  private async countUnread(
    manager: EntityManager,
    conversationId: string,
    userId: string,
    lastReadAt: Date | null,
  ): Promise<number> {
    const qb = manager
      .createQueryBuilder(Message, 'message')
      .where('message.conversationId = :conversationId', { conversationId })
      // Свои сообщения читать не нужно, системные — тоже.
      .andWhere('message.senderId IS NOT NULL')
      .andWhere('message.senderId <> :userId', { userId });

    if (lastReadAt) {
      qb.andWhere('message.createdAt > :lastReadAt', { lastReadAt });
    }

    return qb.getCount();
  }

  /** Собеседник личного диалога — второй из пары. */
  private async peerOf(
    manager: EntityManager,
    conversation: Conversation,
    userId: string,
  ): Promise<ConversationPeerDto | null> {
    const otherId =
      conversation.directA === userId
        ? conversation.directB
        : conversation.directA;

    if (!otherId) return null;

    const user = await manager.findOne(User, { where: { id: otherId } });

    if (!user) return null;

    return {
      id: user.id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    };
  }

  /** Проверить, что диалог этому человеку доступен. */
  private async accessible(
    manager: EntityManager,
    userId: string,
    conversationId: number,
  ): Promise<Conversation> {
    const conversation = await manager.findOne(Conversation, {
      where: { id: String(conversationId) },
    });

    if (!conversation) {
      throw new NotFoundException('Диалог не найден');
    }

    if (conversation.kind === 'direct') {
      const member = await manager.findOne(ConversationMember, {
        where: { conversationId: conversation.id, userId },
      });

      if (!member) {
        throw new ForbiddenException('Это не твой диалог');
      }

      return conversation;
    }

    const participant = conversation.tripId
      ? await manager.findOne(TripParticipant, {
          where: { tripId: conversation.tripId, userId },
        })
      : null;

    if (!participant || participant.status === 'declined') {
      throw new ForbiddenException('Этот чат тебе недоступен');
    }

    return conversation;
  }
}
