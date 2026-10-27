import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CalendarActivityType } from '../calendar/entities/activity-type.entity';
import { Conversation } from './entities/conversation.entity';
import { ConversationMember } from './entities/conversation-member.entity';
import { GeoObject } from './entities/geo-object.entity';
import { Message } from './entities/message.entity';
import { MessageAction } from './entities/message-action.entity';
import { Role } from './entities/role.entity';
import { RoleTabPermission } from './entities/role-tab-permission.entity';
import { TripDateVariant } from './entities/trip-date-variant.entity';
import { TripMealAllocation } from './entities/trip-meal-allocation.entity';
import { TripProduct } from './entities/trip-product.entity';
import { TripMealCheck } from './entities/trip-meal-check.entity';
import { TripMealDishExclusion } from './entities/trip-meal-dish-exclusion.entity';
import { TripMealDish } from './entities/trip-meal-dish.entity';
import { TripMealLine } from './entities/trip-meal-line.entity';
import { TripMealPackage } from './entities/trip-meal-package.entity';
import { TripMeal } from './entities/trip-meal.entity';
import { TripMembershipRequest } from './entities/trip-membership-request.entity';
import { TripParticipantRole } from './entities/trip-participant-role.entity';
import { TripParticipant } from './entities/trip-participant.entity';
import { TripRouteElement } from './entities/trip-route-element.entity';
import { TripTransferLeg } from './entities/trip-transfer-leg.entity';
import { TripTransferPassenger } from './entities/trip-transfer-passenger.entity';
import { TripType } from './entities/trip-type.entity';
import { Trip } from './entities/trip.entity';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';
import { TripMealsController } from './trip-meals.controller';
import { TripMealsService } from './trip-meals.service';
import { TripMyMealsController } from './trip-my-meals.controller';
import { TripTransferController } from './trip-transfer.controller';
import { TripTransferService } from './trip-transfer.service';
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
      RoleTabPermission,
      Trip,
      TripDateVariant,
      TripMeal,
      TripMealDish,
      TripMealLine,
      TripMealPackage,
      TripProduct,
      TripMealAllocation,
      TripMealCheck,
      TripMealDishExclusion,
      TripRouteElement,
      TripTransferLeg,
      TripTransferPassenger,
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
    TripMealsController,
    TripMyMealsController,
    TripTransferController,
    ObjectsController,
    MessageActionsController,
    ConversationsController,
  ],
  providers: [
    TripsService,
    TripMealsService,
    TripTransferService,
    ObjectsService,
    MessageActionsService,
    ConversationsService,
  ],
  exports: [
    TripsService,
    TripMealsService,
    TripTransferService,
    ObjectsService,
    MessageActionsService,
    ConversationsService,
  ],
})
export class TripsModule {}
