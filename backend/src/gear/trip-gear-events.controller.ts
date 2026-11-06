import { Controller, Get, HttpStatus, Param, ParseIntPipe, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { TripEventsService } from '../trips/trip-events.service';
import { TripGearService } from './trip-gear.service';

/** Как часто писать в поток пустой комментарий, чтобы прокси не закрыли. */
const HEARTBEAT_MS = 25_000;

/**
 * Живые изменения вкладки «Снаряжение» — Server-Sent Events (06.11.2026).
 *
 * Заказчик: «пришло время SSE. Участники перетасовывают вещи и нужно видеть
 * изменения онлайн». Вкладку открывают двое-трое одновременно, и перезагрузка
 * страницы после каждого перетаскивания — не ответ.
 *
 * **Почему SSE, а не WebSocket.** Нужен один поток «сервер → клиент»:
 * действия клиента уже уходят обычным `PATCH`, и второго канала для них
 * не требуется. SSE — это обычный HTTP-ответ, который живёт долго: он
 * проходит через nginx и прокси Vite без настройки Upgrade, переподключается
 * сам и не требует библиотек ни на сервере, ни на клиенте.
 *
 * **Почему не `@Sse()` из Nest.** Декоратор подписывается на Observable,
 * который возвращает обработчик, — а нам сначала нужно **асинхронно**
 * проверить доступ (приватность похода и участие). Ответить 403 из
 * Observable уже нельзя: заголовки ушли. Поэтому поток пишется в `Response`
 * руками, а проверка стоит перед первым байтом.
 *
 * **Ручка под вкладкой, а не общая для похода.** Доступ у вкладок разный
 * (снаряжение — только составу), и общий `/trips/:id/events` пришлось бы
 * фильтровать по каждому событию. Появится поток «Питания» — это будет
 * такая же ручка `/trips/:id/meals/events` с той же проверкой домена.
 */
@ApiTags('trip-gear')
@Controller('trips')
export class TripGearEventsController {
  constructor(
    private readonly tripGear: TripGearService,
    private readonly events: TripEventsService,
  ) {}

  /**
   * Открыть поток изменений снаряжения похода.
   *
   * Ответ не заканчивается, пока клиент не закроет соединение: каждое
   * изменение — кадр `event: trip` с JSON `{scope, actorId, at}`.
   * Данные события — **сигнал перечитать**, а не сами вещи: ответ `GET /gear`
   * зависит от смотрящего (чужие личные разделы в нём обнулены).
   */
  @Get(':id/gear/events')
  @ApiOperation({ summary: 'Поток изменений снаряжения похода (SSE)' })
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
    await this.tripGear.assertCanWatch(authUser.id, id);

    response.status(HttpStatus.OK);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    // `no-transform` — чтобы сжатие посредника не копило кадры в буфере.
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    /**
     * nginx по умолчанию копит ответ в буфере: «онлайн»-события приезжали бы
     * пачками по мере заполнения буфера. Заголовок отключает это для
     * конкретного ответа, не трогая конфиг сервера.
     */
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();

    // Просим клиента переподключаться через 3 с, если связь оборвалась.
    response.write('retry: 3000\n\n');

    const subscription = this.events
      .stream(String(id))
      .subscribe((event) => response.write(`event: trip\ndata: ${JSON.stringify(event)}\n\n`));

    /**
     * Пустой комментарий раз в 25 секунд. Нужен не клиенту, а посредникам:
     * nginx и мобильные сети закрывают соединение, по которому ничего не
     * шло. `: ping` — законный кадр SSE, парсер его пропускает.
     */
    const heartbeat = setInterval(() => response.write(': ping\n\n'), HEARTBEAT_MS);

    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;

      clearInterval(heartbeat);
      subscription.unsubscribe();
      // Клиент уже ушёл — `end` завершит ответ, если сокет ещё открыт.
      if (!response.writableEnded) response.end();
    };

    // `close` приходит и при обрыве, и после штатного `end` — повтор
    // отсекает флаг: `clearInterval` и `unsubscribe` идемпотентны, но
    // лишний `end` в закрытый ответ пишет предупреждение в лог.
    request.on('close', close);
    response.on('close', close);
  }
}
