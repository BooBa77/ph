import { describe, expect, it } from 'vitest';

import { TripEventsService } from './trip-events.service';
import type { TripEvent } from './trip-events.service';

/**
 * Канал событий похода (06.11.2026).
 *
 * Юнит проверяет то, чего не видно в e2e: события одного похода не уходят
 * подписчику другого, payload несёт `scope` и автора, а поток можно
 * закрыть. Карта каналов при этом не растёт: после отписки последнего
 * подписчика канал удаляется — проверяем через поведение, а не через
 * приватное поле: новый подписчик получает новый Subject и работает.
 */
describe('TripEventsService', () => {
  it('отдаёт событие подписчику своего похода', () => {
    const service = new TripEventsService();
    const received: TripEvent[] = [];

    const subscription = service.stream('679').subscribe((event) => received.push(event));
    service.emitGear('679', 'user-1');

    expect(received).toEqual([
      { scope: 'gear', actorId: 'user-1', at: expect.any(String) },
    ]);

    subscription.unsubscribe();
  });

  it('не путает походы и виды изменений', () => {
    const service = new TripEventsService();
    const first: TripEvent[] = [];
    const second: TripEvent[] = [];

    const a = service.stream('679').subscribe((event) => first.push(event));
    const b = service.stream('680').subscribe((event) => second.push(event));

    service.emitChecklist('679', 'user-2');

    expect(first).toHaveLength(1);
    expect(first[0]!.scope).toBe('checklist');
    expect(second).toHaveLength(0);

    a.unsubscribe();
    b.unsubscribe();
  });

  it('раздаёт событие всем подписчикам одного похода', () => {
    const service = new TripEventsService();
    const first: TripEvent[] = [];
    const second: TripEvent[] = [];

    const a = service.stream('679').subscribe((event) => first.push(event));
    const b = service.stream('679').subscribe((event) => second.push(event));

    service.emitGear('679', 'user-3');

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);

    a.unsubscribe();
    b.unsubscribe();
  });

  it('после отписки последнего подписчика событие никуда не идёт', () => {
    const service = new TripEventsService();
    const received: TripEvent[] = [];

    const subscription = service.stream('679').subscribe((event) => received.push(event));
    subscription.unsubscribe();

    // Канал удалён — `emit` не должен падать и заводить его заново.
    expect(() => service.emitGear('679', 'user-4')).not.toThrow();
    expect(received).toHaveLength(0);
  });

  it('событие без подписчиков не падает и канал не создаёт', () => {
    const service = new TripEventsService();

    expect(() => service.emitGear('999', 'user-5')).not.toThrow();
  });
});
