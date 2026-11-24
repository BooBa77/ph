import { HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';

import type { TripEventsService } from './trip-events.service';
import type { ConversationEventsService } from './conversation-events.service';

/** Как часто писать в поток пустой комментарий, чтобы прокси не закрыли. */
const HEARTBEAT_MS = 25_000;

/**
 * Источник событий — то общее, что есть у канала похода и канала человека.
 *
 * Канал открывается по ключу (id похода или id человека) и отдаёт поток
 * событий своего типа. Больше от него ничего не требуется: заголовки,
 * кадры и закрытие общие.
 */
export interface EventsSource<T> {
  stream(key: string): Observable<T>;
}

/**
 * Открыть SSE-поток изменений — одна реализация на все вкладки и переписку.
 *
 * До 11.11.2026 этот код жил в контроллере «Снаряжения». С «Бухгалтерией»
 * потоков стало два, и второй экземпляр легко разошёлся бы с первым
 * в заголовках: без `X-Accel-Buffering: no` nginx копит кадры, без
 * `retry` клиент переподключается по-своему, а без heartbeat тихая
 * вкладка закрывается через минуту. Поэтому кадры, заголовки и
 * закрытие — здесь, а контроллер только проверяет доступ.
 *
 * 24.11.2026 появился третий вид потока — переписка человека. Он отличается
 * только ключом и именем события, а заголовки и keep-alive ему нужны те же,
 * поэтому общий код вынесен сюда, а не скопирован в `conversations`.
 *
 * **Проверка доступа — до вызова.** Заголовки уходят сразу, и ответить
 * 403 после `flushHeaders` уже нельзя: вызывающий обязан проверить
 * права раньше. У потока переписки проверять нечего: ключ — id человека
 * из токена, подписаться на чужой поток нечем, а аноним отсекает guard.
 */
export function streamSse<T>(
  events: EventsSource<T>,
  key: string,
  eventName: string,
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
    .stream(key)
    .subscribe((event) =>
      response.write(`event: ${eventName}\ndata: ${JSON.stringify(event)}\n\n`),
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

/**
 * Поток изменений вкладки похода: кадры `event: trip`.
 *
 * Обёртка над общим `streamSse` оставлена, чтобы четыре контроллера вкладок
 * не знали ни имени события, ни порядка аргументов.
 */
export function streamTripEvents(
  events: TripEventsService,
  tripId: string,
  request: Request,
  response: Response,
): void {
  streamSse(events, tripId, 'trip', request, response);
}

/**
 * Поток переписки человека: кадры `event: conversation`.
 *
 * Ключ — id человека, а не диалога: чатов у человека девять, а вкладка одна
 * (почему так — в `ConversationEventsService`).
 */
export function streamConversationEvents(
  events: ConversationEventsService,
  userId: string,
  request: Request,
  response: Response,
): void {
  streamSse(events, userId, 'conversation', request, response);
}
