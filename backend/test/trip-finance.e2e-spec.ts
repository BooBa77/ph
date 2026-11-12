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
  async function addGoing(tripId: string, person: Person): Promise<void> {
    await auth(
      request(app.getHttpServer()).post(`/api/trips/${tripId}/requests`),
      a.token,
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
        [trip1, trip2].filter(Boolean),
      ]);
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
        expect.objectContaining({ userId: g.id, amountRub: 2700 }),
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
          (option: { userId: string; amountRub: number }) => [
            option.userId,
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
          (option: { userId: string }) => option.userId,
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
});
