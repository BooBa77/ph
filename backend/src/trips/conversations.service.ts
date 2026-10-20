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
  ConversationPeerDto,
  type OpenDirectDto,
} from './dto/conversation.dto';
import { Conversation } from './entities/conversation.entity';
import { ConversationMember } from './entities/conversation-member.entity';
import { Message } from './entities/message.entity';
import { TripParticipant } from './entities/trip-participant.entity';
import { User } from '../users/entities/user.entity';

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

    const dtos: ConversationDto[] = [];

    for (const conversation of conversations) {
      const member = memberRows.find(
        (row) => row.conversationId === conversation.id,
      );

      const lastMessage = await manager.findOne(Message, {
        where: { conversationId: conversation.id },
        relations: { sender: true },
        order: { id: 'DESC' },
      });

      const unreadCount = await this.countUnread(
        manager,
        conversation.id,
        userId,
        member?.lastReadAt ?? null,
      );

      const peer =
        conversation.kind === 'direct'
          ? await this.peerOf(manager, conversation, userId)
          : null;

      dtos.push(
        ConversationDto.from(conversation, {
          peer,
          lastMessage,
          unreadCount,
          viewerId: userId,
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
        throw new ForbiddenException('Это не ваш диалог');
      }

      return conversation;
    }

    const participant = conversation.tripId
      ? await manager.findOne(TripParticipant, {
          where: { tripId: conversation.tripId, userId },
        })
      : null;

    if (!participant || participant.status === 'declined') {
      throw new ForbiddenException('Этот чат вам недоступен');
    }

    return conversation;
  }
}
