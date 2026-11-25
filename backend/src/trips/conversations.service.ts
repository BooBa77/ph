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
  type EditConversationMessageDto,
  type OpenDirectDto,
  type SendConversationMessageDto,
} from './dto/conversation.dto';
import {
  TripMessageDto,
  type TripMessageListDto,
} from './dto/message.dto';
import { MessageActionDto } from './dto/message-action.dto';
import { Conversation } from './entities/conversation.entity';
import { ConversationMember } from './entities/conversation-member.entity';
import { Message } from './entities/message.entity';
import { Trip } from './entities/trip.entity';
import { TripParticipant } from './entities/trip-participant.entity';
import { ConversationEventsService } from './conversation-events.service';
import { NotificationsService } from './notifications.service';
import { tripNameOf } from './trip-name';
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
  constructor(
    private readonly dataSource: DataSource,
    /**
     * Канал событий переписки (24.11.2026). Публикация — здесь, а не
     * в контроллере: событие должно уйти только после того, как сообщение
     * легло в базу, а отметить прочитанным значит знать состав диалога.
     */
    private readonly events: ConversationEventsService,
    /**
     * Уведомления правой панели (24.11.2026): новое сообщение даёт карточку
     * «об этом чате», прочтение — убирает её. Логика самих карточек живёт
     * в `NotificationsService`, здесь только вызовы.
     */
    private readonly notifications: NotificationsService,
  ) {}

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

    /**
     * Один диалог — одна строка.
     *
     * Чат похода попадает в обе выборки, как только у человека появляется
     * строка состава: её создают отметка прочтения и галочка «Уведомлять».
     * Без склейки по id лента показала бы такой чат дважды, а бейдж посчитал
     * бы непрочитанное два раза (на живом стенде 23.11.2026: 17 диалогов
     * вместо 9, потому что восемь чатов похода уже были отмечены).
     */
    const unique = [...new Map(conversations.map((row) => [row.id, row])).values()];

    // Названия походов одним запросом: «Чат бухгалтерии» без названия
    // похода не говорит, куда идти.
    const tripTitles = await this.tripTitlesOf(manager, unique);

    const dtos: ConversationDto[] = [];

    for (const conversation of unique) {
      dtos.push(
        await this.buildDto(manager, conversation, {
          viewerId: userId,
          member:
            memberRows.find(
              (row) => row.conversationId === conversation.id,
            ) ?? null,
          participation,
          tripTitles,
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
   * Один диалог — то же, что строка списка, но без остальных.
   *
   * Экран диалога (`/messages/:id`) открывается по прямой ссылке и о
   * диалоге не знает ничего, кроме id: ему нужны подпись, собеседник,
   * название похода и состояние галочки. Отдаём ту же `ConversationDto`,
   * что и список, — иначе экран и лента разошлись бы в трактовке
   * непрочитанного.
   *
   * Отдельной проверки доступа здесь нет: её делает `accessible()`,
   * то есть состав диалога или состав похода.
   */
  async getOne(
    userId: string,
    conversationId: number,
  ): Promise<ConversationDto> {
    const manager = this.dataSource.manager;
    const conversation = await this.accessible(
      manager,
      userId,
      conversationId,
    );

    const member = await manager.findOne(ConversationMember, {
      where: { conversationId: conversation.id, userId },
    });

    const participation = await manager.find(TripParticipant, {
      where: { userId, status: Not('declined') },
    });

    const tripTitles = await this.tripTitlesOf(manager, [conversation]);

    return this.buildDto(manager, conversation, {
      viewerId: userId,
      member,
      participation,
      tripTitles,
    });
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
    const recipients = await this.dataSource.transaction(async (manager) => {
      const conversation = await this.accessible(manager, userId, conversationId);

      const existing = await manager.findOne(ConversationMember, {
        where: { conversationId: conversation.id, userId },
      });

      if (existing) {
        existing.lastReadAt = new Date();
        await manager.save(existing);
        return this.participantsOf(manager, conversation);
      }

      // Для чата похода строки состава могло не быть — она ленивая.
      await manager.insert(ConversationMember, {
        conversationId: conversation.id,
        userId,
        lastReadAt: new Date(),
      });

      return this.participantsOf(manager, conversation);
    });

    /**
     * Отметка прочтения — второе событие переписки (24.11.2026).
     *
     * Без него «Прочитано» у автора сообщения появлялось бы только после
     * перезагрузки или следующего опроса: метка лежит в
     * `conversation_members` и в ленте не видна. Шлём после транзакции:
     * событие «прочитано» до коммита было бы неправдой.
     */
    this.events.emitRead(recipients, String(conversationId), userId);

    /**
     * Открыли чат — карточка уведомления исчезает (§14.2).
     *
     * Удаление без архива: следующее новое сообщение создаст её заново.
     * Своё событие `notifications` уходит только если строка была —
     * иначе панель перечитывалась бы на каждое открытие чата впустую.
     */
    await this.notifications.closeForConversation(conversationId, userId);
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

    /**
     * Событие «новое сообщение» — уже после вставки (24.11.2026).
     *
     * Получатели — состав диалога: у личного это пара участников, у чата
     * похода — состав похода без отказавшихся. Автору тоже уходит: у него
     * может быть вторая вкладка, и «своё» там узнаётся по `actorId`.
     */
    this.events.emitMessage(
      await this.participantsOf(manager, conversation),
      conversation.id,
      userId,
    );

    /**
     * Карточка уведомления — после сообщения (24.11.2026, §14).
     *
     * Уведомление не заменяет сообщение в этом шаге: старая лента ещё
     * читает `messages`, панель уведомлений — новую таблицу (двойная
     * запись). Дедупликация — по диалогу, так что пять сообщений подряд
     * обновят одну карточку.
     */
    await this.notifications.notifyChatMessage(conversation.id, userId, body);

    return TripMessageDto.from(saved, userId);
  }

  /**
   * Оповестить участников диалога о новом сообщении.
   *
   * Сообщение в чат похода умеет писать ещё и `TripsService`
   * (`POST /trips/:id/messages` — им пользуется вкладка чата похода).
   * Логика получателей должна быть одна, поэтому путь через «Трипсы»
   * зовёт этот метод, а не считает состав сам: иначе личный диалог и чат
   * похода разошлись бы в том, кому слать событие.
   */
  async notifyMessage(conversationId: string, actorId: string): Promise<void> {
    const manager = this.dataSource.manager;
    const conversation = await manager.findOne(Conversation, {
      where: { id: conversationId },
    });

    if (!conversation) return;

    this.events.emitMessage(
      await this.participantsOf(manager, conversation),
      conversation.id,
      actorId,
    );
  }

  /**
   * Отредактировать своё сообщение в личном диалоге или чате похода (25.11.2026).
   *
   * Права проверяются здесь, а не в контроллере: `accessible()` — тот же
   * вход, что у чтения и отправки, а сверх него сообщение должно быть
   * **своим**. Системное (`sender_id IS NULL`) не правится никогда: это
   * история событий, а не реплика человека. Сообщение с денежным действием
   * тоже не правится — текст уведомления о переводе человеку не принадлежит,
   * и подменить его значило бы поменять условия денег.
   */
  async editMessage(
    userId: string,
    conversationId: number,
    messageId: string,
    dto: EditConversationMessageDto,
  ): Promise<TripMessageDto> {
    const manager = this.dataSource.manager;
    const conversation = await this.accessible(
      manager,
      userId,
      conversationId,
    );

    return this.editMessageIn(conversation, userId, messageId, dto.body);
  }

  /**
   * Ядро правки — для обоих входов: `/conversations/:id/...` и
   * `/trips/:id/...`.
   *
   * Второй вход нужен гостю публичного похода: он пишет в гостевой чат, но
   * строки состава у него нет, и `accessible()` ответил бы ему 403.
   * `TripsService` находит чат по паре «поход + вид» (там же проверка
   * доступа гостя) и зовёт этот метод — проверка «моё ли сообщение»
   * остаётся одна на оба входа.
   */
  async editMessageIn(
    conversation: Conversation,
    userId: string,
    messageId: string,
    body: string,
  ): Promise<TripMessageDto> {
    const value = body.trim();
    if (value.length === 0) {
      throw new BadRequestException('Сообщение не может состоять из пробелов');
    }

    const manager = this.dataSource.manager;
    const message = await this.ownMessage(
      manager,
      conversation,
      userId,
      messageId,
    );

    // Тот же текст — не ошибка, но и события нет: переписывать нечего.
    if (message.body === value) return TripMessageDto.from(message, userId);

    message.body = value;
    await manager.save(message);

    /**
     * Кадр `message_updated` — после записи (24.11.2026, вид уже был).
     *
     * `actorId` — человек, а не пустая строка: правивший уже получил новый
     * текст ответом ручки, и второй раз ему его применять не нужно. Для
     * собеседника это обычное чужое действие, и открытая переписка
     * заменит тело строки без перезагрузки.
     */
    this.events.emitMessageUpdated(
      await this.participantsOf(manager, conversation),
      conversation.id,
      { id: message.id, body: message.body },
      userId,
    );

    return TripMessageDto.from(message, userId);
  }

  /**
   * Удалить своё сообщение — физически (25.11.2026).
   *
   * **Почему без пометки «удалено».** Заказчик просил «удалить», а не
   * «скрыть»: оставленная строка «сообщение удалено» занимает место в
   * переписке и продолжает считаться непрочитанной у собеседника, хотя
   * читать в ней нечего. Физическое удаление не требует миграции, а
   * `unreadCount` считается по строкам `messages` — после удаления он сам
   * становится честным. Листание по `id` разрыва не замечает: курсор
   * `before` — это «всё, что меньше id», и пропавшая строка просто
   * не встретится.
   *
   * «Прочитано» не ломается: метка живёт на диалог, а не на сообщение;
   * после удаления последнего своего сообщения «Прочитано» переезжает на
   * предыдущее — оно тоже прочитано, если собеседник дочитал до удалённого.
   */
  async deleteMessage(
    userId: string,
    conversationId: number,
    messageId: string,
  ): Promise<void> {
    const manager = this.dataSource.manager;
    const conversation = await this.accessible(
      manager,
      userId,
      conversationId,
    );

    return this.deleteMessageIn(conversation, userId, messageId);
  }

  /** Ядро удаления — те же два входа, что у правки. */
  async deleteMessageIn(
    conversation: Conversation,
    userId: string,
    messageId: string,
  ): Promise<void> {
    const manager = this.dataSource.manager;
    const message = await this.ownMessage(
      manager,
      conversation,
      userId,
      messageId,
    );

    const result = await manager.delete(Message, {
      id: message.id,
      conversationId: conversation.id,
    });

    // Строку нашли мгновением раньше, но параллельный DELETE мог её
    // забрать: честнее ответить 404, чем разослать событие о несуществующем.
    if (!result.affected) {
      throw new NotFoundException('Сообщение не найдено');
    }

    this.events.emitMessageDeleted(
      await this.participantsOf(manager, conversation),
      conversation.id,
      message.id,
      userId,
    );
  }

  /**
   * Найти сообщение для правки и удаления и проверить, что оно своё.
   *
   * Порядок отказов важен: сначала «есть ли такое сообщение в этом
   * диалоге» (404), потом «моё ли» (403) — чужое сообщение не должно
   * превращаться в «не найдено» только потому, что его автор другой.
   * Системное сообщение — тоже 403: у него нет автора, и разрешать его
   * править некому.
   */
  private async ownMessage(
    manager: EntityManager,
    conversation: Conversation,
    userId: string,
    messageId: string,
  ): Promise<Message> {
    const message = await manager.findOne(Message, {
      where: { id: String(messageId), conversationId: conversation.id },
      relations: { sender: true, action: true },
    });

    if (!message) {
      throw new NotFoundException('Сообщение не найдено');
    }

    if (message.senderId === null) {
      throw new ForbiddenException('Системное сообщение изменить нельзя');
    }

    if (message.senderId !== userId) {
      throw new ForbiddenException('Можно менять только своё сообщение');
    }

    if (message.actionId !== null) {
      throw new ForbiddenException('Денежное сообщение менять нельзя');
    }

    return message;
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
   * Собрать DTO одного диалога: последнее сообщение, непрочитанное,
   * собеседник и отметка прочтения.
   *
   * Отдельным методом, потому что это нужно двум ручкам — списку и экрану
   * одного диалога. Второй расчёт непрочитанного разошёлся бы с первым
   * ровно на том сообщении, из-за которого счётчик и видно.
   */
  private async buildDto(
    manager: EntityManager,
    conversation: Conversation,
    context: {
      viewerId: string;
      /** Строка состава — у чатов похода она ленивая и может отсутствовать. */
      member: ConversationMember | null;
      /** Участие человека в походах: нужно для отсчёта непрочитанного. */
      participation: TripParticipant[];
      tripTitles: Map<string, string>;
    },
  ): Promise<ConversationDto> {
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
      context.member?.lastReadAt ??
      context.participation.find((row) => row.tripId === conversation.tripId)
        ?.createdAt ??
      null;

    /**
     * Та же граница уходит клиенту `myLastReadAt` (25.11.2026).
     *
     * Экран диалога показывает разделитель «Новые сообщения» и
     * прокручивается к первому непрочитанному, а отметку прочтения ставит
     * сразу при открытии — после неё первое непрочитанное уже не вычислить.
     * Поэтому граница приходит вместе с `unreadCount`, и экран запоминает
     * её до `POST /read`. Второго расчёта нет намеренно: разделитель обязан
     * совпасть со счётчиком на том же сообщении.
     */
    const unreadCount = await this.countUnread(
      manager,
      conversation.id,
      context.viewerId,
      since,
    );

    const peer =
      conversation.kind === 'direct'
        ? await this.peerOf(manager, conversation, context.viewerId)
        : null;

    const peerLastReadAt =
      conversation.kind === 'direct'
        ? await this.peerReadAt(manager, conversation, peer?.id ?? null)
        : null;

    const dto = ConversationDto.from(conversation, {
      peer,
      lastMessage,
      unreadCount,
      viewerId: context.viewerId,
      tripTitle: conversation.tripId
        ? (context.tripTitles.get(conversation.tripId) ?? null)
        : null,
      muted: Boolean(context.member?.mutedAt),
      peerLastReadAt,
      myLastReadAt: since,
    });

    /**
     * Действие диалога, а не только последнего сообщения (24.11.2026).
     *
     * Раньше кнопка «Подтверждаю» жила на последнем сообщении диалога, и
     * любая реплика после уведомления о переводе её гасила. С полем обратной
     * связи («деньги ещё не пришли, жду») это перестало быть редким случаем —
     * человек пишет отправителю и тут же теряет возможность подтвердить.
     *
     * **Какое действие показывать, решает сервер, а не порядок сообщений.**
     * Неразрешённый перевод (`pending`, адресован смотрящему) важнее просьбы
     * организатора о платеже: пока перевод ждёт ответа, лента обязана держать
     * «Подтверждаю», даже если просьба пришла позже. Просьба выходит вперёд,
     * только когда перевода в диалоге нет или он уже подтверждён. Двух
     * действий лента не показывает — поле одно.
     *
     * **Почему `disputed` не попадает.** Кнопки «не получено» больше нет,
     * такие строки остались только от прежних прогонов; поднимать их снова
     * в ленту значило бы вернуть снятый сценарий.
     *
     * Запрос один на диалог, как и раньше: из него же берётся действие для
     * `lastMessage.action` — совместимость со старыми проверками сохраняется.
     */
    const pending = await manager.find(Message, {
      where: {
        conversationId: conversation.id,
        action: { targetUserId: context.viewerId, state: 'pending' },
      },
      relations: { action: true },
      order: { id: 'DESC' },
    });

    const dialogAction =
      pending.find((row) => row.action?.kind === 'money_received') ??
      pending.find((row) => row.action?.kind === 'payment_request') ??
      null;

    if (dialogAction?.action) {
      dto.action = MessageActionDto.from(
        dialogAction.action,
        context.viewerId,
        dialogAction.senderId,
      );
    }

    if (
      dto.lastMessage !== null &&
      dto.lastMessage.action === null &&
      pending[0]?.action
    ) {
      dto.lastMessage.action = MessageActionDto.from(
        pending[0].action,
        context.viewerId,
        pending[0].senderId,
      );
    }

    return dto;
  }

  /**
   * Названия походов для чатов похода — одним запросом.
   *
   * Имя похода — цель (`tripNameOf` в `trip-name.ts`), та же функция, что
   * называет поход в уведомлениях: иначе одно и то же место называлось бы
   * по-разному. Анонс — подпись гостевой, а не имя.
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
      await Promise.all(
        trips.map(async (trip) => [
          trip.id,
          await tripNameOf(manager, trip),
        ] as const),
      ),
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

  /**
   * Кому доступен диалог — по этому списку и рассылается событие.
   *
   * Те же правила, что у `accessible()`: личный диалог — пара участников,
   * чат похода — состав похода без отказавшихся. Отказник из чата не
   * получает ни сообщений, ни метки прочтения: он «не участник», и
   * событие о жизни чата ему не нужно.
   */
  private async participantsOf(
    manager: EntityManager,
    conversation: Conversation,
  ): Promise<string[]> {
    if (conversation.kind === 'direct') {
      return [conversation.directA, conversation.directB].filter(
        (id): id is string => Boolean(id),
      );
    }

    if (!conversation.tripId) return [];

    const rows = await manager.find(TripParticipant, {
      where: { tripId: conversation.tripId, status: Not('declined') },
    });

    return rows.map((row) => row.userId);
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
