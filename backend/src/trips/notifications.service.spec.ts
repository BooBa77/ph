import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { DataSource, EntityManager } from 'typeorm';

import { ConversationEventsService } from './conversation-events.service';
import { Conversation } from './entities/conversation.entity';
import { ConversationMember } from './entities/conversation-member.entity';
import { Notification } from './entities/notification.entity';
import { TripParticipant } from './entities/trip-participant.entity';
import { Trip } from './entities/trip.entity';
import { User } from '../users/entities/user.entity';
import {
  NotificationsService,
  previewText,
  tripChatTitle,
} from './notifications.service';
import {
  almanacChangedText,
  depositText,
  paymentRequestText,
} from './notification-text';

/**
 * Уведомления правой панели (26.11.2026, §2–§6 `topics/notifications.md`).
 *
 * Здесь — то, что не требует базы: секции и их порядок, аудитории, тексты,
 * дедупликация ключом, закрытие и архив с правами получателя, «прочитать
 * все» и чистка при уходе. Живую дедупликацию на настоящих параллельных
 * запросах и реальные получатели проверяют e2e.
 */

const ANNA = '9bd2e553-4321-4877-a6ab-71b991d942b1';
const BORIS = '4c644442-9738-4fed-8a82-393bcce699da';
const VIKTOR = '0d0f2b7e-0000-4000-8000-000000000001';
const OWNER = '53a1b2c3-0000-4000-8000-000000000002';

function eventBus() {
  return { emitNotifications: vi.fn() } as unknown as ConversationEventsService;
}

function asDataSource(manager: unknown): DataSource {
  return { manager } as unknown as DataSource;
}

/** Строка `notifications` с осмысленными датами. */
function notification(overrides: Partial<Notification>): Notification {
  return {
    id: '1',
    recipientUserId: BORIS,
    kind: 'almanac_changed',
    title: 'Альманах «Хамар-Дабан»',
    announce: 'В походе «Хамар-Дабан» новая редакция альманаха',
    body: 'В походе «Хамар-Дабан» новая редакция альманаха',
    dedupKey: 'almanac_changed:193',
    conversationId: null,
    tripId: '193',
    compensationId: null,
    archivedAt: null,
    archivedReason: null,
    createdAt: new Date('2026-11-24T10:00:00Z'),
    updatedAt: new Date('2026-11-24T10:05:00Z'),
    ...overrides,
  } as Notification;
}

describe('уведомления: чистые правила', () => {
  it('обрезает текст карточки чата до 300 символов', () => {
    expect(previewText('  привет  ')).toBe('привет');
    expect(previewText('а'.repeat(300))).toHaveLength(300);
    expect(previewText('а'.repeat(301))).toHaveLength(301);
    expect(previewText('а'.repeat(301))?.endsWith('…')).toBe(true);
  });

  it('называет чат похода подписью вкладки и именем похода', () => {
    expect(tripChatTitle('trip_route', 'Хамар-Дабан')).toBe(
      'Чат табора «Хамар-Дабан»',
    );
    expect(tripChatTitle('trip_gear', 'Хамар-Дабан')).toBe(
      'Чат снаряжения «Хамар-Дабан»',
    );
    expect(tripChatTitle('trip_new', 'Хамар-Дабан')).toBe(
      'Чат похода «Хамар-Дабан»',
    );
  });

  it('«Запрос платежа» — адресный текст по §3.6', () => {
    expect(paymentRequestText('Анна')).toEqual({
      title: 'Запрос платежа',
      announce: 'Организатор призывает к оплате',
      body:
        'Анна призывает участников компенсировать расходы, внести залог.',
    });
  });

  it('тексты залога и альманаха не меняются, но получают анонс', () => {
    expect(depositText('Пик Черского', 300)).toEqual({
      title: 'Установлен залог',
      announce:
        'В походе «Пик Черского» установлен залог 300 ₽ с человека. ' +
        'Залог можно покрыть расходами или переводом — подробности ' +
        'в «Бухгалтерии».',
      body:
        'В походе «Пик Черского» установлен залог 300 ₽ с человека. ' +
        'Залог можно покрыть расходами или переводом — подробности ' +
        'в «Бухгалтерии».',
    });
    expect(almanacChangedText('Пик Черского').body).toBe(
      'В походе «Пик Черского» новая редакция альманаха',
    );
  });
});

describe('уведомления: секции походов', () => {
  it('группирует по походам, сортирует секции и карточки, оставляет легаси system', async () => {
    const rows = [
      notification({
        id: 'chat',
        kind: 'trip_chat',
        title: 'Чат табора «Старый»',
        conversationId: '10',
        tripId: '20',
        dedupKey: 'trip_chat:10',
        updatedAt: new Date('2026-11-24T09:00:00Z'),
      }),
      notification({
        id: 'almanac',
        kind: 'almanac_changed',
        tripId: '10',
        updatedAt: new Date('2026-11-24T10:00:00Z'),
      }),
      notification({
        id: 'money',
        kind: 'money_transfer',
        title: 'Денежный перевод',
        tripId: '10',
        compensationId: '55',
        updatedAt: new Date('2026-11-24T08:00:00Z'),
      }),
      notification({
        id: 'personal',
        kind: 'direct_chat',
        title: 'Анна',
        conversationId: '11',
        tripId: null,
        dedupKey: 'direct_chat:11',
        updatedAt: new Date('2026-11-24T11:00:00Z'),
      }),
    ];

    const manager = {
      find: vi.fn(async (entity: unknown) => {
        if (entity === Notification) return rows;
        if (entity === TripParticipant) return [];
        if (entity === Trip) {
          return [
            {
              id: '10',
              startsAt: new Date('2026-12-01T00:00:00Z'),
              endsAt: new Date('2026-12-05T00:00:00Z'),
              completedAt: null,
              goalObject: { name: 'Будущий' },
            },
            {
              id: '20',
              startsAt: new Date('2026-11-01T00:00:00Z'),
              endsAt: new Date('2026-11-05T00:00:00Z'),
              completedAt: null,
              goalObject: { name: 'Прошедший' },
            },
          ];
        }
        return [];
      }),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('count(*)')) return [{ count: 0 }];
        if (sql.includes('FROM "messages" m')) return [];
        return [];
      }),
    };

    const service = new NotificationsService(asDataSource(manager), eventBus());
    const list = await service.listMine(BORIS);

    expect(list.tripCount).toBe(2);
    expect(list.personalCount).toBe(1);
    expect(list.total).toBe(4);
    expect(list.sections.map((section) => section.tripId)).toEqual(['10', '20']);
    expect(list.sections[0].tripName).toBe('Будущий');
    expect(list.sections[0].startsAt).toBe('2026-12-01T00:00:00.000Z');
    // Внутри секции — по приоритету: перевод выше альманаха.
    expect(list.sections[0].items.map((item) => item.id)).toEqual([
      'money',
      'almanac',
    ]);
    // Легаси удалён: плоского `system` и поля `section` у карточки нет.
    expect(list).not.toHaveProperty('system');
    expect(list).not.toHaveProperty('systemCount');
    expect(list.sections[0].items[0]).not.toHaveProperty('section');
    expect(list.sections[0].items[0].announce).toBe(list.sections[0].items[0].body);
  });

  it('походы без дат — последними, прошедшие — свежие первыми', async () => {
    const rows = [
      notification({ id: 'nodate', kind: 'trip_deposit', tripId: '30' }),
      notification({ id: 'old', kind: 'trip_deposit', tripId: '20' }),
      notification({ id: 'new', kind: 'trip_deposit', tripId: '21' }),
    ];

    const manager = {
      find: vi.fn(async (entity: unknown) => {
        if (entity === Notification) return rows;
        if (entity === TripParticipant) return [];
        if (entity === Trip) {
          return [
            {
              id: '30',
              startsAt: null,
              endsAt: null,
              completedAt: null,
              goalObject: { name: 'Без дат' },
            },
            {
              id: '20',
              startsAt: new Date('2026-10-01T00:00:00Z'),
              endsAt: new Date('2026-10-05T00:00:00Z'),
              completedAt: null,
              goalObject: { name: 'Старый' },
            },
            {
              id: '21',
              startsAt: new Date('2026-11-01T00:00:00Z'),
              endsAt: new Date('2026-11-05T00:00:00Z'),
              completedAt: null,
              goalObject: { name: 'Новее' },
            },
          ];
        }
        return [];
      }),
      query: vi.fn(async () => []),
    };

    const service = new NotificationsService(asDataSource(manager), eventBus());
    const list = await service.listMine(BORIS);

    expect(list.sections.map((section) => section.tripId)).toEqual([
      '21',
      '20',
      '30',
    ]);
  });
});

describe('уведомления: закрытие, архив и «прочитать все»', () => {
  it('чужое уведомление — 404', async () => {
    const manager = { findOne: vi.fn(async () => null) };
    const service = new NotificationsService(asDataSource(manager), eventBus());

    await expect(service.close(BORIS, '1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.archive(BORIS, '1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('перевод нельзя закрыть «ОК» — только архивировать', async () => {
    const manager = {
      findOne: vi.fn(async () =>
        notification({ kind: 'money_transfer', compensationId: '55' }),
      ),
    };
    const service = new NotificationsService(asDataSource(manager), eventBus());

    await expect(service.close(BORIS, '1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('«ОК» закрывает запрос платежа без архива', async () => {
    const manager = {
      findOne: vi.fn(async () =>
        notification({
          kind: 'payment_request',
          dedupKey: `payment_request:193:${BORIS}`,
        }),
      ),
      delete: vi.fn(async () => undefined),
    };
    const events = eventBus();
    const service = new NotificationsService(asDataSource(manager), events);

    await service.close(BORIS, '1');

    expect(manager.delete).toHaveBeenCalledWith(Notification, { id: '1' });
    expect(events.emitNotifications).toHaveBeenCalledWith([BORIS]);
  });

  it('«ОК» удаляет карточку альманаха и шлёт сигнал в поток', async () => {
    const manager = {
      findOne: vi.fn(async () => notification({ kind: 'almanac_changed' })),
      delete: vi.fn(async () => undefined),
    };
    const events = eventBus();
    const service = new NotificationsService(asDataSource(manager), events);

    await service.close(BORIS, '1');

    expect(manager.delete).toHaveBeenCalledWith(Notification, { id: '1' });
    expect(events.emitNotifications).toHaveBeenCalledWith([BORIS]);
  });

  it('архивирует перевод по причине «подтвердил человек»', async () => {
    const manager = {
      findOne: vi.fn(async () =>
        notification({ kind: 'money_transfer', compensationId: '55' }),
      ),
      update: vi.fn(async () => undefined),
    };
    const events = eventBus();
    const service = new NotificationsService(asDataSource(manager), events);

    await service.archive(BORIS, '1');

    expect(manager.update).toHaveBeenCalledWith(
      Notification,
      { id: '1' },
      expect.objectContaining({ archivedReason: 'confirmed' }),
    );
    expect(events.emitNotifications).toHaveBeenCalledWith([BORIS]);
  });

  it('архивирует запрос платежа по причине «оплачено»', async () => {
    const manager = {
      findOne: vi.fn(async () =>
        notification({
          kind: 'payment_request',
          dedupKey: `payment_request:193:${BORIS}`,
        }),
      ),
      update: vi.fn(async () => undefined),
    };
    const service = new NotificationsService(asDataSource(manager), eventBus());

    await service.archive(BORIS, '1');

    expect(manager.update).toHaveBeenCalledWith(
      Notification,
      { id: '1' },
      expect.objectContaining({ archivedReason: 'paid' }),
    );
  });

  it('альманах в архив не уходит — он закрывается «ОК»', async () => {
    const manager = {
      findOne: vi.fn(async () => notification({ kind: 'almanac_changed' })),
    };
    const service = new NotificationsService(asDataSource(manager), eventBus());

    await expect(service.archive(BORIS, '1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('«прочитать все» удаляет всё, кроме переводов и запросов платежа', async () => {
    const query = vi.fn(async () => [{ id: '1' }, { id: '2' }]);
    const manager = {
      query,
      count: vi.fn(async () => 1),
    };
    const events = eventBus();
    const service = new NotificationsService(asDataSource(manager), events);

    const result = await service.readAll(BORIS, '810');

    expect(result).toEqual({ closed: 2, left: 1 });
    expect(query.mock.calls[0][0]).toContain('DELETE FROM "notifications"');
    expect(query.mock.calls[0][1]).toEqual([
      BORIS,
      '810',
      'money_transfer',
      'payment_request',
    ]);
    expect(events.emitNotifications).toHaveBeenCalledWith([BORIS]);
  });

  it('«прочитать все» без удалений не шлёт кадр', async () => {
    const events = eventBus();
    const manager = {
      query: vi.fn(async () => []),
      count: vi.fn(async () => 2),
    };
    const service = new NotificationsService(asDataSource(manager), events);

    expect(await service.readAll(BORIS, '810')).toEqual({ closed: 0, left: 2 });
    expect(events.emitNotifications).not.toHaveBeenCalled();
  });

  it('чистка при уходе удаляет всё, кроме переводов', async () => {
    const query = vi.fn(async () => [{ id: '1' }]);
    const manager = { query } as unknown as EntityManager;
    const service = new NotificationsService(asDataSource({}), eventBus());

    expect(await service.dropForTripUser(manager, '810', BORIS)).toBe(1);
    expect(query.mock.calls[0][0]).toContain('"kind" <> \'money_transfer\'');
    expect(query.mock.calls[0][1]).toEqual([BORIS, '810']);
  });
});

describe('уведомления: аудитории', () => {
  it('групповая карточка — активному составу без виртуальных и автора', async () => {
    const find = vi.fn(async () => [
      { userId: BORIS, user: { isVirtual: false } },
      { userId: ANNA, user: { isVirtual: false } },
      { userId: VIKTOR, user: { isVirtual: true } },
      { userId: OWNER, user: { isVirtual: false } },
    ]);
    const findOne = vi.fn(async () => ({ id: ANNA, isVirtual: false }));
    const manager = { find, findOne } as unknown as EntityManager;
    const service = new NotificationsService(asDataSource({}), eventBus());

    const recipients = await service.tripAudience(manager, '810', {
      actorUserId: ANNA,
    });

    expect(recipients).toEqual([BORIS, OWNER]);
    // Отбираем именно активный состав, а не «всех, кроме declined».
    const where = (find.mock.calls[0][1] as { where: { status: unknown } }).where;
    expect(where.status).toBeDefined();
  });

  it('виртуальный автор исключает и своего ведущего', async () => {
    const find = vi.fn(async () => [
      { userId: BORIS, user: { isVirtual: false } },
      { userId: OWNER, user: { isVirtual: false } },
    ]);
    const findOne = vi.fn(async () => ({
      id: VIKTOR,
      isVirtual: true,
      virtualOwnerUserId: OWNER,
    }));
    const manager = { find, findOne } as unknown as EntityManager;
    const service = new NotificationsService(asDataSource({}), eventBus());

    expect(
      await service.tripAudience(manager, '810', { actorUserId: VIKTOR }),
    ).toEqual([BORIS]);
  });

  it('субъект уведомления исключается вместе с автором', async () => {
    const find = vi.fn(async () => [
      { userId: BORIS, user: { isVirtual: false } },
      { userId: ANNA, user: { isVirtual: false } },
    ]);
    const findOne = vi.fn(async () => ({ id: BORIS, isVirtual: false }));
    const manager = { find, findOne } as unknown as EntityManager;
    const service = new NotificationsService(asDataSource({}), eventBus());

    expect(
      await service.tripAudience(manager, '810', {
        actorUserId: BORIS,
        exceptUserIds: [ANNA],
      }),
    ).toEqual([]);
  });

  it('личное уведомление виртуальному уходит ведущему', async () => {
    const manager = {
      findOne: vi.fn(async () => ({
        id: VIKTOR,
        isVirtual: true,
        virtualOwnerUserId: OWNER,
      })),
    } as unknown as EntityManager;
    const service = new NotificationsService(asDataSource({}), eventBus());

    expect(await service.personalRecipientUserId(manager, VIKTOR)).toBe(OWNER);
  });

  it('виртуальный без ведущего — карточку класть некуда', async () => {
    const manager = {
      findOne: vi.fn(async () => ({
        id: VIKTOR,
        isVirtual: true,
        virtualOwnerUserId: null,
      })),
    } as unknown as EntityManager;
    const service = new NotificationsService(asDataSource({}), eventBus());

    expect(await service.personalRecipientUserId(manager, VIKTOR)).toBeNull();
  });
});

describe('уведомления: карточка нового сообщения', () => {
  it('личный диалог — второму человеку, заголовок и анонс', async () => {
    const manager = {
      findOne: vi.fn(async (entity: unknown) => {
        if (entity === Conversation) {
          return { id: '10', kind: 'direct', directA: ANNA, directB: BORIS };
        }
        if (entity === User) return { id: ANNA, displayName: 'Анна' };
        return null;
      }),
      find: vi.fn(async (entity: unknown) => {
        if (entity === ConversationMember) return [];
        return [];
      }),
      query: vi.fn(async () => []),
    };
    const events = eventBus();
    const service = new NotificationsService(asDataSource(manager), events);

    await service.notifyChatMessage('10', ANNA, 'привет');

    const insert = manager.query.mock.calls.at(-1)!;
    expect(insert[0]).toContain('INSERT INTO "notifications"');
    expect(insert[1]).toEqual([
      BORIS,
      'direct_chat',
      'Анна',
      'Анна: привет',
      'привет',
      'direct_chat:10',
      '10',
      null,
      null,
    ]);
    expect(events.emitNotifications).toHaveBeenCalledWith([BORIS]);
  });

  it('заглушённый диалог карточку не создаёт', async () => {
    const manager = {
      findOne: vi.fn(async (entity: unknown) => {
        if (entity === Conversation) {
          return { id: '10', kind: 'direct', directA: ANNA, directB: BORIS };
        }
        if (entity === User) return { id: ANNA, displayName: 'Анна' };
        return null;
      }),
      find: vi.fn(async (entity: unknown) => {
        if (entity === ConversationMember) {
          return [{ userId: BORIS, mutedAt: new Date() }];
        }
        return [];
      }),
      query: vi.fn(async () => []),
    };
    const events = eventBus();
    const service = new NotificationsService(asDataSource(manager), events);

    await service.notifyChatMessage('10', ANNA, 'привет');

    expect(manager.query).not.toHaveBeenCalled();
    expect(events.emitNotifications).not.toHaveBeenCalled();
  });

  it('чат похода — активному составу без виртуальных, автора и заглушённых', async () => {
    const manager = {
      findOne: vi.fn(async (entity: unknown) => {
        if (entity === Conversation) {
          return { id: '10', kind: 'trip_gear', tripId: '5' };
        }
        if (entity === Trip) {
          return { id: '5', goalObject: { name: 'Хамар-Дабан' } };
        }
        if (entity === User) return { id: ANNA, displayName: 'Анна' };
        return null;
      }),
      find: vi.fn(async (entity: unknown) => {
        if (entity === TripParticipant) {
          return [
            { userId: BORIS, user: { isVirtual: false } },
            { userId: VIKTOR, user: { isVirtual: true } },
          ];
        }
        return [];
      }),
      query: vi.fn(async () => []),
    };
    const events = eventBus();
    const service = new NotificationsService(asDataSource(manager), events);

    await service.notifyChatMessage('10', ANNA, 'сбор в 8');

    const insert = manager.query.mock.calls.at(-1)!;
    expect(insert[1]).toEqual([
      BORIS,
      'trip_chat',
      'Чат снаряжения «Хамар-Дабан»',
      'Анна: сбор в 8',
      'сбор в 8',
      'trip_chat:10',
      '10',
      '5',
      null,
    ]);
    expect(events.emitNotifications).toHaveBeenCalledWith([BORIS]);
  });
});

/** Менеджер транзакции: уведомление пишется тем же путём. */
describe('уведомления: денежные карточки', () => {
  it('перевод — ключ по компенсации, анонс равен содержимому', async () => {
    const query = vi.fn(async () => []);
    const manager = { query } as unknown as EntityManager;
    const service = new NotificationsService(asDataSource({}), eventBus());

    await service.notifyMoneyTransfer(manager, {
      recipientUserId: BORIS,
      tripId: '193',
      compensationId: '55',
      conversationId: '1268',
      body: 'Анна перевела тебе 1000 ₽ за поход «Хамар-Дабан»',
    });

    expect(query.mock.calls[0][1]).toEqual([
      BORIS,
      'money_transfer',
      'Денежный перевод',
      'Анна перевела тебе 1000 ₽ за поход «Хамар-Дабан»',
      'Анна перевела тебе 1000 ₽ за поход «Хамар-Дабан»',
      'money_transfer:55',
      '1268',
      '193',
      '55',
    ]);
  });

  it('запрос платежа — адресный, ключ с получателем', async () => {
    const query = vi.fn(async () => []);
    const manager = { query } as unknown as EntityManager;
    const service = new NotificationsService(asDataSource({}), eventBus());

    await service.notifyPaymentRequest(manager, {
      recipientUserId: BORIS,
      tripId: '193',
      authorName: 'Анна',
    });

    expect(query.mock.calls[0][1]).toEqual([
      BORIS,
      'payment_request',
      'Запрос платежа',
      'Организатор призывает к оплате',
      'Анна призывает участников компенсировать расходы, внести залог.',
      `payment_request:193:${BORIS}`,
      null,
      '193',
      null,
    ]);
  });

  it('карточка залога: вид trip_deposit и ключ похода', async () => {
    const query = vi.fn(async () => []);
    const manager = { query } as unknown as EntityManager;
    const service = new NotificationsService(asDataSource({}), eventBus());

    await service.notifyTripDeposit(manager, {
      tripId: '810',
      tripName: 'Пик Черского',
      amountRub: 300,
      recipientIds: [BORIS],
    });

    expect(query.mock.calls[0][1]).toEqual([
      BORIS,
      'trip_deposit',
      'Установлен залог',
      'В походе «Пик Черского» установлен залог 300 ₽ с человека. ' +
        'Залог можно покрыть расходами или переводом — подробности ' +
        'в «Бухгалтерии».',
      'В походе «Пик Черского» установлен залог 300 ₽ с человека. ' +
        'Залог можно покрыть расходами или переводом — подробности ' +
        'в «Бухгалтерии».',
      'trip_deposit:810',
      null,
      '810',
      null,
    ]);
  });

  it('снятие залога удаляет карточку и отдаёт получателей', async () => {
    const query = vi.fn(async () => [
      { recipient_user_id: BORIS },
      { recipient_user_id: ANNA },
    ]);
    const manager = { query } as unknown as EntityManager;
    const service = new NotificationsService(asDataSource({}), eventBus());

    const recipients = await service.dropTripDeposit(manager, '810');

    expect(recipients).toEqual([BORIS, ANNA]);
    expect(query.mock.calls[0][0]).toContain('DELETE FROM "notifications"');
    expect(query.mock.calls[0][1]).toEqual(['trip_deposit:810']);
  });

  it('альманах — вид almanac_changed и ключ похода', async () => {
    const query = vi.fn(async () => []);
    const manager = { query } as unknown as EntityManager;
    const service = new NotificationsService(asDataSource({}), eventBus());

    await service.upsertAlmanac(manager, {
      tripId: '810',
      tripName: 'Пик Черского',
      recipientIds: [BORIS],
    });

    expect(query.mock.calls[0][1]).toEqual([
      BORIS,
      'almanac_changed',
      'Альманах «Пик Черского»',
      'В походе «Пик Черского» новая редакция альманаха',
      'В походе «Пик Черского» новая редакция альманаха',
      'almanac_changed:810',
      null,
      '810',
      null,
    ]);
  });
});
