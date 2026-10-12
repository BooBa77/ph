import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { User } from '../users/entities/user.entity';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { CalendarActivity } from './entities/activity.entity';
import { CalendarActivityFavorite } from './entities/activity-favorite.entity';
import { CalendarActivityGroup } from './entities/activity-group.entity';
import { CalendarActivityType } from './entities/activity-type.entity';
import { CalendarActivityTypeRequest } from './entities/activity-type-request.entity';
import { CalendarDay } from './entities/calendar-day.entity';
import { CalendarStateDay } from './entities/calendar-state-day.entity';

/**
 * Календарь пользователя.
 *
 * `User` в forFeature нужен ради одной колонки — `calendar_mode`: режим
 * работы ставится при создании календаря на год, и это часть логики
 * календаря, а не профиля. Через UsersService за этим ходить незачем.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      CalendarDay,
      CalendarStateDay,
      User,
      CalendarActivityGroup,
      CalendarActivityType,
      CalendarActivity,
      CalendarActivityFavorite,
      CalendarActivityTypeRequest,
    ]),
  ],
  controllers: [CalendarController],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}
