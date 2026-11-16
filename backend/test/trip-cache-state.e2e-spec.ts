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
 * Свежесть офлайн-копии похода (e2e) — 16.11.2026.
 *
 * Заказчик: «нужно понимать, что данные в кэше актуальны, вести у похода
 * какое-то поле „время последнего редактирования“ (включая чаты), по нему
 * сверять кэш и автоматически обновлять».
 *
 * Проверяется то, чего не видит юнит-тест перехватчика:
 *
 * 1. **Отметка растёт на любой правке похода** — шапка, вкладки, состав.
 *    Покрытие задаётся маршрутом, а не списком сервисов, и это главное
 *    свойство механизма: забытая ручка оставила бы кэш навсегда «свежим».
 * 2. **Чаты считаются отдельно** — сообщение не двигает счётчик похода,
 *    зато двигает курсор своего чата.
 * 3. **Личные ветки не двигают ничего** — чужой дневник и «моё» питание
 *    не делают общую копию устаревшей.
 * 4. **Набор для офлайна** (`GET /trips?offline=true`) — только решённые,
 *    незакончившиеся и где я иду; отменённые и прошедшие не попадают.
 */
describe('Свежесть офлайн-копии похода (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let token: string;
  let userId: string;
  let objectId: string;
  let tripId: string;
  let pastTripId: string;
  let lastCode: string | null = null;

  const email = `trip-cache-e2e-${Date.now()}@example.com`;

  async function login(): Promise<{ token: string; id: string }> {
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
    };
  }

  function daysFromNow(days: number): string {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  async function createTrip(body: Record<string, unknown>): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({ goalObjectId: Number(objectId), ...body })
      .expect(201);

    return response.body.id as string;
  }

  async function cacheState(id: string) {
    const response = await request(app.getHttpServer())
      .get(`/api/trips/${id}/cache-state`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    return response.body as {
      contentRevision: string;
      contentUpdatedAt: string;
      chats: Array<{ kind: string; lastMessageId: string | null }>;
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

    objectId = (
      await dataSource.query(
        `INSERT INTO objects (name, type) VALUES ('Тестовая свежесть e2e', 'вершина') RETURNING id`,
      )
    )[0].id;

    // Роль организатора создаётся сервисом при создании похода; без неё
    // запрос упал бы 500-й подсказкой про `seed:roles`.
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

    const author = await login();
    token = author.token;
    userId = author.id;

    tripId = await createTrip({
      status: 'decided',
      startsAt: daysFromNow(1),
      endsAt: daysFromNow(3),
    });

    // Прошедший решённый поход: в набор для офлайна попасть не должен.
    pastTripId = await createTrip({
      status: 'decided',
      startsAt: daysFromNow(-30),
      endsAt: daysFromNow(-25),
    });
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query('DELETE FROM trips WHERE organizer_user_id = $1', [
        userId,
      ]);
      await dataSource.query('DELETE FROM objects WHERE id = $1', [objectId]);
      await dataSource.query('DELETE FROM users WHERE id = $1', [userId]);
    }
    await app?.close();
  });

  it('отметка свежести читается и содержит курсоры чатов', async () => {
    const state = await cacheState(tripId);

    expect(state.contentRevision).toMatch(/^\d+$/);
    expect(Number.isNaN(Date.parse(state.contentUpdatedAt))).toBe(false);

    // Чаты похода на месте: с решённого похода их восемь, и курсы
    // нужны по каждому — иначе одно сообщение в «Питании» не будет
    // замечено клиентом.
    const kinds = state.chats.map((chat) => chat.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(['trip_guest', 'trip_members', 'trip_meals']),
    );
  });

  it('правка шапки поднимает счётчик и время', async () => {
    const before = await cacheState(tripId);

    await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ announcement: 'Правка ради отметки свежести' })
      .expect(200);

    const after = await cacheState(tripId);

    expect(Number(after.contentRevision)).toBeGreaterThan(
      Number(before.contentRevision),
    );
    expect(Date.parse(after.contentUpdatedAt)).toBeGreaterThanOrEqual(
      Date.parse(before.contentUpdatedAt),
    );
  });

  it('правка вкладки поднимает счётчик: покрытие идёт от маршрута', async () => {
    const before = await cacheState(tripId);

    // Смена собственного статуса участия — правка состава, а не шапки.
    await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}/participants/me`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'going' })
      .expect(200);

    const after = await cacheState(tripId);
    expect(Number(after.contentRevision)).toBeGreaterThan(
      Number(before.contentRevision),
    );
  });

  it('сообщение в чате двигает курсор чата, но не счётчик похода', async () => {
    const before = await cacheState(tripId);

    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'trip_members', body: 'Проверка курсора e2e' })
      .expect(201);

    const after = await cacheState(tripId);

    // Одно сообщение не повод перечитывать все вкладки (lifecycle.md §2.2).
    expect(after.contentRevision).toBe(before.contentRevision);

    const beforeMembers = before.chats.find((chat) => chat.kind === 'trip_members');
    const afterMembers = after.chats.find((chat) => chat.kind === 'trip_members');

    expect(Number(afterMembers?.lastMessageId)).toBeGreaterThan(
      Number(beforeMembers?.lastMessageId),
    );
    // Гостевой чат не изменился.
    expect(after.chats.find((chat) => chat.kind === 'trip_guest')?.lastMessageId).toBe(
      before.chats.find((chat) => chat.kind === 'trip_guest')?.lastMessageId,
    );
  });

  it('личная запись дневника не делает общую копию устаревшей', async () => {
    const before = await cacheState(tripId);

    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/diary/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        entries: [
          {
            id: '6f0c1f9e-1111-4a1a-9f4a-2c9b1a000001',
            body: 'Личная запись: свежесть общей копии не трогаем',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            deletedAt: null,
          },
        ],
      })
      .expect(200);

    const after = await cacheState(tripId);
    expect(after.contentRevision).toBe(before.contentRevision);
  });

  it('в набор для офлайна попадают только решённые незакончившиеся', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/trips?mine=true&offline=true&limit=50')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const ids = (response.body.trips as Array<{ id: string }>).map((trip) => trip.id);

    expect(ids).toContain(tripId);
    expect(ids).not.toContain(pastTripId);
  });
});
