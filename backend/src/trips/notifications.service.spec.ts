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
  almanacCreatedText,
  depositText,
  mealsLayoutText,
  mealsPurchaseMessage,
  mealsPurchaseText,
  participantJoinedText,
  participantLeftText,
  paymentRequestText,
  roleAssignedText,
  roleRemovedText,
  tentLostText,
  transferLostText,
  transferSeatText,
  tripDatesText,
  tripExpenseText,
  tripGoalText,
  tripRouteText,
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
const VERA = '0f5bbd57-4c1e-4c1e-9f5d-1e36f2f6e3a1';
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

  it('тексты трансфера, палатки и питания — по §3.10–§3.14', () => {
    expect(transferSeatText('Анна', 'Нива', 'А123ВС38')).toEqual({
      title: 'Билет на проезд',
      announce: 'водитель Анна, Нива, А123ВС38',
      body: 'Ты добавлен пассажиром в автомобиль, водитель Анна',
    });
    expect(transferSeatText('Анна', null, null)).toEqual({
      title: 'Билет на проезд',
      announce: 'водитель Анна',
      body: 'Ты добавлен пассажиром в автомобиль, водитель Анна',
    });
    expect(transferLostText()).toEqual({
      title: 'Проблемы с транспортом',
      announce: 'Тебе не на чем ехать в поход',
      body: 'Автомобиль, пассажиром которого ты являлся, стал недоступен',
    });
    expect(tentLostText('f')).toEqual({
      title: 'Проблемы с палаткой',
      announce: 'Ты осталась без палатки',
      body: 'Палатка, в которую тебя определили, стала недоступна',
    });
    expect(tentLostText('m').announce).toBe('Ты остался без палатки');
    // Рода нет — форма «остался(а)», как у остальных текстов §3.0.
    expect(tentLostText(null).announce).toBe('Ты остался(а) без палатки');
    expect(mealsLayoutText('Анна', 'f')).toEqual({
      title: 'Раскладка',
      announce: 'Анна изменила раскладку',
      body: 'Анна изменила раскладку',
    });
    expect(mealsPurchaseText('Борис', 'm')).toEqual({
      title: 'Закупка продуктов',
      announce: 'Борис',
      body: 'Борис закупил общие продукты',
    });
    // Строка в чат питания — та же фраза без «общие» (§3.14).
    expect(mealsPurchaseMessage('Борис', 'm')).toBe('Борис закупил продукты');
  });

  it('«Запрос платежа» — адресный текст по §3.6', () => {    expect(paymentRequestText('Анна')).toEqual({
      title: 'Запрос платежа',
      announce: 'Организатор призывает к оплате',
      body:
        'Анна призывает участников компенсировать расходы, внести залог.',
    });
  });

  it('тексты залога и альманаха: анонс отдельно, автор в тексте', () => {
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
    expect(almanacChangedText('Анна', 'f')).toEqual({
      title: 'Альманах',
      announce: 'Альманах похода изменён',
      body: 'Анна дополнила альманах похода',
    });
    expect(almanacCreatedText()).toEqual({
      title: 'Альманах',
      announce: 'создан альманах похода',
      body: 'Организатор создал альманах похода из записей участников',
    });
  });

  it('тексты новых типов — по §3.2, §3.4, §3.5 и §3.8–§3.17', () => {
    expect(
      tripDatesText(
        'Анна',
        'f',
        new Date('2026-12-01T00:00:00Z'),
        new Date('2026-12-05T00:00:00Z'),
      ),
    ).toEqual({
      title: 'Перенос похода',
      announce: 'Новые даты: 01.12.2026 - 05.12.2026',
      body:
        'Анна изменила даты похода. Нужно пересмотреть разделы Трансфер, ' +
        'Ночёвки, Питание.',
    });
    expect(tripGoalText('Пик Черского')).toEqual({
      title: 'Смена цели похода',
      announce: 'Пик Черского',
      body:
        'Нас невозможно сбить с пути, нам пофигу куда идти. Что-то ' +
        'не сложилось, но мы не унываем и теперь это — Пик Черского',
    });
    expect(tripRouteText('Тропа вдоль реки')).toEqual({
      title: 'Изменение маршрута похода',
      announce: 'Тропа вдоль реки',
      body: 'Тропа вдоль реки',
    });
    expect(participantJoinedText('Борис', 'm')).toEqual({
      title: 'Новый участник',
      announce: 'Борис',
      body: 'Борис готов участвовать',
    });
    expect(participantLeftText('Анна', 'f', 'declined')).toEqual({
      title: 'Отказ от участия',
      announce: 'Анна',
      body: 'Анна не может принять участие в походе и покинула группу.',
    });
    expect(participantLeftText('Анна', 'f', 'maybe')).toEqual({
      title: 'Отказ от участия',
      announce: 'Анна',
      body: 'Анна не может принять участие в походе',
    });
    expect(
      roleAssignedText('Борис', 'm', { code: 'doctor', name: 'Медик' }),
    ).toEqual({
      title: 'Медик похода',
      announce: 'Борис назначен медиком похода',
      body: 'Борис назначен медиком похода',
    });
    expect(
      roleRemovedText('Анна', 'f', {
        code: 'technicalLeader',
        name: 'Технический лидер',
      }),
    ).toEqual({
      title: 'Снятие роли',
      announce: 'Анна освобождена от роли технического лидера',
      body: 'Анна освобождена от роли технического лидера',
    });
    expect(tripExpenseText('Анна', 'f', 'Продукты', 300)).toEqual({
      title: 'Общественный расход',
      announce: 'Анна Продукты 300 руб.',
      body: 'Анна оплатила Продукты 300 руб.',
    });
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
    const find = vi.fn(async () => []);
    const findOne = vi.fn(async (entity: unknown) =>
      entity === User
        ? { id: ANNA, displayName: 'Анна', gender: 'f' }
        : null,
    );
    const manager = { query, find, findOne } as unknown as EntityManager;
    const service = new NotificationsService(asDataSource({}), eventBus());

    await service.upsertAlmanac(manager, {
      tripId: '810',
      authorUserId: ANNA,
      recipientIds: [BORIS],
    });

    expect(query.mock.calls[0][1]).toEqual([
      BORIS,
      'almanac_changed',
      'Альманах',
      'Альманах похода изменён',
      'Анна дополнила альманах похода',
      'almanac_changed:810',
      null,
      '810',
      null,
    ]);
  });
});

/**
 * Генераторы новых типов (часть 3, 26.11.2026).
 *
 * Каждый тест проверяет три вещи сразу: вид и ключ дедупликации (§2.3),
 * готовый текст (анонс и содержимое часто разные) и адресатов — состав
 * приходит снаружи, его считает владелец события через `tripAudience`.
 * Здесь же видно, что один человек получает одну карточку, даже если
 * в списке он оказался дважды.
 */
describe('уведомления: генераторы новых типов', () => {
  const USERS: Record<string, { displayName: string; gender: 'm' | 'f' }> = {
    [ANNA]: { displayName: 'Анна', gender: 'f' },
    [BORIS]: { displayName: 'Борис', gender: 'm' },
    [VERA]: { displayName: 'Вера', gender: 'f' },
  };

  function eventManager(held: Array<{ recipientUserId: string }> = []) {
    const query = vi.fn(async () => []);
    const findOne = vi.fn(
      async (entity: unknown, options?: { where?: { id?: string } }) => {
        if (entity !== User) return null;
        const person = USERS[options?.where?.id ?? ''];
        return person ? { id: options?.where?.id, ...person } : null;
      },
    );
    const find = vi.fn(async (entity: unknown) =>
      entity === Notification ? held : [],
    );
    const manager = { query, find, findOne } as unknown as EntityManager;

    return { manager, query, find, findOne };
  }

  const insets = (query: ReturnType<typeof vi.fn>) =>
    query.mock.calls
      .filter((call) => String(call[0]).includes('INSERT INTO "notifications"'))
      .map((call) => call[1] as unknown[]);

  it('перенос дат: одна карточка на поход, анонс — диапазон', async () => {
    const { manager, query } = eventManager();
    const events = eventBus();
    const service = new NotificationsService(asDataSource({}), events);

    await service.notifyTripDates(manager, {
      tripId: '193',
      authorUserId: ANNA,
      startsAt: new Date('2026-12-01T00:00:00Z'),
      endsAt: new Date('2026-12-05T00:00:00Z'),
      recipientIds: [BORIS, VERA, BORIS],
    });

    const rows = insets(query);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual([
      BORIS,
      'trip_dates',
      'Перенос похода',
      'Новые даты: 01.12.2026 - 05.12.2026',
      'Анна изменила даты похода. Нужно пересмотреть разделы Трансфер, ' +
        'Ночёвки, Питание.',
      'trip_dates:193',
      null,
      '193',
      null,
    ]);
    expect(events.emitNotifications).not.toHaveBeenCalled();
  });

  it('отмена похода: слова заказчика, одна карточка на поход', async () => {
    const { manager, query } = eventManager();
    const service = new NotificationsService(asDataSource({}), eventBus());

    await service.notifyTripCancelled(manager, {
      tripId: '193',
      recipientIds: [BORIS, VERA, BORIS],
    });

    const rows = insets(query);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual([
      BORIS,
      'trip_cancelled',
      'Поход отменён',
      'Увы и ах (((',
      'По объективным причинам поход отменяется. Снаряжение ' +
        'освобождается. Все понесённые расходы представлены к компенсации',
      'trip_cancelled:193',
      null,
      '193',
      null,
    ]);
    expect(rows[1][0]).toBe(VERA);
  });

  it('смена цели и маршрута: ключи по походу, анонс отдельно', async () => {
    const { manager, query } = eventManager();
    const service = new NotificationsService(asDataSource({}), eventBus());

    await service.notifyTripGoal(manager, {
      tripId: '193',
      goalName: 'Пик Черского',
      recipientIds: [BORIS],
    });
    await service.notifyTripRoute(manager, {
      tripId: '193',
      routeText: 'Тропа вдоль реки',
      recipientIds: [BORIS],
    });

    const rows = insets(query);
    expect(rows[0][1]).toBe('trip_goal');
    expect(rows[0][2]).toBe('Смена цели похода');
    expect(rows[0][3]).toBe('Пик Черского');
    expect(rows[0][5]).toBe('trip_goal:193');
    expect(rows[1][1]).toBe('trip_route');
    expect(rows[1][3]).toBe('Тропа вдоль реки');
    expect(rows[1][5]).toBe('trip_route:193');
  });

  it('новый участник и отказ: ключ с человеком, пол в тексте', async () => {
    const { manager, query } = eventManager();
    const service = new NotificationsService(asDataSource({}), eventBus());

    await service.notifyParticipantJoined(manager, {
      tripId: '193',
      subjectUserId: BORIS,
      recipientIds: [ANNA],
    });
    await service.notifyParticipantLeft(manager, {
      tripId: '193',
      subjectUserId: VERA,
      status: 'declined',
      recipientIds: [ANNA],
    });

    const rows = insets(query);
    expect(rows[0]).toEqual([
      ANNA,
      'participant_joined',
      'Новый участник',
      'Борис',
      'Борис готов участвовать',
      `participant_joined:193:${BORIS}`,
      null,
      '193',
      null,
    ]);
    expect(rows[1][1]).toBe('participant_left');
    expect(rows[1][4]).toBe(
      'Вера не может принять участие в походе и покинула группу.',
    );
    expect(rows[1][5]).toBe(`participant_left:193:${VERA}`);
  });

  it('роли: назначение и снятие — ключ на человека и роль', async () => {
    const { manager, query } = eventManager();
    const service = new NotificationsService(asDataSource({}), eventBus());
    const role = { code: 'doctor', name: 'Медик' };

    await service.notifyRoleAssigned(manager, {
      tripId: '193',
      subjectUserId: BORIS,
      role,
      recipientIds: [ANNA],
    });
    await service.notifyRoleRemoved(manager, {
      tripId: '193',
      subjectUserId: VERA,
      role,
      recipientIds: [ANNA],
    });

    const rows = insets(query);
    expect(rows[0][2]).toBe('Медик похода');
    expect(rows[0][4]).toBe('Борис назначен медиком похода');
    expect(rows[0][5]).toBe(`role_assigned:193:${BORIS}:doctor`);
    expect(rows[1][2]).toBe('Снятие роли');
    expect(rows[1][4]).toBe('Вера освобождена от роли медика');
    expect(rows[1][5]).toBe(`role_removed:193:${VERA}:doctor`);
  });

  it('общественный расход: ключ по расходу, «руб.» в тексте', async () => {
    const { manager, query } = eventManager();
    const service = new NotificationsService(asDataSource({}), eventBus());

    await service.notifyTripExpense(manager, {
      tripId: '193',
      expenseId: '55',
      payerUserId: ANNA,
      description: 'Продукты',
      amountRub: 300,
      recipientIds: [BORIS],
    });

    expect(insets(query)[0]).toEqual([
      BORIS,
      'trip_expense',
      'Общественный расход',
      'Анна Продукты 300 руб.',
      'Анна оплатила Продукты 300 руб.',
      'trip_expense:55',
      null,
      '193',
      null,
    ]);
  });

  it('альманах создан: одна карточка на поход', async () => {
    const { manager, query } = eventManager();
    const service = new NotificationsService(asDataSource({}), eventBus());

    await service.upsertAlmanacCreated(manager, {
      tripId: '193',
      recipientIds: [BORIS, VERA],
    });

    const rows = insets(query);
    expect(rows.map((row) => row[0])).toEqual([BORIS, VERA]);
    expect(rows[0][2]).toBe('Альманах');
    expect(rows[0][3]).toBe('создан альманах похода');
    expect(rows[0][5]).toBe('almanac_created:193');
  });

  it('альманах изменён: у кого висит «создан», тому не шлём', async () => {
    const { manager, query } = eventManager([{ recipientUserId: BORIS }]);
    const service = new NotificationsService(asDataSource({}), eventBus());

    const recipients = await service.upsertAlmanac(manager, {
      tripId: '193',
      authorUserId: ANNA,
      recipientIds: [BORIS, VERA],
    });

    expect(recipients).toEqual([VERA]);
    const rows = insets(query);
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe(VERA);
    expect(rows[0][4]).toBe('Анна дополнила альманах похода');
  });

  it('пустой список получателей не пишет и не шлёт кадр', async () => {
    const { manager, query } = eventManager();
    const events = eventBus();
    const service = new NotificationsService(asDataSource({}), events);

    expect(
      await service.notifyTripGoal(manager, {
        tripId: '193',
        goalName: 'Пик Черского',
        recipientIds: [],
      }),
    ).toEqual([]);
    expect(query).not.toHaveBeenCalled();
    expect(events.emitNotifications).not.toHaveBeenCalled();
  });
});

/**
 * Трансфер, палатка и питание (часть 4, 26.11.2026).
 *
 * Тексты и правила адресации: `transfer_seat` и `tent_lost` — личные
 * карточки, `transfer_lost` — одна на поход, `meals_layout` и
 * `meals_purchase` — групповые. Снятие карточки проверяется отдельно: у
 * «место нашлось» и «палаток больше нет» нет действия человека, и строка
 * удаляется, а не уходит в архив.
 */
describe('уведомления: трансфер, палатка и питание', () => {
  const USERS: Record<
    string,
    { displayName: string; gender: 'm' | 'f'; isVirtual?: boolean; owner?: string }
  > = {
    [ANNA]: { displayName: 'Анна', gender: 'f' },
    [BORIS]: { displayName: 'Борис', gender: 'm' },
    [VERA]: { displayName: 'Вера', gender: 'f' },
    [VIKTOR]: {
      displayName: 'Виктор',
      gender: 'm',
      isVirtual: true,
      owner: OWNER,
    },
  };

  function eventManager() {
    const query = vi.fn(async () => []);
    const findOne = vi.fn(
      async (entity: unknown, options?: { where?: { id?: string } }) => {
        if (entity !== User) return null;
        const person = USERS[options?.where?.id ?? ''];
        if (!person) return null;

        return {
          id: options?.where?.id,
          displayName: person.displayName,
          gender: person.gender,
          isVirtual: person.isVirtual === true,
          virtualOwnerUserId: person.owner ?? null,
        };
      },
    );
    const manager = { query, findOne } as unknown as EntityManager;

    return { manager, query, findOne };
  }

  const insets = (query: ReturnType<typeof vi.fn>) =>
    query.mock.calls
      .filter((call) => String(call[0]).includes('INSERT INTO "notifications"'))
      .map((call) => call[1] as unknown[]);

  it('билет на проезд: машина в анонсе, ключ по рейсу и человеку', async () => {
    const { manager, query } = eventManager();
    const service = new NotificationsService(asDataSource({}), eventBus());

    const recipients = await service.notifyTransferSeat(manager, {
      tripId: '193',
      legId: '11',
      passengerUserId: BORIS,
      actorUserId: ANNA,
      driverName: 'Анна',
      vehicleTitle: 'Нива',
      vehiclePlate: 'А123ВС38',
    });

    expect(recipients).toEqual([BORIS]);
    expect(insets(query)[0]).toEqual([
      BORIS,
      'transfer_seat',
      'Билет на проезд',
      'водитель Анна, Нива, А123ВС38',
      'Ты добавлен пассажиром в автомобиль, водитель Анна',
      `transfer_seat:11:${BORIS}`,
      null,
      '193',
      null,
    ]);
  });

  it('билет на проезд: без марки и номера в анонсе только водитель', async () => {
    const { manager, query } = eventManager();
    const service = new NotificationsService(asDataSource({}), eventBus());

    await service.notifyTransferSeat(manager, {
      tripId: '193',
      legId: '11',
      passengerUserId: BORIS,
      actorUserId: ANNA,
      driverName: 'Анна',
      vehicleTitle: 'Нива',
      vehiclePlate: null,
    });

    expect(insets(query)[0][3]).toBe('водитель Анна');
  });

  it('билет на проезд: виртуальному — ведущему, автору — ничего', async () => {
    const { manager, query } = eventManager();
    const service = new NotificationsService(asDataSource({}), eventBus());

    const recipients = await service.notifyTransferSeat(manager, {
      tripId: '193',
      legId: '11',
      passengerUserId: VIKTOR,
      actorUserId: ANNA,
      driverName: 'Анна',
      vehicleTitle: null,
      vehiclePlate: null,
    });

    // У человека без аккаунта входа нет: карточка уходит его ведущему (§4.2).
    expect(recipients).toEqual([OWNER]);
    expect(insets(query)[0][0]).toBe(OWNER);
    // Ключ при этом называет пассажира, а не получателя.
    expect(insets(query)[0][5]).toBe(`transfer_seat:11:${VIKTOR}`);

    // Владелец виртуального посадил его сам — своё действие не уведомляем.
    expect(
      await service.notifyTransferSeat(manager, {
        tripId: '193',
        legId: '12',
        passengerUserId: VIKTOR,
        actorUserId: OWNER,
        driverName: 'Пётр',
        vehicleTitle: null,
        vehiclePlate: null,
      }),
    ).toEqual([]);
    expect(insets(query)).toHaveLength(1);
  });

  it('потеря места: одна карточка на поход, без имени машины', async () => {
    const { manager, query } = eventManager();
    const service = new NotificationsService(asDataSource({}), eventBus());

    await service.notifyTransferLost(manager, {
      tripId: '193',
      passengerUserId: VERA,
      actorUserId: ANNA,
    });

    expect(insets(query)[0]).toEqual([
      VERA,
      'transfer_lost',
      'Проблемы с транспортом',
      'Тебе не на чем ехать в поход',
      'Автомобиль, пассажиром которого ты являлся, стал недоступен',
      'transfer_lost:193',
      null,
      '193',
      null,
    ]);
  });

  it('потеря места: своё действие карточки не даёт', async () => {
    const { manager, query } = eventManager();
    const service = new NotificationsService(asDataSource({}), eventBus());

    expect(
      await service.notifyTransferLost(manager, {
        tripId: '193',
        passengerUserId: BORIS,
        actorUserId: BORIS,
      }),
    ).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('место нашлось: карточка потери удаляется у этого человека', async () => {
    const { manager, query } = eventManager();
    const service = new NotificationsService(asDataSource({}), eventBus());

    query.mockResolvedValueOnce([{ recipient_user_id: BORIS }]);

    const recipients = await service.dropTransferLost(manager, '193', BORIS);

    expect(recipients).toEqual([BORIS]);
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain('DELETE FROM "notifications"');
    expect(params).toEqual(['transfer_lost', 'transfer_lost:193', [BORIS]]);
  });

  it('место потеряно: «билет» этого рейса снимается', async () => {
    const { manager, query } = eventManager();
    const service = new NotificationsService(asDataSource({}), eventBus());

    query.mockResolvedValueOnce([{ recipient_user_id: BORIS }]);

    const recipients = await service.dropTransferSeat(manager, '11', BORIS);

    expect(recipients).toEqual([BORIS]);
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain('DELETE FROM "notifications"');
    // Ключ — рейс и человек: билет обратного рейса остаётся на месте.
    expect(params).toEqual([
      'transfer_seat',
      `transfer_seat:11:${BORIS}`,
      [BORIS],
    ]);
  });

  it('палатка: пол в анонсе, ключ похода', async () => {
    const { manager, query } = eventManager();
    const service = new NotificationsService(asDataSource({}), eventBus());

    await service.notifyTentLost(manager, {
      tripId: '193',
      lostUserId: VERA,
      actorUserId: ANNA,
    });
    await service.notifyTentLost(manager, {
      tripId: '193',
      lostUserId: BORIS,
      actorUserId: ANNA,
    });

    expect(insets(query)[0][3]).toBe('Ты осталась без палатки');
    expect(insets(query)[0][4]).toBe(
      'Палатка, в которую тебя определили, стала недоступна',
    );
    expect(insets(query)[0][5]).toBe('tent_lost:193');
    expect(insets(query)[1][3]).toBe('Ты остался без палатки');
  });

  it('все ночи перестали быть палатками — карточки похода уходят целиком', async () => {
    const { manager, query } = eventManager();
    const service = new NotificationsService(asDataSource({}), eventBus());

    query.mockResolvedValueOnce([
      { recipient_user_id: BORIS },
      { recipient_user_id: VERA },
    ]);

    const recipients = await service.dropTentLostForTrip(manager, '193');

    expect(recipients).toEqual([BORIS, VERA]);
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain('DELETE FROM "notifications"');
    expect(params).toEqual(['tent_lost', 'tent_lost:193']);
  });

  it('раскладка: ключ похода и автор в тексте', async () => {
    const { manager, query } = eventManager();
    const service = new NotificationsService(asDataSource({}), eventBus());

    await service.notifyMealsLayout(manager, {
      tripId: '193',
      authorUserId: ANNA,
      recipientIds: [BORIS, VERA, BORIS],
    });

    // Один человек — одна карточка, даже если в списке он дважды.
    expect(insets(query)).toHaveLength(2);
    expect(insets(query)[0]).toEqual([
      BORIS,
      'meals_layout',
      'Раскладка',
      'Анна изменила раскладку',
      'Анна изменила раскладку',
      'meals_layout:193',
      null,
      '193',
      null,
    ]);
  });

  it('закупка: ключ с покупателем, имя покупателя в тексте', async () => {
    const { manager, query } = eventManager();
    const service = new NotificationsService(asDataSource({}), eventBus());

    await service.notifyMealsPurchase(manager, {
      tripId: '193',
      buyerUserId: ANNA,
      recipientIds: [BORIS],
    });

    expect(insets(query)[0]).toEqual([
      BORIS,
      'meals_purchase',
      'Закупка продуктов',
      'Анна',
      'Анна закупила общие продукты',
      `meals_purchase:193:${ANNA}`,
      null,
      '193',
      null,
    ]);
  });
});
