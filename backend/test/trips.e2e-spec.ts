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
 * Тесты создания похода — по живому приложению с живой БД.
 *
 * Проверяем то, чего не видит юнит-тест: что поход создаётся целиком
 * (организатор в составе, его роль, оба чата, варианты дат — одной
 * транзакцией), что взаимозависимые условия превращаются в 400, а не
 * в 500 от CHECK-а базы, и что приватный поход не виден постороннему.
 *
 * **Тест сам заводит всё, от чего зависит.** Объект справочника, группу
 * и тип активности он создаёт и убирает за собой; роль организатора
 * доводит до существования через `ON CONFLICT DO NOTHING`, но **не
 * удаляет** — это справочные данные, а не мусор теста. Иначе на чистой
 * dev-базе без залитого `seed:roles` «создание похода» падало бы 500-й,
 * и причина выглядела бы как поломка кода.
 *
 * Годы и даты в тесте заведомо далёкие: походы живут по своим датам,
 * а не по текущей, и тест не должен зависеть от того, когда его запустили.
 */
describe('Походы (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let accessToken: string;
  let userId: string;
  let strangerToken: string;
  let strangerId: string;
  let goalObjectId: string;
  let activityGroupId: number;
  let activityTypeId: number;
  let lastCode: string | null = null;

  const email = `trips-e2e-${Date.now()}@example.com`;
  const strangerEmail = `trips-e2e-viewer-${Date.now()}@example.com`;

  /** Id походов, созданных тестом, — чтобы убрать их за собой. */
  const createdTripIds: string[] = [];

  /** Вход по коду из письма: код перехватывается у EmailCodeService. */
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

    goalObjectId = (
      await dataSource.query(
        `INSERT INTO objects (name, type) VALUES ('Тестовая вершина e2e', 'вершина') RETURNING id`,
      )
    )[0].id;

    activityGroupId = (
      await dataSource.query(
        `INSERT INTO calendar_activity_groups (code, label, color) VALUES ('trips-e2e', 'Походный тест', '#123456') RETURNING id`,
      )
    )[0].id;
    activityTypeId = (
      await dataSource.query(
        `INSERT INTO calendar_activity_types (code, label, group_id, icon) VALUES ('trips-e2e', 'Тестовая активность', $1, 'run') RETURNING id`,
        [activityGroupId],
      )
    )[0].id;

    /**
     * Роль организатора создаётся сервисом при создании похода, поэтому
     * без неё запрос вернёт 500 с подсказкой про `seed:roles`. Тест эту
     * зависимость от сида снимает.
     */
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

    const author = await login(email);
    accessToken = author.token;
    userId = author.id;

    const stranger = await login(strangerEmail);
    strangerToken = stranger.token;
    strangerId = stranger.id;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // Походы уносит каскад вместе с участниками, ролями, чатами
      // и вариантами дат.
      await dataSource.query(
        'DELETE FROM trips WHERE organizer_user_id = ANY($1::uuid[])',
        [[userId, strangerId]],
      );
      await dataSource.query(
        'DELETE FROM calendar_activity_types WHERE id = $1',
        [activityTypeId],
      );
      await dataSource.query(
        'DELETE FROM calendar_activity_groups WHERE id = $1',
        [activityGroupId],
      );
      await dataSource.query('DELETE FROM objects WHERE id = $1', [
        goalObjectId,
      ]);
      await dataSource.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        [userId, strangerId],
      ]);
    }
    await app?.close();
  });

  /** Создать поход и запомнить его id для уборки. */
  async function createTrip(
    body: Record<string, unknown>,
    token = accessToken,
  ) {
    const response = await request(app.getHttpServer())
      .post('/api/trips')
      .set('Authorization', `Bearer ${token}`)
      .send({ goalObjectId: Number(goalObjectId), ...body });

    if (response.status === 201) {
      createdTripIds.push(response.body.id as string);
    }
    return response;
  }

  describe('создание', () => {
    it('минимальный поход: только цель, остальное по умолчанию', async () => {
      const response = await createTrip({});

      expect(response.status).toBe(201);
      expect(response.body.status).toBe('idea');
      expect(response.body.visibility).toBe('public');
      expect(response.body.routeText).toBe('');
      expect(response.body.isCommercial).toBe(false);
      expect(response.body.priceRub).toBeNull();
      expect(response.body.activityTypeIds).toEqual([]);
      expect(response.body.startsAt).toBeNull();
      expect(response.body.cancelledAt).toBeNull();
    });

    it('организатор — владелец токена, а не тот, кого назвали в теле', async () => {
      const response = await createTrip({});

      expect(response.status).toBe(201);
      expect(response.body.organizerUserId).toBe(userId);
    });

    it('организатор сразу в составе, с ролью и двумя чатами', async () => {
      const response = await createTrip({});
      const tripId = response.body.id as string;

      const participants = await dataSource.query(
        'SELECT user_id, status FROM trip_participants WHERE trip_id = $1',
        [tripId],
      );
      expect(participants).toHaveLength(1);
      expect(participants[0].user_id).toBe(userId);
      expect(participants[0].status).toBe('going');

      const roles = await dataSource.query(
        `SELECT r.code FROM trip_participant_roles tpr
           JOIN roles r ON r.id = tpr.role_id
          WHERE tpr.trip_id = $1`,
        [tripId],
      );
      expect(roles).toHaveLength(1);
      expect(roles[0].code).toBe(ORGANIZER_ROLE_CODE);

      const chats = await dataSource.query(
        'SELECT kind FROM chats WHERE trip_id = $1 ORDER BY kind',
        [tripId],
      );
      expect(chats.map((row: { kind: string }) => row.kind)).toEqual([
        'trip_guest',
        'trip_members',
      ]);
    });

    it('полный поход: даты, спорные поля, коммерция и варианты дат', async () => {
      const response = await createTrip({
        title: 'Витязь на майские',
        routeText: 'Заброска и подход',
        requirementsText: 'Свои кошки',
        status: 'decided',
        activityTypeIds: [activityTypeId],
        startsAt: '2099-05-05T01:00:00.000Z',
        endsAt: '2099-05-09T10:00:00.000Z',
        isCommercial: true,
        priceRub: 25000,
        priceNote: 'Заброска и питание',
        dateVariants: [
          { year: 2099, month: 6, durationDays: 7, durationDelta: 1 },
          { month: 8 },
        ],
      });

      expect(response.status).toBe(201);
      expect(response.body.title).toBe('Витязь на майские');
      expect(response.body.status).toBe('decided');
      expect(response.body.priceRub).toBe(25000);
      expect(response.body.activityTypeIds).toEqual([activityTypeId]);
      expect(response.body.startsAt).toBe('2099-05-05T01:00:00.000Z');

      const variants = await dataSource.query(
        'SELECT year, month, duration_days, duration_delta FROM trip_date_variants WHERE trip_id = $1 ORDER BY id',
        [response.body.id],
      );
      expect(variants).toHaveLength(2);
      expect(variants[0]).toMatchObject({
        year: 2099,
        month: 6,
        duration_days: 7,
        duration_delta: 1,
      });
      // «Когда-нибудь в августе»: известен только месяц.
      expect(variants[1]).toMatchObject({
        year: null,
        month: 8,
        duration_days: null,
        duration_delta: 0,
      });
    });

    it('активности-дубликаты схлопываются, а не ломают проверку', async () => {
      const response = await createTrip({
        activityTypeIds: [activityTypeId, activityTypeId],
      });

      expect(response.status).toBe(201);
      expect(response.body.activityTypeIds).toEqual([activityTypeId]);
    });
  });

  describe('отказы', () => {
    it('несуществующая цель — 400, а не 500 от внешнего ключа', async () => {
      const response = await createTrip({ goalObjectId: 999999 });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Цель не найдена');
    });

    it('несуществующая активность — 400, а не 500 от триггера', async () => {
      const response = await createTrip({ activityTypeIds: [999999] });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('несуществующие');
    });

    it('коммерческий поход без цены — 400', async () => {
      const response = await createTrip({ isCommercial: true });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('цена участия');
    });

    it('некоммерческий поход с ценой — 400', async () => {
      const response = await createTrip({ priceRub: 3000 });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('некоммерческого');
    });

    it('некоммерческий поход с описанием цены — 400', async () => {
      const response = await createTrip({ priceNote: 'Взнос на заброску' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('некоммерческого');
    });

    it('решённый поход без дат — 400', async () => {
      const response = await createTrip({ status: 'decided' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('обе даты');
    });

    it('конец раньше начала — 400', async () => {
      const response = await createTrip({
        startsAt: '2099-05-09T00:00:00.000Z',
        endsAt: '2099-05-05T00:00:00.000Z',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('раньше начала');
    });

    it('мусор в видимости — 400', async () => {
      await createTrip({ visibility: 'secret' }).then((response) =>
        expect(response.status).toBe(400),
      );
    });

    it('лишнее поле в теле — 400', async () => {
      const response = await createTrip({ organizerUserId: strangerId });

      expect(response.status).toBe(400);
    });

    it('без токена — 401', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/trips')
        .send({ goalObjectId: Number(goalObjectId) });

      expect(response.status).toBe(401);
    });
  });

  describe('чтение', () => {
    it('автор видит свой поход', async () => {
      const created = await createTrip({ title: 'Читаемый поход' });

      const response = await request(app.getHttpServer())
        .get(`/api/trips/${created.body.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.id).toBe(created.body.id);
      expect(response.body.title).toBe('Читаемый поход');
    });

    it('несуществующий поход — 404', async () => {
      await request(app.getHttpServer())
        .get('/api/trips/999999')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });

    it('нечисловой id — 400, а не 500 от базы', async () => {
      await request(app.getHttpServer())
        .get('/api/trips/abc')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);
    });

    it('приватный поход: автор видит, посторонний получает 404', async () => {
      const created = await createTrip({ visibility: 'private' });
      expect(created.status).toBe(201);

      await request(app.getHttpServer())
        .get(`/api/trips/${created.body.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // Именно 404, а не 403: подтверждать существование приватного похода
      // постороннему нельзя — иначе перебор id расскажет, кто и куда едет.
      await request(app.getHttpServer())
        .get(`/api/trips/${created.body.id}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(404);
    });
  });
});
