import { HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';

import type { TripEventsService } from './trip-events.service';

/** Как часто писать в поток пустой комментарий, чтобы прокси не закрыли. */
const HEARTBEAT_MS = 25_000;

/**
 * Открыть SSE-поток изменений похода — одна реализация на все вкладки.
 *
 * До 11.11.2026 этот код жил в контроллере «Снаряжения». С «Бухгалтерией»
 * потоков стало два, и второй экземпляр легко разошёлся бы с первым
 * в заголовках: без `X-Accel-Buffering: no` nginx копит кадры, без
 * `retry` клиент переподключается по-своему, а без heartbeat тихая
 * вкладка закрывается через минуту. Поэтому кадры, заголовки и
 * закрытие — здесь, а контроллер только проверяет доступ.
 *
 * **Проверка доступа — до вызова.** Заголовки уходят сразу, и ответить
 * 403 после `flushHeaders` уже нельзя: вызывающий обязан проверить
 * права раньше.
 */
export function streamTripEvents(
  events: TripEventsService,
  tripId: string,
  request: Request,
  response: Response,
): void {
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

  const subscription = events
    .stream(tripId)
    .subscribe((event) =>
      response.write(`event: trip\ndata: ${JSON.stringify(event)}\n\n`),
    );

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
