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
 * Снаряжение похода «вручную» (e2e) — второй путь заполнения снаряжения
 * (30.10.2026).
 *
 * Проверяем задание `docs/ph/virtual-participants.md` §3 и §6:
 *
 * 1. **Любой участник** добавляет в поход одноразовую вещь
 *    («бутылку бензина на розжиг»): она есть в снаряжении похода
 *    и **не появилась** в его каталоге.
 * 2. **Флаг «Регулярное»** заводит ту же вещь ещё и в каталоге настоящего
 *    хозяина; у одноразовой вещи каталога нет.
 * 3. **Организатор может указать хозяином человека без аккаунта**,
 *    и тогда флага «Регулярное» нет вовсе — каталога у того не бывает.
 * 4. **Другому настоящему участнику вещь не добавляют** (решение
 *    заказчика 31.10.2026): 403, каждый добавляет своё сам.
 * 5. **Каталог одноразовые не отдаёт** — `GET /api/gear` пуст по ним,
 *    и удалить такую вещь через каталог нельзя (404).
 * 6. **Уборка**: одноразовая вещь уходит из базы вместе со строкой похода
 *    и вместе с хозяином, которого убрали из состава.
 *
 * Поход, состав и типы тест заводит напрямую в базе (правило видимости —
 * `trips.e2e-spec.ts`, справочник — `gear-types.e2e-spec.ts`); человек
 * без аккаунта заводится API-ручкой, потому что это часть этого шага.
 */
describe('Снаряжение похода «вручную» (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  let organizerId: string;
  let organizerToken: string;
  let memberId: string;
  let memberToken: string;
  let strangerToken: string;

  let objectId: string;
  let tripId: string;
  let virtualId: string;

  /** Тип без характеристик и тип с обязательной вместимостью. */
  let plainTypeId: number;
  let tentTypeId: number;

  /** Строки, которые заводятся по ходу тестов. */
  let manualTripGearId: string;
  let manualGearItemId: string;
  let virtualTripGearId: string;
  let virtualGearItemId: string;
  let catalogTripGearId: string;
  let catalogGearItemId: string;

  let lastCode: string | null = null;

  const organizerEmail = `manual-gear-e2e-org-${Date.now()}@example.com`;
  const memberEmail = `manual-gear-e2e-member-${Date.now()}@example.com`;
  const strangerEmail = `manual-gear-e2e-stranger-${Date.now()}@example.com`;

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

  /** Тип снаряжения; `ON CONFLICT` не спорит с прошлым прогоном. */
  async function makeType(code: string, name: string): Promise<number> {
    await dataSource.query(
      `INSERT INTO gear_types (code, name) VALUES ($1, $2)
       ON CONFLICT (code) DO NOTHING`,
      [code, name],
    );
    const rows: Array<{ id: number }> = await dataSource.query(
      'SELECT id FROM gear_types WHERE code = $1',
      [code],
    );

    return rows[0].id;
  }

  /** Одноразовая вещь в поход: тело запроса как у формы «Указать вручную». */
  function addManual(token: string, body: Record<string, unknown>) {
    return call('post', `/api/trips/${tripId}/gear/manual`, token, body);
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

    const stranger = await login(strangerEmail);
    strangerToken = stranger.token;

    plainTypeId = await makeType('e2e_manual_plain', 'Проверочный ящик');

    tentTypeId = await makeType('e2e_manual_tent', 'Проверочная палатка');
    await dataSource.query(
      `INSERT INTO gear_type_attributes
         (gear_type_id, code, name, value_kind, unit, is_required)
       VALUES ($1, 'seats', 'Вместимость', 'number', 'мест', true)
       ON CONFLICT DO NOTHING`,
      [tentTypeId],
    );

    objectId = (
      await dataSource.query(
        `INSERT INTO objects (name, type)
         VALUES ('Вершина для ручного снаряжения', 'вершина') RETURNING id`,
      )
    )[0].id;

    // Поход настоящей подготовки: у вставки по умолчанию статус `idea`,
    // а у мечты нет ни состава, ни подготовки.
    tripId = (
      await dataSource.query(
        `INSERT INTO trips (organizer_user_id, goal_object_id, status)
         VALUES ($1, $2, 'planning') RETURNING id`,
        [organizerId, objectId],
      )
    )[0].id;
    await dataSource.query(
      `INSERT INTO conversations (kind, trip_id)
       VALUES ('trip_members', $1), ('trip_guest', $1)`,
      [tripId],
    );
    await dataSource.query(
      `INSERT INTO trip_participants (trip_id, user_id, status)
       VALUES ($1, $2, 'going'), ($1, $3, 'going')`,
      [tripId, organizerId, memberId],
    );

    // Человек без аккаунта — через API: это часть шага, и его id нужен
    // как хозяин одноразовой вещи.
    virtualId = (
      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/participants/virtual`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ displayName: 'Дядя Витя' })
        .expect(201)
    ).body.userId as string;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // Поход уносит снаряжение похода каскадом, а одноразовые вещи
      // каталогу не принадлежат — их убираем руками.
      await dataSource.query('DELETE FROM trips WHERE id = $1', [tripId]);
      await dataSource.query(
        'DELETE FROM gear_items WHERE owner_user_id = ANY($1::uuid[])',
        [[organizerId, memberId, virtualId]],
      );
      await dataSource.query(
        `DELETE FROM gear_types WHERE code LIKE 'e2e\\_manual\\_%'`,
      );
      await dataSource.query(
        'DELETE FROM users WHERE id = ANY($1::uuid[])',
        [[organizerId, memberId, virtualId]],
      );
      await dataSource.query('DELETE FROM objects WHERE id = $1', [objectId]);
    }
    await app?.close();
  });

  it('участник добавляет себе одноразовую вещь — она в походе, но не в каталоге', async () => {
    const response = await addManual(memberToken, {
      typeId: plainTypeId,
      title: 'Бутылка бензина на розжиг',
      weightGrams: 800,
    }).expect(201);

    manualTripGearId = response.body.id as string;
    manualGearItemId = response.body.gearItemId as string;

    expect(response.body.title).toBe('Бутылка бензина на розжиг');
    expect(response.body.ownerUserId).toBe(memberId);
    // Идущему вещь сразу в рюкзак — как у предложенной из каталога.
    expect(response.body.assignedUserId).toBe(memberId);
    expect(response.body.status).toBe('proposed');
    expect(response.body.isTripOnly).toBe(true);
    expect(response.body.typeCode).toBe('e2e_manual_plain');
    expect(response.body.weightGrams).toBe(800);

    const list = await call(
      'get',
      `/api/trips/${tripId}/gear`,
      memberToken,
    ).expect(200);
    expect(
      (list.body.items as Array<{ id: string }>).map((item) => item.id),
    ).toContain(manualTripGearId);
  });

  it('в личном каталоге её нет — ни у владельца, ни у организатора', async () => {
    for (const token of [memberToken, organizerToken]) {
      const catalog = await call('get', '/api/gear', token).expect(200);
      expect(
        (catalog.body.items as Array<{ id: string }>).map((item) => item.id),
      ).not.toContain(manualGearItemId);
    }
  });

  it('через каталог одноразовую вещь не удалить — 404', async () => {
    await call(
      'delete',
      `/api/gear/${manualGearItemId}`,
      memberToken,
    ).expect(404);
  });

  it('названия может не быть — строку подписывает тип', async () => {
    const response = await addManual(memberToken, {
      typeId: plainTypeId,
    }).expect(201);

    expect(response.body.title).toBe('Проверочный ящик');
    expect(response.body.isTripOnly).toBe(true);
    expect(response.body.weightGrams).toBeNull();
  });

  it('характеристики — те же правила: обязательные спрашиваются', async () => {
    await addManual(memberToken, { typeId: tentTypeId }).expect(400);

    // Число приходит строкой с запятой — как из поля ввода на телефоне.
    const response = await addManual(memberToken, {
      typeId: tentTypeId,
      attributes: { seats: '3' },
    }).expect(201);

    const seats = (
      response.body.attributes as Array<{ code: string; value: unknown }>
    ).find((attribute) => attribute.code === 'seats');

    expect(seats?.value).toBe(3);
  });

  it('флаг «Регулярное» заводит вещь ещё и в каталоге владельца', async () => {
    const response = await addManual(memberToken, {
      typeId: plainTypeId,
      title: 'Тент из целлофана',
      addToCatalog: true,
    }).expect(201);

    catalogTripGearId = response.body.id as string;
    catalogGearItemId = response.body.gearItemId as string;

    expect(response.body.isTripOnly).toBe(false);

    const catalog = await call('get', '/api/gear', memberToken).expect(200);
    expect(
      (catalog.body.items as Array<{ id: string }>).map((item) => item.id),
    ).toContain(catalogGearItemId);

    const list = await call(
      'get',
      `/api/trips/${tripId}/gear`,
      memberToken,
    ).expect(200);
    expect(
      (list.body.items as Array<{ id: string }>).map((item) => item.id),
    ).toContain(catalogTripGearId);
  });

  it('организатор добавляет вещь человеку без аккаунта — без флага и без каталога', async () => {
    const response = await addManual(organizerToken, {
      typeId: plainTypeId,
      title: 'Топор для Дяди Вити',
      ownerUserId: virtualId,
    }).expect(201);

    virtualTripGearId = response.body.id as string;
    virtualGearItemId = response.body.gearItemId as string;

    expect(response.body.ownerUserId).toBe(virtualId);
    // Идущему — сразу в рюкзак; у виртуального статус всегда `going`.
    expect(response.body.assignedUserId).toBe(virtualId);
    expect(response.body.isTripOnly).toBe(true);
  });

  it('«Регулярное» для человека без аккаунта — 400: каталога у него нет', async () => {
    await addManual(organizerToken, {
      typeId: plainTypeId,
      ownerUserId: virtualId,
      addToCatalog: true,
    }).expect(400);
  });

  it('другому настоящему участнику вещь не добавляют — 403', async () => {
    await addManual(organizerToken, {
      typeId: plainTypeId,
      title: 'Чужая вещь',
      ownerUserId: memberId,
    }).expect(403);
  });

  it('за виртуального добавляет только организатор — участнику 403', async () => {
    await addManual(memberToken, {
      typeId: plainTypeId,
      ownerUserId: virtualId,
    }).expect(403);
  });

  it('посторонний в снаряжение похода не лезет — 403', async () => {
    await addManual(strangerToken, { typeId: plainTypeId }).expect(403);
    await call('get', `/api/trips/${tripId}/gear`, strangerToken).expect(403);
  });

  it('неизвестные тип и характеристика — 400', async () => {
    await addManual(memberToken, { typeId: 2147483000 }).expect(400);
    await addManual(memberToken, {
      typeId: plainTypeId,
      attributes: { no_such_attribute: 1 },
    }).expect(400);
  });

  it('убрали вещь из похода — одноразовая ушла из базы', async () => {
    await call(
      'delete',
      `/api/trips/${tripId}/gear/${manualTripGearId}`,
      memberToken,
    ).expect(204);

    const rows: Array<{ count: number }> = await dataSource.query(
      'SELECT count(*)::int AS count FROM gear_items WHERE id = $1',
      [manualGearItemId],
    );
    expect(rows[0].count).toBe(0);
  });

  it('вещь из каталога из похода уходит, а в каталоге остаётся', async () => {
    await call(
      'delete',
      `/api/trips/${tripId}/gear/${catalogTripGearId}`,
      memberToken,
    ).expect(204);

    const catalog = await call('get', '/api/gear', memberToken).expect(200);
    expect(
      (catalog.body.items as Array<{ id: string }>).map((item) => item.id),
    ).toContain(catalogGearItemId);
  });

  it('убрали человека без аккаунта — его одноразовые вещи ушли вместе с ним', async () => {
    await call(
      'delete',
      `/api/trips/${tripId}/participants/${virtualId}`,
      organizerToken,
    ).expect(204);

    const gearRows: Array<{ count: number }> = await dataSource.query(
      'SELECT count(*)::int AS count FROM gear_items WHERE id = $1',
      [virtualGearItemId],
    );
    const tripRows: Array<{ count: number }> = await dataSource.query(
      'SELECT count(*)::int AS count FROM trip_gear WHERE id = $1',
      [virtualTripGearId],
    );

    expect(gearRows[0].count).toBe(0);
    expect(tripRows[0].count).toBe(0);
  });
});
