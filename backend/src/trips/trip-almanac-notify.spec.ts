import { describe, expect, it, vi } from 'vitest';
import type { DataSource, EntityManager } from 'typeorm';

import {
  notifyAlmanacUpdated,
  type AlmanacNotification,
} from './trip-almanac-notify';
import type { Trip } from './entities/trip.entity';

/**
 * Дедупликация «Альманах похода обновлён» (24.11.2026, бэклог §53).
 *
 * 23.11.2026 в личный диалог по одному походу пришло три одинаковых
 * уведомления. Причин было две, обе в `trip-almanac-notify.ts`:
 *
 * 1. проверка искала непрочитанное только **от того же автора**, а правило
 *    заказчика — одно непрочитанное на человека на поход;
 * 2. проверка и вставка шли без замка, и параллельные правки проскакивали
 *    проверку вместе.
 *
 * Здесь — то, что можно проверить без базы: адресат в проверке указан явно
 * (автора в ней нет вовсе), замок берётся до проверки, второе уведомление
 * не вставляется. Гонку и совместную работу двух авторов проверяет e2e
 * `diary` — там настоящая база и настоящие параллельные запросы.
 *
 * С 24.11.2026 (§14) функция заводит ещё и карточку `notifications`:
 * здесь проверяется, что она создаётся в той же транзакции и что сигнал
 * `notifications` уходит после COMMIT.
 */
const ANNA = '9bd2e553-4321-4877-a6ab-71b991d942b1';
const BORIS = '4c644442-9738-4fed-8a82-393bcce699da';
const CONVERSATION = '1268';

const TRIP = {
  id: 193,
  goalObject: { name: 'Хамар-Дабан' },
} as unknown as Trip;

const BODY = 'Альманах похода «Хамар-Дабан» обновлён: /trips/193?tab=guest';

interface Query {
  sql: string;
  params: unknown[];
}

interface StubOptions {
  /** Есть ли у получателя непрочитанное уведомление на момент проверки. */
  unread: boolean;
  /** Появляется ли непрочитанное после первой вставки (второй получатель). */
  unreadAfterInsert?: boolean;
  participants?: { userId: string; status: string }[];
}

function stub({
  unread,
  unreadAfterInsert = false,
  participants = [
    { userId: ANNA, status: 'going' },
    { userId: BORIS, status: 'going' },
  ],
}: StubOptions) {
  const queries: Query[] = [];
  const inserts: { conversationId: string; senderId: string; body: string }[] = [];
  /** Порядок шагов: `commit` транзакции и `emit` кадра — для проверки «после». */
  const log: string[] = [];

  const conversation = {
    id: CONVERSATION,
    kind: 'direct',
    directA: ANNA,
    directB: BORIS,
  };

  const builder = {
    insert: () => builder,
    into: () => builder,
    values: () => builder,
    orIgnore: () => builder,
    execute: async () => undefined,
  };

  const manager = {
    find: async () => participants,
    findOne: async () => conversation,
    createQueryBuilder: () => builder,
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });

      if (sql.includes('pg_advisory_xact_lock')) return [];

      const hasUnread = unread || (unreadAfterInsert && inserts.length > 0);
      return hasUnread ? [{ exists: 1 }] : [];
    },
    insert: async (
      _entity: unknown,
      values: { conversationId: string; senderId: string; body: string },
    ) => {
      inserts.push(values);
    },
  };

  /** Заглушка сервиса уведомлений: карточки и сигнал после COMMIT. */
  const notifications = {
    upsertAlmanac: vi.fn(async () => undefined),
    emitChanged: vi.fn(),
  };

  const dataSource = {
    manager,
    transaction: async (run: (scope: EntityManager) => Promise<void>) => {
      await run(manager as unknown as EntityManager);
      log.push('commit');
    },
  };

  return {
    dataSource: dataSource as unknown as DataSource,
    notifications,
    queries,
    inserts,
    log,
  };
}

/** Запрос проверки — второй в транзакции, после advisory-lock. */
function unreadQuery(queries: Query[]): Query {
  const query = queries.find((row) => row.sql.includes('FROM messages'));
  if (!query) throw new Error('проверка непрочитанного не выполнялась');

  return query;
}

describe('уведомление альманаха: дедупликация', () => {
  it('берёт транзакционный замок диалога до проверки непрочитанного', async () => {
    const { dataSource, notifications, queries } = stub({ unread: false });

    await notifyAlmanacUpdated(dataSource, notifications, TRIP, ANNA);

    expect(queries[0].sql).toContain('pg_advisory_xact_lock');
    expect(queries[0].params).toEqual([`almanac-notify:${CONVERSATION}`]);
    expect(queries[1].sql).toContain('FROM messages');
  });

  it('проверяет непрочитанное по получателю, а не по автору правки', async () => {
    const { dataSource, notifications, queries } = stub({ unread: true });

    await notifyAlmanacUpdated(dataSource, notifications, TRIP, ANNA);

    const check = unreadQuery(queries);

    // Адресат и текст — по ним и решается «такое уже есть».
    expect(check.params).toEqual([CONVERSATION, BORIS, BODY]);
    // Автора в проверке нет: уведомление от другого участника тоже считается.
    expect(check.params).not.toContain(ANNA);
  });

  it('не шлёт второе, если непрочитанное уже лежит — от любого автора', async () => {
    const { dataSource, notifications, inserts } = stub({ unread: true });

    await notifyAlmanacUpdated(dataSource, notifications, TRIP, ANNA);

    expect(inserts).toEqual([]);
  });

  it('шлёт одно, если непрочитанного нет, и заводит карточку уведомления', async () => {
    const { dataSource, notifications, inserts } = stub({ unread: false });

    await notifyAlmanacUpdated(dataSource, notifications, TRIP, ANNA);

    expect(inserts).toEqual([
      { conversationId: CONVERSATION, senderId: ANNA, body: BODY },
    ]);
    // Карточка — в той же транзакции: ключ по походу, получатель без автора.
    expect(notifications.upsertAlmanac).toHaveBeenCalledWith(expect.anything(), {
      tripId: '193',
      tripName: 'Хамар-Дабан',
      recipientIds: [BORIS],
    });
    // Сигнал в поток — после COMMIT.
    expect(notifications.emitChanged).toHaveBeenCalledWith([BORIS]);
  });

  it('дубль получателя не даёт второго уведомления: проверка видит вставку', async () => {
    // Так выглядит гонка на уровне транзакции: второй проход по тому же
    // человеку уже находит непрочитанное, которое вставил первый.
    const { dataSource, notifications, inserts } = stub({
      unread: false,
      unreadAfterInsert: true,
      participants: [
        { userId: ANNA, status: 'going' },
        { userId: BORIS, status: 'going' },
        { userId: BORIS, status: 'going' },
      ],
    });

    await notifyAlmanacUpdated(dataSource, notifications, TRIP, ANNA);

    expect(inserts).toHaveLength(1);
  });

  it('автору и отказнику не шлёт — ни сообщения, ни карточки', async () => {
    const { dataSource, notifications, queries, inserts } = stub({
      unread: false,
      participants: [
        { userId: ANNA, status: 'going' },
        { userId: BORIS, status: 'declined' },
      ],
    });

    await notifyAlmanacUpdated(dataSource, notifications, TRIP, ANNA);

    expect(queries).toEqual([]);
    expect(inserts).toEqual([]);
    expect(notifications.upsertAlmanac).not.toHaveBeenCalled();
    expect(notifications.emitChanged).not.toHaveBeenCalled();
  });
});

/**
 * Кадр «новое сообщение» в поток переписки (24.11.2026, §10 п.14).
 *
 * Уведомление вставляется в `messages` напрямую, мимо
 * `ConversationsService.sendMessage`, поэтому раньше лента узнавала о нём
 * только перечитыванием по фокусу. Теперь факт вставки отдаётся наружу,
 * и вызывающий сервис шлёт событие.
 *
 * Здесь — три правила, остальное проверяет e2e `diary` на живой базе:
 * кадр уходит на обоих участников диалога, уходит **после** COMMIT,
 * и не уходит вовсе, когда нового уведомления не было.
 */
describe('уведомление альманаха: кадр в поток переписки', () => {
  it('отдаёт кадр на обоих участников диалога — и после коммита', async () => {
    const { dataSource, notifications, log } = stub({ unread: false });
    const frames: AlmanacNotification[] = [];

    await notifyAlmanacUpdated(dataSource, notifications, TRIP, ANNA, (created) => {
      log.push('emit');
      frames.push(created);
    });

    // Диалог — пара людей: автор правки тоже получает кадр (вторая вкладка,
    // телефон), а «своё» клиент узнаёт по `actorId`, который подставит сервис.
    expect(frames).toEqual([
      { conversationId: CONVERSATION, participantIds: [ANNA, BORIS] },
    ]);
    // Сначала COMMIT, потом кадр: иначе подписчик перечитает диалог
    // до сохранения и увидит пустую ленту.
    expect(log).toEqual(['commit', 'emit']);
  });

  it('не отдаёт кадр, если непрочитанное уже лежало — вставки не было', async () => {
    const { dataSource, notifications } = stub({ unread: true });
    let emitted = 0;

    await notifyAlmanacUpdated(dataSource, notifications, TRIP, ANNA, () => {
      emitted += 1;
    });

    expect(emitted).toBe(0);
  });

  it('работает без слушателя: старые вызовы не ломаются', async () => {
    const { dataSource, notifications, inserts } = stub({ unread: false });

    await expect(
      notifyAlmanacUpdated(dataSource, notifications, TRIP, ANNA),
    ).resolves.toBeUndefined();
    expect(inserts).toHaveLength(1);
  });
});
