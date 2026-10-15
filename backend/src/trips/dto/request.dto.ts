import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import type { TripMembershipRequest } from '../entities/trip-membership-request.entity';
import { REQUEST_DIRECTIONS, type RequestDirection } from '../trip.types';

/**
 * Тело `POST /api/trips/:id/requests` — завести тикет.
 *
 * Один эндпоинт на оба направления, потому что и таблица одна: поля те же,
 * различает их только `direction`. Приглашение (`invite`) создаёт
 * организатор и обязан назвать человека; заявку (`apply`) создаёт любой,
 * и `userId` ей не нужен — им становится владелец токена. Передать чужой
 * `userId` в заявке нельзя: `forbidNonWhitelisted` тут не поможет (поле
 * есть в DTO), поэтому лишнее отбивает сервис.
 */
export class CreateRequestDto {
  @ApiProperty({
    description:
      'invite — приглашение от организатора (нужен userId), apply — заявка на участие',
    enum: REQUEST_DIRECTIONS,
    example: 'apply',
  })
  @IsIn(REQUEST_DIRECTIONS, { message: 'Недопустимое направление тикета' })
  direction: RequestDirection;

  @ApiProperty({
    description: 'Кого приглашаем. Обязателен для invite, запрещён для apply',
    example: '90ca6b06-fb04-4c5e-8c49-36ef5d188c50',
    required: false,
  })
  @IsOptional()
  @IsUUID('4', { message: 'Приглашаемому нужен корректный UUID пользователя' })
  userId?: string;

  @ApiProperty({
    description: 'Текст приглашения или обращения',
    example: 'Ищу напарника с опытом ночёвок зимой',
    maxLength: 2000,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: 'Сообщение должно быть строкой' })
  @MaxLength(2000, { message: 'Сообщение не должно превышать 2000 символов' })
  message?: string | null;
}

/**
 * Тикет наружу: приглашение или заявка.
 *
 * Статуса у тикета нет — он живёт, пока не обработан; историей служат
 * системные сообщения в чатах. Поэтому наружу уходит только то, что в нём
 * есть: кто, в какую сторону, с каким текстом и когда.
 */
export class TripRequestDto {
  @ApiProperty({ description: 'Id пользователя', example: '90ca6b06-…' })
  userId: string;

  @ApiProperty({ description: 'Отображаемое имя', example: 'booba' })
  displayName: string;

  @ApiProperty({ description: 'URL аватарки', nullable: true })
  avatarUrl: string | null;

  @ApiProperty({
    description: 'Направление: invite — приглашение, apply — заявка',
    enum: REQUEST_DIRECTIONS,
    example: 'apply',
  })
  direction: RequestDirection;

  @ApiProperty({
    description: 'Текст приглашения или обращения',
    nullable: true,
  })
  message: string | null;

  @ApiProperty({ description: 'Когда тикет заведён' })
  createdAt: string;

  static from(request: TripMembershipRequest): TripRequestDto {
    return {
      userId: request.userId,
      displayName: request.user?.displayName ?? 'Неизвестный',
      avatarUrl: request.user?.avatarUrl ?? null,
      direction: request.direction,
      message: request.message,
      createdAt: request.createdAt.toISOString(),
    };
  }
}

export class TripRequestListDto {
  @ApiProperty({ description: 'Тикеты похода', type: [TripRequestDto] })
  requests: TripRequestDto[];
}
