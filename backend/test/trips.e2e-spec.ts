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
  let applicantToken: string;
  let applicantId: string;
  let goalObjectId: string;
  let activityGroupId: number;
  let activityTypeId: number;
  let lastCode: string | null = null;

  const email = `trips-e2e-${Date.now()}@example.com`;
  const strangerEmail = `trips-e2e-viewer-${Date.now()}@example.com`;
  const applicantEmail = `trips-e2e-applicant-${Date.now()}@example.com`;

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

    const applicant = await login(applicantEmail);
    applicantToken = applicant.token;
    applicantId = applicant.id;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // Походы уносит каскад вместе с участниками, ролями, чатами
      // и вариантами дат.
      await dataSource.query(
        'DELETE FROM trips WHERE organizer_user_id = ANY($1::uuid[])',
        [[userId, strangerId, applicantId]],
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
      // Заявитель и посторонний попадают в состав чужих походов, поэтому
      // пользователей удаляем после походов: `ON DELETE RESTRICT` не даст
      // иначе, и это правильно.
      await dataSource.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        [userId, strangerId, applicantId],
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
        announcement: 'Витязь на майские',
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
      expect(response.body.announcement).toBe('Витязь на майские');
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
      const created = await createTrip({ announcement: 'Читаемый поход' });

      const response = await request(app.getHttpServer())
        .get(`/api/trips/${created.body.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.id).toBe(created.body.id);
      expect(response.body.announcement).toBe('Читаемый поход');
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

  describe('список', () => {
    /** Заголовки походов из ответа ленты. */
    const listAnnouncements = async (
      query: string,
      token = accessToken,
    ): Promise<string[]> => {
      const response = await request(app.getHttpServer())
        .get(`/api/trips${query}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      return (response.body.trips as Array<{ announcement: string }>).map(
        (trip) => trip.announcement,
      );
    };

    it('отдаёт мои походы вместе с целью, чтобы лента не ходила за именем', async () => {
      await createTrip({ announcement: 'В ленте' });

      const response = await request(app.getHttpServer())
        .get('/api/trips?mine=true')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const trip = (
        response.body.trips as Array<{
          announcement: string;
          goalObject: unknown;
        }>
      ).find((item) => item.announcement === 'В ленте');
      expect(trip).toBeDefined();
      expect(trip?.goalObject).toMatchObject({ type: 'вершина' });
    });

    it('приватный поход не виден постороннему в ленте', async () => {
      await createTrip({
        announcement: 'Приватный в ленте',
        visibility: 'private',
      });

      expect(await listAnnouncements('?limit=50', strangerToken)).not.toContain(
        'Приватный в ленте',
      );
      expect(
        await listAnnouncements('?mine=true&limit=50', strangerToken),
      ).not.toContain('Приватный в ленте');
    });

    /**
     * `mine` — три состояния. Без параметра лента общая, `true` — только мои,
     * `false` — только чужие. Разделение на «Мои походы» и «Анонсы» держится
     * именно на этом: без третьего состояния вторая страница повторяла бы
     * первую, а «покажи чужие» пришлось бы фильтровать на клиенте.
     */
    it('mine=false показывает только чужие походы, mine=true — только свои', async () => {
      await createTrip({ announcement: 'Мой поход e2e' });

      const mine = await listAnnouncements('?mine=true&limit=50');
      expect(mine).toContain('Мой поход e2e');

      const others = await listAnnouncements('?mine=false&limit=50');
      expect(others).not.toContain('Мой поход e2e');

      // Для постороннего этот поход чужой — и он попадает в «чужие»,
      // а в «мои» не попадает ни при каких условиях.
      const strangerOthers = await listAnnouncements(
        '?mine=false&limit=50',
        strangerToken,
      );
      expect(strangerOthers).toContain('Мой поход e2e');
      expect(
        await listAnnouncements('?mine=true&limit=50', strangerToken),
      ).not.toContain('Мой поход e2e');
    });

    it('when=undated не смешивает бездатные походы с предстоящими', async () => {
      await createTrip({ announcement: 'Без дат e2e' });
      await createTrip({
        announcement: 'Впереди e2e',
        startsAt: '2099-06-01T00:00:00.000Z',
        endsAt: '2099-06-05T00:00:00.000Z',
      });

      const undated = await listAnnouncements('?mine=true&when=undated');
      expect(undated).toContain('Без дат e2e');
      expect(undated).not.toContain('Впереди e2e');

      const upcoming = await listAnnouncements('?mine=true&when=upcoming');
      expect(upcoming).toContain('Впереди e2e');
      expect(upcoming).not.toContain('Без дат e2e');
    });

    it('фильтр по цели и пагинация с полным total', async () => {
      await createTrip({ announcement: 'На тестовую вершину' });

      const response = await request(app.getHttpServer())
        .get(`/api/trips?mine=true&goalObjectId=${goalObjectId}&limit=1`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.trips).toHaveLength(1);
      expect(response.body.total).toBeGreaterThan(1);
    });

    /**
     * Признак спортивного похода — не украшение карточки, а фильтр:
     * зачётные походы ищут отдельно от «просто сходить». Проверяются оба
     * значения, потому что `false` — такой же осознанный выбор, как `true`,
     * и условие «показать неспортивные» обязано работать, а не только
     * отсекать спортивные.
     */
    it('фильтр по спортивному признаку разделяет спортивные и обычные', async () => {
      await createTrip({ announcement: 'Спортивный e2e', isSport: true });
      await createTrip({ announcement: 'Обычный e2e', isSport: false });

      const sport = await listAnnouncements('?mine=true&isSport=true');
      expect(sport).toContain('Спортивный e2e');
      expect(sport).not.toContain('Обычный e2e');

      const usual = await listAnnouncements('?mine=true&isSport=false');
      expect(usual).toContain('Обычный e2e');
      expect(usual).not.toContain('Спортивный e2e');
    });

    it('мусор в фильтрах — 400, а не молчаливое значение по умолчанию', async () => {
      for (const query of [
        '?when=когда-нибудь',
        '?mine=yes',
        '?isSport=yes',
        '?limit=999',
      ]) {
        await request(app.getHttpServer())
          .get(`/api/trips${query}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(400);
      }
    });
  });

  describe('правка', () => {
    it('организатор меняет поля, а неприсланные остаются как были', async () => {
      const created = await createTrip({
        announcement: 'До правки',
        requirementsText: 'Свои кошки',
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/trips/${created.body.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ announcement: 'После правки' })
        .expect(200);

      expect(response.body.announcement).toBe('После правки');
      expect(response.body.requirementsText).toBe('Свои кошки');
    });

    it('null стирает поле, а пустое тело ничего не меняет', async () => {
      const created = await createTrip({ requirementsText: 'Что-то' });

      const cleared = await request(app.getHttpServer())
        .patch(`/api/trips/${created.body.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ requirementsText: null })
        .expect(200);
      expect(cleared.body.requirementsText).toBeNull();

      const untouched = await request(app.getHttpServer())
        .patch(`/api/trips/${created.body.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({})
        .expect(200);
      expect(untouched.body.id).toBe(created.body.id);
    });

    it('маршрут пересобирает индекс упоминаний объектов', async () => {
      const created = await createTrip({ routeText: '' });
      const tripId = created.body.id as string;

      await request(app.getHttpServer())
        .patch(`/api/trips/${tripId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          routeText: `Идём на [[object:${goalObjectId}]] и обратно на [[object:${goalObjectId}]]`,
        })
        .expect(200);

      const elements = await dataSource.query(
        'SELECT object_id FROM trip_route_elements WHERE trip_id = $1',
        [tripId],
      );
      expect(elements).toHaveLength(1);
      expect(elements[0].object_id).toBe(goalObjectId);

      await request(app.getHttpServer())
        .patch(`/api/trips/${tripId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ routeText: '' })
        .expect(200);

      const afterClear = await dataSource.query(
        'SELECT object_id FROM trip_route_elements WHERE trip_id = $1',
        [tripId],
      );
      expect(afterClear).toHaveLength(0);
    });

    it('ссылка на несуществующий объект — 400, и правка не сохраняется', async () => {
      const created = await createTrip({
        routeText: '',
        announcement: 'Целый',
      });

      await request(app.getHttpServer())
        .patch(`/api/trips/${created.body.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ routeText: 'Идём на [[object:999999]]' })
        .expect(400);

      const elements = await dataSource.query(
        'SELECT object_id FROM trip_route_elements WHERE trip_id = $1',
        [created.body.id],
      );
      expect(elements).toHaveLength(0);
    });

    it('нельзя снять коммерцию, оставив цену: проверяется итоговое состояние', async () => {
      const created = await createTrip({
        isCommercial: true,
        priceRub: 20000,
      });

      await request(app.getHttpServer())
        .patch(`/api/trips/${created.body.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ isCommercial: false })
        .expect(400);

      await request(app.getHttpServer())
        .patch(`/api/trips/${created.body.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ isCommercial: false, priceRub: null })
        .expect(200);
    });

    it('решённый поход нельзя оставить без дат', async () => {
      const created = await createTrip({
        status: 'decided',
        startsAt: '2099-07-01T00:00:00.000Z',
        endsAt: '2099-07-05T00:00:00.000Z',
      });

      await request(app.getHttpServer())
        .patch(`/api/trips/${created.body.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ startsAt: null, endsAt: null })
        .expect(400);
    });

    it('посторонний не может править чужой публичный поход — 403', async () => {
      const created = await createTrip({ announcement: 'Не твой' });

      await request(app.getHttpServer())
        .patch(`/api/trips/${created.body.id}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ announcement: 'Захват' })
        .expect(403);
    });
  });

  describe('отмена', () => {
    it('идею отменить нельзя: у неё нет договорённостей', async () => {
      const created = await createTrip({ announcement: 'Идея' });
      expect(created.body.status).toBe('idea');

      await request(app.getHttpServer())
        .post(`/api/trips/${created.body.id}/cancel`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);
    });

    it('отмена не затирает статус, убирает поход из ленты и снимается обратно', async () => {
      const created = await createTrip({
        announcement: 'Отменяемый',
        status: 'planning',
      });
      const tripId = created.body.id as string;

      const cancelled = await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/cancel`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(cancelled.body.cancelledAt).not.toBeNull();
      expect(cancelled.body.status).toBe('planning');

      const list = await request(app.getHttpServer())
        .get('/api/trips?mine=true&limit=50')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(
        (list.body.trips as Array<{ announcement: string }>).map(
          (trip) => trip.announcement,
        ),
      ).not.toContain('Отменяемый');

      const restored = await request(app.getHttpServer())
        .delete(`/api/trips/${tripId}/cancel`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(restored.body.cancelledAt).toBeNull();
    });

    it('посторонний не может отменить чужой поход — 403', async () => {
      const created = await createTrip({
        announcement: 'Чужой',
        status: 'planning',
      });

      await request(app.getHttpServer())
        .post(`/api/trips/${created.body.id}/cancel`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(403);
    });
  });

  describe('состав и тикеты', () => {
    /** Системные сообщения чата похода: у них `sender_id IS NULL`. */
    const systemMessages = async (
      tripId: string,
      kind: string,
    ): Promise<string[]> => {
      const rows = await dataSource.query(
        `SELECT gm.body
           FROM group_messages gm
           JOIN chats c ON c.id = gm.chat_id
          WHERE c.trip_id = $1 AND c.kind = $2 AND gm.sender_id IS NULL
          ORDER BY gm.id`,
        [tripId, kind],
      );
      return rows.map((row: { body: string }) => row.body);
    };

    const participants = async (tripId: string, token = accessToken) => {
      const response = await request(app.getHttpServer())
        .get(`/api/trips/${tripId}/participants`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      return response.body.participants as Array<{
        userId: string;
        status: string;
        isOrganizer: boolean;
        roles: Array<{ code: string }>;
      }>;
    };

    it('при создании в составе один организатор с ролью и статусом going', async () => {
      const created = await createTrip({ announcement: 'Состав по умолчанию' });
      const list = await participants(created.body.id as string);

      expect(list).toHaveLength(1);
      expect(list[0].userId).toBe(userId);
      expect(list[0].isOrganizer).toBe(true);
      expect(list[0].status).toBe('going');
      expect(list[0].roles.map((role) => role.code)).toContain(
        ORGANIZER_ROLE_CODE,
      );
    });

    it('приглашение сразу добавляет человека в состав и он видит поход', async () => {
      const created = await createTrip({ announcement: 'С приглашением' });
      const tripId = created.body.id as string;

      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ direction: 'invite', userId: applicantId, message: 'Идёшь?' })
        .expect(201);

      const list = await participants(tripId);
      const invited = list.find((item) => item.userId === applicantId);
      expect(invited?.status).toBe('invited');

      // Приглашённый должен видеть поход, иначе он не решит, идти ли.
      await request(app.getHttpServer())
        .get(`/api/trips/${tripId}`)
        .set('Authorization', `Bearer ${applicantToken}`)
        .expect(200);
    });

    it('повторное приглашение — 409, приглашение не организатором — 403', async () => {
      const created = await createTrip({ announcement: 'Двойное приглашение' });
      const tripId = created.body.id as string;
      const invite = { direction: 'invite', userId: applicantId };

      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(invite)
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(invite)
        .expect(409);

      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ direction: 'invite', userId: strangerId })
        .expect(403);
    });

    it('приглашённый принимает: статус меняется, тикет закрыт, есть сообщение', async () => {
      const created = await createTrip({
        announcement: 'Принятие приглашения',
      });
      const tripId = created.body.id as string;

      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ direction: 'invite', userId: applicantId })
        .expect(201);

      const accepted = await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests/${applicantId}/accept`)
        .set('Authorization', `Bearer ${applicantToken}`)
        .send({ status: 'maybe' })
        .expect(200);
      expect(accepted.body.status).toBe('maybe');

      const tickets = await dataSource.query(
        'SELECT count(*)::int AS c FROM trip_membership_requests WHERE trip_id = $1',
        [tripId],
      );
      expect(tickets[0].c).toBe(0);

      // Текст сообщения начинается с имени, а имя выводится из адреса
      // почты — привязываться к нему в тесте незачем, проверяем суть.
      expect(
        (await systemMessages(tripId, 'trip_members')).some((body) =>
          body.endsWith(': пока не решил'),
        ),
      ).toBe(true);
    });

    it('заявку принимает только организатор, а подаёт — только от своего имени', async () => {
      const created = await createTrip({ announcement: 'Заявка' });
      const tripId = created.body.id as string;

      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${applicantToken}`)
        .send({ direction: 'apply', list: 'нет такого поля' })
        .expect(400);

      const applied = await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${applicantToken}`)
        .send({ direction: 'apply', message: 'Возьмите меня' })
        .expect(201);
      expect(applied.body.userId).toBe(applicantId);

      // Заявку видит организатор и сам заявитель, но не посторонний.
      const asOrganizer = await request(app.getHttpServer())
        .get(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(asOrganizer.body.requests).toHaveLength(1);

      const asStranger = await request(app.getHttpServer())
        .get(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(200);
      expect(asStranger.body.requests).toHaveLength(0);

      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests/${applicantId}/accept`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ status: 'going' })
        .expect(403);

      const approved = await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests/${applicantId}/accept`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ status: 'going' })
        .expect(200);
      expect(approved.body.status).toBe('going');

      expect(
        (await systemMessages(tripId, 'trip_guest')).some((body) =>
          body.startsWith('Заявка на участие от '),
        ),
      ).toBe(true);
    });

    it('при закрытом наборе заявку не принять — 409', async () => {
      const created = await createTrip({ announcement: 'Набор закрыт' });
      const tripId = created.body.id as string;

      await request(app.getHttpServer())
        .patch(`/api/trips/${tripId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ isRecruitmentClosed: true })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${applicantToken}`)
        .send({ direction: 'apply' })
        .expect(409);
    });

    it('отказ от приглашения убирает из состава и пишет в чат участников', async () => {
      const created = await createTrip({ announcement: 'Отказ' });
      const tripId = created.body.id as string;

      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ direction: 'invite', userId: applicantId })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/trips/${tripId}/requests/${applicantId}`)
        .set('Authorization', `Bearer ${applicantToken}`)
        .expect(204);

      const list = await participants(tripId);
      expect(list.some((item) => item.userId === applicantId)).toBe(false);
      expect(
        (await systemMessages(tripId, 'trip_members')).some((body) =>
          body.includes('не идёт в поход'),
        ),
      ).toBe(true);
    });

    it('организатор убирает участника, но не себя', async () => {
      const created = await createTrip({ announcement: 'Удаление участника' });
      const tripId = created.body.id as string;

      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ direction: 'invite', userId: applicantId })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests/${applicantId}/accept`)
        .set('Authorization', `Bearer ${applicantToken}`)
        .send({ status: 'going' })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/trips/${tripId}/participants/${applicantId}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .delete(`/api/trips/${tripId}/participants/${userId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);

      await request(app.getHttpServer())
        .delete(`/api/trips/${tripId}/participants/${applicantId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      const list = await participants(tripId);
      expect(list.some((item) => item.userId === applicantId)).toBe(false);
    });

    it('свой статус меняет только участник, и это видно в чате', async () => {
      const created = await createTrip({ announcement: 'Свой статус' });
      const tripId = created.body.id as string;

      await request(app.getHttpServer())
        .patch(`/api/trips/${tripId}/participants/me`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ status: 'going' })
        .expect(404);

      const changed = await request(app.getHttpServer())
        .patch(`/api/trips/${tripId}/participants/me`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ status: 'declined' })
        .expect(200);

      // Организатор тоже может не идти: «организую, но сам не пойду».
      expect(changed.body.status).toBe('declined');
      expect(changed.body.isOrganizer).toBe(true);
    });

    it('состав приватного похода постороннему не виден — 404', async () => {
      const created = await createTrip({
        announcement: 'Приватный состав',
        visibility: 'private',
      });

      await request(app.getHttpServer())
        .get(`/api/trips/${created.body.id}/participants`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/api/trips/${created.body.id}/participants`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(404);
    });
  });

  describe('переписка', () => {
    const send = (tripId: string, token: string, kind: string, body: string) =>
      request(app.getHttpServer())
        .post(`/api/trips/${tripId}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ kind, body });

    const read = async (
      tripId: string,
      token: string,
      query: string,
    ): Promise<{
      messages: Array<{ body: string; isSystem: boolean }>;
      hasMore: boolean;
    }> => {
      const response = await request(app.getHttpServer())
        .get(`/api/trips/${tripId}/messages?${query}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      return response.body;
    };

    it('организатор видит оба чата, посторонний в публичном — только гостевой', async () => {
      const created = await createTrip({ announcement: 'Чаты похода' });
      const tripId = created.body.id as string;

      const mine = await request(app.getHttpServer())
        .get(`/api/trips/${tripId}/chats`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(mine.body.chats.map((c: { kind: string }) => c.kind)).toEqual([
        'trip_guest',
        'trip_members',
      ]);
      expect(mine.body.chats[0].lastMessage).toBeNull();

      const theirs = await request(app.getHttpServer())
        .get(`/api/trips/${tripId}/chats`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(200);
      expect(theirs.body.chats.map((c: { kind: string }) => c.kind)).toEqual([
        'trip_guest',
      ]);
    });

    it('чаты приватного похода постороннему не видны — 404', async () => {
      const created = await createTrip({
        announcement: 'Приватные чаты',
        visibility: 'private',
      });

      await request(app.getHttpServer())
        .get(`/api/trips/${created.body.id}/chats`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(404);
    });

    it('сообщение сохраняется обрезанным, с автором и признаком «не системное»', async () => {
      const created = await createTrip({ announcement: 'Отправка' });
      const tripId = created.body.id as string;

      const sent = await send(
        tripId,
        accessToken,
        'trip_members',
        '  Беру палатку  ',
      ).expect(201);

      expect(sent.body.body).toBe('Беру палатку');
      expect(sent.body.senderId).toBe(userId);
      expect(sent.body.senderName).toBeTruthy();
      expect(sent.body.isSystem).toBe(false);
    });

    it('чат участников закрыт для постороннего, гостевой открыт', async () => {
      const created = await createTrip({ announcement: 'Доступ к чатам' });
      const tripId = created.body.id as string;

      await request(app.getHttpServer())
        .get(`/api/trips/${tripId}/messages?kind=trip_members`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(403);

      await send(tripId, strangerToken, 'trip_guest', 'А можно с вами?').expect(
        201,
      );

      const guest = await read(tripId, accessToken, 'kind=trip_guest');
      expect(guest.messages.map((message) => message.body)).toContain(
        'А можно с вами?',
      );
    });

    it('приглашённый получает чат участников, ещё не ответив', async () => {
      const created = await createTrip({ announcement: 'Чат приглашённого' });
      const tripId = created.body.id as string;

      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ direction: 'invite', userId: applicantId })
        .expect(201);

      const chats = await request(app.getHttpServer())
        .get(`/api/trips/${tripId}/chats`)
        .set('Authorization', `Bearer ${applicantToken}`)
        .expect(200);
      expect(chats.body.chats).toHaveLength(2);

      await send(tripId, applicantToken, 'trip_members', 'Я в деле').expect(
        201,
      );
    });

    it('системные сообщения видны в чате без автора', async () => {
      const created = await createTrip({ announcement: 'Системные в чате' });
      const tripId = created.body.id as string;

      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${applicantToken}`)
        .send({ direction: 'apply' })
        .expect(201);

      const guest = await read(tripId, accessToken, 'kind=trip_guest');
      const system = guest.messages.find((message) => message.isSystem);
      expect(system?.body).toContain('Заявка на участие от');
    });

    it('страницы листаются курсором от новых к старым', async () => {
      const created = await createTrip({ announcement: 'Страницы' });
      const tripId = created.body.id as string;

      for (let index = 1; index <= 5; index += 1) {
        await send(
          tripId,
          accessToken,
          'trip_guest',
          `сообщение ${index}`,
        ).expect(201);
      }

      const first = await read(tripId, accessToken, 'kind=trip_guest&limit=2');
      expect(first.messages.map((message) => message.body)).toEqual([
        'сообщение 4',
        'сообщение 5',
      ]);
      expect(first.hasMore).toBe(true);

      const second = await read(
        tripId,
        accessToken,
        `kind=trip_guest&limit=2&before=${(first.messages[0] as unknown as { id: string }).id}`,
      );
      expect(second.messages.map((message) => message.body)).toEqual([
        'сообщение 2',
        'сообщение 3',
      ]);
      expect(second.hasMore).toBe(true);

      const third = await read(
        tripId,
        accessToken,
        `kind=trip_guest&limit=2&before=${(second.messages[0] as unknown as { id: string }).id}`,
      );
      expect(third.messages.map((message) => message.body)).toEqual([
        'сообщение 1',
      ]);
      expect(third.hasMore).toBe(false);
    });

    it('пустое сообщение, неизвестный чат и мусор в параметрах — 400', async () => {
      const created = await createTrip({ announcement: 'Отказы чата' });
      const tripId = created.body.id as string;

      await send(tripId, accessToken, 'trip_guest', '').expect(400);
      await send(tripId, accessToken, 'trip_guest', '     ').expect(400);
      await send(tripId, accessToken, 'trip_secret', 'привет').expect(400);

      await request(app.getHttpServer())
        .get(`/api/trips/${tripId}/messages`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);

      await request(app.getHttpServer())
        .get(`/api/trips/${tripId}/messages?kind=trip_guest&limit=101`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);

      await request(app.getHttpServer())
        .get(`/api/trips/${tripId}/messages?kind=trip_guest&before=вчера`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);
    });
  });
});
