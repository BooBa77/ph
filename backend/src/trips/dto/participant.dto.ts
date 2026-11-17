import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

import { USER_GENDERS, type UserGender } from '../../users/gender.types';
import type { Role } from '../entities/role.entity';
import type { TripParticipant } from '../entities/trip-participant.entity';
import {
  PARTICIPANT_DECISIONS,
  PARTICIPANT_STATUSES,
  PRESENCE_ACTIONS,
  PRESENCE_SOURCES,
  type ParticipantDecision,
  type ParticipantStatus,
  type PresenceAction,
  type PresenceSource,
  type PresenceStatus,
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

  /**
   * Пол участника — нужен распределению веса рюкзака (Ф7).
   *
   * В публичном профиле (`/people/:id`) пола **нет**: случайному гостю
   * его не показывают. Здесь он есть, потому что состав похода — это
   * люди, которые идут вместе, и без пола алгоритм не посчитает доли.
   */
  @ApiProperty({
    description: 'Пол: m — мужской, f — женский',
    enum: USER_GENDERS,
    example: 'm',
  })
  gender: UserGender;

  @ApiProperty({
    description: 'Участие: invited, going, maybe, declined',
    enum: PARTICIPANT_STATUSES,
    example: 'going',
  })
  status: ParticipantStatus;

  @ApiProperty({
    description: 'Вегетарианец — мясное на него не считается',
    example: false,
  })
  isVegetarian: boolean;

  @ApiProperty({ description: 'Аллергии из профиля', nullable: true })
  allergies: string | null;

  @ApiProperty({
    description: 'Питается отдельно: не едок, пакеты еды не назначаются',
    example: false,
  })
  eatsSeparately: boolean;

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

  /**
   * Человек без аккаунта — его завёл организатор, войти он не может
   * (30.10.2026).
   *
   * Фронту флаг нужен в двух местах: пометка «без аккаунта» в составе
   * и **выбор хозяина** при ручном добавлении снаряжения — там список
   * «я + виртуальные похода», и настоящего участника в нём нет (решение
   * заказчика: другой настоящий участник добавляет вещь себе сам).
   */
  @ApiProperty({
    description: 'Человек без аккаунта: заведён организатором, войти не может',
    example: false,
  })
  isVirtual: boolean;

  @ApiProperty({ description: 'Когда человек попал в состав' })
  createdAt: string;

  @ApiProperty({
    description:
      'Когда статус менялся последний раз — по нему видно, кто тянет с ответом',
  })
  updatedAt: string;

  /**
   * Присутствие (17.11.2026): перекличка «на маршруте / вернулся».
   *
   * `presenceStatus` — производное от двух времён: `returned` (есть
   * возвращение), `route` (есть выход, возвращения нет), `none` (не
   * отметился). Фронт по нему решает, что рисовать, и не сравнивает даты
   * сам: правило одно и живёт на сервере.
   */
  @ApiProperty({
    description: 'Когда человек отметил выход на маршрут',
    nullable: true,
  })
  startedAt: string | null;

  @ApiProperty({ description: 'Когда человек отметил возвращение', nullable: true })
  returnedAt: string | null;

  @ApiProperty({
    description: 'Присутствие: route — на маршруте, returned — вернулся, none — не отметился',
    enum: ['route', 'returned', 'none'],
    example: 'route',
  })
  presenceStatus: PresenceStatus;

  @ApiProperty({
    description: 'Кто поставил отметку. null — её ещё не ставили',
    nullable: true,
  })
  presenceUpdatedByUserId: string | null;

  @ApiProperty({
    description: 'Сам отметил (self) или другой идущий (other)',
    enum: PRESENCE_SOURCES,
    nullable: true,
  })
  presenceSource: PresenceSource | null;

  static presenceOf(
    participant: Pick<TripParticipant, 'startedAt' | 'returnedAt'>,
  ): PresenceStatus {
    if (participant.returnedAt) return 'returned';
    if (participant.startedAt) return 'route';

    return 'none';
  }

  static from(
    participant: TripParticipant,
    roles: TripRoleDto[],
    organizerUserId: string,
  ): TripParticipantDto {
    return {
      userId: participant.userId,
      displayName: participant.user?.displayName ?? 'Неизвестный',
      avatarUrl: participant.user?.avatarUrl ?? null,
      // Пользователь не удаляется физически, так что связь всегда есть;
      // `m` — то же значение, что DEFAULT в базе, и оно не выдумывает
      // коэффициент, а повторяет правило «пол не заполнен — считаем
      // мужским».
      gender: participant.user?.gender ?? 'm',
      status: participant.status,
      isVegetarian: participant.user?.isVegetarian ?? false,
      allergies: participant.user?.allergies ?? null,
      eatsSeparately: participant.eatsSeparately,
      roles,
      isOrganizer: participant.userId === organizerUserId,
      isVirtual: participant.user?.isVirtual ?? false,
      createdAt: participant.createdAt.toISOString(),
      updatedAt: participant.updatedAt.toISOString(),
      startedAt: participant.startedAt?.toISOString() ?? null,
      returnedAt: participant.returnedAt?.toISOString() ?? null,
      presenceStatus: TripParticipantDto.presenceOf(participant),
      presenceUpdatedByUserId: participant.presenceUpdatedBy ?? null,
      presenceSource: participant.presenceSource ?? null,
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
 * Организатору доступно «пока не решил», но не `declined`: решение
 * 16.11.2026 — организатор не может быть «не иду», он автор похода.
 * Раньше `declined` разрешался, и это была ошибка: состав без автора
 * выглядит как брошенный поход, а присутствие отмечают те, кто в поле.
 */
export class UpdateMyStatusDto {
  @ApiProperty({
    description: 'Новый статус участия',
    enum: PARTICIPANT_STATUSES,
    example: 'maybe',
  })
  @IsIn(PARTICIPANT_STATUSES, { message: 'Недопустимый статус участия' })
  status: ParticipantStatus;

  @ApiProperty({
    description:
      'Питаться отдельно: не едок, пакеты еды не назначаются. Не задано — не трогаем',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'Флаг отдельного питания должен быть true или false' })
  eatsSeparately?: boolean;
}

/**
 * Тело `PUT /api/trips/:id/presence/:userId` — отметка присутствия.
 *
 * Отмечает **любой идущий** участник: себе и любому другому, включая
 * человека без аккаунта. Цель — любой участник, кроме `declined`.
 * `none` снимает обе отметки: «нажал не туда» исправляется там же, где
 * поставили, и не требует админки.
 */
export class UpdatePresenceDto {
  @ApiProperty({
    description: 'route — на маршруте, returned — вернулся, none — снять отметки',
    enum: PRESENCE_ACTIONS,
    example: 'route',
  })
  @IsIn(PRESENCE_ACTIONS, {
    message: 'Отметка: route, returned или none',
  })
  status: PresenceAction;
}

/**
 * Тело `PATCH /api/trips/:id/participants/:userId/diet` — питание человека
 * без аккаунта.
 *
 * Флагов два и они из разных мест: «питается отдельно» — свойство **этого
 * похода** (`trip_participants`), «вегетарианец» — свойство человека
 * (`users`). Оба меняются одной ручкой, потому что на экране это две
 * галочки в одной строке.
 *
 * Менять их может участник похода — тот, кто ведёт чужой аккаунт, а не
 * только организатор (решение заказчика 12.11.2026).
 */
export class UpdateParticipantDietDto {
  @ApiProperty({
    description:
      'Питается отдельно: не едок, пакеты еды не назначаются. Не задано — не трогаем',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'Флаг отдельного питания должен быть true или false' })
  eatsSeparately?: boolean;

  @ApiProperty({
    description: 'Вегетарианец. Не задано — не трогаем',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'Флаг вегетарианца должен быть true или false' })
  isVegetarian?: boolean;
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
