import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { from, type Observable, switchMap } from 'rxjs';
import { DataSource } from 'typeorm';

import { touchTrip } from './trip-cache-state';

/** Методы, которые меняют данные. GET и HEAD сюда не входят. */
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Личные ветки похода: их правки не делают общую копию устаревшей.
 *
 * - `diary` — личный журнал, чужих записей в нём нет;
 * - `my-meal*` — личные раскладка, список продуктов и отметки покупок;
 * - `messages` — у чатов свои курсоры (`lastMessageId`), и одно сообщение
 *   не должно заставлять перечитывать все вкладки.
 */
const PERSONAL_PARTS = ['/diary/', '/my-meal', '/messages'];

/**
 * Поднять отметку свежести похода после любой правки.
 *
 * Покрытие — главный риск механизма: забытая ручка не поднимает счётчик,
 * и кэш навсегда считает себя свежим. Поэтому не список сервисов, а
 * перехватчик: путь `/trips/:id/...` с не-GET методом — это по определению
 * правка похода, и новый роут попадёт под правило сам, без правки здесь.
 *
 * Ошибку записи отметки **не отдаём наружу**: человек уже сделал дело,
 * и падать из-за служебного счётчика — хуже, чем показать лишний раз
 * устаревшую копию. Ошибка уходит в лог.
 */
@Injectable()
export class TripContentInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TripContentInterceptor.name);

  constructor(private readonly dataSource: DataSource) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const tripId = touchedTripId(context);
    if (tripId === null) return next.handle();

    return next.handle().pipe(
      switchMap((value) =>
        from(this.touch(tripId).then(() => value)),
      ),
    );
  }

  private async touch(tripId: string): Promise<void> {
    try {
      await touchTrip(this.dataSource.manager, tripId);
    } catch (error) {
      this.logger.warn(
        `Не удалось поднять отметку свежести похода ${tripId}: ${String(error)}`,
      );
    }
  }
}

/**
 * Id похода, если этот запрос — правка общего содержимого похода.
 *
 * Путь берётся у маршрута (`request.route.path`), а не у URL: URL содержит
 * конкретный id и query-строку, а маршрут — шаблон `/trips/:id/...`.
 * Возвращается `null`, если запрос не про поход или касается личной ветки.
 */
export function touchedTripId(context: ExecutionContext): string | null {
  if (context.getType() !== 'http') return null;

  const request = context.switchToHttp().getRequest<{
    method?: string;
    route?: { path?: string };
    params?: Record<string, string | undefined>;
  }>();

  const method = (request.method ?? '').toUpperCase();
  if (!MUTATING_METHODS.has(method)) return null;

  const path = request.route?.path ?? '';
  if (!path.includes('/trips/:id')) return null;
  if (PERSONAL_PARTS.some((part) => path.includes(part))) return null;

  const tripId = request.params?.id;
  return tripId && /^\d+$/.test(tripId) ? tripId : null;
}
