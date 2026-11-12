import { Controller, Get, Param, ParseIntPipe, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { TripEventsService } from './trip-events.service';
import { streamTripEvents } from './trip-events-stream';
import { TripMealsService } from './trip-meals.service';

/**
 * Живые изменения «Питания» — Server-Sent Events (12.11.2026).
 *
 * Заказчик: «Две группы закупщиков могут работать параллельно в соседних
 * супермаркетах и хорошо бы при прокликивании закупленных продуктов коллеги
 * были в курсе или если внезапно повар что-то вспомнил и добавил
 * в чек-лист». Поэтому поток открывает **модалка списка продуктов**: пока
 * она на экране, отметка «куплено», введённое количество и правка раскладки
 * доезжают до остальных.
 *
 * Отдельная ручка, как у «Снаряжения» и «Бухгалтерии»: права у вкладок
 * разные, общий `/trips/:id/events` пришлось бы фильтровать на каждом кадре.
 */
@ApiTags('trip-meals')
@Controller('trips')
export class TripMealsEventsController {
  constructor(
    private readonly meals: TripMealsService,
    private readonly events: TripEventsService,
  ) {}

  @Get(':id/meals/events')
  @ApiOperation({ summary: 'Поток изменений питания похода (SSE)' })
  @ApiOkResponse({
    description:
      'text/event-stream: кадры `event: trip`, данные — JSON {scope, actorId, at}',
  })
  async stream(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    // Проверка до заголовков: отказавшему достаётся обычный 403/404 JSON.
    await this.meals.assertCanWatch(authUser.id, id);

    streamTripEvents(this.events, String(id), request, response);
  }
}
