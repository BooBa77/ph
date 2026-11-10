import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

import type { User } from '../entities/user.entity';
import type { FamilyLinkStatus } from '../family.types';

/**
 * Родной человек в списке «Контактов».
 *
 * Это не публичный профиль: сюда попадают только те, с кем родство уже
 * подтверждено (или кого завёл сам человек — виртуального). Ничего кроме
 * имени и аватарки список не отдаёт: родство — про бюджет и снаряжение,
 * а не про право читать чужой профиль.
 */
export class FamilyMemberDto {
  @ApiProperty({ description: 'Id пользователя' })
  userId: string;

  @ApiProperty({ description: 'Имя', example: 'Анна' })
  displayName: string;

  @ApiProperty({
    description: 'Аватарка: путь или null',
    nullable: true,
    example: null,
  })
  avatarUrl: string | null;

  @ApiProperty({
    description:
      'Человек без аккаунта: он не может войти, им управляет владелец списка',
    example: false,
  })
  isVirtual: boolean;

  @ApiProperty({
    description: 'Когда родство подтвердили (для виртуального — когда завели)',
  })
  since: string;

  static from(user: User, since: Date): FamilyMemberDto {
    return {
      userId: user.id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      isVirtual: user.isVirtual,
      since: since.toISOString(),
    };
  }
}

/**
 * Запрос в родные: отправленный мной или ожидающий моего ответа.
 *
 * `direction` избавляет фронт от вычисления «кто кому» по id: у входящего
 * запроса кнопки «Принять»/«Отклонить», у исходящего — «Отменить».
 */
export class FamilyRequestDto {
  @ApiProperty({ description: 'Id человека по ту сторону запроса' })
  userId: string;

  @ApiProperty({ description: 'Имя', example: 'Иван' })
  displayName: string;

  @ApiProperty({
    description: 'Аватарка: путь или null',
    nullable: true,
    example: null,
  })
  avatarUrl: string | null;

  @ApiProperty({
    description: 'Направление запроса: incoming — мне, outgoing — от меня',
    enum: ['incoming', 'outgoing'],
  })
  direction: 'incoming' | 'outgoing';

  @ApiProperty({ description: 'Когда запрос отправлен' })
  requestedAt: string;

  static from(
    user: User,
    direction: 'incoming' | 'outgoing',
    requestedAt: Date,
  ): FamilyRequestDto {
    return {
      userId: user.id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      direction,
      requestedAt: requestedAt.toISOString(),
    };
  }
}

/** Три списка «Родных»: действующие, входящие и исходящие запросы. */
export class FamilyListDto {
  @ApiProperty({ description: 'Подтверждённые родные', type: [FamilyMemberDto] })
  family: FamilyMemberDto[];

  @ApiProperty({
    description: 'Запросы, которые ждут моего ответа',
    type: [FamilyRequestDto],
  })
  incoming: FamilyRequestDto[];

  @ApiProperty({
    description: 'Мои запросы, которые ждут ответа другого человека',
    type: [FamilyRequestDto],
  })
  outgoing: FamilyRequestDto[];
}

/**
 * Тело `POST /api/users/me/family` — добавить человека в родные.
 *
 * Для настоящего пользователя создаётся запрос на подтверждение; для
 * своего человека без аккаунта родство возникает сразу — подтверждать
 * ему нечем.
 */
export class AddFamilyMemberDto {
  @ApiProperty({
    description: 'Кого добавляем — id пользователя',
    example: '90ca6b06-fb04-4c5e-8c49-36ef5d188c50',
  })
  @IsUUID('4', { message: 'Нужен корректный UUID человека' })
  userId: string;
}

/** Что ответила ручка добавления: родство сразу или запрос на подтверждение. */
export class FamilyLinkResultDto {
  @ApiProperty({ description: 'С кем связь' })
  userId: string;

  @ApiProperty({
    description:
      'accepted — родство действует; pending — запрос отправлен и ждёт ответа',
    enum: ['pending', 'accepted'],
  })
  status: FamilyLinkStatus;
}
