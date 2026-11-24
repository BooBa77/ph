import { describe, expect, it, vi } from 'vitest';
import type { DataSource, EntityManager } from 'typeorm';

import { notifyAlmanacUpdated } from './trip-almanac-notify';
import type { Trip } from './entities/trip.entity';

/**
 * «Альманах похода обновлён» — карточка без личного сообщения (24.11.2026).
 *
 * До этого шага функция писала в личный диалог строку «Альманах похода …»
 * и держала три механизма ради неё: проверку «одно непрочитанное на
 * человека на поход», транзакционный замок диалога и кадр `message`
 * в поток переписки. Панель перестала читать диалоги (§14.4 п.2), и всё
 * это ушло: дедупликацию держит уникальный индекс `notifications`
 * (`almanac:<поход>`), а о карточке подписчиков извещает `emitChanged`.
 *
 * Здесь проверяется то, что видно без базы: сообщений не пишется вовсе,
 * карточка заводится одному составу без автора и отказников, сигнал идёт
 * **после** записи. Гонку и живую доставку проверяет e2e `diary`.
 */
const ANNA = '9bd2e553-4321-4877-a6ab-71b991d942b1';
const BORIS = '4c644442-9738-4fed-8a82-393bcce699da';
const VERA = '0f5bbd57-4c1e-4c1e-9f5d-1e36f2f6e3a1';

const TRIP = {
  id: 193,
  goalObject: { name: 'Хамар-Дабан' },
} as unknown as Trip;

interface StubOptions {
  participants?: { userId: string; status: string }[];
}

function stub({
  participants = [
    { userId: ANNA, status: 'going' },
    { userId: BORIS, status: 'going' },
  ],
}: StubOptions = {}) {
  /** Порядок шагов: запись карточки и сигнал — для проверки «после». */
  const log: string[] = [];
  const queries: string[] = [];

  const manager = {
    find: async () => participants,
    insert: vi.fn(async () => {
      log.push('insert');
    }),
    save: vi.fn(async () => {
      log.push('save');
    }),
    create: vi.fn(),
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      return [];
    }),
  };

  const notifications = {
    upsertAlmanac: vi.fn(async () => {
      log.push('card');
    }),
    emitChanged: vi.fn(() => {
      log.push('emit');
    }),
  };

  const dataSource = { manager } as unknown as DataSource;

  return { dataSource, notifications, log, queries, manager };
}

/** Заглушке нужен только `manager.find` — приводим тип один раз. */
function dataSourceOf(source: DataSource): DataSource {
  return source;
}

describe('уведомление альманаха: карточка вместо сообщения', () => {
  it('заводит карточку всем участникам, кроме автора правки', async () => {
    const { dataSource, notifications } = stub({
      participants: [
        { userId: ANNA, status: 'going' },
        { userId: BORIS, status: 'going' },
        { userId: VERA, status: 'maybe' },
      ],
    });

    await notifyAlmanacUpdated(
      dataSourceOf(dataSource),
      notifications,
      TRIP,
      ANNA,
    );

    expect(notifications.upsertAlmanac).toHaveBeenCalledWith(
      expect.anything() as EntityManager,
      {
        tripId: '193',
        tripName: 'Хамар-Дабан',
        recipientIds: [BORIS, VERA],
      },
    );
  });

  /**
   * Главное изменение шага: двойная запись выключена. Ни `insert`, ни
   * `save` не должны вызываться вовсе — в частности, больше нет вставки
   * строки в `messages` и строк состава личного диалога.
   */
  it('не пишет ни одного сообщения', async () => {
    const { dataSource, notifications, manager, queries } = stub();

    await notifyAlmanacUpdated(dataSourceOf(dataSource), notifications, TRIP, ANNA);

    expect(manager.insert).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
    expect(queries.filter((sql) => sql.includes('messages'))).toEqual([]);
  });

  it('сигнал «перечитай уведомления» уходит после записи карточки', async () => {
    const { dataSource, notifications, log } = stub();

    await notifyAlmanacUpdated(dataSourceOf(dataSource), notifications, TRIP, ANNA);

    expect(log).toEqual(['card', 'emit']);
    expect(notifications.emitChanged).toHaveBeenCalledWith([BORIS]);
  });

  it('отказнику карточка не нужна: он уже не в походе', async () => {
    const { dataSource, notifications } = stub({
      participants: [
        { userId: ANNA, status: 'going' },
        { userId: BORIS, status: 'declined' },
      ],
    });

    await notifyAlmanacUpdated(dataSourceOf(dataSource), notifications, TRIP, ANNA);

    expect(notifications.upsertAlmanac).not.toHaveBeenCalled();
    expect(notifications.emitChanged).not.toHaveBeenCalled();
  });

  it('без получателей ничего не делает и не зовёт сервис уведомлений', async () => {
    const { dataSource, notifications, manager } = stub({
      participants: [{ userId: ANNA, status: 'going' }],
    });

    await notifyAlmanacUpdated(dataSourceOf(dataSource), notifications, TRIP, ANNA);

    expect(manager.find).toHaveBeenCalled();
    expect(notifications.upsertAlmanac).not.toHaveBeenCalled();
    expect(notifications.emitChanged).not.toHaveBeenCalled();
  });
});
