import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Chat } from './entities/chat.entity';
import { GeoObject } from './entities/geo-object.entity';
import { GroupMessage } from './entities/group-message.entity';
import { Role } from './entities/role.entity';
import { TripDateVariant } from './entities/trip-date-variant.entity';
import { TripMembershipRequest } from './entities/trip-membership-request.entity';
import { TripParticipantRole } from './entities/trip-participant-role.entity';
import { TripParticipant } from './entities/trip-participant.entity';
import { TripRouteElement } from './entities/trip-route-element.entity';
import { Trip } from './entities/trip.entity';

/**
 * Домен походов: справочник географических объектов, роли, сами походы,
 * их варианты дат, участники, заявки и чаты.
 *
 * Сервиса и контроллера пока нет — модуль заводится вместе со схемой
 * и не «на будущее», а по делу: рантайм поднимает `autoLoadEntities: true`,
 * а он подхватывает только то, что зарегистрировано через `forFeature`.
 * Незарегистрированная entity не существует для приложения, и следующий
 * шаг («написать сервис») упал бы на «No metadata for Trip was found» —
 * ошибка, которая не говорит, где искать причину.
 *
 * Миграции от этого не зависят: CLI (`data-source.ts`) собирает entity
 * шаблоном по пути `**\/*.entity.ts` и модуля не спрашивает.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      GeoObject,
      Role,
      Trip,
      TripDateVariant,
      TripRouteElement,
      TripParticipant,
      TripParticipantRole,
      TripMembershipRequest,
      Chat,
      GroupMessage,
    ]),
  ],
})
export class TripsModule {}
