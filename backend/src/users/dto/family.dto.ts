import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

import type { User } from '../entities/user.entity';
import type { FamilyUnionConsent, FamilyUnionStatus } from '../family.types';

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

  @ApiProperty({ description: 'Когда родство возникло (у виртуального — когда завели)' })
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
 * Участник заявки на объединение семей.
 *
 * `consent` и `mine` — то, что нужно экрану: кто уже согласился, кого ещё
 * ждём и к какой стороне относится человек («Ваша семья» / «Их семья»).
 * `isInitiator` отмечает автора заявки: у него согласие не спрашивают.
 */
export class FamilyUnionMemberDto {
  @ApiProperty({ description: 'Id участника' })
  userId: string;

  @ApiProperty({ description: 'Имя', example: 'Пётр' })
  displayName: string;

  @ApiProperty({ description: 'Аватарка: путь или null', nullable: true })
  avatarUrl: string | null;

  @ApiProperty({ description: 'Человек без аккаунта', example: false })
  isVirtual: boolean;

  @ApiProperty({
    description: 'Согласие участника',
    enum: ['pending', 'accepted', 'declined'],
  })
  consent: FamilyUnionConsent;

  @ApiProperty({ description: 'Автор заявки: его согласие не спрашивают' })
  isInitiator: boolean;

  @ApiProperty({ description: 'Человек из моей семьи (а не из присоединяющейся)' })
  mine: boolean;
}

/**
 * Заявка на объединение семей.
 *
 * Одна заявка — не пара, а **состав**: две компоненты связей целиком,
 * поэтому экран показывает список людей и подпись, кто её завёл.
 */
export class FamilyUnionDto {
  @ApiProperty({ description: 'Id заявки' })
  id: string;

  @ApiProperty({
    description: 'Статус заявки',
    enum: ['pending', 'accepted', 'declined', 'cancelled'],
  })
  status: FamilyUnionStatus;

  @ApiProperty({ description: 'Кто завёл заявку' })
  initiatorUserId: string;

  @ApiProperty({ description: 'Имя автора заявки', example: 'Иван' })
  initiatorName: string;

  @ApiProperty({ description: 'Когда заявка создана' })
  createdAt: string;

  @ApiProperty({
    description: 'Мой ответ на заявку',
    enum: ['pending', 'accepted', 'declined'],
  })
  myConsent: FamilyUnionConsent;

  @ApiProperty({ description: 'Заявку завёл я' })
  isInitiator: boolean;

  @ApiProperty({
    description: 'Все участники объединения: обе семьи целиком',
    type: [FamilyUnionMemberDto],
  })
  members: FamilyUnionMemberDto[];
}

/** Три списка «Родных»: действующие родные, входящие и исходящие заявки. */
export class FamilyListDto {
  @ApiProperty({ description: 'Подтверждённые родные', type: [FamilyMemberDto] })
  family: FamilyMemberDto[];

  @ApiProperty({
    description: 'Заявки на объединение семей, которые ждут моего ответа',
    type: [FamilyUnionDto],
  })
  incoming: FamilyUnionDto[];

  @ApiProperty({
    description: 'Мои заявки, которые ждут ответа других',
    type: [FamilyUnionDto],
  })
  outgoing: FamilyUnionDto[];
}

/**
 * Тело `POST /api/users/me/family` — добавить человека в родные.
 *
 * Кого именно назвали, не важно: заявка всё равно собирает **обе семьи
 * целиком** (`family-union.service.ts`). Для своего человека без аккаунта
 * заявки нет — подтверждать ему нечем, родство возникает сразу.
 */
export class AddFamilyMemberDto {
  @ApiProperty({
    description: 'Кого добавляем — id пользователя',
    example: '90ca6b06-fb04-4c5e-8c49-36ef5d188c50',
  })
  @IsUUID('4', { message: 'Нужен корректный UUID человека' })
  userId: string;
}

/** Что ответила ручка добавления: родство сразу или заявка на объединение. */
export class FamilyUnionResultDto {
  @ApiProperty({
    description:
      'Id заявки; null — родство возникло сразу (свой человек без аккаунта)',
    nullable: true,
    example: '3f0c3d59-1c57-4a0f-8f1f-6d0f1f5b2a11',
  })
  unionId: string | null;

  @ApiProperty({
    description:
      'pending — заявка ждёт согласия остальных; accepted — родство действует',
    enum: ['pending', 'accepted'],
  })
  status: 'pending' | 'accepted';
}

/**
 * Человек в предварительном списке объединения.
 *
 * `mine` — из моей семьи: экран раскладывает состав на две колонки, чтобы
 * человек видел, кого именно втягивает, и не подтверждал вслепую.
 */
export class FamilyUnionPreviewMemberDto {
  @ApiProperty({ description: 'Id человека' })
  userId: string;

  @ApiProperty({ description: 'Имя', example: 'Мария' })
  displayName: string;

  @ApiProperty({ description: 'Аватарка: путь или null', nullable: true })
  avatarUrl: string | null;

  @ApiProperty({ description: 'Человек без аккаунта', example: false })
  isVirtual: boolean;

  @ApiProperty({ description: 'Из моей семьи' })
  mine: boolean;
}

/**
 * Что будет, если добавить этого человека.
 *
 * Заказчик: «Инициатор собирает обе компоненты; показывает список людей
 * и предупреждение „снаряжение станет общим“; подтверждает — заявка
 * создана». Поэтому предпросмотр отдаёт состав обеих семей и признак
 * «заявка уже висит»: второй такой же запрос создавать незачем.
 */
export class FamilyUnionPreviewDto {
  @ApiProperty({ description: 'Кого добавляем' })
  targetUserId: string;

  @ApiProperty({ description: 'Имя человека, которого добавляем' })
  targetName: string;

  @ApiProperty({
    description: 'Заявка с этим составом уже ждёт ответа',
    example: false,
  })
  pending: boolean;

  @ApiProperty({
    description: 'Все, кто окажется в семье: обе компоненты связей',
    type: [FamilyUnionPreviewMemberDto],
  })
  members: FamilyUnionPreviewMemberDto[];
}
