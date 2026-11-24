import { describe, expect, it } from 'vitest';

import { ConversationEventsService } from './conversation-events.service';
import type { ConversationEvent } from './conversation-events.service';

/**
 * Канал событий переписки (24.11.2026).
 *
 * Юнит проверяет то, чего не видно в живой проверке: событие одного
 * человека не уходит другому, чаты похода и личные едут одним потоком,
 * payload не несёт DTO (только `conversationId`, `kind`, `actorId`, `at`),
 * и канал закрывается на последнем подписчике. Последнее — через
 * поведение, а не через приватное поле: после отписки нового подписчика
 * не должно догонять старое событие.
 */
describe('ConversationEventsService', () => {
  it('отдаёт событие «сообщение» подписчику человека', () => {
    const service = new ConversationEventsService();
    const received: ConversationEvent[] = [];

    const subscription = service
      .stream('user-1')
      .subscribe((event) => received.push(event));

    service.emitMessage(['user-1'], '1268', 'user-2');

    expect(received).toEqual([
      {
        conversationId: '1268',
        kind: 'message',
        actorId: 'user-2',
        at: expect.any(String),
      },
    ]);

    subscription.unsubscribe();
  });

  it('не путает людей', () => {
    const service = new ConversationEventsService();
    const first: ConversationEvent[] = [];
    const second: ConversationEvent[] = [];

    const a = service.stream('user-1').subscribe((event) => first.push(event));
    const b = service.stream('user-2').subscribe((event) => second.push(event));

    service.emitMessage(['user-1'], '1268', 'user-2');

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);

    a.unsubscribe();
    b.unsubscribe();
  });

  it('раздаёт одно сообщение нескольким участникам диалога', () => {
    const service = new ConversationEventsService();
    const first: ConversationEvent[] = [];
    const second: ConversationEvent[] = [];
    const third: ConversationEvent[] = [];

    const a = service.stream('user-1').subscribe((event) => first.push(event));
    const b = service.stream('user-2').subscribe((event) => second.push(event));
    const c = service.stream('user-3').subscribe((event) => third.push(event));

    service.emitMessage(['user-1', 'user-2'], '193', 'user-1');

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    // Третий человек в состав не входит — ему события не положено.
    expect(third).toHaveLength(0);

    a.unsubscribe();
    b.unsubscribe();
    c.unsubscribe();
  });

  it('повтор в списке получателей не даёт двух кадров', () => {
    const service = new ConversationEventsService();
    const received: ConversationEvent[] = [];

    const subscription = service
      .stream('user-1')
      .subscribe((event) => received.push(event));

    // Человек мог попасть и в состав диалога, и в состав похода в чате
    // похода: один диалог — одна строка на человека.
    service.emitMessage(['user-1', 'user-1'], '1268', 'user-2');

    expect(received).toHaveLength(1);

    subscription.unsubscribe();
  });

  it('различает «сообщение» и «прочитано»', () => {
    const service = new ConversationEventsService();
    const received: ConversationEvent[] = [];

    const subscription = service
      .stream('user-1')
      .subscribe((event) => received.push(event));

    service.emitRead(['user-1'], '1268', 'user-2');

    expect(received).toEqual([
      {
        conversationId: '1268',
        kind: 'read',
        actorId: 'user-2',
        at: expect.any(String),
      },
    ]);

    subscription.unsubscribe();
  });

  /**
   * Переписанный текст (24.11.2026): автосогласие через 72 часа меняет
   * `messages.body`, и открытый диалог должен заменить тело уже показанного
   * сообщения. Поэтому в кадре есть `messageId` и `body`, а `actorId` пуст:
   * человека-актора нет, и событие применяют все — включая того, кто сам
   * открыл «Бухгалтерию» и запустил расчёт.
   */
  it('отдаёт «сообщение изменилось» с id и новым текстом', () => {
    const service = new ConversationEventsService();
    const received: ConversationEvent[] = [];

    const subscription = service
      .stream('user-1')
      .subscribe((event) => received.push(event));

    service.emitMessageUpdated(['user-1'], '1268', {
      id: '346',
      body: 'Борис перевёл тебе 1000 ₽. Так как время ожидания подтверждения вышло…',
    });

    expect(received).toEqual([
      {
        conversationId: '1268',
        kind: 'message_updated',
        actorId: '',
        at: expect.any(String),
        messageId: '346',
        body: 'Борис перевёл тебе 1000 ₽. Так как время ожидания подтверждения вышло…',
      },
    ]);

    subscription.unsubscribe();
  });

  it('переписанный текст доходит до обоих участников диалога', () => {
    const service = new ConversationEventsService();
    const sender: ConversationEvent[] = [];
    const recipient: ConversationEvent[] = [];
    const stranger: ConversationEvent[] = [];

    const a = service.stream('user-1').subscribe((event) => sender.push(event));
    const b = service.stream('user-2').subscribe((event) => recipient.push(event));
    const c = service.stream('user-3').subscribe((event) => stranger.push(event));

    // Событие шлётся с пустым `actorId`: «своё действие не перечитываем»
    // здесь не работает, иначе открывший «Бухгалтерию» не увидел бы текст.
    service.emitMessageUpdated(['user-1', 'user-2'], '1268', {
      id: '346',
      body: 'Новый текст',
    });

    expect(sender).toHaveLength(1);
    expect(recipient).toHaveLength(1);
    expect(stranger).toHaveLength(0);

    a.unsubscribe();
    b.unsubscribe();
    c.unsubscribe();
  });

  it('после отписки последнего подписчика событие никуда не идёт', () => {
    const service = new ConversationEventsService();
    const received: ConversationEvent[] = [];

    const subscription = service
      .stream('user-1')
      .subscribe((event) => received.push(event));
    subscription.unsubscribe();

    // Канал удалён — `emit` не должен падать и заводить его заново.
    expect(() => service.emitMessage(['user-1'], '1268', 'user-2')).not.toThrow();
    expect(received).toHaveLength(0);
  });

  it('событие без подписчиков не падает', () => {
    const service = new ConversationEventsService();

    expect(() => service.emitRead(['nobody'], '999', 'user-1')).not.toThrow();
  });
});
