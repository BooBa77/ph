import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { EmailCodeService } from './../src/email/services/email-code.service';
import { SmtpService } from './../src/email/services/smtp.service';
import { ORGANIZER_ROLE_CODE } from './../src/trips/trip.types';
import { TripEventsService } from './../src/trips/trip-events.service';
import { ConversationEventsService } from './../src/trips/conversation-events.service';
import type { ConversationEvent } from './../src/trips/conversation-events.service';

/**
 * «Бухгалтерия» похода — e2e на живом приложении и живой базе (11.11.2026).
 *
 * Здесь проверяется то, чего не видит юнит-тест: права (автор, получатель,
 * посторонний, приглашённый), что баланс сходится с примером заказчика,
 * что ожидающая компенсация бронирует кредит и сужает варианты у второго
 * должника, что «Чек» из «Питания» делит на питающихся с общего и что
 * каждое изменение уходит в SSE-поток.
 *
 * Участники: А (организатор), Б, В, Г, Д, Е. Первый поход — все шестеро
 * и пример с продуктами, бензином, ужином и коньяком. Второй — четверо
 * (А, Б, В, Г) для компенсаций; Д там приглашён и не принял, Е — посторонний.
 */
describe('Бухгалтерия похода (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let goalObjectId: string;
  let trip1: string;
  let trip2: string;
  let trip3: string;
  /** Поход с человеком без аккаунта: за него платит и переводит ведущий. */
  let trip4: string;
  /** Общая касса семьи: плюс одного участника гасит минус другого. */
  let trip5: string;
  /** Пример заказчика по залогу: A платит продукты, выходит, E решает. */
  let trip6: string;
  /** Залог v3: частичные переводы, «запас» и ушедшие с разным покрытием. */
  let trip7: string;
  /** Очередь офлайн-чеков: пачка, повтор по `clientId`, отказ по одному чеку. */
  let trip8: string;
  /** Ушедший и деньги: личное сообщение, автосогласие, закрытый расчёт. */
  let trip9: string;
  /** Завершённый поход: прежние чеки — история, новые можно (20.11.2026). */
  let trip10: string;
  /** Поход для проверки подтверждения с карточки (свой, чтобы не менять trip9). */
  let cardTrip: string;
  /** Общегрупповые уведомления: залог и «Компенсируйте расходы» (25.11.2026). */
  let financeNotifyTrip: string;
  let virtualPersonId: string;
  /** Виртуальный участник похода общегрупповых уведомлений (25.11.2026). */
  let financeVirtualId: string;
  let lastCode: string | null = null;

  interface Person {
    token: string;
    id: string;
    email: string;
  }

  let a: Person;
  let b: Person;
  let c: Person;
  let d: Person;
  let e: Person;
  let g: Person;

  const suffix = Date.now();
  const emails = {
    a: `fin-a-${suffix}@example.com`,
    b: `fin-b-${suffix}@example.com`,
    c: `fin-c-${suffix}@example.com`,
    d: `fin-d-${suffix}@example.com`,
    e: `fin-e-${suffix}@example.com`,
    g: `fin-g-${suffix}@example.com`,
  };

  async function login(email: string): Promise<Person> {
    await request(app.getHttpServer())
      .post('/api/auth/request-code')
      .send({ email })
      .expect(200);

    const verified = await request(app.getHttpServer())
      .post('/api/auth/verify-code')
      .send({ email, code: lastCode })
      .expect(200);

    return {
      token: verified.body.accessToken as string,
      id: verified.body.user.id as string,
      email,
    };
  }

  const auth = (req: request.Test, token: string) =>
    req.set('Authorization', `Bearer ${token}`);

  async function createTrip(announcement: string): Promise<string> {
    const response = await auth(
      request(app.getHttpServer()).post('/api/trips'),
      a.token,
    )
      .send({
        goalObjectId: Number(goalObjectId),
        status: 'planning',
        announcement,
      })
      .expect(201);

    return response.body.id as string;
  }

  /** Пригласить и сразу принять — человек становится `going`. */
  async function addGoing(
    tripId: string,
    person: Person,
    organizer: Person = a,
  ): Promise<void> {
    await auth(
      request(app.getHttpServer()).post(`/api/trips/${tripId}/requests`),
      organizer.token,
    )
      .send({ direction: 'invite', userId: person.id })
      .expect(201);

    await auth(
      request(app.getHttpServer()).post(
        `/api/trips/${tripId}/requests/${person.id}/accept`,
      ),
      person.token,
    )
      .send({ status: 'going' })
      .expect(200);
  }

  async function addExpense(
    tripId: string,
    person: Person,
    body: Record<string, unknown>,
    expected = 201,
  ) {
    return auth(
      request(app.getHttpServer()).post(`/api/trips/${tripId}/finance/expenses`),
      person.token,
    )
      .send(body)
      .expect(expected);
  }

  /**
   * Сделать двух людей родными напрямую в базе.
   *
   * Через API это заявка на объединение семей с согласием всех участников —
   * для проверки компенсации это лишний шаг. Пара пишется в каноническом
   * порядке (`user_a_id < user_b_id`), как требует CHECK таблицы.
   */
  async function makeFamily(left: Person, right: Person): Promise<void> {
    const [userAId, userBId] = [left.id, right.id].sort();

    await dataSource.query(
      `INSERT INTO family_links (user_a_id, user_b_id) VALUES ($1, $2)
       ON CONFLICT (user_a_id, user_b_id) DO NOTHING`,
      [userAId, userBId],
    );
  }

  async function view(tripId: string, person: Person, expected = 200) {
    return auth(
      request(app.getHttpServer()).get(`/api/trips/${tripId}/finance`),
      person.token,
    ).expect(expected);
  }

  /** Баланс по логину: `{ a: -1000, g: 9800 }`. */
  async function balances(tripId: string, person: Person) {
    const response = await view(tripId, person);
    const byId = new Map<string, number>(
      response.body.members.map((member: { userId: string; balanceRub: number }) => [
        member.userId,
        member.balanceRub,
      ]),
    );

    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries({ a, b, c, d, e, g })) {
      result[key] = byId.get(value.id) ?? 0;
    }

    return result;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SmtpService)
      .useValue({ sendEmail: vi.fn().mockResolvedValue(undefined) })
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();

    dataSource = moduleFixture.get(DataSource);

    goalObjectId = (
      await dataSource.query(
        `INSERT INTO objects (name, type) VALUES ('Бухгалтерия e2e', 'вершина') RETURNING id`,
      )
    )[0].id;

    // Без сида ролей создание похода падает 500-й — тест снимает зависимость.
    await dataSource.query(
      `INSERT INTO roles (code, name) VALUES ($1, 'Организатор') ON CONFLICT (code) DO NOTHING`,
      [ORGANIZER_ROLE_CODE],
    );

    const emailCodeService = moduleFixture.get(EmailCodeService);
    const realCreateCode = emailCodeService.createCode.bind(emailCodeService);
    vi.spyOn(emailCodeService, 'createCode').mockImplementation((mail) => {
      lastCode = realCreateCode(mail);
      return lastCode;
    });

    a = await login(emails.a);
    b = await login(emails.b);
    c = await login(emails.c);
    d = await login(emails.d);
    e = await login(emails.e);
    g = await login(emails.g);

    trip1 = await createTrip('Бухгалтерия: пример заказчика');
    for (const person of [b, c, d, e, g]) await addGoing(trip1, person);

    // Второй поход: Д приглашён, но не принял — ему финансы видны,
    // а тратить он ещё не может.
    trip2 = await createTrip('Бухгалтерия: компенсации');
    for (const person of [b, c, g]) await addGoing(trip2, person);
    await auth(
      request(app.getHttpServer()).post(`/api/trips/${trip2}/requests`),
      a.token,
    )
      .send({ direction: 'invite', userId: d.id })
      .expect(201);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // Расходы, доли и компенсации уходят каскадом вместе с походами.
      await dataSource.query('DELETE FROM trips WHERE id = ANY($1::bigint[])', [
        [
          trip1,
          trip2,
          trip3,
          trip4,
          trip5,
          trip6,
          trip7,
          trip8,
          trip9,
          trip10,
          cardTrip,
          financeNotifyTrip,
        ].filter(Boolean),
      ]);
      // Личные сообщения о компенсациях живут вне похода: диалог не уходит
      // каскадом от `trips`, а FK действий и сообщений держат людей.
      // Чистим до пользователей, иначе удаление падает на `FK_messages_sender`.
      const userIds = [a, b, c, d, e, g]
        .filter(Boolean)
        .map((person) => person.id);

      // Адресатом действия бывает и человек без аккаунта (личное сообщение
      // о переводе «Дяде Вите»): без его id в списке действия оставались бы
      // и держали `FK_message_actions_target` при удалении людей.
      if (virtualPersonId) userIds.push(virtualPersonId);
      if (financeVirtualId) userIds.push(financeVirtualId);

      await dataSource.query(
        `DELETE FROM message_actions WHERE "target_user_id" = ANY($1::uuid[])`,
        [userIds],
      );
      await dataSource.query(
        `DELETE FROM conversations
          WHERE "kind" = 'direct'
            AND ("direct_a" = ANY($1::uuid[]) OR "direct_b" = ANY($1::uuid[]))`,
        [userIds],
      );
      // Человек без аккаунта ссылается на владельца — удаляем его первым.
      if (virtualPersonId) {
        await dataSource.query('DELETE FROM users WHERE id = $1', [
          virtualPersonId,
        ]);
      }
      if (financeVirtualId) {
        await dataSource.query('DELETE FROM users WHERE id = $1', [
          financeVirtualId,
        ]);
      }
      await dataSource.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        [a, b, c, d, e, g].filter(Boolean).map((person) => person.id),
      ]);
      await dataSource.query('DELETE FROM objects WHERE id = $1', [
        goalObjectId,
      ]);
    }

    await app?.close();
  });

  describe('пустая вкладка и права', () => {
    it('у нового похода записей нет, а состав виден целиком', async () => {
      const response = await view(trip1, a);

      expect(response.body.expenses).toEqual([]);
      expect(response.body.compensations).toEqual([]);
      expect(response.body.members).toHaveLength(6);
      expect(response.body.me.balanceRub).toBe(0);
      expect(response.body.me.canSpend).toBe(true);
      expect(response.body.me.suggestions).toEqual([]);
    });

    it('реквизиты участника приходят только в «Бухгалтерии»', async () => {
      await auth(
        request(app.getHttpServer()).patch('/api/users/me'),
        g.token,
      )
        .send({ paymentDetails: '+7 914 000-11-22', paymentBank: 'Сбербанк' })
        .expect(200);

      const response = await view(trip1, a);
      const member = response.body.members.find(
        (item: { userId: string }) => item.userId === g.id,
      );

      expect(member.paymentDetails).toBe('+7 914 000-11-22');
      expect(member.paymentBank).toBe('Сбербанк');
    });

    it('посторонний вкладку не видит', async () => {
      // Е не входит во второй поход; поход публичный, значит 403, а не 404.
      await view(trip2, e, 403);
    });

    it('приглашённый видит, но тратить ещё не может', async () => {
      // Экран по этому флагу выключает кнопки, а не узнаёт о запрете 403-й.
      const invited = await view(trip2, d);
      expect(invited.body.me.canSpend).toBe(false);

      await addExpense(
        trip2,
        d,
        { amountRub: 100, split: 'all', description: 'Рано' },
        403,
      );
    });
  });

  describe('пример заказчика: шесть человек', () => {
    it('продукты за 12 000 на всех', async () => {
      const response = await addExpense(trip1, g, {
        amountRub: 12000,
        split: 'all',
        description: 'Продукты',
        spentAt: '2026-11-01',
      });

      expect(response.body.expenses).toHaveLength(1);
      expect(response.body.expenses[0].authorUserId).toBe(g.id);
      expect(response.body.expenses[0].shares).toHaveLength(6);
      expect(
        response.body.expenses[0].shares.every(
          (share: { amountRub: number }) => share.amountRub === 2000,
        ),
      ).toBe(true);

      const result = await balances(trip1, a);
      expect(result.g).toBe(10000);
      expect(result.a).toBe(-2000);
    });

    it('бензин 1 500 на А, Б и В; ужин 500 за Е; коньяк 1 000 на пятерых', async () => {
      await addExpense(trip1, a, {
        amountRub: 1500,
        split: 'group',
        participantIds: [a.id, b.id, c.id],
        description: 'Бензин',
        spentAt: '2026-11-02',
      });
      await addExpense(trip1, c, {
        amountRub: 500,
        split: 'group',
        participantIds: [e.id],
        description: 'Ужин для Е',
        spentAt: '2026-11-03',
      });
      // А за рулём не пьёт — в долях его нет.
      await addExpense(trip1, d, {
        amountRub: 1000,
        split: 'group',
        participantIds: [b.id, c.id, d.id, e.id, g.id],
        description: 'Коньяк',
        spentAt: '2026-11-04',
      });

      const result = await balances(trip1, a);

      expect(result.a).toBe(-1000);
      expect(result.b).toBe(-2700);
      expect(result.c).toBe(-2200);
      expect(result.g).toBe(9800);
      expect(result.d).toBe(-1200);
      expect(result.e).toBe(-2700);
    });

    it('в плюсе только Г, и он один в подсказках у должника', async () => {
      const response = await view(trip1, b);
      const creditors = response.body.members.filter(
        (member: { remainingRub: number }) => member.remainingRub > 0,
      );

      expect(creditors).toHaveLength(1);
      expect(creditors[0].userId).toBe(g.id);

      expect(response.body.me.suggestions).toEqual([
        expect.objectContaining({ userIds: [g.id], amountRub: 2700 }),
      ]);
    });
  });

  describe('правка и удаление расхода', () => {
    let expenseId: string;

    it('автор правит свой расход, доли пересобираются', async () => {
      const created = await addExpense(trip2, a, {
        amountRub: 900,
        split: 'group',
        participantIds: [b.id, c.id],
        description: 'Перекус',
        spentAt: '2026-11-05',
      });
      expenseId = created.body.expenses[0].id;

      const updated = await auth(
        request(app.getHttpServer()).patch(
          `/api/trips/${trip2}/finance/expenses/${expenseId}`,
        ),
        a.token,
      )
        .send({
          amountRub: 1000,
          split: 'group',
          participantIds: [b.id, c.id],
          description: 'Перекус и чай',
        })
        .expect(200);

      expect(updated.body.expenses[0].amountRub).toBe(1000);
      expect(
        updated.body.expenses[0].shares.map(
          (share: { amountRub: number }) => share.amountRub,
        ),
      ).toEqual([500, 500]);
    });

    it('чужой расход править и удалять нельзя', async () => {
      await auth(
        request(app.getHttpServer()).patch(
          `/api/trips/${trip2}/finance/expenses/${expenseId}`,
        ),
        b.token,
      )
        .send({
          amountRub: 1,
          split: 'group',
          participantIds: [b.id],
          description: 'Мой',
        })
        .expect(403);

      await auth(
        request(app.getHttpServer()).delete(
          `/api/trips/${trip2}/finance/expenses/${expenseId}`,
        ),
        b.token,
      ).expect(403);
    });

    it('автор удаляет расход — запись исчезает', async () => {
      const deleted = await auth(
        request(app.getHttpServer()).delete(
          `/api/trips/${trip2}/finance/expenses/${expenseId}`,
        ),
        a.token,
      ).expect(200);

      expect(
        deleted.body.expenses.some(
          (expense: { id: string }) => expense.id === expenseId,
        ),
      ).toBe(false);
    });
  });

  describe('«Чек» из «Питания»', () => {
    it('делит на питающихся с общего и подписывает пустое описание', async () => {
      // Е ест отдельно — в доли чека он не попадает.
      await dataSource.query(
        'UPDATE trip_participants SET eats_separately = true WHERE trip_id = $1 AND user_id = $2',
        [trip1, e.id],
      );

      const response = await addExpense(trip1, b, {
        amountRub: 600,
        split: 'commonEaters',
        description: '',
        spentAt: '2026-11-06',
      });

      const expense = response.body.expenses.find(
        (item: { split: string }) => item.split === 'commonEaters',
      );

      expect(expense.description).toBe('на продукты');
      expect(expense.shares).toHaveLength(5);
      expect(
        expense.shares.some(
          (share: { userId: string }) => share.userId === e.id,
        ),
      ).toBe(false);
      expect(
        expense.shares.reduce(
          (sum: number, share: { amountRub: number }) => sum + share.amountRub,
          0,
        ),
      ).toBe(600);
    });

    it('смена питания пересобирает уже записанные чеки с общего стола', async () => {
      // Возвращаем Б к общему столу напрямую: предыдущий чек (600 ₽) создан,
      // когда он ещё ел со всеми. Прямая запись в базу доли не трогает —
      // пересчёт делает именно смена питания через API.
      await dataSource.query(
        `UPDATE trip_participants SET eats_separately = false
         WHERE trip_id = $1 AND user_id = $2`,
        [trip1, b.id],
      );

      const created = await addExpense(trip1, a, {
        amountRub: 300,
        split: 'commonEaters',
        description: 'Пересчёт',
        spentAt: '2026-11-09',
      });
      const expenseId = created.body.expenses.find(
        (item: { description: string }) => item.description === 'Пересчёт',
      ).id as string;

      const before = await balances(trip1, a);

      // Б ставит «питаюсь отдельно» сам: за него это делает только человек
      // с аккаунтом, виртуальному — ведущий.
      await auth(
        request(app.getHttpServer()).patch(
          `/api/trips/${trip1}/participants/me`,
        ),
        b.token,
      )
        .send({ status: 'going', eatsSeparately: true })
        .expect(200);

      const after = await view(trip1, a);
      const expense = after.body.expenses.find(
        (item: { id: string }) => item.id === expenseId,
      );

      // Е уже ест отдельно (тест выше), теперь и Б: было 5 едоков, стало 4.
      expect(expense.shares).toHaveLength(4);
      expect(
        expense.shares.some(
          (share: { userId: string }) => share.userId === b.id,
        ),
      ).toBe(false);
      expect(
        expense.shares.reduce(
          (sum: number, share: { amountRub: number }) => sum + share.amountRub,
          0,
        ),
      ).toBe(300);

      // Пересчитаны оба чека с общего: 600 ₽ (5→4 едока) и 300 ₽ (5→4).
      // Доля Б в них была 120 + 60 = 180 ₽ — ровно столько возвращается
      // в его баланс.
      const afterBalances = await balances(trip1, a);
      expect(afterBalances.b! - before.b!).toBe(180);

      // Возвращаем как было: следующие проверки не должны зависеть от Б.
      await auth(
        request(app.getHttpServer()).patch(
          `/api/trips/${trip1}/participants/me`,
        ),
        b.token,
      )
        .send({ status: 'going', eatsSeparately: false })
        .expect(200);
    });

    /**
     * Баг 12.11.2026 повторился 13.11.2026: доли, разошедшиеся с составом
     * едоков, не чинились. Первый вариант пересчёта убирал доли вышедших
     * из-за стола, но не возвращал вернувшихся — чек, поделённый на четырёх,
     * оставался четырёхдольным при пяти едоках, и галочка «питаюсь отдельно»
     * ничего не меняла. Теперь доли пересобираются целиком.
     */
    it('разошедшиеся доли чинятся при смене питания: вернувшийся снова платит', async () => {
      const current = await view(trip1, a);
      const expense = current.body.expenses.find(
        (item: { description: string }) => item.description === 'Пересчёт',
      );
      expect(expense).toBeDefined();

      // Так выглядел баг: у едока Б доли в чеке нет, хотя он ест со всеми.
      await dataSource.query(
        'DELETE FROM trip_expense_shares WHERE expense_id = $1 AND user_id = $2',
        [expense.id, b.id],
      );

      const toggle = (eatsSeparately: boolean) =>
        auth(
          request(app.getHttpServer()).patch(
            `/api/trips/${trip1}/participants/me`,
          ),
          b.token,
        )
          .send({ status: 'going', eatsSeparately })
          .expect(200);

      // Два действия: выйти из-за стола и вернуться. Каждое — пересборка.
      await toggle(true);
      await toggle(false);

      const fixed = await view(trip1, a);
      const row = fixed.body.expenses.find(
        (item: { id: string }) => item.id === expense.id,
      );

      // Е ест отдельно, остальные пятеро — с общего: доля Б на месте,
      // сумма прежняя, и никто не потерял деньги.
      expect(row.shares).toHaveLength(5);
      expect(
        row.shares.find((share: { userId: string }) => share.userId === b.id),
      ).toBeDefined();
      expect(
        row.shares.reduce(
          (sum: number, share: { amountRub: number }) => sum + share.amountRub,
          0,
        ),
      ).toBe(300);
    });

    it('обычный расход без описания не создаётся', async () => {
      await addExpense(
        trip1,
        b,
        { amountRub: 100, split: 'all', description: '   ' },
        400,
      );
    });
  });

  describe('компенсации: ожидание бронирует кредит', () => {
    let compToA: string;

    beforeAll(async () => {
      // А +4000, Б +2000, В −2000, Г −4000.
      await addExpense(trip2, a, {
        amountRub: 4000,
        split: 'group',
        participantIds: [c.id, g.id],
        description: 'Закупка',
        spentAt: '2026-11-07',
      });
      await addExpense(trip2, b, {
        amountRub: 2000,
        split: 'group',
        participantIds: [g.id],
        description: 'Газ',
        spentAt: '2026-11-08',
      });
    });

    it('у В два варианта, суммы по 2000', async () => {
      const response = await view(trip2, c);

      expect(response.body.me.balanceRub).toBe(-2000);
      expect(
        response.body.me.suggestions.map(
          (option: { userIds: string[]; amountRub: number }) => [
            option.userIds[0],
            option.amountRub,
          ],
        ),
      ).toEqual([
        [a.id, 2000],
        [b.id, 2000],
      ]);
    });

    it('Г отправляет А 4000 — баланс не меняется, кредит занят', async () => {
      const sent = await auth(
        request(app.getHttpServer()).post(
          `/api/trips/${trip2}/finance/compensations`,
        ),
        g.token,
      )
        .send({ toUserId: a.id, amountRub: 4000 })
        .expect(201);

      compToA = sent.body.compensations[0].id;
      expect(sent.body.compensations[0].status).toBe('pending');
      expect(sent.body.compensations[0].canConfirm).toBe(false);
      expect(sent.body.compensations[0].canCancel).toBe(true);

      // Баланс не двигается, остаток — двигается.
      expect((await balances(trip2, g)).g).toBe(-4000);
      expect((await view(trip2, g)).body.me.remainingRub).toBe(0);

      // У В остался только Б: кредит А забронирован ожидающим переводом.
      expect(
        (await view(trip2, c)).body.me.suggestions.map(
          (option: { userIds: string[] }) => option.userIds[0],
        ),
      ).toEqual([b.id]);
    });

    it('подтверждает только получатель, и баланс двигается', async () => {
      await auth(
        request(app.getHttpServer()).post(
          `/api/trips/${trip2}/finance/compensations/${compToA}/confirm`,
        ),
        b.token,
      ).expect(403);

      const confirmed = await auth(
        request(app.getHttpServer()).post(
          `/api/trips/${trip2}/finance/compensations/${compToA}/confirm`,
        ),
        a.token,
      ).expect(200);

      expect(confirmed.body.compensations[0].status).toBe('confirmed');

      const result = await balances(trip2, a);
      expect(result.a).toBe(0);
      expect(result.g).toBe(0);
    });

    it('повторное подтверждение ничего не ломает', async () => {
      const again = await auth(
        request(app.getHttpServer()).post(
          `/api/trips/${trip2}/finance/compensations/${compToA}/confirm`,
        ),
        a.token,
      ).expect(200);

      expect(again.body.compensations[0].status).toBe('confirmed');
    });

    it('подтверждённую компенсацию отменить нельзя', async () => {
      await auth(
        request(app.getHttpServer()).delete(
          `/api/trips/${trip2}/finance/compensations/${compToA}`,
        ),
        g.token,
      ).expect(409);
    });

    it('больше остатка долга перевести нельзя', async () => {
      // У Г долг закрыт полностью.
      await auth(
        request(app.getHttpServer()).post(
          `/api/trips/${trip2}/finance/compensations`,
        ),
        g.token,
      )
        .send({ toUserId: b.id, amountRub: 2000 })
        .expect(400);

      // У В долг 2000 — 2500 тоже больше.
      await auth(
        request(app.getHttpServer()).post(
          `/api/trips/${trip2}/finance/compensations`,
        ),
        c.token,
      )
        .send({ toUserId: b.id, amountRub: 2500 })
        .expect(400);
    });

    it('ожидающую компенсацию отменяет только отправитель', async () => {
      const sent = await auth(
        request(app.getHttpServer()).post(
          `/api/trips/${trip2}/finance/compensations`,
        ),
        c.token,
      )
        .send({ toUserId: b.id, amountRub: 1000 })
        .expect(201);

      const id = sent.body.compensations[0].id as string;

      await auth(
        request(app.getHttpServer()).delete(
          `/api/trips/${trip2}/finance/compensations/${id}`,
        ),
        b.token,
      ).expect(403);

      await auth(
        request(app.getHttpServer()).delete(
          `/api/trips/${trip2}/finance/compensations/${id}`,
        ),
        c.token,
      ).expect(200);
    });

    it('себе и не участнику не переводят', async () => {
      await auth(
        request(app.getHttpServer()).post(
          `/api/trips/${trip2}/finance/compensations`,
        ),
        c.token,
      )
        .send({ toUserId: c.id, amountRub: 100 })
        .expect(400);

      await auth(
        request(app.getHttpServer()).post(
          `/api/trips/${trip2}/finance/compensations`,
        ),
        c.token,
      )
        .send({ toUserId: e.id, amountRub: 100 })
        .expect(400);
    });

    it('чужие изменения уходят в SSE-поток вкладки', async () => {
      const events = app.get(TripEventsService);
      const received: string[] = [];
      const subscription = events
        .stream(String(trip2))
        .subscribe((event) => received.push(event.scope));

      await addExpense(trip2, b, {
        amountRub: 100,
        split: 'all',
        description: 'Проверка потока',
        spentAt: '2026-11-09',
      });

      subscription.unsubscribe();

      expect(received).toContain('finance');
    });
  });

  /**
   * Семейная компенсация и общая касса семьи (12.11.2026).
   *
   * Заказчик: «сумма к компенсации рассчитывается от семьи… проще — папа
   * платит за всех»; «предлагать семью одной строкой „Вася и Аня“, сумму =
   * Вася + Аня». 12.11.2026 уточнил: это **общая касса** — «компенсация
   * семье любому её члену и „платит семья“ при компенсации другим
   * участникам», а расходы остаются от конкретного человека.
   *
   * Третий поход: А (организатор), Б, В, Г. Семьи: (Б, В) и (А, Г).
   * Г платит 1 200 на всех — каждый должен 300; А платит 800 за Г —
   * у А +500, у Г +100. Итого: семья (Б, В) должна 600, семья (А, Г)
   * в плюсе на 600.
   */
  describe('семейная компенсация', () => {
    /** Пары переводов без учёта порядка ответа. */
    function pairs(compensations: Array<Record<string, string | number>>) {
      return compensations
        .map((item) => `${item.fromUserId}->${item.toUserId}:${item.amountRub}`)
        .sort();
    }

    beforeAll(async () => {
      trip3 = await createTrip('Бухгалтерия: семьи');
      for (const person of [b, c, g]) await addGoing(trip3, person);

      await makeFamily(b, c);
      await makeFamily(a, g);

      // Реквизиты: у А есть, у Г нет — подсказка покажет только А.
      // У Г они остались от прошлого блока, поэтому чистим их заранее.
      await auth(
        request(app.getHttpServer()).patch('/api/users/me'),
        g.token,
      )
        .send({ paymentDetails: '', paymentBank: '' })
        .expect(200);

      await auth(
        request(app.getHttpServer()).patch('/api/users/me'),
        a.token,
      )
        .send({ paymentDetails: '+7 914 111-22-33', paymentBank: 'Сбербанк' })
        .expect(200);

      await addExpense(trip3, g, {
        amountRub: 1200,
        split: 'all',
        description: 'Продукты',
        spentAt: '2026-11-10',
      });
      await addExpense(trip3, a, {
        amountRub: 800,
        split: 'group',
        participantIds: [g.id],
        description: 'Газ',
        spentAt: '2026-11-11',
      });
    });

    it('сумма варианта — остаток общей кассы, а предлагается только чужая семья', async () => {
      const response = await view(trip3, b);

      // Личный баланс Б — 300, но платит семья: 300 + 300 = 600.
      expect(response.body.me.balanceRub).toBe(-300);
      expect(response.body.me.familyBalanceRub).toBe(-600);
      expect(response.body.me.familyRemainingRub).toBe(-600);
      expect(response.body.me.familyDebtRub).toBe(600);
      expect(response.body.me.familyCreditRub).toBe(0);

      // Кассы семей: одна строка на семью, а не на человека.
      const mine = response.body.families.find(
        (family: { isMine: boolean }) => family.isMine,
      );
      expect(mine.memberIds).toEqual([b.id, c.id]);
      expect(mine.balanceRub).toBe(-600);
      expect(mine.displayName).toContain(' и ');

      const other = response.body.families.find(
        (family: { isMine: boolean }) => !family.isMine,
      );
      expect(other.balanceRub).toBe(600);

      expect(response.body.me.suggestions).toHaveLength(1);
      const [option] = response.body.me.suggestions;
      expect(option.userIds).toEqual([a.id, g.id]);
      expect(option.amountRub).toBe(600);
      // Своя семья в варианты не попадает.
      expect(option.userIds).not.toContain(c.id);
    });

    it('семья одной строкой и реквизиты всех, у кого они есть', async () => {
      const [option] = (await view(trip3, b)).body.me.suggestions;

      expect(option.displayName).toContain(' и ');
      expect(option.members.map((member: { userId: string }) => member.userId)).toEqual(
        [a.id, g.id],
      );

      const withDetails = option.members.filter(
        (member: { paymentDetails: string | null }) => member.paymentDetails !== null,
      );
      expect(withDetails).toHaveLength(1);
      expect(withDetails[0].userId).toBe(a.id);
      expect(withDetails[0].paymentBank).toBe('Сбербанк');
      expect(withDetails[0].gender).toBe('m');

      const withoutDetails = option.members.find(
        (member: { userId: string }) => member.userId === g.id,
      );
      expect(withoutDetails.paymentDetails).toBeNull();
    });

    it('своей семье не переводят и больше остатка не проводят', async () => {
      await auth(
        request(app.getHttpServer()).post(
          `/api/trips/${trip3}/finance/compensations`,
        ),
        b.token,
      )
        .send({ toUserId: c.id, amountRub: 100 })
        .expect(400);

      await auth(
        request(app.getHttpServer()).post(
          `/api/trips/${trip3}/finance/compensations`,
        ),
        b.token,
      )
        .send({ toUserId: g.id, amountRub: 601 })
        .expect(400);
    });

    it('одно действие — один перевод в общую кассу семьи', async () => {
      // Платит В: лично он должник на 300, а касса семьи — на 600.
      const sent = await auth(
        request(app.getHttpServer()).post(
          `/api/trips/${trip3}/finance/compensations`,
        ),
        c.token,
      )
        .send({ toUserId: a.id, amountRub: 600 })
        .expect(201);

      // Получателю подтверждать одну строку, а не три: касса у семьи одна.
      expect(sent.body.compensations).toHaveLength(1);
      expect(pairs(sent.body.compensations)).toEqual([`${c.id}->${a.id}:600`]);

      // Ожидающий перевод бронирует кассу: семья Б и В больше ничего не должна.
      const after = await view(trip3, b);
      expect(after.body.me.familyDebtRub).toBe(0);
      expect(after.body.me.familyRemainingRub).toBe(0);
      expect(after.body.me.familyBalanceRub).toBe(-600);
      expect(after.body.me.suggestions).toEqual([]);
    });

    it('отменить перевод может только отправитель; родной — нет', async () => {
      const [compensation] = (await view(trip3, b)).body.compensations;
      expect(compensation.fromUserId).toBe(c.id);

      /**
       * 25.11.2026: переводы личные. Б — родной отправителя В, но отменить
       * чужой перевод больше не может: семейное право осталось только
       * у залога, а балансы и расчёт компенсаций семьи не тронуты.
       */
      expect(compensation.canCancel).toBe(false);

      await auth(
        request(app.getHttpServer()).delete(
          `/api/trips/${trip3}/finance/compensations/${compensation.id}`,
        ),
        g.token,
      ).expect(403);

      await auth(
        request(app.getHttpServer()).delete(
          `/api/trips/${trip3}/finance/compensations/${compensation.id}`,
        ),
        b.token,
      ).expect(403);

      // Сам отправитель — может: это его перевод.
      await auth(
        request(app.getHttpServer()).delete(
          `/api/trips/${trip3}/finance/compensations/${compensation.id}`,
        ),
        c.token,
      ).expect(200);
    });

    it('подтвердить перевод может только получатель; родной — нет', async () => {
      // Отменённый перевод не возвращается — семья платит его заново.
      const created = await auth(
        request(app.getHttpServer()).post(
          `/api/trips/${trip3}/finance/compensations`,
        ),
        c.token,
      )
        .send({ toUserId: a.id, amountRub: 600 })
        .expect(201);
      const [compensation] = created.body.compensations;

      // Б не получатель и не родной А — подтверждать ему нечего.
      expect(compensation.canConfirm).toBe(false);

      await auth(
        request(app.getHttpServer()).post(
          `/api/trips/${trip3}/finance/compensations/${compensation.id}/confirm`,
        ),
        b.token,
      ).expect(403);

      /**
       * Г — родной получателя А, но с 25.11.2026 семейное подтверждение
       * снято: «переводы личные; семейные связи — только в расчёте
       * балансов». Михаил подтверждает только сам, Сергей получает 403.
       */
      await auth(
        request(app.getHttpServer()).post(
          `/api/trips/${trip3}/finance/compensations/${compensation.id}/confirm`,
        ),
        g.token,
      ).expect(403);

      const confirmed = await auth(
        request(app.getHttpServer()).post(
          `/api/trips/${trip3}/finance/compensations/${compensation.id}/confirm`,
        ),
        a.token,
      ).expect(200);

      expect(
        confirmed.body.compensations.find(
          (item: { id: string }) => item.id === compensation.id,
        ).status,
      ).toBe('confirmed');

      // Подтверждённый перевод закрыл кассу: было −600, пришло 600.
      const after = await view(trip3, b);
      expect(after.body.me.familyBalanceRub).toBe(0);
      expect(after.body.me.familyRemainingRub).toBe(0);
      expect(after.body.me.suggestions).toEqual([]);
    });
  });

  /**
   * 12.11.2026: общая касса семьи.
   *
   * Пятый поход: А (организатор), Б, В, Г; семьи (А, Г) и (Б, В).
   * Б платит 1 000 за А, Г платит 300 за В, А платит 100 за В. Балансы:
   * А −900, Г +300, Б +1 000, В −400. Касса (А, Г) — −600, касса (Б, В) —
   * +600. По прежнему правилу (долг и кредит по отдельности) семья А и Г
   * предложила бы 900 — весь долг А, — хотя касса должна 600: плюс Г
   * внутри семьи гасит часть минуса А.
   */
  describe('общая касса семьи', () => {
    beforeAll(async () => {
      trip5 = await createTrip('Бухгалтерия: общая касса');
      for (const person of [b, c, g]) await addGoing(trip5, person);

      await makeFamily(b, c);
      await makeFamily(a, g);

      await addExpense(trip5, b, {
        amountRub: 1000,
        split: 'group',
        participantIds: [a.id],
        description: 'За А',
      });
      await addExpense(trip5, g, {
        amountRub: 300,
        split: 'group',
        participantIds: [c.id],
        description: 'За В',
      });
      await addExpense(trip5, a, {
        amountRub: 100,
        split: 'group',
        participantIds: [c.id],
        description: 'За В ещё',
      });
    });

    it('касса семьи гасит внутренние долги: предлагается чистый остаток', async () => {
      const response = await view(trip5, a);

      expect(response.body.me.balanceRub).toBe(-900);
      expect(response.body.me.familyBalanceRub).toBe(-600);
      expect(response.body.me.familyDebtRub).toBe(600);

      // Старое правило дало бы 900 — весь личный долг А.
      expect(response.body.me.suggestions).toEqual([
        expect.objectContaining({ userIds: [b.id, c.id], amountRub: 600 }),
      ]);

      const mine = response.body.families.find(
        (family: { isMine: boolean }) => family.isMine,
      );
      expect(mine.memberIds).toEqual([a.id, g.id]);
      expect(mine.balanceRub).toBe(-600);

      const other = response.body.families.find(
        (family: { isMine: boolean }) => !family.isMine,
      );
      expect(other.balanceRub).toBe(600);
    });

    it('перевод закрывает кассу целиком и подтверждается одной строкой', async () => {
      const sent = await auth(
        request(app.getHttpServer()).post(
          `/api/trips/${trip5}/finance/compensations`,
        ),
        a.token,
      )
        .send({ toUserId: b.id, amountRub: 600 })
        .expect(201);

      expect(sent.body.compensations).toHaveLength(1);

      const pending = await view(trip5, a);
      expect(pending.body.me.familyBalanceRub).toBe(-600);
      expect(pending.body.me.familyRemainingRub).toBe(0);
      expect(pending.body.me.suggestions).toEqual([]);

      await auth(
        request(app.getHttpServer()).post(
          `/api/trips/${trip5}/finance/compensations/${sent.body.compensations[0].id}/confirm`,
        ),
        b.token,
      ).expect(200);

      const confirmed = await view(trip5, a);
      expect(confirmed.body.me.familyBalanceRub).toBe(0);
      expect(confirmed.body.me.familyRemainingRub).toBe(0);
    });
  });

  /**
   * 12.11.2026: «забыли про виртуальных участников… ведущий этот аккаунт
   * пользователь должен получить возможность выбора от кого
   * платёж/компенсация». Семью это не касается — «на пользователя всё
   * вешаем»; здесь только человек без аккаунта.
   */
  describe('человек без аккаунта: платёж и перевод от ведущего', () => {
    beforeAll(async () => {
      trip4 = await createTrip('Бухгалтерия: человек без аккаунта');
      await addGoing(trip4, b);

      const created = await auth(
        request(app.getHttpServer()).post(
          `/api/trips/${trip4}/participants/virtual`,
        ),
        b.token,
      )
        .send({ displayName: 'Дядя Витя' })
        .expect(201);

      virtualPersonId = created.body.userId as string;
    });

    it('расход записывается на человека без аккаунта, правит его ведущий', async () => {
      const response = await addExpense(trip4, b, {
        amountRub: 900,
        split: 'all',
        description: 'Бензин',
        payerUserId: virtualPersonId,
      });

      const expense = response.body.expenses[0];
      expect(expense.authorUserId).toBe(virtualPersonId);
      expect(expense.canEdit).toBe(true);

      const member = response.body.members.find(
        (item: { userId: string }) => item.userId === virtualPersonId,
      );
      expect(member.isVirtual).toBe(true);
      expect(member.managedByMe).toBe(true);
      expect(member.balanceRub).toBe(600);

      // Организатор его не ведёт: править расход не может и выбора не видит.
      const asOrganizer = await view(trip4, a);
      expect(asOrganizer.body.expenses[0].canEdit).toBe(false);
      expect(
        asOrganizer.body.members.find(
          (item: { userId: string }) => item.userId === virtualPersonId,
        ).managedByMe,
      ).toBe(false);
      expect(asOrganizer.body.managedSenders).toEqual([]);
    });

    it('чужой человек без аккаунта плательщиком не становится', async () => {
      await addExpense(
        trip4,
        a,
        {
          amountRub: 100,
          split: 'all',
          description: 'Чужой',
          payerUserId: virtualPersonId,
        },
        403,
      );
    });

    it('перевод от человека без аккаунта создаёт и отменяет его ведущий', async () => {
      // Три расхода на одного виртуального делают его должником А на 300.
      for (let index = 0; index < 3; index += 1) {
        await addExpense(trip4, a, {
          amountRub: 300,
          split: 'group',
          participantIds: [virtualPersonId],
          description: `Долг ${index + 1}`,
        });
      }

      const asManager = await view(trip4, b);
      const sender = asManager.body.managedSenders.find(
        (item: { userId: string }) => item.userId === virtualPersonId,
      );

      expect(sender.familyDebtRub).toBe(300);
      expect(
        sender.suggestions.map(
          (option: { userIds: string[] }) => option.userIds,
        ),
      ).toEqual([[a.id]]);

      // Чужой ведущий за него не переводит.
      await auth(
        request(app.getHttpServer()).post(
          `/api/trips/${trip4}/finance/compensations`,
        ),
        a.token,
      )
        .send({ toUserId: b.id, fromUserId: virtualPersonId, amountRub: 100 })
        .expect(403);

      const created = await auth(
        request(app.getHttpServer()).post(
          `/api/trips/${trip4}/finance/compensations`,
        ),
        b.token,
      )
        .send({ toUserId: a.id, fromUserId: virtualPersonId, amountRub: 300 })
        .expect(201);

      const compensation = created.body.compensations.find(
        (item: { fromUserId: string }) => item.fromUserId === virtualPersonId,
      );
      expect(compensation.status).toBe('pending');
      // Отменить перевод виртуального может его ведущий, хотя отправитель —
      // не он сам.
      expect(compensation.canCancel).toBe(true);

      const cancelled = await auth(
        request(app.getHttpServer()).delete(
          `/api/trips/${trip4}/finance/compensations/${compensation.id}`,
        ),
        b.token,
      ).expect(200);

      expect(
        cancelled.body.compensations.some(
          (item: { id: string }) => item.id === compensation.id,
        ),
      ).toBe(false);
    });

    it('получение за человека без аккаунта подтверждает его ведущий', async () => {
      // Виртуальный заплатил 600 за А: теперь он кредитор на 300 (после
      // прежних долгов), А — должник.
      await addExpense(trip4, b, {
        amountRub: 600,
        split: 'group',
        participantIds: [a.id],
        description: 'Палатка для А',
        payerUserId: virtualPersonId,
      });

      // Б платит 300 за А: А снова должник, а у виртуального кредит.
      await addExpense(trip4, b, {
        amountRub: 300,
        split: 'group',
        participantIds: [a.id],
        description: 'Долг А',
      });

      const created = await auth(
        request(app.getHttpServer()).post(
          `/api/trips/${trip4}/finance/compensations`,
        ),
        a.token,
      )
        .send({ toUserId: virtualPersonId, amountRub: 300 })
        .expect(201);

      const compensation = created.body.compensations.find(
        (item: { toUserId: string }) => item.toUserId === virtualPersonId,
      );
      expect(compensation.status).toBe('pending');

      /**
       * Карточка уходит **владельцу** виртуального (25.11.2026): у самого
       * виртуального входа нет, диалог с ним не создаётся, а текст
       * называет участника по имени. «Переводы личные»: карточка — это
       * личное уведомление владельцу, а не групповое.
       */
      const [card] = (await dataSource.query(
        `SELECT "recipient_user_id", "conversation_id", "body"
           FROM "notifications" WHERE "compensation_id" = $1`,
        [compensation.id],
      )) as Array<{
        recipient_user_id: string;
        conversation_id: string | null;
        body: string;
      }>;

      expect(card).toMatchObject({ recipient_user_id: b.id });
      expect(card!.conversation_id).toBeNull();
      expect(card!.body).toContain('перевёл(а) твоему участнику (Дядя Витя)');
      expect(card!.body).toContain('300 ₽');

      // Самому виртуальному карточки нет: входить в приложение ему нечем.
      const virtualCards = (await dataSource.query(
        `SELECT "id" FROM "notifications" WHERE "recipient_user_id" = $1`,
        [virtualPersonId],
      )) as Array<{ id: string }>;
      expect(virtualCards).toHaveLength(0);

      // Получатель — виртуальный, войти не может; подтверждает ведущий.
      const asManager = await view(trip4, b);
      expect(
        asManager.body.compensations.find(
          (item: { id: string }) => item.id === compensation.id,
        ).canConfirm,
      ).toBe(true);

      const confirmed = await auth(
        request(app.getHttpServer()).post(
          `/api/trips/${trip4}/finance/compensations/${compensation.id}/confirm`,
        ),
        b.token,
      ).expect(200);

      expect(
        confirmed.body.compensations.find(
          (item: { id: string }) => item.id === compensation.id,
        ).status,
      ).toBe('confirmed');
    });
  });

  /**
   * Залог участия: покрытие расходами и решения (v3, 18.11.2026).
   *
   * Пример заказчика дословно: «A,B,C,D,E готовятся к походу, есть залог
   * 200р, A купил продуктов на 1000р и отказался от участия, организатор
   * решает удержать с него залог, баланс на этот момент A=+800,
   * B,C,D,E=-200… A уговорил организатора вернуть залог, баланс стал
   * A=+1000, B,C,D,E=-250 разошли полюбовно».
   *
   * **В v3 A не переводит залог:** он вложил 1 000 ₽ — больше залога (200),
   * поэтому залог покрыт расходами и кнопки у A нет. Это и проверяет
   * первый блок. Частичные переводы и «запас» проверяются на отдельном
   * походе (trip7), чтобы их движения не мешали ровно этим цифрам.
   *
   * E — организатор, A платит продукты и выходит.
   */
  describe('залог участия: покрытие расходами и решения (v3)', () => {
    /** Мой залог в ответе вкладки: расчёт покрытия приходит с сервера. */
    interface DepositMeView {
      status: string;
      amountRub: number;
      investedRub: number;
      transferredRub: number;
      pendingRub: number;
      coveredRub: number;
      missingRub: number;
      dueRub: number;
      canTransfer: boolean;
      selfHeld: boolean;
      hasPendingTransfer: boolean;
      holderName: string | null;
    }

    /** Строка секции риска: тот же расчёт плюс решение. */
    interface DepositRowView {
      userId: string;
      status: string;
      declined: boolean;
      investedRub: number;
      transferredRub: number;
      coveredRub: number;
      missingRub: number;
      dueRub: number;
      canDecide: boolean;
      hasPendingTransfer: boolean;
      holderName: string | null;
    }

    interface DepositView {
      amountRub: number;
      canManage: boolean;
      me: DepositMeView | null;
      participants: DepositRowView[];
      senders: {
        userId: string;
        isMe: boolean;
        dueRub: number;
        recipients: { userId: string }[];
      }[];
    }

    interface CompensationView {
      id: string;
      kind: string;
      status: string;
      fromUserId: string;
      toUserId: string;
      amountRub: number;
    }

    const updateTrip = (person: Person, body: Record<string, unknown>) =>
      auth(
        request(app.getHttpServer()).patch(`/api/trips/${trip6}`),
        person.token,
      ).send(body);

    /** Решение организатора: «Вернуть», «Удержать» или снять решение. */
    const setDecision = (
      tripId: string,
      person: Person,
      target: Person,
      status: string,
    ) =>
      auth(
        request(app.getHttpServer()).put(
          `/api/trips/${tripId}/finance/deposit/${target.id}`,
        ),
        person.token,
      ).send({ status });

    const transferDeposit = (
      tripId: string,
      person: Person,
      recipientUserId: string,
      amountRub: number,
      fromUserId?: string,
    ) =>
      auth(
        request(app.getHttpServer()).post(
          `/api/trips/${tripId}/finance/deposit/transfer`,
        ),
        person.token,
      ).send({ recipientUserId, amountRub, fromUserId });

    const confirm = (tripId: string, person: Person, id: string) =>
      auth(
        request(app.getHttpServer()).post(
          `/api/trips/${tripId}/finance/compensations/${id}/confirm`,
        ),
        person.token,
      );

    const decline = (tripId: string, person: Person) =>
      auth(
        request(app.getHttpServer()).patch(
          `/api/trips/${tripId}/participants/me`,
        ),
        person.token,
      ).send({ status: 'declined' });

    /** Баланс человека в ответе вкладки (`0`, если строки нет). */
    const balanceOf = (body: unknown, person: Person): number =>
      (
        body as { members: { userId: string; balanceRub: number }[] }
      ).members.find((member) => member.userId === person.id)?.balanceRub ?? 0;

    const depositOf = (body: unknown) => (body as { deposit: DepositView }).deposit;

    const riskOf = (body: unknown, person: Person) =>
      depositOf(body).participants.find((row) => row.userId === person.id);

    const compensationsOf = (body: unknown) =>
      (body as { compensations: CompensationView[] }).compensations;

    beforeAll(async () => {
      const created = await auth(
        request(app.getHttpServer()).post('/api/trips'),
        e.token,
      )
        .send({
          goalObjectId: Number(goalObjectId),
          status: 'planning',
          announcement: 'Залог: пример заказчика',
        })
        .expect(201);

      trip6 = created.body.id as string;
      for (const person of [a, b, c, g]) {
        await addGoing(trip6, person, e);
      }

      await updateTrip(e, { depositRub: 200 }).expect(200);
      await addExpense(trip6, a, {
        amountRub: 1000,
        split: 'all',
        description: 'Продукты',
        spentAt: '2026-11-18',
      });
    });

    it('без залога блока нет', async () => {
      // Проверяем на соседнем походе, где залог не назначали.
      const response = await view(trip2, a);
      expect(response.body.deposit).toBeNull();
    });

    it('балансы примера до решения: A +800, остальные −200', async () => {
      const response = await view(trip6, a);

      expect(balanceOf(response.body, a)).toBe(800);
      expect(balanceOf(response.body, b)).toBe(-200);
      expect(balanceOf(response.body, c)).toBe(-200);
      expect(balanceOf(response.body, g)).toBe(-200);
      expect(balanceOf(response.body, e)).toBe(-200);
    });

    it('A вложил больше залога: кнопки нет, переводить нечего', async () => {
      const member = await view(trip6, a);

      expect(depositOf(member.body).amountRub).toBe(200);
      expect(depositOf(member.body).canManage).toBe(false);
      expect(depositOf(member.body).me).toMatchObject({
        investedRub: 1000,
        transferredRub: 0,
        pendingRub: 0,
        coveredRub: 200,
        missingRub: 0,
        dueRub: 0,
        canTransfer: false,
      });
      // Секция риска — только организатору: рядовому она не отдаётся.
      expect(depositOf(member.body).participants).toEqual([]);

      // Залог уже покрыт расходами — перевод отклоняется.
      await transferDeposit(trip6, a, e.id, 200).expect(400);
    });

    it('B ничего не вложил: недостача 200, кнопка есть', async () => {
      const member = await view(trip6, b);

      expect(depositOf(member.body).me).toMatchObject({
        investedRub: 0,
        transferredRub: 0,
        coveredRub: 0,
        missingRub: 200,
        dueRub: 200,
        canTransfer: true,
        hasPendingTransfer: false,
      });
      expect(
        depositOf(member.body).senders[0]?.recipients.map(
          (row) => row.userId,
        ),
      ).toEqual([e.id]);
    });

    it('секция риска: идущие с недостатком, без вложившегося A и без организатора', async () => {
      const organizer = await view(trip6, e);
      const risk = depositOf(organizer.body).participants;

      // A вложил 1 000 ₽ — больше залога, ему в секции не место.
      // B, C, D (g) не вложили ничего. E — организатор, своего залога
      // в списке нет.
      expect(risk.map((row) => row.userId)).toEqual([b.id, c.id, g.id]);
      expect(risk.every((row) => row.missingRub === 200)).toBe(true);
      expect(depositOf(organizer.body).canManage).toBe(true);
    });

    it('свой залог организатор считает покрытым: деньги у него', async () => {
      const organizer = await view(trip6, e);

      expect(depositOf(organizer.body).me).toMatchObject({
        status: 'held',
        selfHeld: true,
        coveredRub: 200,
        missingRub: 0,
        canTransfer: false,
        holderName: expect.stringContaining('fin-e-'),
      });
    });

    it('«Удержать»: A решения хватает по расходам — +800 / −200', async () => {
      await decline(trip6, a).expect(200);

      // A покрыл залог продуктами: перевода у него нет, но решать есть что.
      const before = await view(trip6, e);
      expect(riskOf(before.body, a)).toMatchObject({
        declined: true,
        coveredRub: 200,
        canDecide: true,
      });

      const forfeited = await setDecision(trip6, e, a, 'forfeited').expect(200);

      expect(riskOf(forfeited.body, a)).toMatchObject({
        status: 'forfeited',
        declined: true,
      });
      // После удержания личные балансы прежние: залог покрывает долю A.
      expect(balanceOf(forfeited.body, a)).toBe(800);
      expect(balanceOf(forfeited.body, b)).toBe(-200);
      expect(balanceOf(forfeited.body, c)).toBe(-200);
      expect(balanceOf(forfeited.body, g)).toBe(-200);
      expect(balanceOf(forfeited.body, e)).toBe(-200);

      expect(forfeited.body.depositForfeits).toHaveLength(1);
      expect(forfeited.body.depositForfeits[0]).toMatchObject({
        sourceUserId: a.id,
        amountRub: 200,
      });
      expect(forfeited.body.depositReturns).toEqual([]);
    });

    it('«Вернуть»: доля ушедшего на идущих — A +1000 / −250', async () => {
      const returned = await setDecision(trip6, e, a, 'returned').expect(200);

      expect(riskOf(returned.body, a)?.status).toBe('returned');
      expect(returned.body.depositForfeits).toEqual([]);

      // Доля A (200 ₽) разошлась на четверых — по 50 ₽.
      expect(balanceOf(returned.body, a)).toBe(1000);
      expect(balanceOf(returned.body, b)).toBe(-250);
      expect(balanceOf(returned.body, c)).toBe(-250);
      expect(balanceOf(returned.body, g)).toBe(-250);
      expect(balanceOf(returned.body, e)).toBe(-250);

      expect(returned.body.depositReturns).toHaveLength(1);
      expect(returned.body.depositReturns[0]).toMatchObject({
        sourceUserId: a.id,
        amountRub: 200,
      });
      expect(
        returned.body.depositReturns[0].shares.map(
          (share: { amountRub: number }) => share.amountRub,
        ),
      ).toEqual([50, 50, 50, 50]);
    });

    it('решения ставит только организатор', async () => {
      // A — рядовой участник, пусть и уже вышедший.
      await setDecision(trip6, a, b, 'forfeited').expect(403);
      // B идёт: удерживать с него нечего, это не выход из похода.
      await setDecision(trip6, e, b, 'forfeited').expect(400);
      // «Сдал» руками больше не ставится: только подтверждение перевода.
      await setDecision(trip6, e, b, 'held').expect(400);
    });

    it('ушедший без вложений не показывается: решать нечего', async () => {
      // B выходит, но не вложил ни рубля и ничего не переводил.
      await decline(trip6, b).expect(200);

      const viewAfter = await view(trip6, e);
      expect(riskOf(viewAfter.body, b)).toBeUndefined();
      expect(
        depositOf(viewAfter.body).participants.map((row) => row.userId),
      ).not.toContain(b.id);

      await setDecision(trip6, e, b, 'forfeited').expect(400);
      await setDecision(trip6, e, b, 'returned').expect(400);
    });

    it('приглашённому решение не ставится, чужой человек — 404', async () => {
      await auth(
        request(app.getHttpServer()).post(`/api/trips/${trip6}/requests`),
        e.token,
      )
        .send({ direction: 'invite', userId: d.id })
        .expect(201);

      await setDecision(trip6, e, d, 'pending').expect(400);
      await setDecision(
        trip6,
        e,
        { token: '', id: '00000000-0000-4000-8000-000000000000', email: '' },
        'pending',
      ).expect(404);
    });

    it('залог снимается правкой похода, и блок исчезает', async () => {
      const patched = await updateTrip(e, { depositRub: null }).expect(200);
      expect(patched.body.depositRub).toBeNull();

      const response = await view(trip6, e);
      expect(response.body.deposit).toBeNull();
    });

    /**
     * Частичные переводы и «запас» — отдельный поход (v3, 18.11.2026).
     *
     * Примеры плана 2–6: C потратил 50 ₽ (недостача 150), перевёл 100,
     * кнопка осталась; доложил 50 — кнопка исчезла. B перевёл 300 «с
     * запасом»: 200 остаются залогом, 100 — обычным переводом. D вложил
     * 50 и вышел: решать есть что, удержание — на покрытую часть.
     * G не вложил ничего и вышел: в секции его нет.
     */
    describe('частичные переводы и перевод с запасом', () => {
      beforeAll(async () => {
        trip7 = await createTrip('Залог v3: частичные переводы');
        for (const person of [b, c, d, g]) await addGoing(trip7, person);

        await auth(
          request(app.getHttpServer()).patch(`/api/trips/${trip7}`),
          a.token,
        )
          .send({ depositRub: 200 })
          .expect(200);

        // C и D «вложились» по 50 ₽: расход только на себя, чтобы балансы
        // остальных не сдвигались — важна именно сумма покрытия.
        await addExpense(trip7, c, {
          amountRub: 50,
          split: 'group',
          participantIds: [c.id],
          description: 'Личная закупка C',
          spentAt: '2026-11-18',
        });
        await addExpense(trip7, d, {
          amountRub: 50,
          split: 'group',
          participantIds: [d.id],
          description: 'Личная закупка D',
          spentAt: '2026-11-18',
        });
      });

      it('C вложил 50 — в модалке 150', async () => {
        const member = await view(trip7, c);

        expect(depositOf(member.body).me).toMatchObject({
          investedRub: 50,
          transferredRub: 0,
          coveredRub: 50,
          missingRub: 150,
          dueRub: 150,
          canTransfer: true,
        });
        expect(depositOf(member.body).senders[0]).toMatchObject({
          isMe: true,
          dueRub: 150,
        });
      });

      it('C перевёл 100 — кнопка осталась, осталось 50', async () => {
        const transferred = await transferDeposit(trip7, c, a.id, 100).expect(200);
        const [row] = compensationsOf(transferred.body);

        expect(row).toMatchObject({ kind: 'deposit', status: 'pending', amountRub: 100 });
        // До подтверждения перевод бронирует недостачу, но не покрывает её.
        expect(depositOf(transferred.body).me).toMatchObject({
          transferredRub: 0,
          pendingRub: 100,
          coveredRub: 50,
          missingRub: 150,
          dueRub: 50,
          canTransfer: false,
          hasPendingTransfer: true,
        });

        const confirmed = await confirm(trip7, a, row!.id).expect(200);
        // Ответ подтверждения — вкладка **получателя**: свой залог смотрим
        // его же глазами.
        expect(compensationsOf(confirmed.body)[0]?.status).toBe('confirmed');

        const afterC = await view(trip7, c);
        expect(depositOf(afterC.body).me).toMatchObject({
          status: 'pending',
          transferredRub: 100,
          pendingRub: 0,
          coveredRub: 150,
          missingRub: 50,
          dueRub: 50,
          canTransfer: true,
        });
      });

      it('C докладывает 50 — залог покрыт, кнопка исчезла', async () => {
        const transferred = await transferDeposit(trip7, c, a.id, 50).expect(200);
        const row = compensationsOf(transferred.body).find(
          (item) => item.status === 'pending',
        );

        await confirm(trip7, a, row!.id).expect(200);
        const afterC = await view(trip7, c);

        expect(depositOf(afterC.body).me).toMatchObject({
          status: 'held',
          coveredRub: 200,
          missingRub: 0,
          dueRub: 0,
          canTransfer: false,
        });
        expect(depositOf(afterC.body).senders).toEqual([]);
        // C заплатил 50 ₽ расходом (доля 50 ₽ — баланс 0) и перевёл 150 ₽:
        // залог 200 ₽ целиком у организатора, значит, ему должны 150 ₽.
        expect(balanceOf(afterC.body, c)).toBe(150);
      });

      it('B перевёл 300 с запасом: 200 — залог, 100 — обычный перевод', async () => {
        const transferred = await transferDeposit(trip7, b, a.id, 300).expect(200);
        const row = compensationsOf(transferred.body).find(
          (item) => item.kind === 'deposit',
        );

        const confirmed = await confirm(trip7, a, row!.id).expect(200);
        const rows = compensationsOf(confirmed.body);

        // Излишек отделён, а не растворён в залоге: иначе при удержании
        // он исчез бы вместе с ним, а при возврате — потерялся.
        expect(
          rows
            .filter((item) => item.kind === 'deposit' && item.fromUserId === b.id)
            .map((item) => item.amountRub),
        ).toEqual([200]);
        expect(
          rows
            .filter((item) => item.kind === 'compensation' && item.fromUserId === b.id)
            .map((item) => item.amountRub),
        ).toEqual([100]);

        const afterB = await view(trip7, b);
        expect(depositOf(afterB.body).me).toMatchObject({
          transferredRub: 200,
          coveredRub: 200,
          missingRub: 0,
          status: 'held',
          canTransfer: false,
        });
        // 300 ₽ — кредит B перед группой: 200 залога и 100 обычного перевода.
        expect(balanceOf(afterB.body, b)).toBe(300);
      });

      it('G ничего не вложил — в секции риска с недостачей', async () => {
        const organizer = await view(trip7, a);
        const row = riskOf(organizer.body, g);

        expect(row).toMatchObject({
          investedRub: 0,
          transferredRub: 0,
          coveredRub: 0,
          missingRub: 200,
          declined: false,
          canDecide: false,
        });
        // C и B покрыли залог — их в списке нет; D вложил 50, ему не хватает
        // 150 — он в списке «недостаточно вложился» вместе с G.
        expect(
          depositOf(organizer.body).participants.map((item) => item.userId),
        ).toEqual([d.id, g.id]);
        expect(riskOf(organizer.body, d)).toMatchObject({
          investedRub: 50,
          missingRub: 150,
        });
      });

      it('D вложил 50 и вышел в ноль — расчёт закрыт, удержание недоступно', async () => {
        await decline(trip7, d).expect(200);

        // 20.11.2026: D оплатил ровно свою долю (баланс 0), поэтому
        // с ним рассчитались сразу. Секция риска его больше не показывает,
        // а решение по залогу сервер отклоняет: деньги уже ушли.
        const before = await view(trip7, a);
        expect(riskOf(before.body, d)).toBeUndefined();
        expect(balanceOf(before.body, d)).toBe(0);

        await setDecision(trip7, a, d, 'forfeited').expect(409);
        await setDecision(trip7, a, d, 'returned').expect(409);
      });

      it('G вышел с нулём — в секции его нет', async () => {
        await decline(trip7, g).expect(200);

        const after = await view(trip7, a);

        // Ушедших с закрытым расчётом (D и G) в секции риска нет вовсе.
        expect(depositOf(after.body).participants).toEqual([]);
        expect(riskOf(after.body, g)).toBeUndefined();

        // У G покрытия нет — решать нечего, это прежнее правило.
        await setDecision(trip7, a, g, 'forfeited').expect(400);
        await setDecision(trip7, a, g, 'returned').expect(400);
      });
    });
  });

  /**
   * Общегрупповые уведомления о деньгах (25.11.2026).
   *
   * Заказчик отказался от персональных «запросов платежа»: установка залога
   * и распределение расходов — новость для всей группы, а участник сам
   * решает в «Бухгалтерии», чем покрыть. Проверяем то, чего не видит юнит:
   * кому реально достаётся карточка (автору — нет, виртуальным — нет,
   * владельцу виртуального — как участнику), дедупликацию по ключу,
   * обновление суммы, снятие залога и «ОК» без архива.
   */
  describe('общегрупповые уведомления о деньгах', () => {
    interface CardRow {
      id: string;
      recipient_user_id: string;
      kind: string;
      title: string;
      body: string;
      dedup_key: string;
      conversation_id: string | null;
      archived_at: string | null;
    }

    let virtualViktorId: string;

    const patchTrip = (person: Person, body: Record<string, unknown>) =>
      auth(
        request(app.getHttpServer()).patch(`/api/trips/${financeNotifyTrip}`),
        person.token,
      ).send(body);

    const askCompensation = (person: Person) =>
      auth(
        request(app.getHttpServer()).post(
          `/api/trips/${financeNotifyTrip}/finance/payment-requests`,
        ),
        person.token,
      );

    const cardsOf = async (kind: string): Promise<CardRow[]> =>
      (await dataSource.query(
        `SELECT "id", "recipient_user_id", "kind", "title", "body",
                "dedup_key", "conversation_id", "archived_at"
           FROM "notifications"
          WHERE "trip_id" = $1 AND "kind" = $2
          ORDER BY "recipient_user_id"`,
        [financeNotifyTrip, kind],
      )) as CardRow[];

    const recipientsOf = (rows: CardRow[]): string[] =>
      rows.map((row) => row.recipient_user_id).sort();

    beforeAll(async () => {
      financeNotifyTrip = await createTrip('Уведомления: залог и расходы');
      await addGoing(financeNotifyTrip, b);
      await addGoing(financeNotifyTrip, c);

      // Виртуальный участник: ведёт его Б, карточку за него получает он сам.
      const created = await auth(
        request(app.getHttpServer()).post(
          `/api/trips/${financeNotifyTrip}/participants/virtual`,
        ),
        b.token,
      )
        .send({ displayName: 'Виктор' })
        .expect(201);

      virtualViktorId = created.body.userId as string;
      // В уборке виртуальный удаляется первым: на нём `FK_users_virtual_owner`.
      financeVirtualId = virtualViktorId;
    });

    it('установка залога: карточка всем идущим, кроме автора и виртуальных', async () => {
      await patchTrip(a, { depositRub: 300 }).expect(200);

      const cards = await cardsOf('trip_finance');

      expect(recipientsOf(cards)).toEqual([b.id, c.id].sort());
      expect(cards[0]).toMatchObject({
        title: 'Установлен залог',
        dedup_key: `trip_finance:${financeNotifyTrip}:deposit`,
        conversation_id: null,
        archived_at: null,
      });
      expect(cards[0].body).toContain('установлен залог 300 ₽ с человека');
      expect(cards[0].body).toContain('Залог можно покрыть расходами');

      // Виртуальному карточки нет: входить в приложение ему нечем.
      expect(recipientsOf(cards)).not.toContain(virtualViktorId);
    });

    it('повторное изменение суммы обновляет ту же карточку', async () => {
      await patchTrip(a, { depositRub: 350 }).expect(200);

      const cards = await cardsOf('trip_finance');

      expect(cards).toHaveLength(2);
      expect(cards.every((card) => card.body.includes('350 ₽'))).toBe(true);
    });

    it('новому участнику карточка не создаётся, пока залог не изменят', async () => {
      await addGoing(financeNotifyTrip, d);

      expect(recipientsOf(await cardsOf('trip_finance'))).not.toContain(d.id);

      // Повторное объявление суммы — и новый участник карточку получает.
      await patchTrip(a, { depositRub: 400 }).expect(200);

      expect(recipientsOf(await cardsOf('trip_finance'))).toContain(d.id);
    });

    it('снятие залога удаляет карточку', async () => {
      await patchTrip(a, { depositRub: null }).expect(200);

      expect(await cardsOf('trip_finance')).toHaveLength(0);
    });

    it('«Компенсируйте расходы» — группе, а не должникам', async () => {
      const response = await askCompensation(a).expect(200);

      expect(response.body.notified).toBe(3);
      expect(response.body.recipients).toBe(3);

      const cards = await cardsOf('trip_finance');

      // Все идущие, кроме автора: Б, В и Г. Виртуальный пропущен.
      expect(recipientsOf(cards)).toEqual([b.id, c.id, d.id].sort());
      expect(cards[0]).toMatchObject({
        title: 'Компенсируйте расходы',
        dedup_key: `trip_finance:${financeNotifyTrip}:expenses`,
        conversation_id: null,
      });
      expect(cards[0].body).toContain('Расходы по походу');
      expect(cards[0].body).toContain('Проверь свой баланс');

      // Новых «Запросов платежа» больше не бывает.
      expect(await cardsOf('payment_request')).toHaveLength(0);
    });

    it('повторное нажатие обновляет ту же карточку', async () => {
      await askCompensation(a).expect(200);

      expect(await cardsOf('trip_finance')).toHaveLength(3);
    });

    it('«ОК» закрывает карточку без архива', async () => {
      const [mine] = (await cardsOf('trip_finance')).filter(
        (card) => card.recipient_user_id === b.id,
      );

      await auth(
        request(app.getHttpServer()).post(
          `/api/notifications/${mine.id}/close`,
        ),
        b.token,
      ).expect(204);

      const left = (await cardsOf('trip_finance')).filter(
        (card) => card.recipient_user_id === b.id,
      );

      expect(left).toHaveLength(0);
      // Это не архив: строки просто нет.
      const archived = (await dataSource.query(
        `SELECT "id" FROM "notifications" WHERE "id" = $1`,
        [mine.id],
      )) as Array<{ id: string }>;
      expect(archived).toHaveLength(0);
    });
  });

  /**
   * Ушедший и деньги (20.11.2026).
   *
   * Ушедший виден в «Балансах» и секции риска, пока с ним не рассчитались.
   * Компенсация ему уходит **личным сообщением** с кнопкой, потому что
   * «Бухгалтерия» ему уже закрыта; без ответа она подтверждается через
   * 72 часа. После расчёта строки нет, а «Удержать» отвечает 409.
   *
   * Поход на четверых: D оплатил общий стол 200 ₽ (доля 50), поэтому ему
   * должны 150. Он выходит — и группа закрывает долг тремя переводами
   * по 50: один подтверждает он сам в сообщении, два «дозревают» по сроку.
   */
  describe('ушедший: личное сообщение, автосогласие и закрытый расчёт', () => {
    interface CompensationRow {
      id: string;
      kind: string;
      status: string;
      fromUserId: string;
      toUserId: string;
      amountRub: number;
    }

    const compensationsOf = (body: unknown) =>
      (body as { compensations: CompensationRow[] }).compensations;

    const memberOf = (body: unknown, person: Person) =>
      (
        body as {
          members: { userId: string; balanceRub: number }[];
        }
      ).members.find((member) => member.userId === person.id);

    const riskOf = (body: unknown, person: Person) =>
      (
        body as {
          deposit: {
            participants: { userId: string; coveredRub: number; canDecide: boolean }[];
          };
        }
      ).deposit.participants.find((row) => row.userId === person.id);

    const balanceOf = (body: unknown, person: Person): number =>
      memberOf(body, person)?.balanceRub ?? 0;

    const decline = (tripId: string, person: Person) =>
      auth(
        request(app.getHttpServer()).patch(
          `/api/trips/${tripId}/participants/me`,
        ),
        person.token,
      ).send({ status: 'declined' });

    const toMaybe = (tripId: string, person: Person) =>
      auth(
        request(app.getHttpServer()).patch(
          `/api/trips/${tripId}/participants/me`,
        ),
        person.token,
      ).send({ status: 'maybe' });

    const compensate = (
      tripId: string,
      person: Person,
      toUserId: string,
      amountRub: number,
    ) =>
      auth(
        request(app.getHttpServer()).post(
          `/api/trips/${tripId}/finance/compensations`,
        ),
        person.token,
      ).send({ toUserId, amountRub });

    const setDecision = (
      tripId: string,
      person: Person,
      target: Person,
      status: string,
    ) =>
      auth(
        request(app.getHttpServer()).put(
          `/api/trips/${tripId}/finance/deposit/${target.id}`,
        ),
        person.token,
      ).send({ status });

    beforeAll(async () => {
      trip9 = await createTrip('Ушедший: расчёт и автосогласие');
      for (const person of [b, c, d]) await addGoing(trip9, person);

      await auth(
        request(app.getHttpServer()).patch(`/api/trips/${trip9}`),
        a.token,
      )
        .send({ depositRub: 200 })
        .expect(200);

      // D оплатил общий стол на четверых: доли по 50, ему должны 150.
      await addExpense(trip9, d, {
        amountRub: 200,
        split: 'all',
        description: 'Общий стол',
        spentAt: '2026-11-20',
      });

      await decline(trip9, d).expect(200);
    });

    it('перед выходом отдаёт снаряжение и деньги', async () => {
      const response = await auth(
        request(app.getHttpServer()).get(
          `/api/trips/${trip9}/finance/departure`,
        ),
        d.token,
      ).expect(200);

      expect(response.body).toMatchObject({
        gearTypes: [],
        coveredRub: 200,
        deposit: {
          amountRub: 200,
          coveredRub: 200,
          holdRub: 200,
          refundRub: 0,
        },
      });
    });

    it('пока не рассчитались, ушедший в балансах и секции риска', async () => {
      const response = await view(trip9, a);

      expect(memberOf(response.body, d)).toMatchObject({ balanceRub: 150 });
      expect(riskOf(response.body, d)).toMatchObject({
        declined: true,
        coveredRub: 200,
        canDecide: true,
      });
    });

    it('перевод ушедшему рождает карточку уведомления, а не сообщение', async () => {
      const response = await compensate(trip9, b, d.id, 50).expect(201);
      const [row] = compensationsOf(response.body);

      expect(row).toMatchObject({
        kind: 'compensation',
        status: 'pending',
        toUserId: d.id,
        amountRub: 50,
      });

      /**
       * Двойная запись выключена (24.11.2026, §14.4 п.2): панель читает
       * карточки, а не диалоги. Поэтому ни сообщения, ни действия
       * `money_received` больше не заводится — только `notifications`.
       */
      const actions = (await dataSource.query(
        `SELECT "id" FROM "message_actions"
          WHERE "payload"->>'compensationId' = $1`,
        [String(row!.id)],
      )) as Array<{ id: string }>;
      expect(actions).toHaveLength(0);

      const [card] = (await dataSource.query(
        `SELECT "kind", "title", "body", "recipient_user_id", "conversation_id"
           FROM "notifications"
          WHERE "compensation_id" = $1`,
        [String(row!.id)],
      )) as Array<{
        kind: string;
        title: string;
        body: string;
        recipient_user_id: string;
        conversation_id: string | null;
      }>;

      // Текст — тот же, что раньше был у личного сообщения: «Борис перевёл
      // тебе 50 ₽ за поход «…»»; диалог нужен полю «Сообщение отправителю».
      expect(card).toMatchObject({
        kind: 'money_transfer',
        title: 'Денежный перевод',
        recipient_user_id: d.id,
      });
      expect(card!.conversation_id).toEqual(expect.any(String));
      expect(card!.body).toContain('перевёл тебе 50 ₽');
      expect(card!.body).toContain('за поход');

      const messages = (await dataSource.query(
        `SELECT "id" FROM "messages" WHERE "conversation_id" = $1`,
        [card!.conversation_id],
      )) as Array<{ id: string }>;
      expect(messages).toHaveLength(0);
    });

    it('подтверждение с карточки закрывает перевод и уводит её в архив', async () => {
      /**
       * Отдельный поход: в общем `trip9` кредитор — ушедший `d`, а ручка
       * подтверждения требует «идёт» (кроме залога). Здесь получатель
       * идущий и с кредитом: Борис платит за двоих, Анна ему переводит.
       */
      cardTrip = await createTrip('Подтверждение с карточки');
      await addGoing(cardTrip, b);
      await addExpense(cardTrip, b, {
        amountRub: 100,
        split: 'all',
        description: 'Общий стол',
        spentAt: '2026-11-20',
      });
      await compensate(cardTrip, a, b.id, 50).expect(201);

      const pending = compensationsOf((await view(cardTrip, a)).body).find(
        (item) => item.toUserId === b.id && item.status === 'pending',
      )!;

      // «Подтвердить» на карточке панели — та же ручка, что у «Бухгалтерии».
      await auth(
        request(app.getHttpServer()).post(
          `/api/trips/${cardTrip}/finance/compensations/${pending.id}/confirm`,
        ),
        b.token,
      ).expect(200);

      const after = await view(cardTrip, a);
      expect(
        compensationsOf(after.body).find((item) => item.id === pending.id),
      ).toMatchObject({ status: 'confirmed' });

      const [card] = (await dataSource.query(
        `SELECT "archived_reason" FROM "notifications" WHERE "compensation_id" = $1`,
        [String(pending.id)],
      )) as Array<{ archived_reason: string | null }>;
      expect(card?.archived_reason).toBe('confirmed');
    });

    it('«пока думаю» с ненулевым балансом остаётся в балансах', async () => {
      // C расплачивается, пока ещё идёт, и только потом переходит в maybe.
      await compensate(trip9, c, d.id, 50).expect(201);
      await toMaybe(trip9, c).expect(200);

      const response = await view(trip9, a);
      expect(memberOf(response.body, c)).toMatchObject({ balanceRub: -50 });
    });

    it('через 72 часа переводы подтверждаются сами, ушедший исчезает', async () => {
      await compensate(trip9, a, d.id, 50).expect(201);

      // Оба ожидающих перевода «вчерашние»: возраст больше 72 часов.
      await dataSource.query(
        `UPDATE "trip_compensations"
            SET "created_at" = now() - interval '73 hours'
          WHERE "trip_id" = $1 AND "status" = 'pending'`,
        [trip9],
      );

      /**
       * Переписанный текст — событием переписки (24.11.2026).
       *
       * Подписываемся на потоки участников до чтения вкладки: автосогласие
       * закрывается именно при чтении, и кадр должен дойти до обеих сторон
       * каждого диалога — без «своё действие не перечитываем», потому что
       * человека-актора нет.
       */
      const conversationEvents = app.get(ConversationEventsService);
      const received: ConversationEvent[] = [];
      const streams = [a, c, d].map((person) =>
        conversationEvents
          .stream(person.id)
          .subscribe((event) => received.push(event)),
      );

      const settled = await view(trip9, a);

      for (const subscription of streams) subscription.unsubscribe();

      expect(
        compensationsOf(settled.body).every(
          (item) => item.status === 'confirmed',
        ),
      ).toBe(true);
      expect(balanceOf(settled.body, d)).toBe(0);
      // Рассчитались в ноль — ушедшего нет ни в «Балансах», ни в «Залогах».
      expect(memberOf(settled.body, d)).toBeUndefined();
      expect(riskOf(settled.body, d)).toBeUndefined();
      // C в «пока думаю» и в нуле — строки тоже нет.
      expect(memberOf(settled.body, c)).toBeUndefined();

      /**
       * Автосогласие закрывает карточки переводов в архив (§14.2).
       *
       * Переписывать больше нечего: личных сообщений с действием нет
       * (24.11.2026, §14.4 п.2), поэтому вместо `message_updated` приходит
       * сигнал `notifications` тем, у кого карточка изменилась.
       */
      const signals = received.filter(
        (event) => event.kind === 'notifications',
      );
      expect(signals.length).toBeGreaterThan(0);

      const archived = (await dataSource.query(
        `SELECT "archived_reason" FROM "notifications"
          WHERE "trip_id" = $1 AND "kind" = 'money_transfer'
            AND "archived_at" IS NOT NULL`,
        [trip9],
      )) as Array<{ archived_reason: string | null }>;

      expect(archived.length).toBeGreaterThanOrEqual(2);
      expect(archived.every((card) => card.archived_reason === 'expired72')).toBe(
        true,
      );
    });

    it('«Удержать» ушедшему с закрытым расчётом недоступно', async () => {
      await setDecision(trip9, a, d, 'forfeited').expect(409);
      await setDecision(trip9, a, d, 'returned').expect(409);
    });
  });

  /**
   * Очередь офлайн-чеков (19.11.2026, сессия 5).
   *
   * Здесь проверяется то, чего не видит юнит-тест: пачка чеков с устройства
   * доезжает одной ручкой, повтор с тем же `clientId` не создаёт дубль,
   * отказ по одному чеку не роняет остальные, а неидущий получает 403
   * на всю очередь. Поход на пятерых: организатор и четверо идущих; один
   * из них потом выходит — на нём проверяются отклонение и 403.
   */
  describe('синхронизация офлайн-чеков', () => {
    interface SyncResult {
      clientId: string;
      status: 'accepted' | 'rejected';
      message?: string;
    }

    interface ExpenseRow {
      clientId: string | null;
      amountRub: number;
      shares: { userId: string; amountRub: number }[];
    }

    const sync = (
      tripId: string,
      person: Person,
      entries: unknown[],
      expected = 200,
    ) =>
      auth(
        request(app.getHttpServer()).post(
          `/api/trips/${tripId}/finance/expenses/sync`,
        ),
        person.token,
      )
        .send({ entries })
        .expect(expected);

    const resultsOf = (body: unknown) =>
      (body as { results: SyncResult[] }).results;

    const expensesWith = (body: unknown, clientId: string): ExpenseRow[] =>
      (body as { expenses: ExpenseRow[] }).expenses.filter(
        (item) => item.clientId === clientId,
      );

    const decline = (tripId: string, person: Person) =>
      auth(
        request(app.getHttpServer()).patch(
          `/api/trips/${tripId}/participants/me`,
        ),
        person.token,
      ).send({ status: 'declined' });

    beforeAll(async () => {
      trip8 = await createTrip('Бухгалтерия: офлайн-чеки');
      for (const person of [b, c, d, g]) await addGoing(trip8, person);
    });

    it('пачка доезжает, а повтор с теми же ключами дублей не делает', async () => {
      const events = app.get(TripEventsService);
      const received: string[] = [];
      const subscription = events
        .stream(String(trip8))
        .subscribe((event) => received.push(event.scope));

      const first = '11111111-1111-4111-8111-111111111111';
      const second = '22222222-2222-4222-8222-222222222222';
      const entries = [
        {
          clientId: first,
          amountRub: 1000,
          split: 'all',
          description: 'Продукты из очереди',
          spentAt: '2026-11-18',
        },
        {
          clientId: second,
          amountRub: 400,
          split: 'all',
          description: 'Бензин из очереди',
          spentAt: '2026-11-19',
        },
      ];

      const accepted = await sync(trip8, b, entries);
      const repeated = await sync(trip8, b, entries);

      subscription.unsubscribe();

      // `accepted` значит «создан или уже был» — повтор отвечает так же.
      expect(resultsOf(accepted.body).map((item) => item.status)).toEqual([
        'accepted',
        'accepted',
      ]);
      expect(resultsOf(repeated.body).map((item) => item.status)).toEqual([
        'accepted',
        'accepted',
      ]);

      // Второй заход не завёл вторую строку на тот же ключ.
      expect(expensesWith(repeated.body, first)).toHaveLength(1);
      expect(expensesWith(repeated.body, second)).toHaveLength(1);

      // Доли считает сервер по актуальному составу: 1000 на пятерых.
      expect(expensesWith(repeated.body, first)[0]?.shares).toHaveLength(5);
      expect(
        expensesWith(repeated.body, first)[0]?.shares.map(
          (share) => share.amountRub,
        ),
      ).toEqual([200, 200, 200, 200, 200]);

      // Один сигнал на пачку; повтор ничего не создал — сигнала нет.
      expect(received).toEqual(['finance']);
    });

    it('отклонённый чек не роняет пачку', async () => {
      await decline(trip8, d).expect(200);

      const rejected = '33333333-3333-4333-8333-333333333333';
      const accepted = '44444444-4444-4444-8444-444444444444';

      const response = await sync(trip8, b, [
        {
          clientId: rejected,
          payerUserId: d.id,
          amountRub: 100,
          split: 'all',
          description: 'Чек ушедшего',
          spentAt: '2026-11-19',
        },
        {
          clientId: accepted,
          amountRub: 300,
          split: 'all',
          description: 'Бензин после выхода',
          spentAt: '2026-11-19',
        },
      ]);

      const results = resultsOf(response.body);

      // У отказанного чека свой итог и причина, очередь из-за него не встаёт.
      expect(results[0]).toMatchObject({
        clientId: rejected,
        status: 'rejected',
      });
      expect(results[0]?.message).toBeTruthy();
      expect(results[1]).toEqual({ clientId: accepted, status: 'accepted' });

      // Отклонённого чека в таблице нет, принятый — есть.
      expect(expensesWith(response.body, rejected)).toEqual([]);
      expect(expensesWith(response.body, accepted)).toHaveLength(1);
    });

    it('неидущий получает 403 на всю очередь, и ничего не создаётся', async () => {
      const clientId = '55555555-5555-4555-8555-555555555555';

      await sync(
        trip8,
        d,
        [
          {
            clientId,
            amountRub: 100,
            split: 'all',
            description: 'Чек после выхода',
            spentAt: '2026-11-19',
          },
        ],
        403,
      );

      const after = await view(trip8, b);
      expect(expensesWith(after.body, clientId)).toEqual([]);
    });

    it('пустая пачка, чек без ключа и пачка больше 50 — 400', async () => {
      await sync(trip8, b, [], 400);

      await auth(
        request(app.getHttpServer()).post(
          `/api/trips/${trip8}/finance/expenses/sync`,
        ),
        b.token,
      )
        .send({
          entries: [
            {
              amountRub: 100,
              split: 'all',
              description: 'Без ключа',
            },
          ],
        })
        .expect(400);

      const many = Array.from({ length: 51 }, (_, index) => ({
        clientId: `${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`,
        amountRub: 10,
        split: 'all',
        description: `Чек ${index + 1}`,
      }));

      await sync(trip8, b, many, 400);
    });
  });

  /**
   * Завершённый поход (20.11.2026): расчёты ещё идут, а записи о тратах —
   * история. Заказчик: «новые расходные чеки, доли, компенсации и судьба
   * залогов… Прежние чеки не правятся и не удаляются».
   */
  describe('завершённый поход: новый чек можно, прежние не трогаем', () => {
    const DAY = 24 * 60 * 60 * 1000;

    it('старый чек не правится и не удаляется, новый создаётся', async () => {
      const created = await createTrip('Бухгалтерия: завершённый поход');
      trip10 = created;

      // Поход прошёл по датам и все идущие вернулись — условия завершения.
      await auth(
        request(app.getHttpServer()).patch(`/api/trips/${trip10}`),
        a.token,
      )
        .send({
          status: 'decided',
          startsAt: new Date(Date.now() - 5 * DAY).toISOString(),
          endsAt: new Date(Date.now() - DAY).toISOString(),
        })
        .expect(200);

      const old = await addExpense(trip10, a, {
        amountRub: 600,
        split: 'all',
        description: 'Продукты до возвращения',
      });
      const oldId = old.body.expenses[0].id as string;

      await auth(
        request(app.getHttpServer()).put(`/api/trips/${trip10}/presence/${a.id}`),
        a.token,
      )
        .send({ status: 'returned' })
        .expect(200);

      await auth(
        request(app.getHttpServer()).post(`/api/trips/${trip10}/complete`),
        a.token,
      ).expect(200);

      // Экран узнаёт, что править нельзя, из самого ответа вкладки.
      const locked = await view(trip10, a);
      const oldRow = locked.body.expenses.find(
        (expense: { id: string }) => expense.id === oldId,
      );
      expect(oldRow.canEdit).toBe(false);

      await auth(
        request(app.getHttpServer()).patch(
          `/api/trips/${trip10}/finance/expenses/${oldId}`,
        ),
        a.token,
      )
        .send({ amountRub: 1, split: 'all', description: 'Поправить' })
        .expect(409);

      await auth(
        request(app.getHttpServer()).delete(
          `/api/trips/${trip10}/finance/expenses/${oldId}`,
        ),
        a.token,
      ).expect(409);

      // Новый чек — можно: «заправились, покушали по дороге».
      const fresh = await addExpense(trip10, a, {
        amountRub: 350,
        split: 'all',
        description: 'Заправились на обратном пути',
      });
      expect(fresh.body.expenses).toHaveLength(2);
      expect(
        fresh.body.expenses.some(
          (expense: { id: string }) => expense.id === oldId,
        ),
      ).toBe(true);
    });
  });
});
