import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import type { Conversation } from '../entities/conversation.entity';
import type { Message } from '../entities/message.entity';
import { MessageActionDto } from './message-action.dto';
import { CHAT_TITLES, TripMessageDto } from './message.dto';

/** Кто собеседник в личном диалоге. */
export class ConversationPeerDto {
  @ApiProperty({ description: 'Id пользователя' })
  id: string;

  @ApiProperty({ description: 'Имя' })
  displayName: string;

  @ApiProperty({ description: 'Аватарка', nullable: true })
  avatarUrl: string | null;
}

/** Диалог в списке «новых сообщений». */
export class ConversationDto {
  @ApiProperty({ description: 'Id диалога', example: '1' })
  id: string;

  @ApiProperty({
    description: 'Вид: direct, trip_guest, trip_members',
    example: 'direct',
  })
  kind: string;

  @ApiProperty({ description: 'Поход для чатов похода. null — личный', nullable: true })
  tripId: string | null;

  @ApiProperty({
    description: 'Подпись: имя собеседника или название чата',
    example: 'Иван',
  })
  title: string;

  @ApiProperty({
    description: 'Собеседник. null — чат похода',
    type: () => ConversationPeerDto,
    nullable: true,
  })
  peer: ConversationPeerDto | null;

  @ApiProperty({
    description: 'Последнее сообщение. null — пусто',
    type: () => TripMessageDto,
    nullable: true,
  })
  lastMessage: TripMessageDto | null;

  /**
   * Действие диалога — одно, и какое именно, решает сервер (24.11.2026).
   *
   * Раньше лента брала действие из `lastMessage.action`, и любая следующая
   * реплика (в том числе «Организатор запросил платёж») перекрывала строку
   * перевода: кнопка «Подтверждаю» исчезала, а строка уезжала с верха.
   * Здесь лежит выбранное действие независимо от того, на каком сообщении
   * оно висит. Приоритет: неразрешённый перевод выше просьбы о платеже;
   * просьба видна, только когда перевода нет или он уже подтверждён.
   * `null` — действий нет.
   *
   * Это поле — контракт ленты. `lastMessage.action` остаётся ради
   * совместимости и старых проверок, но рисовать кнопки по нему больше
   * нельзя: он по-прежнему описывает последнее сообщение, а не диалог.
   */
  @ApiProperty({
    description:
      'Действие диалога: неразрешённый перевод, иначе просьба о платеже. ' +
      'null — действий нет',
    type: () => MessageActionDto,
    nullable: true,
  })
  action: MessageActionDto | null;

  @ApiProperty({
    description: 'Сколько сообщений новее моего последнего прочтения',
    example: 3,
  })
  unreadCount: number;

  /**
   * Название похода для чата похода. null — личный диалог.
   *
   * Без него лента писала бы «Чат бухгалтерии» и не говорила, какого
   * похода; название лежит в `trips.announcement`, а если он пуст —
   * в цели похода, как в остальных экранах.
   */
  @ApiProperty({
    description: 'Название похода. null — личный диалог',
    example: 'Витязь',
    nullable: true,
  })
  tripTitle: string | null;

  /**
   * Заглушены ли уведомления по этому диалогу.
   *
   * Отдельный флаг, а не только `mutedAt`: клиенту нужно решение
   * «показывать строку или нет», а не время, когда её выключили.
   */
  @ApiProperty({ description: 'Уведомления по диалогу заглушены', example: false })
  muted: boolean;

  /**
   * Когда собеседник последний раз читал личный диалог.
   *
   * Отметка «прочитано» ставится не на каждое сообщение: хранится одна
   * метка на диалог, и «прочитано» получают все мои сообщения, созданные
   * до неё. `null` — собеседник диалог ещё не открывал.
   */
  @ApiProperty({
    description: 'Когда собеседник читал диалог. null — не открывал',
    nullable: true,
  })
  peerLastReadAt: string | null;

  /**
   * Подпись чата: имя собеседника или название чата похода.
   *
   * Личные подписываются именем собеседника — оно приходит в `peer`, а не
   * строкой: по нему ещё рисуется аватарка. Названия чатов похода берутся
   * из `CHAT_TITLES` — того же словаря, что у `GET /trips/:id/chats`:
   * отдельная копия здесь уже приводила к «Диалогу» вместо «Чата
   * снаряжения» (23.11.2026).
   */
  static titleOf(conversation: Conversation, peerName: string | null): string {
    const tripTitle = (CHAT_TITLES as Record<string, string>)[conversation.kind]

    return tripTitle ?? peerName ?? 'Диалог'
  }

  static from(
    conversation: Conversation,
    options: {
      peer: ConversationPeerDto | null;
      lastMessage: Message | null;
      unreadCount: number;
      viewerId: string;
      /** Действие диалога: одно, приоритет выбран сервисом. */
      action?: MessageActionDto | null;
      /** Название похода для чатов похода, null — личный диалог. */
      tripTitle?: string | null;
      /** Заглушены ли уведомления у этого человека. */
      muted?: boolean;
      /** Когда собеседник последний раз читал диалог. */
      peerLastReadAt?: Date | null;
    },
  ): ConversationDto {
    return {
      id: conversation.id,
      kind: conversation.kind,
      tripId: conversation.tripId,
      title: ConversationDto.titleOf(conversation, options.peer?.displayName ?? null),
      peer: options.peer,
      lastMessage: options.lastMessage
        ? TripMessageDto.from(options.lastMessage, options.viewerId)
        : null,
      action: options.action ?? null,
      unreadCount: options.unreadCount,
      tripTitle: options.tripTitle ?? null,
      muted: options.muted === true,
      peerLastReadAt: options.peerLastReadAt?.toISOString() ?? null,
    };
  }
}

export class ConversationListDto {
  @ApiProperty({ type: [ConversationDto] })
  conversations: ConversationDto[];
}

/** Тело `POST /api/conversations/direct` — открыть личный диалог. */
export class OpenDirectDto {
  @ApiProperty({
    description: 'С кем говорить',
    example: '90ca6b06-fb04-4c5e-8c49-36ef5d188c50',
  })
  @IsUUID('4', { message: 'Нужен корректный UUID собеседника' })
  userId: string;
}

/**
 * Параметры `GET /api/conversations/:id/messages`.
 *
 * Курсор `before` и размер страницы — те же, что у чатов похода: лента
 * правой колонки читает тем же кодом и листает историю так же. `kind` здесь
 * не нужен: диалог уже выбран id, в отличие от `GET /trips/:id/messages`.
 */
export class ConversationMessageQueryDto {
  @ApiProperty({
    description: 'Сколько сообщений вернуть',
    example: 50,
    default: 50,
    maximum: 100,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Размер страницы должен быть целым числом' })
  @Min(1, { message: 'Размер страницы — от 1 до 100' })
  @Max(100, { message: 'Размер страницы — от 1 до 100' })
  limit?: number;

  @ApiProperty({
    description: 'Id сообщения, до которого листаем (не включая его)',
    example: '120',
    required: false,
  })
  @IsOptional()
  @Matches(/^\d+$/, { message: 'Курсор должен быть id сообщения' })
  before?: string;
}

/**
 * Тело `POST /api/conversations/:id/messages`.
 *
 * Только текст: вид чата уже известен по id диалога, а вложение или
 * действие вешает сервер, а не клиент.
 */
export class SendConversationMessageDto {
  @ApiProperty({
    description:
      'Текст: markdown (GFM). Санитайз — при рендере, в базе лежит исходник',
    example: 'Буду к восьми',
    minLength: 1,
    maxLength: 4000,
  })
  @IsString({ message: 'Сообщение должно быть строкой' })
  @MinLength(1, { message: 'Сообщение не может быть пустым' })
  @MaxLength(4000, { message: 'Сообщение не должно превышать 4000 символов' })
  body: string;
}
