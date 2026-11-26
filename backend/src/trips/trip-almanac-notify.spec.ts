import { describe, expect, it, vi } from 'vitest';
import type { DataSource, EntityManager } from 'typeorm';

import { notifyAlmanacUpdated } from './trip-almanac-notify';
import type { Trip } from './entities/trip.entity';

/**
 * «Альманах похода обновлён» — карточка без личного сообщения (24.11.2026;
 * аудитория и вид — 26.11.2026).
 *
 * До этого шага функция писала в личный диалог строку «Альманах похода …»
 * и держала три механизма ради неё: проверку «одно непрочитанное на
 * человека на поход», транзакционный замок диалога и кадр `message`
 * в поток переписки. Панель перестала читать диалоги (§14.4 п.2), и всё
 * это ушло: дедупликацию держит уникальный индекс `notifications`
 * (`almanac_changed:<поход>`), а о карточке подписчиков извещает
 * `emitChanged`.
 *
 * С 26.11.2026 получателей считает `NotificationsService.tripAudience`
 * (активный состав без автора и виртуальных) — здесь проверяется, что
 * функция зовёт именно его и пишет карточку после расчёта. Само правило
 * аудитории — в `notifications.service.spec.ts`.
 */
const ANNA = '9bd2e553-4321-4877-a6ab-71b991d942b1';
const BORIS = '4c644442-9738-4fed-8a82-393bcce699da';
const VERA = '0f5bbd57-4c1e-4c1e-9f5d-1e36f2f6e3a1';

const TRIP = {
  id: 193,
  goalObject: { name: 'Хамар-Дабан' },
} as unknown as Trip;

function stub({ recipients = [BORIS] }: { recipients?: string[] } = {}) {
  /** Порядок шагов: расчёт, запись карточки и сигнал — для проверки «после». */
  const log: string[] = [];
  const queries: string[] = [];

  const manager = {
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
    tripAudience: vi.fn(async () => {
      log.push('audience');
      return recipients;
    }),
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

describe('уведомление альманаха: карточка вместо сообщения', () => {
  it('считает аудиторию без автора и заводит карточку', async () => {
    const { dataSource, notifications } = stub({
      recipients: [BORIS, VERA],
    });

    await notifyAlmanacUpdated(dataSource, notifications, TRIP, ANNA);

    expect(notifications.tripAudience).toHaveBeenCalledWith(
      expect.anything() as EntityManager,
      '193',
      { actorUserId: ANNA },
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
   * Двойная запись выключена: ни `insert`, ни `save` не должны вызываться
   * вовсе — в частности, больше нет вставки строки в `messages` и строк
   * состава личного диалога.
   */
  it('не пишет ни одного сообщения', async () => {
    const { dataSource, notifications, manager, queries } = stub();

    await notifyAlmanacUpdated(dataSource, notifications, TRIP, ANNA);

    expect(manager.insert).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
    expect(queries.filter((sql) => sql.includes('messages'))).toEqual([]);
  });

  it('сигнал «перечитай уведомления» уходит после записи карточки', async () => {
    const { dataSource, notifications, log } = stub();

    await notifyAlmanacUpdated(dataSource, notifications, TRIP, ANNA);

    expect(log).toEqual(['audience', 'card', 'emit']);
    expect(notifications.emitChanged).toHaveBeenCalledWith([BORIS]);
  });

  it('пустая аудитория — ничего не пишет и не шлёт кадр', async () => {
    const { dataSource, notifications } = stub({ recipients: [] });

    await notifyAlmanacUpdated(dataSource, notifications, TRIP, ANNA);

    expect(notifications.tripAudience).toHaveBeenCalled();
    expect(notifications.upsertAlmanac).not.toHaveBeenCalled();
    expect(notifications.emitChanged).not.toHaveBeenCalled();
  });
});
