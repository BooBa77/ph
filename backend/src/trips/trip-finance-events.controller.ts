import { Controller, Get, Param, ParseIntPipe, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { TripFinanceService } from './trip-finance.service';
import { streamTripEvents } from './trip-events-stream';
import { TripEventsService } from './trip-events.service';

/**
 * Живые изменения «Бухгалтерии» — Server-Sent Events (11.11.2026).
 *
 * Заказчик: «здесь очень важен SSE, обычно за компенсацию берутся
 * на обратной дороге и все в раз». Один человек отправил перевод, другой
 * подтвердил — у остальных на экране должны сразу измениться статус,
 * баланс и доступные варианты компенсации.
 *
 * Поток отдельный от «Снаряжения»: у вкладок разные права и разные
 * события, а `scope` в кадре говорит клиенту, что перечитать. Проверка
 * доступа — до первых заголовков (иначе 403 уже не отправить).
 */
@ApiTags('trip-finance')
@Controller('trips')
export class TripFinanceEventsController {
  constructor(
    private readonly finance: TripFinanceService,
    private readonly events: TripEventsService,
  ) {}

  @Get(':id/finance/events')
  @ApiOperation({ summary: 'Поток изменений бухгалтерии похода (SSE)' })
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
    await this.finance.assertCanWatch(authUser.id, id);

    streamTripEvents(this.events, String(id), request, response);
  }
}
