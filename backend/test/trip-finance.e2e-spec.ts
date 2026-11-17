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
  let trip3: string;
  /** Поход с человеком без аккаунта: за него платит и переводит ведущий. */
  let trip4: string;
  /** Общая касса семьи: плюс одного участника гасит минус другого. */
  let trip5: string;
  let virtualPersonId: string;
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
        [trip1, trip2, trip3, trip4, trip5].filter(Boolean),
      ]);
      // Человек без аккаунта ссылается на владельца — удаляем его первым.
      if (virtualPersonId) {
        await dataSource.query('DELETE FROM users WHERE id = $1', [
          virtualPersonId,
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

    it('родной отправителя может отменить перевод, посторонний — нет', async () => {
      const [compensation] = (await view(trip3, b)).body.compensations;
      expect(compensation.fromUserId).toBe(c.id);

      // Б не отправитель строки, но он родной В — семья платит одним кошельком.
      expect(compensation.canCancel).toBe(true);

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
      ).expect(200);
    });

    it('родной получателя может подтвердить получение', async () => {
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

      // Г — родной А: семья получателя подтверждает получение сама.
      const confirmed = await auth(
        request(app.getHttpServer()).post(
          `/api/trips/${trip3}/finance/compensations/${compensation.id}/confirm`,
        ),
        g.token,
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
   * Залог участия (17.11.2026) и «залог как риск» (17.11.2026).
   *
   * Заказчик: «Организатор может установить залог на участие, размести это
   * над секцией Движение денег». Потом подтвердил, что удержанный залог —
   * **доход фонда группы**: «A −залог, каждому идущему +залог/число идущих».
   * Здесь проверяется то, чего не видит юнит-тест: сумма живёт в походе,
   * отметки ставит только организатор, «Перевести залог» пишет держателя,
   * а удержание двигает балансы и появляется в ленте.
   */
  describe('залог участия', () => {
    /** Поход №2: A — организатор, Б, В, Г идут, Д приглашён. */
    const updateTrip = (person: Person, body: Record<string, unknown>) =>
      auth(
        request(app.getHttpServer()).patch(`/api/trips/${trip2}`),
        person.token,
      ).send(body);

    const setDeposit = (person: Person, target: Person, status: string) =>
      auth(
        request(app.getHttpServer()).put(
          `/api/trips/${trip2}/finance/deposit/${target.id}`,
        ),
        person.token,
      ).send({ status });

    /** «Перевести залог» — участник переводит его организатору. */
    const transferDeposit = (person: Person, recipientUserId: string) =>
      auth(
        request(app.getHttpServer()).post(
          `/api/trips/${trip2}/finance/deposit/transfer`,
        ),
        person.token,
      ).send({ recipientUserId });

    const decline = (person: Person) =>
      auth(
        request(app.getHttpServer()).patch(
          `/api/trips/${trip2}/participants/me`,
        ),
        person.token,
      ).send({ status: 'declined' });

    /** Баланс человека в ответе вкладки (`0`, если строки нет). */
    const balanceOf = (body: unknown, person: Person): number =>
      ((body as { members: { userId: string; balanceRub: number }[] }).members.find(
        (member) => member.userId === person.id,
      )?.balanceRub ?? 0);

    /** Строка залога в полном списке — секция риска её не всегда содержит. */
    const depositRow = (body: unknown, person: Person) =>
      (
        body as {
          deposit: {
            allParticipants: {
              userId: string;
              status: string;
              updatedByName: string | null;
              holderName: string | null;
            }[];
          };
        }
      ).deposit.allParticipants.find((row) => row.userId === person.id)!;

    it('без залога блока нет', async () => {
      const response = await view(trip2, a);

      expect(response.body.deposit).toBeNull();
    });

    it('залог ставится правкой похода и виден всем участникам', async () => {
      // В походе уже есть расходы из соседних тестов: залог обязан их
      // не трогать — он не расход и баланс не двигает.
      const before = await view(trip2, b);

      const patched = await updateTrip(a, { depositRub: 2000 }).expect(200);
      expect(patched.body.depositRub).toBe(2000);

      // Смотрящий — не организатор: видит сумму и состояния, но не правит.
      const asMember = await view(trip2, b);
      expect(asMember.body.deposit.amountRub).toBe(2000);
      expect(asMember.body.deposit.canManage).toBe(false);
      expect(
        asMember.body.deposit.allParticipants.map(
          (person: { userId: string }) => person.userId,
        ),
      ).toEqual([a.id, b.id, c.id, g.id]);
      expect(asMember.body.deposit.summary.total).toBe(4);
      expect(asMember.body.deposit.summary.pending).toBe(4);
      // Секция риска — только «не сдал»: сдавших и вложившихся в неё
      // не кладут (слова заказчика про экономию места).
      expect(
        asMember.body.deposit.participants.every(
          (person: { status: string }) => person.status === 'pending',
        ),
      ).toBe(true);

      // Пока удержания нет, в ленте залога нет и баланс он не двигает.
      expect(asMember.body.expenses).toHaveLength(before.body.expenses.length);
      expect(asMember.body.me.balanceRub).toBe(before.body.me.balanceRub);
      expect(asMember.body.depositForfeits).toEqual([]);

      const asOrganizer = await view(trip2, a);
      expect(asOrganizer.body.deposit.canManage).toBe(true);
    });

    it('отметки ставит только организатор', async () => {
      // Участник — 403, посторонний — тоже: деньги получает организатор.
      await setDeposit(b, b, 'held').expect(403);
      await setDeposit(e, b, 'held').expect(403);
    });

    it('«сдал» ставит организатор, и держателем становится он сам', async () => {
      const held = await setDeposit(a, b, 'held').expect(200);
      const row = depositRow(held.body, b);

      expect(row.status).toBe('held');
      // Имя автора — имя организатора: залог держится на прозрачности.
      expect(row.updatedByName).toContain('fin-a-');
      // Раз отметил он, деньги у него: «частичный держатель кассы».
      expect(row.holderName).toContain('fin-a-');
      expect(held.body.deposit.summary.cashRub).toBe(2000);

      const returned = await setDeposit(a, b, 'returned').expect(200);
      expect(depositRow(returned.body, b).status).toBe('returned');
      expect(returned.body.deposit.summary.cashRub).toBe(0);
    });

    it('«Перевести залог»: участник переводит его организатору без движения балансов', async () => {
      const before = await view(trip2, c);

      const transferred = await transferDeposit(c, a.id).expect(200);
      const row = depositRow(transferred.body, c);

      expect(row.status).toBe('held');
      expect(row.holderName).toContain('fin-a-');
      // Залог двигает балансы только в момент удержания.
      expect(balanceOf(transferred.body, c)).toBe(balanceOf(before.body, c));
      expect(transferred.body.depositForfeits).toEqual([]);

      // Повторно переводить нечего — залог уже отмечен.
      await transferDeposit(c, a.id).expect(400);

      // Получатель — только организатор похода: Б не организатор.
      await transferDeposit(g, b.id).expect(400);
    });

    it('«Удержать» отдаёт залог фонду группы: −залог источнику, +доля идущим', async () => {
      // Заказчик: «Если участник отваливается и уже понёс расходы, залог
      // ему не возвращается». Б выходит — и его залог решает организатор.
      await decline(b).expect(200);

      const before = await view(trip2, a);
      const forfeited = await setDeposit(a, b, 'forfeited').expect(200);

      expect(depositRow(forfeited.body, b).status).toBe('forfeited');

      // У вышедшего баланс падает на залог — и он виден группе.
      expect(balanceOf(forfeited.body, b)).toBe(
        balanceOf(before.body, b) - 2000,
      );

      // Идущих трое: 2000 на троих — 667, 667 и 666 первым по составу.
      expect(balanceOf(forfeited.body, a) - balanceOf(before.body, a)).toBe(667);
      expect(balanceOf(forfeited.body, c) - balanceOf(before.body, c)).toBe(667);
      expect(balanceOf(forfeited.body, g) - balanceOf(before.body, g)).toBe(666);

      // В ленте — одна строка удержания; сумма долей равна залогу.
      expect(forfeited.body.depositForfeits).toHaveLength(1);
      const ledgerRow = forfeited.body.depositForfeits[0];
      expect(ledgerRow.amountRub).toBe(2000);
      expect(ledgerRow.sourceUserId).toBe(b.id);
      expect(
        ledgerRow.shares.reduce(
          (sum: number, share: { amountRub: number }) => sum + share.amountRub,
          0,
        ),
      ).toBe(2000);

      // Сумма по всем, включая вышедшего, остаётся нулевой.
      const total = (
        forfeited.body.members as { balanceRub: number }[]
      ).reduce((sum, member) => sum + member.balanceRub, 0);
      expect(total).toBe(0);
    });

    it('«Вернуть» снимает удержание и возвращает балансы', async () => {
      const before = await view(trip2, a);
      const returned = await setDeposit(a, b, 'returned').expect(200);

      // Отметку отказавшемуся организатор ставить может: это и есть его
      // решение («вернуть или удержать»). Прежние 400 для `declined` сняты.
      expect(depositRow(returned.body, b).status).toBe('returned');
      expect(balanceOf(returned.body, b)).toBe(
        balanceOf(before.body, b) + 2000,
      );
      expect(returned.body.depositForfeits).toEqual([]);
    });

    it('приглашённому залог не ставят: он ещё не ответил', async () => {
      await setDeposit(a, d, 'held').expect(400);
    });

    it('неизвестное состояние и чужой поход отклоняются', async () => {
      await setDeposit(a, b, 'сдал').expect(400);

      // Человек не из этого похода — 404, а не тихая запись в никуда.
      await setDeposit(a, a, 'held').expect(200);
      await setDeposit(a, e, 'held').expect(404);
    });

    it('залог снимается правкой похода, и блок исчезает', async () => {
      const patched = await updateTrip(a, { depositRub: null }).expect(200);
      expect(patched.body.depositRub).toBeNull();

      const response = await view(trip2, a);
      expect(response.body.deposit).toBeNull();
    });
  });
});
