import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

import type { Role } from '../entities/role.entity';
import type { TripParticipant } from '../entities/trip-participant.entity';
import {
  PARTICIPANT_DECISIONS,
  PARTICIPANT_STATUSES,
  type ParticipantDecision,
  type ParticipantStatus,
} from '../trip.types';

/** Роль участника: код для логики, подпись для человека. */
export class TripRoleDto {
  @ApiProperty({ description: 'Код роли', example: 'quartermaster' })
  code: string;

  @ApiProperty({ description: 'Название роли по-русски', example: 'Завхоз' })
  name: string;

  static from(role: Role): TripRoleDto {
    return { code: role.code, name: role.name };
  }
}

/**
 * Участник похода: кто, как участвует и какие у него роли.
 *
 * Имя и аватарка вкладываются, а не отдаются ссылкой на `/api/users/:id`:
 * состав — это список людей, и рисовать его без N+1 запросов иначе нельзя.
 * Наружу уходит только публичная часть профиля.
 */
export class TripParticipantDto {
  @ApiProperty({
    description: 'Id пользователя',
    example: '90ca6b06-fb04-4c5e-8c49-36ef5d188c50',
  })
  userId: string;

  @ApiProperty({ description: 'Отображаемое имя', example: 'booba' })
  displayName: string;

  @ApiProperty({ description: 'URL аватарки', nullable: true })
  avatarUrl: string | null;

  @ApiProperty({
    description: 'Участие: invited, going, maybe, declined',
    enum: PARTICIPANT_STATUSES,
    example: 'going',
  })
  status: ParticipantStatus;

  @ApiProperty({
    description: 'Роли в походе. Пусто — ролей нет',
    type: [TripRoleDto],
  })
  roles: TripRoleDto[];

  @ApiProperty({
    description: 'Организатор: автор похода, его нельзя убрать из состава',
    example: false,
  })
  isOrganizer: boolean;

  @ApiProperty({ description: 'Когда человек попал в состав' })
  createdAt: string;

  @ApiProperty({
    description:
      'Когда статус менялся последний раз — по нему видно, кто тянет с ответом',
  })
  updatedAt: string;

  static from(
    participant: TripParticipant,
    roles: TripRoleDto[],
    organizerUserId: string,
  ): TripParticipantDto {
    return {
      userId: participant.userId,
      displayName: participant.user?.displayName ?? 'Неизвестный',
      avatarUrl: participant.user?.avatarUrl ?? null,
      status: participant.status,
      roles,
      isOrganizer: participant.userId === organizerUserId,
      createdAt: participant.createdAt.toISOString(),
      updatedAt: participant.updatedAt.toISOString(),
    };
  }
}

export class ParticipantListDto {
  @ApiProperty({ description: 'Состав похода', type: [TripParticipantDto] })
  participants: TripParticipantDto[];
}

/**
 * Тело `PATCH /api/trips/:id/participants/me` — свой статус участия.
 *
 * Организатору это тоже доступно: «организую, но сам не иду» — законная
 * ситуация, и статус `declined` для него разрешён.
 */
export class UpdateMyStatusDto {
  @ApiProperty({
    description: 'Новый статус участия',
    enum: PARTICIPANT_STATUSES,
    example: 'maybe',
  })
  @IsIn(PARTICIPANT_STATUSES, { message: 'Недопустимый статус участия' })
  status: ParticipantStatus;
}

/**
 * Тело `POST /api/trips/:id/requests/:userId/accept` — «иду» или «пока
 * не решил». Отказа здесь нет: отказ — это `DELETE` тикета.
 */
export class AcceptRequestDto {
  @ApiProperty({
    description: 'Ответ на приглашение или решение по заявке',
    enum: PARTICIPANT_DECISIONS,
    example: 'going',
  })
  @IsIn(PARTICIPANT_DECISIONS, {
    message: 'Ответом может быть только «иду» или «пока не решил»',
  })
  status: ParticipantDecision;

  @ApiProperty({
    description: 'Зарезервировано: ответ с текстом. Пока не используется',
    required: false,
    nullable: true,
  })
  @IsOptional()
  message?: string | null;
}
