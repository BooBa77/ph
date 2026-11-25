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
  sectionOf,
  tripChatTitle,
} from './notifications.service';

/**
 * Уведомления правой панели (24.11.2026, §14 `topics/messages.md`).
 *
 * Здесь — то, что не требует базы: разделы и заголовки, дедупликация
 * ключом, кому карточка достаётся (автору — нет, заглушённому — нет,
 * «виртуальному» — нет), закрытие и архив с правами получателя.
 * Живую дедупликацию на настоящих параллельных запросах проверяет e2e.
 */

const ANNA = '9bd2e553-4321-4877-a6ab-71b991d942b1';
const BORIS = '4c644442-9738-4fed-8a82-393bcce699da';
const VIRTUAL = '0d0f2b7e-0000-4000-8000-000000000001';

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
    kind: 'almanac',
    title: 'Альманах «Хамар-Дабан»',
    body: 'В походе «Хамар-Дабан» новая редакция альманаха',
    dedupKey: 'almanac:193',
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
  it('делит виды на системные и личные', () => {
    expect(sectionOf('money_transfer')).toBe('system');
    expect(sectionOf('payment_request')).toBe('system');
    expect(sectionOf('trip_finance')).toBe('system');
    expect(sectionOf('almanac')).toBe('system');
    expect(sectionOf('trip_chat')).toBe('system');
    expect(sectionOf('direct_chat')).toBe('personal');
  });

  it('обрезает текст карточки чата до 300 символов', () => {
    expect(previewText('  привет  ')).toBe('привет');
    expect(previewText('а'.repeat(300))).toHaveLength(300);
    // Многоточие добавляется только при реальной обрезке.
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
    // Незнакомый вид чата не должен давать пустой заголовок.
    expect(tripChatTitle('trip_new', 'Хамар-Дабан')).toBe(
      'Чат похода «Хамар-Дабан»',
    );
  });
});

describe('уведомления: список для панели', () => {
  it('раскладывает активные карточки по секциям и считает их', async () => {
    const manager = {
      find: vi.fn(async (entity: unknown) =>
        entity === TripParticipant
          ? []
          : [
              notification({ id: '1', kind: 'money_transfer', title: 'Денежный перевод' }),
              notification({
                id: '2',
                kind: 'direct_chat',
                title: 'Анна',
                conversationId: '10',
                dedupKey: 'direct_chat:10',
              }),
            ],
      ),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('count(*)')) return [{ count: 2 }];
        if (sql.includes('FROM "messages" m')) {
          return [
            {
              id: '7',
              body: 'а'.repeat(350),
              sender_id: ANNA,
              created_at: '2026-11-24T10:00:00Z',
              display_name: 'Анна',
            },
          ];
        }
        return [];
      }),
    };

    const service = new NotificationsService(
      asDataSource(manager),
      eventBus(),
    );

    const list = await service.listMine(BORIS);

    expect(list.systemCount).toBe(1);
    expect(list.personalCount).toBe(1);
    expect(list.system[0].kind).toBe('money_transfer');
    expect(list.personal[0].section).toBe('personal');
    // Непрочитанное и последнее сообщение — только у карточки чата.
    expect(list.system[0].unreadCount).toBeNull();
    expect(list.personal[0].unreadCount).toBe(2);
    expect(list.personal[0].preview).toHaveLength(1);
    expect(list.personal[0].preview[0].body).toHaveLength(301);
    // Признак «вышел из похода» — только у перевода.
    expect(list.system[0].viewerDeclined).toBe(false);
    expect(list.personal[0].viewerDeclined).toBeNull();
  });

  /**
   * 25.11.2026: «Бухгалтерия» ушедшему закрыта, но подтвердить перевод он
   * может прямо в карточке. Клиенту нужен признак, чтобы объяснить это
   * словами, — сервер считает его по составу похода.
   */
  it('помечает перевод человеку, вышедшему из похода', async () => {
    const manager = {
      find: vi.fn(async (entity: unknown) =>
        entity === TripParticipant
          ? [{ userId: BORIS, tripId: '193', status: 'declined' }]
          : [
              notification({
                id: '1',
                kind: 'money_transfer',
                tripId: '193',
                compensationId: '55',
              }),
            ],
      ),
      query: vi.fn(async () => []),
    };

    const service = new NotificationsService(asDataSource(manager), eventBus());
    const list = await service.listMine(BORIS);

    expect(list.system[0].viewerDeclined).toBe(true);
    // Запрос состава — один на список, а не на каждую карточку.
    expect(manager.find).toHaveBeenCalledTimes(2);
  });
});

describe('уведомления: закрытие и архив', () => {
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

  it('деньги нельзя закрыть «ОК» — только архивировать', async () => {
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

  it('«ОК» удаляет карточку чата и шлёт сигнал в поток', async () => {
    const manager = {
      findOne: vi.fn(async () =>
        notification({ kind: 'trip_chat', conversationId: '10' }),
      ),
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
        notification({ kind: 'payment_request', dedupKey: 'payment_request:193' }),
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
      findOne: vi.fn(async () => notification({ kind: 'almanac' })),
    };
    const service = new NotificationsService(asDataSource(manager), eventBus());

    await expect(service.archive(BORIS, '1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('уведомления: карточка нового сообщения', () => {
  it('личный диалог — второму человеку, заголовок — имя автора', async () => {
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

  it('чат похода — составу без виртуальных, автору и заглушённым', async () => {
    const manager = {
      findOne: vi.fn(async (entity: unknown) => {
        if (entity === Conversation) {
          return { id: '10', kind: 'trip_gear', tripId: '5' };
        }
        if (entity === Trip) {
          return { id: '5', goalObject: { name: 'Хамар-Дабан' } };
        }
        return null;
      }),
      find: vi.fn(async (entity: unknown) => {
        if (entity === TripParticipant) {
          return [
            { userId: BORIS, user: { isVirtual: false } },
            { userId: VIRTUAL, user: { isVirtual: true } },
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
      'сбор в 8',
      'trip_chat:10',
      '10',
      '5',
      null,
    ]);
    expect(events.emitNotifications).toHaveBeenCalledWith([BORIS]);
  });
});

/** Менеджер транзакции: уведомление о переводе пишется тем же путём. */
describe('уведомления: денежные карточки', () => {
  it('перевод — ключ по компенсации, ссылки на диалог и поход', async () => {
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
      'money_transfer:55',
      '1268',
      '193',
      '55',
    ]);
  });

  it('запрос платежа — одна карточка на поход', async () => {
    const query = vi.fn(async () => []);
    const manager = { query } as unknown as EntityManager;
    const service = new NotificationsService(asDataSource({}), eventBus());

    await service.notifyTripFinanceExpenses(manager, {
      tripId: '193',
      tripName: 'Хамар-Дабан',
      recipientIds: [BORIS],
    });

    expect(query.mock.calls[0][1]).toEqual([
      BORIS,
      'trip_finance',
      'Компенсируйте расходы',
      'Расходы по походу «Хамар-Дабан» распределены. Проверь свой баланс ' +
        'в «Бухгалтерии» — там видно, кому и сколько перевести.',
      'trip_finance:193:expenses',
      null,
      '193',
      null,
    ]);
  });
});

/**
 * Общегрупповые уведомления о деньгах (25.11.2026).
 *
 * Заказчик отказался от персональных «запросов платежа»: залог и
 * распределение расходов — новость для всей группы, участник сам решает
 * в «Бухгалтерии», чем покрыть. Здесь — получатели, тексты и то, что
 * такие карточки закрываются «ОК» без архива.
 */
describe('уведомления: общегрупповые деньги', () => {
  it('рассылает карточку всем идущим, кроме автора и виртуальных', async () => {
    const find = vi.fn(async () => [
      { userId: BORIS, user: { isVirtual: false } },
      { userId: VIRTUAL, user: { isVirtual: true } },
    ]);
    const manager = { find } as unknown as EntityManager;
    const service = new NotificationsService(asDataSource({}), eventBus());

    const recipients = await service.tripFinanceRecipients(
      manager,
      '193',
      ANNA,
    );

    expect(recipients).toEqual([BORIS]);

    // Автор исключён на уровне запроса: уведомление о своём действии
    // человеку не нужно.
    const options = find.mock.calls[0][1] as {
      where: { tripId: string; status: string; userId: unknown };
    };
    expect(options.where.tripId).toBe('193');
    expect(options.where.status).toBe('going');
    expect(options.where.userId).toBeDefined();
  });

  it('карточка залога: заголовок, сумма и ключ похода', async () => {
    const query = vi.fn(async () => []);
    const manager = { query } as unknown as EntityManager;
    const service = new NotificationsService(asDataSource({}), eventBus());

    await service.notifyTripFinanceDeposit(manager, {
      tripId: '810',
      tripName: 'Пик Черского',
      amountRub: 300,
      recipientIds: [BORIS],
    });

    expect(query.mock.calls[0][1]).toEqual([
      BORIS,
      'trip_finance',
      'Установлен залог',
      'В походе «Пик Черского» установлен залог 300 ₽ с человека. ' +
        'Залог можно покрыть расходами или переводом — подробности ' +
        'в «Бухгалтерии».',
      'trip_finance:810:deposit',
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

    const recipients = await service.dropTripFinanceDeposit(manager, '810');

    expect(recipients).toEqual([BORIS, ANNA]);
    expect(query.mock.calls[0][0]).toContain('DELETE FROM "notifications"');
    expect(query.mock.calls[0][1]).toEqual(['trip_finance:810:deposit']);
  });

  it('«ОК» закрывает общегрупповую карточку без архива', async () => {
    const manager = {
      findOne: vi.fn(async () =>
        notification({
          kind: 'trip_finance',
          title: 'Компенсируйте расходы',
          dedupKey: 'trip_finance:810:expenses',
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

  it('в архив общегрупповая карточка не уходит', async () => {
    const manager = {
      findOne: vi.fn(async () =>
        notification({ kind: 'trip_finance', dedupKey: 'trip_finance:810:deposit' }),
      ),
    };
    const service = new NotificationsService(asDataSource(manager), eventBus());

    await expect(service.archive(BORIS, '1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
