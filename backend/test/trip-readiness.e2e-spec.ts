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

/**
 * Готовность похода и набор вкладок (e2e) — решения 21.10.2026
 * (`docs/ph/tabs.md` §7).
 *
 * Проверяем то, что легко сломать незаметно:
 *
 * 1. **Мечта — вишлист, а не поход.** Создаётся как trip, но связанные
 *    таблицы пустые: только гостевой чат. У владельца «Инфо» и «Гостевая»,
 *    у остальных — «Гостевая».
 * 2. **Мечта → Планирую** достраивает организатора, роль и членский чат.
 * 3. **Без конкретного числа** (дня месяца) в «Планирую» видны только
 *    «Инфо» и «Участники»; с числом открываются все вкладки.
 * 4. **Число — точка невозврата**, и вернуться в «Мечту» тоже нельзя.
 *    «Решено → Планирую» разрешено: даты и закладки остаются.
 *
 * Походы, у которых проверяется только состав, тест заводит через API —
 * именно создание мечты и переход проверяются.
 */
describe('Готовность похода (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  let ownerId: string;
  let ownerToken: string;
  let strangerId: string;
  let strangerToken: string;

  let objectId: string;
  let tripId: string;

  let lastCode: string | null = null;

  const ownerEmail = `readiness-e2e-owner-${Date.now()}@example.com`;
  const strangerEmail = `readiness-e2e-stranger-${Date.now()}@example.com`;

  async function login(mail: string): Promise<{ token: string; id: string }> {
    await request(app.getHttpServer())
      .post('/api/auth/request-code')
      .send({ email: mail })
      .expect(200);

    const verified = await request(app.getHttpServer())
      .post('/api/auth/verify-code')
      .send({ email: mail, code: lastCode })
      .expect(200);

    return {
      token: verified.body.accessToken as string,
      id: verified.body.user.id as string,
    };
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

    const emailCodeService = moduleFixture.get(EmailCodeService);
    const realCreateCode = emailCodeService.createCode.bind(emailCodeService);
    vi.spyOn(emailCodeService, 'createCode').mockImplementation((mail) => {
      lastCode = realCreateCode(mail);
      return lastCode;
    });

    const owner = await login(ownerEmail);
    ownerToken = owner.token;
    ownerId = owner.id;

    const stranger = await login(strangerEmail);
    strangerToken = stranger.token;
    strangerId = stranger.id;

    objectId = (
      await dataSource.query(
        `INSERT INTO objects (name, type) VALUES ('Вершина для готовности', 'вершина') RETURNING id`,
      )
    )[0].id;

    // Мечта: продолжительность есть (она обязательна при создании),
    // конкретных дат нет — это законный вишлист.
    const created = await request(app.getHttpServer())
      .post('/api/trips')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        goalObjectId: Number(objectId),
        status: 'idea',
        dateVariants: [{ durationDays: 5 }],
      })
      .expect(201);

    tripId = created.body.id as string;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // Поход уносит состав, чаты и варианты каскадом.
      await dataSource.query('DELETE FROM trips WHERE id = $1', [tripId]);
      await dataSource.query('DELETE FROM objects WHERE id = $1', [objectId]);
      await dataSource.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        [ownerId, strangerId],
      ]);
    }
    await app?.close();
  });

  function call(
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    token: string,
    body?: unknown,
  ) {
    const agent = request(app.getHttpServer())[method](path).set(
      'Authorization',
      `Bearer ${token}`,
    );

    return body === undefined ? agent : agent.send(body as object);
  }

  /** Коды вкладок в порядке ответа. */
  async function tabsOf(token: string): Promise<string[]> {
    const response = await call('get', `/api/trips/${tripId}/tabs`, token).expect(
      200,
    );

    return (response.body.tabs as Array<{ code: string }>).map(
      (tab) => tab.code,
    );
  }

  it('мечта создаётся без участников, ролей и членского чата', async () => {
    const participants = await dataSource.query(
      'SELECT count(*)::int AS count FROM trip_participants WHERE trip_id = $1',
      [tripId],
    );
    const roles = await dataSource.query(
      'SELECT count(*)::int AS count FROM trip_participant_roles WHERE trip_id = $1',
      [tripId],
    );
    const chats = await dataSource.query(
      'SELECT kind FROM conversations WHERE trip_id = $1 ORDER BY kind',
      [tripId],
    );

    expect(participants[0].count).toBe(0);
    expect(roles[0].count).toBe(0);
    expect(chats.map((row: { kind: string }) => row.kind)).toEqual([
      'trip_guest',
    ]);
  });

  it('у мечты одна «Гостевая» — и у владельца, и у гостя', async () => {
    await expect(tabsOf(ownerToken)).resolves.toEqual(['guest']);
    await expect(tabsOf(strangerToken)).resolves.toEqual(['guest']);
  });

  it('мечта → планирую достраивает организатора, роль и чаты', async () => {
    await call('patch', `/api/trips/${tripId}`, ownerToken, {
      status: 'planning',
    }).expect(200);

    const participant = await dataSource.query(
      'SELECT status FROM trip_participants WHERE trip_id = $1 AND user_id = $2',
      [tripId, ownerId],
    );
    const role = await dataSource.query(
      `SELECT r.code FROM trip_participant_roles tpr
         JOIN roles r ON r.id = tpr.role_id
        WHERE tpr.trip_id = $1 AND tpr.user_id = $2`,
      [tripId, ownerId],
    );
    const chats = await dataSource.query(
      'SELECT kind FROM conversations WHERE trip_id = $1 ORDER BY kind',
      [tripId],
    );

    expect(participant[0]?.status).toBe('going');
    expect(role[0]?.code).toBe(ORGANIZER_ROLE_CODE);
    expect(chats.map((row: { kind: string }) => row.kind).sort()).toEqual([
      'trip_guest',
      'trip_meals',
      'trip_members',
      'trip_route',
      'trip_transfer',
    ]);
  });

  it('без конкретного числа видны только «Гостевая» и «Участники»', async () => {
    // Продолжительность есть, месяц/число — нет: срок не задан.
    await expect(tabsOf(ownerToken)).resolves.toEqual(['guest', 'members']);
    await expect(tabsOf(strangerToken)).resolves.toEqual(['guest']);
  });

  it('конкретное число открывает все вкладки, кроме «Выпуска»', async () => {
    await call('patch', `/api/trips/${tripId}`, ownerToken, {
      dateVariants: [{ year: 2027, month: 5, day: 5, durationDays: 5 }],
    }).expect(200);

    // «Выпуск» (код `sport`) — только у официального похода: у обычного
    // выпуска нет, и пустой вкладки в меню ему не нужно.
    await expect(tabsOf(ownerToken)).resolves.toEqual([
      'guest',
      'members',
      'transfer',
      'route',
      'meals',
      'gear',
      'firstAid',
      'finance',
      'diary',
    ]);
  });

  it('«Выпуск» появляется у официального похода и уходит вместе с флагом', async () => {
    await call('patch', `/api/trips/${tripId}`, ownerToken, {
      isOfficial: true,
    }).expect(200);

    await expect(tabsOf(ownerToken)).resolves.toContain('sport');

    await call('patch', `/api/trips/${tripId}`, ownerToken, {
      isOfficial: false,
    }).expect(200);

    await expect(tabsOf(ownerToken)).resolves.not.toContain('sport');
  });

  it('вернуться к «без числа» нельзя', async () => {
    await call('patch', `/api/trips/${tripId}`, ownerToken, {
      dateVariants: [{ year: 2027, month: 5, durationDays: 5 }],
    }).expect(400);
  });

  it('вернуться в мечту нельзя', async () => {
    await call('patch', `/api/trips/${tripId}`, ownerToken, {
      status: 'idea',
    }).expect(400);
  });

  it('решено → планирую разрешено, даты и закладки остаются', async () => {
    await call('patch', `/api/trips/${tripId}`, ownerToken, {
      status: 'decided',
      startsAt: '2027-05-05T09:00:00.000Z',
      endsAt: '2027-05-09T18:00:00.000Z',
    }).expect(200);

    await call('patch', `/api/trips/${tripId}`, ownerToken, {
      status: 'planning',
    }).expect(200);

    await expect(tabsOf(ownerToken)).resolves.toHaveLength(9);
  });

  it('без токена — 401', async () => {
    await request(app.getHttpServer())
      .get(`/api/trips/${tripId}/tabs`)
      .expect(401);
  });
});
