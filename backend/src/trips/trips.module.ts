import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CalendarActivityType } from '../calendar/entities/activity-type.entity';
import { Conversation } from './entities/conversation.entity';
import { ConversationMember } from './entities/conversation-member.entity';
import { GeoObject } from './entities/geo-object.entity';
import { Message } from './entities/message.entity';
import { MessageAction } from './entities/message-action.entity';
import { Role } from './entities/role.entity';
import { TripDateVariant } from './entities/trip-date-variant.entity';
import { TripMembershipRequest } from './entities/trip-membership-request.entity';
import { TripParticipantRole } from './entities/trip-participant-role.entity';
import { TripParticipant } from './entities/trip-participant.entity';
import { TripRouteElement } from './entities/trip-route-element.entity';
import { TripType } from './entities/trip-type.entity';
import { Trip } from './entities/trip.entity';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { MessageActionsController } from './message-actions.controller';
import { MessageActionsService } from './message-actions.service';
import { ObjectsController } from './objects.controller';
import { ObjectsService } from './objects.service';

/**
 * Домен походов: справочник географических объектов, роли, сами походы,
 * их варианты дат, типы, участники, заявки и чаты.
 *
 * `CalendarActivityType` в `forFeature` нужен ради одной проверки —
 * существования id типа похода перед вставкой в `trip_types`, — и это
 * ровно тот случай, что `User` в `CalendarModule`: сущность принадлежит
 * другому домену, но проверка нужна здесь. Ходить за ней через
 * `CalendarService` незачем: справочник читается, а не меняется.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      GeoObject,
      Role,
      Trip,
      TripDateVariant,
      TripRouteElement,
      TripType,
      TripParticipant,
      TripParticipantRole,
      TripMembershipRequest,
      Conversation,
      ConversationMember,
      Message,
      MessageAction,
      CalendarActivityType,
    ]),
  ],
  controllers: [
    TripsController,
    ObjectsController,
    MessageActionsController,
    ConversationsController,
  ],
  providers: [
    TripsService,
    ObjectsService,
    MessageActionsService,
    ConversationsService,
  ],
  exports: [TripsService, ObjectsService, MessageActionsService, ConversationsService],
})
export class TripsModule {}
