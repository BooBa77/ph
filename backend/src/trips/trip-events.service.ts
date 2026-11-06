import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

/**
 * Что именно изменилось на вкладке.
 *
 * Пока вкладка одна — «Снаряжение», и у неё два независимых куска данных:
 * вещи с разделами (`gear`) и чек-листы (`checklist`). Клиент по `scope`
 * решает, что перезапросить: целиком всю вкладку дёргать незачем, а
 * перепутать их значит показать старое рядом с новым.
 */
export type TripEventScope = 'gear' | 'checklist';

/**
 * Событие похода для подписчиков потока (SSE).
 *
 * `actorId` нужен клиенту, чтобы **не перезапрашивать своё же действие**:
 * свой `PATCH` уже вернул свежую строку, и повторный запрос только что
 * сделанного изменения гоняет лишний круг и может перетереть более новое
 * локальное состояние. Чужие действия — наоборот, повод перечитать.
 */
export interface TripEvent {
  scope: TripEventScope;
  actorId: string;
  at: string;
}

/**
 * Канал событий похода — память процесса, без базы и без Redis.
 *
 * Зачем: участники перетасовывают вещи одновременно, и «обнови страницу,
 * чтобы увидеть» — не ответ для вкладки, где двое раскладывают рюкзаки.
 * Поток открыт, пока вкладка «Снаряжение» на экране; событие — сигнал
 * «перечитай данные», а не сами данные.
 *
 * **Почему сигнал, а не готовый объект.** `TripGearItemDto` зависит от
 * смотрящего: чужие личные разделы в ответе обнулены, и разослать всем один
 * DTO автора значило бы отдать его личную раскладку остальным. Перечитать
 * `GET /gear` — единственный способ отдать каждому его правду, и данных
 * там немного (вещи одного похода).
 *
 * **Почему без Redis.** Процесс бэкенда один (`docker-compose.prod.yml`),
 * горизонтального масштабирования нет. Появится второй инстанс — сюда
 * придёт pg_notify или Redis, и это будет замена одного класса, а не всей
 * вкладки.
 *
 * Ключ — id похода строкой: id в базе `bigint`, и TypeORM отдаёт его
 * строкой. Число здесь заставило бы приводить тип в каждом вызове.
 *
 * `Map` чистится сам: когда уходит последний подписчик похода, поток
 * удаляется — иначе карта росла бы на каждый поход, открытый за время
 * жизни процесса.
 */
@Injectable()
export class TripEventsService {
  private readonly streams = new Map<string, Subject<TripEvent>>();

  /** Поток событий одного похода. Отписка последнего закрывает канал. */
  stream(tripId: string): Observable<TripEvent> {
    return new Observable<TripEvent>((subscriber) => {
      const subject = this.channel(tripId);
      const subscription = subject.subscribe(subscriber);

      return () => {
        subscription.unsubscribe();
        if (!subject.observed) this.streams.delete(tripId);
      };
    });
  }

  /** Изменилось снаряжение похода: вещь, раздел или состав. */
  emitGear(tripId: string, actorId: string): void {
    this.emit(tripId, 'gear', actorId);
  }

  /** Изменились чек-листы похода: пункт, отметка, импорт. */
  emitChecklist(tripId: string, actorId: string): void {
    this.emit(tripId, 'checklist', actorId);
  }

  private emit(tripId: string, scope: TripEventScope, actorId: string): void {
    // Нет подписчиков — событие некому отдавать: `next` в пустоту ничего
    // не стоит, но и канал создавать незачем.
    this.streams.get(tripId)?.next({
      scope,
      actorId,
      at: new Date().toISOString(),
    });
  }

  private channel(tripId: string): Subject<TripEvent> {
    const existing = this.streams.get(tripId);
    if (existing) return existing;

    const created = new Subject<TripEvent>();
    this.streams.set(tripId, created);

    return created;
  }
}
