import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

import type { Conversation } from '../entities/conversation.entity';
import type { Message } from '../entities/message.entity';
import { TripMessageDto } from './message.dto';

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

  @ApiProperty({
    description: 'Сколько сообщений новее моего последнего прочтения',
    example: 3,
  })
  unreadCount: number;

  /**
   * Подпись чата похода. Личные подписываются именем собеседника — оно
   * приходит в `peer`, а не строкой: по нему ещё рисуется аватарка.
   *
   * Подписи вкладок здесь тоже есть: чат «Питания», «Трансфера» и «Ночёвок»
   * попадает в общий список диалогов, и без своей строки он назывался бы
   * «Диалог».
   */
  static titleOf(conversation: Conversation, peerName: string | null): string {
    if (conversation.kind === 'trip_guest') return 'Гостевой чат';
    if (conversation.kind === 'trip_members') return 'Чат участников';
    if (conversation.kind === 'trip_meals') return 'Чат питания';
    if (conversation.kind === 'trip_transfer') return 'Чат трансфера';
    if (conversation.kind === 'trip_route') return 'Чат табора';
    return peerName ?? 'Диалог';
  }

  static from(
    conversation: Conversation,
    options: {
      peer: ConversationPeerDto | null;
      lastMessage: Message | null;
      unreadCount: number;
      viewerId: string;
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
      unreadCount: options.unreadCount,
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
