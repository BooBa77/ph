import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

import type { TripTab } from '../trip-tabs';
import { TRIP_TABS } from '../trip-tabs';
import type { Trip } from '../entities/trip.entity';
import type { TripStatus } from '../trip.types';
import { TripRoleDto } from './participant.dto';
import { TripGoalDto } from './trip-response.dto';

/**
 * Вкладка похода с правом смотреть/править.
 *
 * `canEdit` — «может править», а не «может видеть»: видят вкладки все
 * участники (решение заказчика 21.10.2026), а роль отвечает на вопрос
 * «кто ведёт». Гостю, который в походе не участвует, отдаётся только
 * гостевая вкладка.
 */
export class TripTabDto {
  @ApiProperty({
    description: 'Код вкладки',
    enum: TRIP_TABS,
    example: 'meals',
  })
  code: TripTab;

  @ApiProperty({
    description: 'Может ли этот человек править вкладку',
    example: false,
  })
  canEdit: boolean;
}

export class TripTabListDto {
  @ApiProperty({ description: 'Вкладки похода', type: [TripTabDto] })
  tabs: TripTabDto[];
}

/**
 * Справочник активных ролей — для выбора при назначении.
 *
 * Тот же `TripRoleDto`, что и у состава: код и название. Отдельный тип
 * не нужен — роль везде имеет одни и те же два поля.
 */
export class RoleListDto {
  @ApiProperty({
    description: 'Активные роли: код и название',
    type: [TripRoleDto],
  })
  roles: TripRoleDto[];
}

/**
 * Тело `PUT /api/trips/:id/participants/:userId/roles`.
 *
 * **Присланный список заменяет прежний целиком** — как у типов похода:
 * у роли нет стабильного «места в списке», и «третья роль» после правки
 * означала бы уже другую. Организатор похода роль `organizer` сохраняет
 * при любом теле: она производная от `trips.organizer_user_id`.
 */
export class SetParticipantRolesDto {
  @ApiProperty({
    description: 'Коды ролей. Пустой список — снять все роли',
    type: [String],
    example: ['quartermaster', 'driver'],
  })
  @IsArray({ message: 'Роли должны быть массивом кодов' })
  @ArrayMaxSize(9, { message: 'У участника не больше девяти ролей' })
  @IsString({ each: true, message: 'Код роли должен быть строкой' })
  @MaxLength(50, { each: true, message: 'Код роли слишком длинный' })
  roleCodes: string[];
}

/**
 * Поход глазами гостя — урезанное представление.
 *
 * Гость — зарегистрированный человек, который **в походе не участвует**.
 * Ему показывается гостевая вкладка, собранная из «Общей»: цель, анонс,
 * походные даты, маршрут, требования, коммерция и цена. **Места сбора здесь
 * нет** (решение заказчика 21.10.2026): «где встречаемся» — дело тех, кто
 * уже в составе.
 *
 * Чего здесь нет намеренно: состава участников, фактических дат выхода
 * и возвращения, приватных пометок. Гость узнаёт, куда и когда идут
 * и сколько это стоит, — и решает, проситься ли в поход.
 */
export class GuestTripDto {
  @ApiProperty({ description: 'Id похода', example: '7' })
  id: string;

  @ApiProperty({
    description: 'Цель похода',
    type: () => TripGoalDto,
    nullable: true,
  })
  goalObject: TripGoalDto | null;

  @ApiProperty({ description: 'Анонс', nullable: true })
  announcement: string | null;

  @ApiProperty({ description: 'Маршрут со ссылками [[object:N]]' })
  routeText: string;

  @ApiProperty({ description: 'Требования к участникам', nullable: true })
  requirementsText: string | null;

  @ApiProperty({
    description: 'Стадия подготовки',
    enum: ['idea', 'planning', 'decided'],
    example: 'planning',
  })
  status: TripStatus;

  @ApiProperty({ description: 'Начало по решению организатора', nullable: true })
  startsAt: string | null;

  @ApiProperty({ description: 'Конец по решению организатора', nullable: true })
  endsAt: string | null;

  @ApiProperty({ description: 'Коммерческий поход', example: false })
  isCommercial: boolean;

  @ApiProperty({ description: 'Цена участия, рубли', nullable: true })
  priceRub: number | null;

  @ApiProperty({ description: 'Что входит в стоимость', nullable: true })
  priceNote: string | null;

  @ApiProperty({ description: 'Официальный поход', example: false })
  isOfficial: boolean;

  @ApiProperty({ description: 'Набор закрыт', example: false })
  isRecruitmentClosed: boolean;

  static from(trip: Trip): GuestTripDto {
    return {
      id: trip.id,
      goalObject: trip.goalObject
        ? {
            id: trip.goalObject.id,
            name: trip.goalObject.name,
            type: trip.goalObject.type,
            url: trip.goalObject.url,
          }
        : null,
      announcement: trip.announcement,
      routeText: trip.routeText,
      requirementsText: trip.requirementsText,
      status: trip.status,
      startsAt: trip.startsAt?.toISOString() ?? null,
      endsAt: trip.endsAt?.toISOString() ?? null,
      isCommercial: trip.isCommercial,
      priceRub: trip.priceRub,
      priceNote: trip.priceNote,
      isOfficial: trip.isOfficial,
      isRecruitmentClosed: trip.isRecruitmentClosed,
    };
  }
}
