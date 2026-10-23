import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import type { Message } from '../entities/message.entity';
import { MessageActionDto } from './message-action.dto';
import { CHAT_KINDS, type ChatKind } from '../trip.types';

/**
 * Подписи чатов для человека.
 *
 * В базе `kind` — код (`trip_guest`), и наружу он тоже уходит кодом: по нему
 * фронт выбирает оформление. Подпись здесь ради Swagger и отладки — рисовать
 * интерфейс по ней нельзя, иначе переводы однажды окажутся в API.
 */
const CHAT_TITLES: Record<ChatKind, string> = {
  trip_guest: 'Гостевой чат',
  trip_members: 'Чат участников',
  trip_meals: 'Чат питания',
};

/** Сообщение чата похода. */
export class TripMessageDto {
  @ApiProperty({ description: 'Id сообщения', example: '1' })
  id: string;

  @ApiProperty({
    description: 'Автор. null — системное сообщение',
    example: '90ca6b06-fb04-4c5e-8c49-36ef5d188c50',
    nullable: true,
  })
  senderId: string | null;

  @ApiProperty({
    description: 'Имя автора. null — системное сообщение',
    example: 'booba',
    nullable: true,
  })
  senderName: string | null;

  @ApiProperty({ description: 'Аватарка автора', nullable: true })
  senderAvatarUrl: string | null;

  @ApiProperty({
    description:
      'Текст сообщения: markdown (GFM), санитайз при рендере обязателен',
    example: 'Возьму палатку и горелку',
  })
  body: string;

  @ApiProperty({
    description:
      'Системное сообщение — производное от `senderId`: автора нет, значит система. Отдельного флага в базе нет, чтобы он не разошёлся с автором',
    example: false,
  })
  isSystem: boolean;

  @ApiProperty({ description: 'Когда отправлено' })
  createdAt: string;

  /**
   * Действие, которое показывает сообщение: кнопки «Да»/«Нет».
   *
   * Кнопки рисуются только адресату, поэтому canRespond считается
   * для того, кто читает: без этого фронт показывал бы «Да» тому,
   * кто деньги отправил.
   */
  @ApiProperty({
    description: 'Действие в сообщении. null — обычное сообщение',
    type: () => MessageActionDto,
    nullable: true,
  })
  action: MessageActionDto | null;

  static from(message: Message, viewerId: string): TripMessageDto {
    return {
      id: message.id,
      senderId: message.senderId,
      senderName: message.sender?.displayName ?? null,
      senderAvatarUrl: message.sender?.avatarUrl ?? null,
      body: message.body,
      isSystem: message.senderId === null,
      createdAt: message.createdAt.toISOString(),
      action: message.action
        ? MessageActionDto.from(
            message.action,
            viewerId,
            message.senderId,
          )
        : null,
    };
  }
}

/** Чат похода, доступный этому человеку. */
export class TripChatDto {
  @ApiProperty({ description: 'Id чата', example: '1' })
  id: string;

  @ApiProperty({
    description: 'Вид чата',
    enum: CHAT_KINDS,
    example: 'trip_guest',
  })
  kind: ChatKind;

  @ApiProperty({ description: 'Подпись для человека', example: 'Гостевой чат' })
  title: string;

  @ApiProperty({
    description:
      'Можно ли писать. Право читать и писать здесь одно: чат либо доступен, либо нет',
    example: true,
  })
  canWrite: boolean;

  @ApiProperty({
    description: 'Последнее сообщение чата. null — чат пуст',
    type: () => TripMessageDto,
    nullable: true,
  })
  lastMessage: TripMessageDto | null;

  static from(
    chat: { id: string; kind: ChatKind },
    lastMessage: TripMessageDto | null,
  ): TripChatDto {
    return {
      id: chat.id,
      kind: chat.kind,
      title: CHAT_TITLES[chat.kind] ?? chat.kind,
      canWrite: true,
      lastMessage,
    };
  }
}

export class TripChatListDto {
  @ApiProperty({
    description: 'Чаты, доступные этому человеку',
    type: [TripChatDto],
  })
  chats: TripChatDto[];
}

/**
 * Страница сообщений: от старых к новым.
 *
 * `hasMore` — есть ли ещё сообщения выше первого в ответе. Без него фронт
 * не отличил бы «начало переписки» от «страница кончилась, листай дальше».
 */
export class TripMessageListDto {
  @ApiProperty({
    description: 'Сообщения в хронологическом порядке',
    type: [TripMessageDto],
  })
  messages: TripMessageDto[];

  @ApiProperty({
    description: 'Есть ли ещё более старые сообщения',
    example: true,
  })
  hasMore: boolean;
}

/**
 * Параметры `GET /api/trips/:id/messages`.
 *
 * `before` — курсор: id самого старого сообщения, которое уже есть
 * у клиента. Листание по id, а не по дате: id уникален и монотонен, а две
 * записи с одинаковой `created_at` — обычное дело, и на дате страница
 * либо зациклилась бы, либо теряла сообщения.
 */
export class TripMessageQueryDto {
  @ApiProperty({
    description: 'Какой чат читаем',
    enum: CHAT_KINDS,
    example: 'trip_members',
  })
  @IsIn(CHAT_KINDS, { message: 'Недопустимый вид чата' })
  kind: ChatKind;

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

/** Тело `POST /api/trips/:id/messages`. */
export class SendTripMessageDto {
  @ApiProperty({
    description: 'В какой чат пишем',
    enum: CHAT_KINDS,
    example: 'trip_members',
  })
  @IsIn(CHAT_KINDS, { message: 'Недопустимый вид чата' })
  kind: ChatKind;

  @ApiProperty({
    description:
      'Текст: markdown (GFM). Санитайз — при рендере, в базе лежит исходник',
    example: 'Возьму палатку и горелку',
    minLength: 1,
    maxLength: 4000,
  })
  @IsString({ message: 'Сообщение должно быть строкой' })
  @MinLength(1, { message: 'Сообщение не может быть пустым' })
  @MaxLength(4000, { message: 'Сообщение не должно превышать 4000 символов' })
  body: string;
}
