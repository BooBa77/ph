import { Controller, Get, Param, ParseIntPipe, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { TripDiaryService } from './trip-diary.service';
import { streamTripEvents } from './trip-events-stream';
import { TripEventsService } from './trip-events.service';

/**
 * Живые изменения дневника — Server-Sent Events (16.11.2026).
 *
 * Дневник личный, но у человека бывает два устройства и две вкладки:
 * запись, отправленная из офлайн-очереди на телефоне, должна появиться
 * на планшете без перезагрузки. Поток общий на поход (как у остальных
 * вкладок), а клиент реагирует только на события своего аккаунта —
 * чужая запись в мой дневник всё равно не попадёт.
 *
 * Проверка доступа — до первых заголовков: 403 после `event-stream`
 * уже не отправить.
 */
@ApiTags('trip-diary')
@Controller('trips')
export class TripDiaryEventsController {
  constructor(
    private readonly diary: TripDiaryService,
    private readonly events: TripEventsService,
  ) {}

  @Get(':id/diary/events')
  @ApiOperation({ summary: 'Поток изменений дневника похода (SSE)' })
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
    await this.diary.assertCanWatch(authUser.id, id);

    streamTripEvents(this.events, String(id), request, response);
  }
}
