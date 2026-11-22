import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { EmailCodeService } from './../src/email/services/email-code.service';
import { SmtpService } from './../src/email/services/smtp.service';

/**
 * «Дневник» похода (e2e) — 16.11.2026.
 *
 * Заказчик: «это личная закладка, выглядит как большой чат… Дневник
 * ведётся онлайн и оффлайн (синхронизация при возвращении связи)».
 *
 * Здесь проверяется API, а не экран:
 *
 * 1. **Записи личные.** У каждого участника свой дневник: организатор
 *    не видит записей других, и никто не видит чужих.
 * 2. **Синхронизация идемпотентна.** Повторная отправка той же пачки
 *    после обрыва не создаёт дубль и ничего не меняет.
 * 3. **Побеждает более поздняя правка.** Старая копия с другого
 *    устройства не затирает новую, а более поздняя — применяется.
 * 4. **Удаление — могильник.** Запись исчезает из чтения, а старая
 *    копия, отправленная позже, её не воскрешает.
 * 5. **Чужие не пускают.** Посторонний получает 403 и на чтение,
 *    и на синхронизацию; отказавшийся от участия — тоже.
 * 6. **Мусор отвергается словами**: пустая запись, правка раньше
 *    создания, не-UUID.
 * 7. **Альманах собирается после завершения из помеченных записей**
 *    (22.11.2026). До завершения — 409; в него не попадает запись с
 *    снятой пометкой; старый клиент без поля пометку не переключает;
 *    видит альманах и гость завершённого похода.
 *
 * Поход, состав и участники заводятся напрямую в базе: правила походов
 * проверены в `trips.e2e-spec.ts`, здесь важно поведение дневника.
 */
describe('Дневник похода (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  let organizerId: string;
  let organizerToken: string;
  let memberId: string;
  let memberToken: string;
  let declinedToken: string;
  let strangerToken: string;

  let objectId: string;
  let tripId: string;
  let almanacTripId: string;
  let lastCode: string | null = null;

  const organizerEmail = `diary-e2e-org-${Date.now()}@example.com`;
  const memberEmail = `diary-e2e-member-${Date.now()}@example.com`;
  const declinedEmail = `diary-e2e-declined-${Date.now()}@example.com`;
  const strangerEmail = `diary-e2e-stranger-${Date.now()}@example.com`;

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

  function call(
    method: 'get' | 'post',
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

  function diary(token: string) {
    return call('get', `/api/trips/${tripId}/diary`, token);
  }

  function sync(token: string, entries: unknown[]) {
    return call('post', `/api/trips/${tripId}/diary/sync`, token, { entries });
  }

  /** Синхронизация в произвольный поход: альманах проверяется на втором. */
  function syncOn(id: string, token: string, entries: unknown[]) {
    return call('post', `/api/trips/${id}/diary/sync`, token, { entries });
  }

  function almanac(token: string, id: string = almanacTripId) {
    return call('get', `/api/trips/${id}/almanac`, token);
  }

  /** Запись в том виде, в каком её пришлёт устройство. */
  function entry(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id: randomUUID(),
      body: 'Первый день: вышли на тропу.',
      createdAt: '2026-11-16T03:00:00.000Z',
      updatedAt: '2026-11-16T03:00:00.000Z',
      deletedAt: null,
      ...overrides,
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

    const organizer = await login(organizerEmail);
    organizerToken = organizer.token;
    organizerId = organizer.id;

    const member = await login(memberEmail);
    memberToken = member.token;
    memberId = member.id;

    const declined = await login(declinedEmail);
    declinedToken = declined.token;

    const stranger = await login(strangerEmail);
    strangerToken = stranger.token;

    objectId = (
      await dataSource.query(
        `INSERT INTO objects (name, type) VALUES ('Вершина для дневника', 'вершина') RETURNING id`,
      )
    )[0].id;

    tripId = (
      await dataSource.query(
        `INSERT INTO trips (organizer_user_id, goal_object_id, route_text,
                            status, starts_at, ends_at, visibility)
         VALUES ($1, $2, '', 'decided', now() + interval '2 days',
                 now() + interval '4 days', 'public') RETURNING id`,
        [organizerId, objectId],
      )
    )[0].id;

    await dataSource.query(
      `INSERT INTO trip_participants (trip_id, user_id, status)
       VALUES ($1, $2, 'going'), ($1, $3, 'going'), ($1, $4, 'declined')`,
      [tripId, organizerId, memberId, declined.id],
    );

    // Второй поход — уже завершённый: альманах собирается только после
    // `completed_at`, а портить основной поход означало бы погасить
    // проверки дневника, которые идут до конца файла.
    almanacTripId = (
      await dataSource.query(
        `INSERT INTO trips (organizer_user_id, goal_object_id, route_text,
                            status, starts_at, ends_at, visibility,
                            completed_at)
         VALUES ($1, $2, '', 'decided', now() + interval '2 days',
                 now() + interval '4 days', 'public', now()) RETURNING id`,
        [organizerId, objectId],
      )
    )[0].id;

    await dataSource.query(
      `INSERT INTO trip_participants (trip_id, user_id, status)
       VALUES ($1, $2, 'going'), ($1, $3, 'going')`,
      [almanacTripId, organizerId, memberId],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query('DELETE FROM trips WHERE id = ANY($1)', [
        [tripId, almanacTripId],
      ]);
      await dataSource.query('DELETE FROM objects WHERE id = $1', [objectId]);
    }
    await app?.close();
  });

  it('дневник участника начинается пустым', async () => {
    const response = await diary(organizerToken).expect(200);

    expect(response.body.entries).toEqual([]);
  });

  it('создание приходит синхронизацией и читается обратно', async () => {
    const created = entry({ body: 'День 1: дошли до озера.' });

    const saved = await sync(organizerToken, [created]).expect(200);
    expect(saved.body.entries).toHaveLength(1);
    expect(saved.body.entries[0]).toMatchObject({
      id: created.id,
      body: 'День 1: дошли до озера.',
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    });

    const read = await diary(organizerToken).expect(200);
    expect(read.body.entries).toHaveLength(1);
    expect(read.body.entries[0].id).toBe(created.id);
  });

  it('повторная отправка той же пачки не создаёт дубль', async () => {
    const created = entry({ body: 'Повторная отправка.' });

    await sync(organizerToken, [created]).expect(200);
    const again = await sync(organizerToken, [created]).expect(200);

    expect(
      again.body.entries.filter(
        (row: { id: string }) => row.id === created.id,
      ),
    ).toHaveLength(1);
  });

  it('дневники участников не смешиваются', async () => {
    const mine = entry({ body: 'Это мой личный дневник.' });
    await sync(memberToken, [mine]).expect(200);

    const memberDiary = await diary(memberToken).expect(200);
    expect(memberDiary.body.entries.map((row: { id: string }) => row.id)).toEqual(
      [mine.id],
    );

    const organizerDiary = await diary(organizerToken).expect(200);
    expect(
      organizerDiary.body.entries.some(
        (row: { id: string }) => row.id === mine.id,
      ),
    ).toBe(false);
    expect(
      organizerDiary.body.entries.some(
        (row: { body: string }) => row.body === 'Это мой личный дневник.',
      ),
    ).toBe(false);
  });

  it('более поздняя правка применяется, старая — нет', async () => {
    const created = entry({
      body: 'Черновик записи.',
      createdAt: '2026-11-16T04:00:00.000Z',
      updatedAt: '2026-11-16T04:00:00.000Z',
    });
    await sync(organizerToken, [created]).expect(200);

    const edited = {
      ...created,
      body: 'Отредактированная запись.',
      updatedAt: '2026-11-16T05:00:00.000Z',
    };

    const applied = await sync(organizerToken, [edited]).expect(200);
    expect(
      applied.body.entries.find((row: { id: string }) => row.id === created.id)
        ?.body,
    ).toBe('Отредактированная запись.');

    // Старая копия с другого устройства: отметка времени раньше серверной.
    const stale = {
      ...created,
      body: 'Старая версия из офлайна.',
      updatedAt: '2026-11-16T04:30:00.000Z',
    };

    const kept = await sync(organizerToken, [stale]).expect(200);
    expect(
      kept.body.entries.find((row: { id: string }) => row.id === created.id)
        ?.body,
    ).toBe('Отредактированная запись.');
  });

  it('удаление уносит запись, а старая копия её не воскрешает', async () => {
    const created = entry({
      body: 'Эту запись удалят.',
      createdAt: '2026-11-16T06:00:00.000Z',
      updatedAt: '2026-11-16T06:00:00.000Z',
    });
    await sync(organizerToken, [created]).expect(200);

    const deleted = {
      ...created,
      updatedAt: '2026-11-16T06:10:00.000Z',
      deletedAt: '2026-11-16T06:10:00.000Z',
    };

    const afterDelete = await sync(organizerToken, [deleted]).expect(200);
    expect(
      afterDelete.body.entries.some(
        (row: { id: string }) => row.id === created.id,
      ),
    ).toBe(false);

    // Устройство, которое о удалении ещё не знает, присылает старую копию.
    const stale = {
      ...created,
      updatedAt: '2026-11-16T06:05:00.000Z',
      deletedAt: null,
    };
    const stillDeleted = await sync(organizerToken, [stale]).expect(200);
    expect(
      stillDeleted.body.entries.some(
        (row: { id: string }) => row.id === created.id,
      ),
    ).toBe(false);
  });

  it('посторонний не читает и не пишет дневник', async () => {
    await diary(strangerToken).expect(403);
    await sync(strangerToken, [entry()]).expect(403);
  });

  it('отказавшийся от участия дневник не ведёт', async () => {
    await diary(declinedToken).expect(403);
    await sync(declinedToken, [entry()]).expect(403);
  });

  it('пустая запись отвергается словами', async () => {
    const response = await sync(organizerToken, [entry({ body: '   ' })]).expect(
      400,
    );

    expect(response.body.message).toContain('не может быть пустой');
  });

  it('правка раньше создания отвергается', async () => {
    const response = await sync(organizerToken, [
      entry({
        createdAt: '2026-11-16T07:00:00.000Z',
        updatedAt: '2026-11-16T06:00:00.000Z',
      }),
    ]).expect(400);

    expect(response.body.message).toContain('противоречиво');
  });

  it('запись без UUID с устройства отвергается', async () => {
    await sync(organizerToken, [entry({ id: 'not-a-uuid' })]).expect(400);
  });

  it('пометка «в альманах» по умолчанию включена', async () => {
    const created = entry({ body: 'Запись без пометки в теле.' });
    const saved = await sync(organizerToken, [created]).expect(200);

    expect(
      saved.body.entries.find((row: { id: string }) => row.id === created.id)
        ?.sharedWithTrip,
    ).toBe(true);
  });

  it('до завершения похода альманах не собирается', async () => {
    const response = await almanac(organizerToken, tripId).expect(409);

    expect(response.body.message).toContain('после завершения');
  });

  it('в альманах попадают только помеченные записи, с автором', async () => {
    const shared = entry({
      body: 'В альманах: первый день.',
      createdAt: '2026-11-16T03:00:00.000Z',
      updatedAt: '2026-11-16T03:00:00.000Z',
      sharedWithTrip: true,
    });
    const hidden = entry({
      body: 'В альманах нельзя.',
      createdAt: '2026-11-16T03:10:00.000Z',
      updatedAt: '2026-11-16T03:10:00.000Z',
      sharedWithTrip: false,
    });
    const fromMember = entry({
      body: 'В альманах: заметка второго автора.',
      createdAt: '2026-11-16T04:00:00.000Z',
      updatedAt: '2026-11-16T04:00:00.000Z',
      sharedWithTrip: true,
    });

    await syncOn(almanacTripId, organizerToken, [shared, hidden]).expect(200);
    await syncOn(almanacTripId, memberToken, [fromMember]).expect(200);

    const response = await almanac(organizerToken).expect(200);
    const bodies = response.body.entries.map(
      (row: { body: string }) => row.body,
    );

    expect(bodies).toEqual([
      'В альманах: первый день.',
      'В альманах: заметка второго автора.',
    ]);
    expect(
      response.body.entries.map(
        (row: { author: { userId: string } }) => row.author.userId,
      ),
    ).toEqual([organizerId, memberId]);
    expect(
      response.body.entries.every(
        (row: { author: { displayName: string } }) =>
          typeof row.author.displayName === 'string' &&
          row.author.displayName.length > 0,
      ),
    ).toBe(true);
  });

  it('снятая пометка убирает запись из альманаха', async () => {
    const created = entry({
      body: 'Сначала можно, потом нельзя.',
      createdAt: '2026-11-16T05:00:00.000Z',
      updatedAt: '2026-11-16T05:00:00.000Z',
      sharedWithTrip: true,
    });
    await syncOn(almanacTripId, organizerToken, [created]).expect(200);

    const before = await almanac(organizerToken).expect(200);
    expect(
      before.body.entries.some((row: { id: string }) => row.id === created.id),
    ).toBe(true);

    const unmarked = {
      ...created,
      sharedWithTrip: false,
      updatedAt: '2026-11-16T05:05:00.000Z',
    };
    await syncOn(almanacTripId, organizerToken, [unmarked]).expect(200);

    const after = await almanac(organizerToken).expect(200);
    expect(
      after.body.entries.some((row: { id: string }) => row.id === created.id),
    ).toBe(false);
  });

  it('старый клиент без поля пометку не переключает', async () => {
    const created = entry({
      body: 'Запись, которой в альманах не надо.',
      createdAt: '2026-11-16T06:00:00.000Z',
      updatedAt: '2026-11-16T06:00:00.000Z',
      sharedWithTrip: false,
    });
    await syncOn(almanacTripId, organizerToken, [created]).expect(200);

    // Устройство с прежней версией приложения: поля согласия в записи нет,
    // текст поправлен. Пометка должна остаться снятой, а не вернуться.
    const editedByOldClient = {
      id: created.id,
      body: 'Текст поправлен на старом устройстве.',
      createdAt: created.createdAt,
      updatedAt: '2026-11-16T06:05:00.000Z',
    };
    const saved = await syncOn(almanacTripId, organizerToken, [
      editedByOldClient,
    ]).expect(200);

    expect(
      saved.body.entries.find(
        (row: { id: string }) => row.id === created.id,
      ),
    ).toMatchObject({
      body: 'Текст поправлен на старом устройстве.',
      sharedWithTrip: false,
    });

    const response = await almanac(organizerToken).expect(200);
    expect(
      response.body.entries.some(
        (row: { id: string }) => row.id === created.id,
      ),
    ).toBe(false);
  });

  it('гость завершённого похода видит альманах, но не дневник', async () => {
    const response = await almanac(strangerToken).expect(200);

    expect(response.body.tripId).toBe(String(almanacTripId));
    expect(response.body.entries.length).toBeGreaterThan(0);

    // Дневник остаётся личным: гость его по-прежнему не читает.
    await call('get', `/api/trips/${almanacTripId}/diary`, strangerToken).expect(
      403,
    );
  });

  it('вкладку «Альманах» видит гость завершённого похода', async () => {
    const completed = await call(
      'get',
      `/api/trips/${almanacTripId}/tabs`,
      strangerToken,
    ).expect(200);
    expect(completed.body.tabs.map((tab: { code: string }) => tab.code)).toEqual(
      ['guest', 'almanac'],
    );

    // А до завершения вкладки нет — собирать ещё нечего.
    const running = await call(
      'get',
      `/api/trips/${tripId}/tabs`,
      strangerToken,
    ).expect(200);
    expect(running.body.tabs.map((tab: { code: string }) => tab.code)).toEqual([
      'guest',
    ]);
  });
});
