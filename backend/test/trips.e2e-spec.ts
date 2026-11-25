import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { EmailCodeService } from './../src/email/services/email-code.service';
import { SmtpService } from './../src/email/services/smtp.service';
import { ConversationEventsService } from './../src/trips/conversation-events.service';
import { COORGANIZER_ROLE_CODE } from './../src/trips/trip-tabs';
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
  /** Соорганизатор (20.11.2026) — четвёртый человек, роль ему даёт автор. */
  let coorgToken: string;
  let coorgId: string;
  let goalObjectId: string;
  /** Второй объект справочника: проверяем фильтр по упоминанию в маршруте. */
  let routeObjectId: string;
  let activityGroupId: number;
  let activityTypeId: number;
  let lastCode: string | null = null;

  const email = `trips-e2e-${Date.now()}@example.com`;
  const strangerEmail = `trips-e2e-viewer-${Date.now()}@example.com`;
  const applicantEmail = `trips-e2e-applicant-${Date.now()}@example.com`;
  const coorgEmail = `trips-e2e-coorg-${Date.now()}@example.com`;

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

    routeObjectId = (
      await dataSource.query(
        `INSERT INTO objects (name, type) VALUES ('Тестовый перевал e2e', 'перевал') RETURNING id`,
      )
    )[0].id;

    activityGroupId = (
      await dataSource.query(
        `INSERT INTO calendar_activity_groups (code, label, color, scope) VALUES ('trips-e2e', 'Походный тест', '#123456', 'trips') RETURNING id`,
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

    /**
     * Роль соорганизатора (20.11.2026) — тоже справочные данные: её заводит
     * `seed:roles`, а тест не должен зависеть от того, залит ли сид.
     * Матрицу прав вкладок тест не трогает намеренно: права соорганизатора
     * с этого шага живут в коде (`tabsByRole`), и проверка «все вкладки»
     * должна проходить и без единой строки `role_tab_permissions`.
     */
    await dataSource.query(
      `INSERT INTO roles (code, name) VALUES ($1, 'Соорганизатор') ON CONFLICT (code) DO NOTHING`,
      [COORGANIZER_ROLE_CODE],
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

    const coorg = await login(coorgEmail);
    coorgToken = coorg.token;
    coorgId = coorg.id;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // Походы уносит каскад вместе с участниками, ролями, чатами
      // и вариантами дат.
      await dataSource.query(
        'DELETE FROM trips WHERE organizer_user_id = ANY($1::uuid[])',
        [[userId, strangerId, applicantId, coorgId]],
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
      await dataSource.query('DELETE FROM objects WHERE id = $1', [
        routeObjectId,
      ]);
      // Заявитель и посторонний попадают в состав чужих походов, поэтому
      // пользователей удаляем после походов: `ON DELETE RESTRICT` не даст
      // иначе, и это правильно.
      // Действия и личные диалоги — до пользователей: у действия внешний
      // ключ на адресата, а диалоги держат пару участников.
      await dataSource.query(
        'DELETE FROM message_actions WHERE target_user_id = ANY($1::uuid[])',
        [[strangerId, applicantId, coorgId, userId]],
      );
      await dataSource.query(
        `DELETE FROM conversations
          WHERE kind = 'direct'
            AND (direct_a = ANY($1::uuid[]) OR direct_b = ANY($1::uuid[]))`,
        [[userId, strangerId, applicantId, coorgId]],
      );
      // Люди без аккаунта (20.11.2026): их заводит тест, и создатель держит
      // их внешним ключом `FK_users_virtual_owner`. Походы уже удалены —
      // участие ушло каскадом, остались только строки `users`.
      await dataSource.query(
        'DELETE FROM users WHERE virtual_owner_user_id = ANY($1::uuid[])',
        [[userId, strangerId, applicantId, coorgId]],
      );
      await dataSource.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        [userId, strangerId, applicantId, coorgId],
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
      // По умолчанию — настоящий поход: с 21.10.2026 у мечты нет ни
      // состава, ни членского чата (`tabs.md` §7). Тесты про мечту
      // передают `status: 'idea'` явно.
      .send({ goalObjectId: Number(goalObjectId), status: 'planning', ...body });

    if (response.status === 201) {
      createdTripIds.push(response.body.id as string);
    }
    return response;
  }

  describe('создание', () => {
    it('минимальный поход: только цель, остальное по умолчанию', async () => {
      const response = await createTrip({ status: 'idea' });

      expect(response.status).toBe(201);
      expect(response.body.status).toBe('idea');
      expect(response.body.visibility).toBe('public');
      expect(response.body.routeText).toBe('');
      expect(response.body.isCommercial).toBe(false);
      expect(response.body.priceRub).toBeNull();
      // Открытое участие — умолчание похода (13.11.2026): участники
      // приглашают своих, пока организатор не выключил флаг.
      expect(response.body.openParticipation).toBe(true);
      expect(response.body.activityTypeIds).toEqual([]);
      expect(response.body.startsAt).toBeNull();
      expect(response.body.cancelledAt).toBeNull();
    });

    it('организатор — владелец токена, а не тот, кого назвали в теле', async () => {
      const response = await createTrip({});

      expect(response.status).toBe(201);
      expect(response.body.organizerUserId).toBe(userId);
    });

    it('у планируемого похода организатор сразу в составе, с ролью и чатами', async () => {
      // У мечты состава нет — она вишлист (`tabs.md` §7). Проверяем
      // настоящий поход: в «Планирую» организатор появляется в составе.
      const response = await createTrip({ status: 'planning' });
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
        'SELECT kind FROM conversations WHERE trip_id = $1 ORDER BY kind',
        [tripId],
      );
      expect(chats.map((row: { kind: string }) => row.kind).sort()).toEqual([
        'trip_finance',
        'trip_first_aid',
        'trip_gear',
        'trip_guest',
        'trip_meals',
        'trip_members',
        'trip_route',
        'trip_transfer',
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

    /**
     * «Будет гитара» — короткое поле, которое человек ищет глазами в день
     * выхода. Место сбора убрано 27.10.2026: с новой редакцией «Трансфера»
     * у каждой карточки перевозки своя точка и своё время, а общее место
     * стало бы третьим источником правды о выезде.
     */
    it('гитара сохраняется флагом', async () => {
      const response = await createTrip({
        announcement: 'С гитарой',
        hasGuitar: true,
      });

      expect(response.status).toBe(201);
      expect(response.body.hasGuitar).toBe(true);

      // В базе лежит флаг, а не строка «да»: по нему строится карточка
      // и подпись на странице похода.
      const stored = await dataSource.query(
        'SELECT has_guitar FROM trips WHERE id = $1',
        [response.body.id],
      );
      expect(stored[0].has_guitar).toBe(true);
    });

    it('гитары по умолчанию нет', async () => {
      const response = await createTrip({ announcement: 'Без гитары' });

      expect(response.body.hasGuitar).toBe(false);
    });

    it('гитара не boolean — 400', async () => {
      const response = await createTrip({ hasGuitar: 'да' });

      expect(response.status).toBe(400);
    });

    it('удалённых полей сбора больше нет: место, время и заброска отбиваются 400-м', async () => {
      // `forbidNonWhitelisted` не прощает незнакомых полей — это и есть
      // проверка, что колонки убраны не только из ответа, но и из контракта.
      for (const body of [
        { meetingPlace: 'У вокзала' },
        { meetingAt: '2099-05-05T00:00:00.000Z' },
        { transferText: 'Электричка 6:40' },
      ]) {
        const response = await createTrip(body);

        expect(response.status).toBe(400);
      }
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

    it('несуществующая активность — 400, а не 500 от внешнего ключа', async () => {
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

  /**
   * Словарь типов похода: группа «Туризм» общего справочника активностей.
   *
   * Проверяем ровно то, на чём легко ошибиться: что календарные группы сюда
   * не просачиваются, что погашенные типы не предлагаются и что тип
   * по умолчанию фронт находит по коду, а не по порядку строк.
   */
  describe('типы похода', () => {
    it('отдаёт типы из походных групп и тип по умолчанию', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/trips/types')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const types = response.body.types as Array<{ id: number; code: string }>;

      // Тестовый тип живёт в группе со `scope = 'trips'` — он обязан быть.
      expect(types.map((type) => type.id)).toContain(activityTypeId);

      // Календарные группы в словарь типов похода не попадают: у них
      // `scope = 'calendar'`, и это правило живёт в данных.
      const calendarIds = await dataSource.query(
        `SELECT t.id
           FROM calendar_activity_types t
           JOIN calendar_activity_groups g ON g.id = t.group_id
          WHERE g.scope = 'calendar' AND t.is_active`,
      );
      const typeIds = types.map((type) => type.id);
      for (const row of calendarIds as Array<{ id: number }>) {
        expect(typeIds).not.toContain(row.id);
      }

      // `defaultTypeId` — это `trip_hiking`, если он залит в базу. На dev
      // он есть (миграция `ActivityGroupsScope`), на чистой базе может
      // отсутствовать — тогда словарь честно отдаёт `null`.
      const hiking = types.find((type) => type.code === 'trip_hiking');
      expect(response.body.defaultTypeId).toBe(hiking ? hiking.id : null);
    });

    it('погашенный тип в словарь не попадает', async () => {
      await dataSource.query(
        `UPDATE calendar_activity_types SET is_active = false WHERE id = $1`,
        [activityTypeId],
      );

      try {
        const response = await request(app.getHttpServer())
          .get('/api/trips/types')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        const ids = (response.body.types as Array<{ id: number }>).map(
          (type) => type.id,
        );
        expect(ids).not.toContain(activityTypeId);
      } finally {
        await dataSource.query(
          `UPDATE calendar_activity_types SET is_active = true WHERE id = $1`,
          [activityTypeId],
        );
      }
    });

    it('без токена словарь закрыт', async () => {
      await request(app.getHttpServer()).get('/api/trips/types').expect(401);
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

    it('фильтр по объекту и пагинация с полным total', async () => {
      await createTrip({ announcement: 'На тестовую вершину' });

      const response = await request(app.getHttpServer())
        .get(`/api/trips?mine=true&objectId=${goalObjectId}&limit=1`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.trips).toHaveLength(1);
      expect(response.body.total).toBeGreaterThan(1);
    });

    /**
     * Объект в фильтре — это цель **или** упоминание в маршруте, и проверять
     * надо именно второй случай: по цели фильтр работал и раньше, а индекс
     * упоминаний (`trip_route_elements`) до этого никто не спрашивал.
     *
     * Устройство проверки: поход B идёт на перевал, а вершина у него только
     * в тексте маршрута. Значит, по вершине он находится, а без индекса
     * упоминаний не нашёлся бы; поход C (перевал в цели, упоминаний нет)
     * по вершине не находится — это защита от «фильтр совпал со всем».
     */
    it('фильтр по объекту находит и цель, и упоминание в маршруте', async () => {
      await createTrip({ announcement: 'Цель — тестовая вершина' });
      await createTrip({
        goalObjectId: Number(routeObjectId),
        announcement: 'Вершина упомянута в маршруте',
        routeText: `Сначала заброска, потом [[object:${goalObjectId}]]`,
      });
      await createTrip({
        goalObjectId: Number(routeObjectId),
        announcement: 'Перевал без упоминаний',
      });

      const byGoalObject = await listAnnouncements(
        `?mine=true&objectId=${goalObjectId}&limit=50`,
      );
      expect(byGoalObject).toContain('Цель — тестовая вершина');
      expect(byGoalObject).toContain('Вершина упомянута в маршруте');
      expect(byGoalObject).not.toContain('Перевал без упоминаний');

      const byRouteObject = await listAnnouncements(
        `?mine=true&objectId=${routeObjectId}&limit=50`,
      );
      expect(byRouteObject).toContain('Вершина упомянута в маршруте');
      expect(byRouteObject).toContain('Перевал без упоминаний');
      expect(byRouteObject).not.toContain('Цель — тестовая вершина');
    });

    /**
     * «Следующие выходные» считаются в поясе проекта (Иркутск), а не по UTC,
     * поэтому дата в тесте строится вручную: сначала местное «сейчас»,
     * потом ближайшая суббота. Импортировать боевой расчёт сюда нельзя —
     * тест сравнивал бы функцию сама с собой.
     */
    it('when=weekend находит походы, пересекающие следующие выходные', async () => {
      /** Суббота ближайших выходных, 12:00 по Иркутску (UTC+8 без переходов). */
      const local = new Date(Date.now() + 8 * 60 * 60 * 1000);
      let ahead = (6 - local.getUTCDay() + 7) % 7;
      if (ahead === 0) ahead = 7;

      const saturdayNoon = Date.UTC(
        local.getUTCFullYear(),
        local.getUTCMonth(),
        local.getUTCDate() + ahead,
        12 - 8,
      );
      const iso = (ms: number) => new Date(ms).toISOString();

      await createTrip({
        announcement: 'Выходные e2e',
        status: 'decided',
        startsAt: iso(saturdayNoon),
        endsAt: iso(saturdayNoon + 26 * 60 * 60 * 1000),
      });
      // Пятница вечером — воскресенье: поход выходного дня, который
      // начинается до субботы. Окно он пересекает, значит попадать должен.
      await createTrip({
        announcement: 'С пятницы по воскресенье e2e',
        status: 'decided',
        startsAt: iso(saturdayNoon - 14 * 60 * 60 * 1000),
        endsAt: iso(saturdayNoon + 30 * 60 * 60 * 1000),
      });
      await createTrip({
        announcement: 'Через месяц e2e',
        status: 'decided',
        startsAt: iso(saturdayNoon + 30 * 24 * 60 * 60 * 1000),
        endsAt: iso(saturdayNoon + 30 * 24 * 60 * 60 * 1000 + 26 * 60 * 60 * 1000),
      });

      const weekend = await listAnnouncements('?mine=true&when=weekend&limit=50');
      expect(weekend).toContain('Выходные e2e');
      expect(weekend).toContain('С пятницы по воскресенье e2e');
      expect(weekend).not.toContain('Через месяц e2e');
    });

    /**
     * Признак официального похода — не украшение карточки, а фильтр:
     * зачётные выходы ищут отдельно от «просто сходить». Проверяются оба
     * значения, потому что `false` — такой же осознанный выбор, как `true`,
     * и условие «показать неофициальные» обязано работать, а не только
     * отсекать официальные.
     */
    it('фильтр по официальному признаку разделяет официальные и обычные', async () => {
      await createTrip({ announcement: 'Официальный e2e', isOfficial: true });
      await createTrip({ announcement: 'Обычный e2e', isOfficial: false });

      const official = await listAnnouncements('?mine=true&isOfficial=true');
      expect(official).toContain('Официальный e2e');
      expect(official).not.toContain('Обычный e2e');

      const usual = await listAnnouncements('?mine=true&isOfficial=false');
      expect(usual).toContain('Обычный e2e');
      expect(usual).not.toContain('Официальный e2e');
    });

    it('мусор в фильтрах — 400, а не молчаливое значение по умолчанию', async () => {
      for (const query of [
        '?when=когда-нибудь',
        '?mine=yes',
        '?isOfficial=yes',
        '?objectId=abc',
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

    it('правка включает гитару, не трогая соседние поля', async () => {
      const created = await createTrip({
        requirementsText: 'Свои кошки',
      });

      const changed = await request(app.getHttpServer())
        .patch(`/api/trips/${created.body.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ hasGuitar: true })
        .expect(200);

      // Патч одного поля не трогает соседние: требования остаются как были,
      // а гитара включается отдельным патчем — «выключить» её можно
      // только явным `false`.
      expect(changed.body.hasGuitar).toBe(true);
      expect(changed.body.requirementsText).toBe('Свои кошки');

      const cleared = await request(app.getHttpServer())
        .patch(`/api/trips/${created.body.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ hasGuitar: false })
        .expect(200);

      expect(cleared.body.hasGuitar).toBe(false);
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

    it('открытое участие выключается и включается обратно', async () => {
      const created = await createTrip({ announcement: 'Флаг участия' });
      const tripId = created.body.id as string;

      const closed = await request(app.getHttpServer())
        .patch(`/api/trips/${tripId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ openParticipation: false })
        .expect(200);
      expect(closed.body.openParticipation).toBe(false);

      const opened = await request(app.getHttpServer())
        .patch(`/api/trips/${tripId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ openParticipation: true })
        .expect(200);
      expect(opened.body.openParticipation).toBe(true);
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
      const created = await createTrip({
        announcement: 'Идея',
        status: 'idea',
      });
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
        `SELECT m.body
           FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
          WHERE c.trip_id = $1 AND c.kind = $2 AND m.sender_id IS NULL
          ORDER BY m.id`,
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

    it('повторное приглашение — 409, посторонним — 403', async () => {
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

      // Посторонний — не участник: открытое участие даёт право идущим,
      // а не всем, кому виден поход.
      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ direction: 'invite', userId: strangerId })
        .expect(403);
    });

    /**
     * Открытое участие (13.11.2026). Заказчик: «нужен чек-бокс „Открытое
     * участие. Участники могут приглашать своих“, по умолчанию true».
     * Право приглашать стало свойством похода, а не только организатора.
     */
    it('при открытом участии идущий участник приглашает своего и отзывает приглашение', async () => {
      const created = await createTrip({ announcement: 'Открытое участие' });
      const tripId = created.body.id as string;
      expect(created.body.openParticipation).toBe(true);

      // Сначала посторонний входит в состав: он и станет «участником».
      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ direction: 'invite', userId: strangerId })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests/${strangerId}/accept`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ status: 'going' })
        .expect(200);

      const invited = await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ direction: 'invite', userId: applicantId })
        .expect(201);
      expect(invited.body.createdByUserId).toBe(strangerId);

      // Пригласивший видит своё приглашение — иначе ему нечего отзывать.
      const mine = await request(app.getHttpServer())
        .get(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(200);
      expect(
        (mine.body.requests as Array<{ userId: string }>).map(
          (ticket) => ticket.userId,
        ),
      ).toEqual([applicantId]);

      // И может отозвать: право есть у организатора, приглашённого и автора.
      await request(app.getHttpServer())
        .delete(`/api/trips/${tripId}/requests/${applicantId}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(204);

      const list = await participants(tripId);
      expect(list.some((item) => item.userId === applicantId)).toBe(false);
    });

    it('при выключенном открытом участии участнику приглашать нельзя — 403', async () => {
      const created = await createTrip({
        announcement: 'Закрытое участие',
        openParticipation: false,
      });
      const tripId = created.body.id as string;
      expect(created.body.openParticipation).toBe(false);

      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ direction: 'invite', userId: strangerId })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests/${strangerId}/accept`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ status: 'going' })
        .expect(200);

      const denied = await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ direction: 'invite', userId: applicantId })
        .expect(403);
      expect(denied.body.message).toContain('Открытое участие выключено');

      // Организатор собирает состав сам — флаг на него не действует.
      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ direction: 'invite', userId: applicantId })
        .expect(201);
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

      /**
       * Организатор может быть «не иду» (17.11.2026): заказчик отменил
       * решение 16.11.2026 — «организатор может быть инвалидом лежачим,
       * организовывать людей и не ходить». Авторство похода и участие
       * в нём — разные вещи.
       */
      const organizer = await request(app.getHttpServer())
        .patch(`/api/trips/${tripId}/participants/me`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ status: 'declined' })
        .expect(200);

      expect(organizer.body.status).toBe('declined');

      // Обычный участник отказаться может: сначала он в составе.
      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ direction: 'invite', userId: strangerId })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests/${strangerId}/accept`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ status: 'going' })
        .expect(200);

      const changed = await request(app.getHttpServer())
        .patch(`/api/trips/${tripId}/participants/me`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ status: 'declined' })
        .expect(200);

      expect(changed.body.status).toBe('declined');
      expect(changed.body.isOrganizer).toBe(false);
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

  /**
   * Поиск людей сделан ради приглашения в поход: чтобы позвать человека,
   * его надо найти. Проверяется и приватность выдачи — наружу уходят
   * только имя, аватарка и id, — и то, что себя человек в списке не видит.
   */
  describe('поиск людей', () => {
    it('находит по подстроке имени и не показывает себя', async () => {
      await request(app.getHttpServer())
        .patch('/api/users/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ displayName: 'Поиск e2e организатор' })
        .expect(200);

      await request(app.getHttpServer())
        .patch('/api/users/me')
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ displayName: 'Поиск e2e напарник' })
        .expect(200);

      const found = await request(app.getHttpServer())
        .get('/api/users')
        .query({ search: 'Поиск e2e' })
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const users = found.body.users as Array<Record<string, unknown>>;
      const names = users.map((user) => user.displayName);

      expect(names).toContain('Поиск e2e напарник');
      expect(names).not.toContain('Поиск e2e организатор');
      expect(Object.keys(users[0]).sort()).toEqual([
        'avatarUrl',
        'displayName',
        'id',
      ]);
    });

    it('короткий запрос — 400, пустой — пустой список, а не все люди', async () => {
      await request(app.getHttpServer())
        .get('/api/users')
        .query({ search: 'П' })
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);

      const empty = await request(app.getHttpServer())
        .get('/api/users')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(empty.body.users).toEqual([]);
    });

    it('без токена поиск закрыт', async () => {
      await request(app.getHttpServer())
        .get('/api/users')
        .query({ search: 'Поиск e2e' })
        .expect(401);
    });
  });

  /**
   * Действия в сообщениях: «Да» / «Нет» и «посмотри ещё раз».
   *
   * Создания через API нет намеренно — действие вешает сервер (у денег это
   * Бухгалтерия). Поэтому строки заводятся прямо в базе, а проверяются
   * правила переходов и права: ответить может только адресат, переспросить
   * и отменить — только отправитель, подтверждение окончательно, отмена
   * удаляет и действие, и его сообщения.
   */
  describe('действия в сообщениях', () => {
    /** Личный диалог двух людей; повторный вызов возвращает тот же. */
    const directWith = async (otherUserId: string): Promise<string> => {
      const inserted = await dataSource.query(
        `INSERT INTO conversations (kind, direct_a, direct_b)
         VALUES ('direct', LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid))
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [userId, otherUserId],
      );
      if (inserted.length > 0) return inserted[0].id;

      const existing = await dataSource.query(
        `SELECT id FROM conversations
          WHERE kind = 'direct'
            AND direct_a = LEAST($1::uuid, $2::uuid)
            AND direct_b = GREATEST($1::uuid, $2::uuid)`,
        [userId, otherUserId],
      );
      return existing[0].id as string;
    };

    /** Действие и два сообщения с ним: публичное и личное. */
    const makeAction = async (
      targetUserId: string,
      state = 'pending',
    ): Promise<{ actionId: string; conversationId: string }> => {
      const conversationId = await directWith(targetUserId);
      const action = (
        await dataSource.query(
          `INSERT INTO message_actions (kind, target_user_id, payload, state)
           VALUES ('money_received', $1, $2::jsonb, $3) RETURNING id`,
          [targetUserId, JSON.stringify({ amountRub: 1000 }), state],
        )
      )[0].id;

      await dataSource.query(
        `INSERT INTO messages (conversation_id, sender_id, body, action_id)
         VALUES ($1, $2, 'Перевёл 1000 ₽', $3), ($1, $2, 'Перевёл тебе 1000 ₽', $3)`,
        [conversationId, userId, action],
      );

      return { actionId: action, conversationId };
    };

    const respond = (actionId: string, result: string, as: string) =>
      request(app.getHttpServer())
        .post(`/api/message-actions/${actionId}/respond`)
        .set('Authorization', `Bearer ${as}`)
        .send({ result });

    it('адресат подтверждает, чужой — нет, повтор ничего не меняет', async () => {
      const { actionId } = await makeAction(strangerId);

      const pending = await request(app.getHttpServer())
        .get('/api/message-actions/pending')
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(200);
      expect(
        (pending.body.toAnswer as Array<{ id: string }>).map((item) => item.id),
      ).toContain(actionId);

      await respond(actionId, 'confirmed', accessToken).expect(403);

      const confirmed = await respond(actionId, 'confirmed', strangerToken).expect(200);
      expect(confirmed.body.state).toBe('confirmed');

      // Повторное нажатие — тот же ответ, второго перевода не появляется.
      const again = await respond(actionId, 'confirmed', strangerToken).expect(200);
      expect(again.body.state).toBe('confirmed');

      // Подтверждённое отменить нельзя.
      await request(app.getHttpServer())
        .delete(`/api/message-actions/${actionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(409);
    });

    it('«не получено» можно переспросить, копия уходит в личный диалог', async () => {
      const { actionId, conversationId } = await makeAction(strangerId);

      await respond(actionId, 'disputed', strangerToken).expect(200);

      const before = await dataSource.query(
        'SELECT count(*)::int AS c FROM messages WHERE conversation_id = $1',
        [conversationId],
      );

      const rechecked = await request(app.getHttpServer())
        .post(`/api/message-actions/${actionId}/recheck`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(rechecked.body.state).toBe('pending');

      const after = await dataSource.query(
        'SELECT count(*)::int AS c FROM messages WHERE conversation_id = $1',
        [conversationId],
      );
      expect(after[0].c).toBe(before[0].c + 1);

      // Переспросить может только отправитель.
      await request(app.getHttpServer())
        .post(`/api/message-actions/${actionId}/recheck`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(403);
    });

    it('«нет» можно передумать на «да», обратно — нет', async () => {
      const { actionId } = await makeAction(strangerId);

      await respond(actionId, 'disputed', strangerToken).expect(200);
      const confirmed = await respond(actionId, 'confirmed', strangerToken).expect(200);
      expect(confirmed.body.state).toBe('confirmed');

      const back = await respond(actionId, 'disputed', strangerToken).expect(200);
      expect(back.body.state).toBe('confirmed');
    });

    it('«мой косяк» удаляет действие вместе с сообщениями', async () => {
      const { actionId, conversationId } = await makeAction(strangerId);

      await respond(actionId, 'disputed', strangerToken).expect(200);

      // Отменить может только отправитель.
      await request(app.getHttpServer())
        .delete(`/api/message-actions/${actionId}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .delete(`/api/message-actions/${actionId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      const left = await dataSource.query(
        'SELECT count(*)::int AS c FROM messages WHERE action_id = $1',
        [actionId],
      );
      expect(left[0].c).toBe(0);

      // И подтвердить уже нечего: записи нет.
      await respond(actionId, 'confirmed', strangerToken).expect(404);

      // Диалог при этом жив, просто без этого сообщения.
      const dialog = await dataSource.query(
        'SELECT count(*)::int AS c FROM conversations WHERE id = $1',
        [conversationId],
      );
      expect(dialog[0].c).toBe(1);
    });

    it('без токена действия закрыты', async () => {
      await request(app.getHttpServer()).get('/api/message-actions/pending').expect(401);
    });
  });

  /**
   * Диалоги: список для конвертика, открытие личного, отметка прочитанного.
   *
   * Полноценного мессенджера нет — проверяем ровно то, что нужно: походный
   * чат виден участнику, личный диалог открывается один и тот же в обе
   * стороны, а отметка прочитанного обнуляет счётчик.
   */
  describe('диалоги', () => {
    it('походный чат попадает в список участника и не попадает отказавшемуся', async () => {
      const trip = await createTrip({ announcement: 'Диалоги e2e' });

      const asAuthor = await request(app.getHttpServer())
        .get('/api/conversations')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const kinds = (asAuthor.body.conversations as Array<{ kind: string }>).map(
        (item) => item.kind,
      );
      expect(kinds).toContain('trip_members');
      expect(kinds).toContain('trip_guest');

      // У постороннего в списке нет чужих приватных чатов.
      const asStranger = await request(app.getHttpServer())
        .get('/api/conversations')
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(200);
      const strangerPeers = (
        asStranger.body.conversations as Array<{ title: string }>
      ).map((item) => item.title);
      expect(strangerPeers.length).toBeGreaterThanOrEqual(0);
      expect(trip.status).toBe(201);
    });

    it('личный диалог открывается один и тот же в обе стороны', async () => {
      const first = await request(app.getHttpServer())
        .post('/api/conversations/direct')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ userId: strangerId })
        .expect(200);

      const second = await request(app.getHttpServer())
        .post('/api/conversations/direct')
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ userId })
        .expect(200);

      expect(second.body.id).toBe(first.body.id);
      expect(first.body.peer.displayName).toBeTruthy();
    });

    it('с собой диалог не открывается, а чужой читать нельзя', async () => {
      await request(app.getHttpServer())
        .post('/api/conversations/direct')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ userId })
        .expect(400);

      const own = await request(app.getHttpServer())
        .post('/api/conversations/direct')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ userId: strangerId })
        .expect(200);

      // Отметить прочитанным чужой личный диалог нельзя.
      await request(app.getHttpServer())
        .post(`/api/conversations/${own.body.id}/read`)
        .set('Authorization', `Bearer ${applicantToken}`)
        .expect(403);
    });

    it('непрочитанное считается и обнуляется отметкой', async () => {
      const own = await request(app.getHttpServer())
        .post('/api/conversations/direct')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ userId: strangerId })
        .expect(200);

      const conversationId = own.body.id as string;

      /** Строка диалога глазами постороннего: счётчик и моя метка прочтения. */
      const rowForStranger = async (): Promise<{
        unreadCount: number;
        myLastReadAt: string | null;
      } | null> => {
        const response = await request(app.getHttpServer())
          .get('/api/conversations')
          .set('Authorization', `Bearer ${strangerToken}`)
          .expect(200);

        return (
          (
            response.body.conversations as Array<{
              id: string;
              unreadCount: number;
              myLastReadAt: string | null;
            }>
          ).find((item) => item.id === conversationId) ?? null
        );
      };

      /** Непрочитанное в этом диалоге глазами постороннего. */
      const unreadForStranger = async (): Promise<number> =>
        (await rowForStranger())?.unreadCount ?? 0;

      // База в e2e общая, и в этом же диалоге могли остаться сообщения
      // прошлых тестов — поэтому сравниваем «до и после», а не с единицей.
      const beforeInsert = await unreadForStranger();

      await dataSource.query(
        `INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, 'привет')`,
        [conversationId, userId],
      );

      expect(await unreadForStranger()).toBe(beforeInsert + 1);

      await request(app.getHttpServer())
        .post(`/api/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(204);

      const afterRead = await rowForStranger();

      expect(afterRead?.unreadCount).toBe(0);
      /**
       * Граница прочтения приходит в диалоге, а не только счётчиком
       * (25.11.2026). По ней экран `/messages/:id` ставит разделитель
       * «Новые сообщения» **до** `POST /read`: после отметки первое
       * непрочитанное уже не вычислить.
       */
      expect(typeof afterRead?.myLastReadAt).toBe('string');
      expect(Date.parse(afterRead?.myLastReadAt ?? '')).toBeGreaterThan(
        Date.now() - 60_000,
      );
    });

    /**
     * Контракт ленты: действие диалога выбирает сервер (24.11.2026).
     *
     * Просьба о платеже пришла последней, но перевод ещё ждёт ответа —
     * значит, лента обязана показывать перевод, а не просьбу. После
     * подтверждения перевода вперёд выходит просьба. `lastMessage.action`
     * при этом остаётся действием последнего сообщения: старые проверки
     * не ломаются.
     */
    it('действие диалога: перевод важнее просьбы о платеже', async () => {
      const stamp = Date.now();
      const payer = await login(`trips-e2e-action-payer-${stamp}@example.com`);
      const recipient = await login(`trips-e2e-action-recipient-${stamp}@example.com`);

      const conversationId = (
        await dataSource.query(
          `INSERT INTO conversations (kind, direct_a, direct_b)
           VALUES ('direct', LEAST($1::uuid, $2::uuid), GREATEST($1::uuid, $2::uuid))
           RETURNING id`,
          [payer.id, recipient.id],
        )
      )[0].id as string;

      // Состав диалога: список ленты для личных строится по нему.
      await dataSource.query(
        `INSERT INTO conversation_members (conversation_id, user_id)
         VALUES ($1, $2), ($1, $3)`,
        [conversationId, payer.id, recipient.id],
      );

      const transferId = (
        await dataSource.query(
          `INSERT INTO message_actions (kind, target_user_id, payload, state)
           VALUES ('money_received', $1, $2::jsonb, 'pending') RETURNING id`,
          [recipient.id, JSON.stringify({ amountRub: 1000 })],
        )
      )[0].id as string;

      const requestId = (
        await dataSource.query(
          `INSERT INTO message_actions (kind, target_user_id, payload, state)
           VALUES ('payment_request', $1, $2::jsonb, 'pending') RETURNING id`,
          [recipient.id, JSON.stringify({ tripId: '193', tripTitle: 'Хамар-Дабан' })],
        )
      )[0].id as string;

      await dataSource.query(
        `INSERT INTO messages (conversation_id, sender_id, body, action_id) VALUES
           ($1, $2, 'Перевёл тебе 1000 ₽', $3),
           ($1, $2, 'Организатор запросил платёж по походу «Хамар-Дабан».', $4)`,
        [conversationId, payer.id, transferId, requestId],
      );

      const rowOf = async () => {
        const response = await request(app.getHttpServer())
          .get('/api/conversations')
          .set('Authorization', `Bearer ${recipient.token}`)
          .expect(200);

        return (
          response.body.conversations as Array<{
            id: string;
            action: { kind: string } | null;
            lastMessage: { action: { kind: string } | null } | null;
          }>
        ).find((item) => item.id === conversationId);
      };

      const before = await rowOf();
      // Перевод ждёт ответа — он и есть действие диалога.
      expect(before?.action?.kind).toBe('money_received');
      // Поле последнего сообщения не подменено: там просьба, как и было.
      expect(before?.lastMessage?.action?.kind).toBe('payment_request');

      await request(app.getHttpServer())
        .post(`/api/message-actions/${transferId}/respond`)
        .set('Authorization', `Bearer ${recipient.token}`)
        .send({ result: 'confirmed' })
        .expect(200);

      const after = await rowOf();
      // Перевод разрешён — вперёд выходит просьба о платеже.
      expect(after?.action?.kind).toBe('payment_request');
    });

    /**
     * Правка и удаление своего сообщения (25.11.2026, §10 п.9).
     *
     * Права — на сервере: чужое, системное и денежное не правится (403),
     * несуществующее — 404. Удаление физическое, поэтому непрочитанное
     * у собеседника уменьшается само, а в поток событий уходят
     * `message_updated` (с `actorId` автора) и `message_deleted`.
     */
    it('своё сообщение правится и удаляется, чужое и системное — нет', async () => {
      const own = await request(app.getHttpServer())
        .post('/api/conversations/direct')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ userId: strangerId })
        .expect(200);

      const conversationId = own.body.id as string;

      const sent = await request(app.getHttpServer())
        .post(`/api/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ body: '  черновик  ' })
        .expect(201);

      const messageId = sent.body.id as string;
      const createdAt = sent.body.createdAt as string;

      // Только что отправленное — ещё не правили.
      expect(sent.body.editedAt).toBeNull();

      const events = app.get(ConversationEventsService);
      const received: Array<{
        kind: string;
        actorId: string;
        messageId?: string;
        body?: string;
        editedAt?: string | null;
      }> = [];
      const subscription = events
        .stream(strangerId)
        .subscribe((event) => received.push(event));

      const systemId = String(
        (
          await dataSource.query(
            `INSERT INTO messages (conversation_id, sender_id, body)
             VALUES ($1, NULL, 'системная строка') RETURNING id`,
            [conversationId],
          )
        )[0].id,
      );

      const actionId = (
        await dataSource.query(
          `INSERT INTO message_actions (kind, target_user_id, payload, state)
           VALUES ('money_received', $1, $2::jsonb, 'pending') RETURNING id`,
          [strangerId, JSON.stringify({ amountRub: 10 })],
        )
      )[0].id as string;

      const moneyMessageId = String(
        (
          await dataSource.query(
            `INSERT INTO messages (conversation_id, sender_id, body, action_id)
             VALUES ($1, $2, 'перевод', $3) RETURNING id`,
            [conversationId, userId, actionId],
          )
        )[0].id,
      );

      try {
        const edited = await request(app.getHttpServer())
          .patch(`/api/conversations/${conversationId}/messages/${messageId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ body: '  исправлено  ' })
          .expect(200);

        expect(edited.body.body).toBe('исправлено');
        expect(edited.body.senderId).toBe(userId);
        // Правка ставит время, но не переставляет сообщение: `createdAt`
        // остаётся прежним, порядок в переписке — по `id`.
        expect(edited.body.createdAt).toBe(createdAt);
        expect(edited.body.editedAt).toEqual(expect.any(String));
        expect(
          new Date(edited.body.editedAt as string).getTime(),
        ).toBeGreaterThanOrEqual(new Date(createdAt).getTime());

        await vi.waitFor(() =>
          expect(
            received.some(
              (event) =>
                event.kind === 'message_updated' &&
                event.actorId === userId &&
                event.messageId === messageId &&
                event.body === 'исправлено' &&
                // Время правки едет в кадре: клиенту не нужен второй
                // запрос, чтобы нарисовать «изменено».
                event.editedAt === edited.body.editedAt,
            ),
          ).toBe(true),
        );

        // Чужое править нельзя; несуществующее — 404; пустое — 400.
        await request(app.getHttpServer())
          .patch(`/api/conversations/${conversationId}/messages/${messageId}`)
          .set('Authorization', `Bearer ${strangerToken}`)
          .send({ body: 'моё теперь' })
          .expect(403);

        await request(app.getHttpServer())
          .patch(`/api/conversations/${conversationId}/messages/999999999`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ body: 'нет такого' })
          .expect(404);

        await request(app.getHttpServer())
          .patch(`/api/conversations/${conversationId}/messages/${messageId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ body: '   ' })
          .expect(400);

        // Системное — история событий, у него нет автора.
        await request(app.getHttpServer())
          .patch(`/api/conversations/${conversationId}/messages/${systemId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ body: 'теперь моя' })
          .expect(403);

        await request(app.getHttpServer())
          .delete(`/api/conversations/${conversationId}/messages/${systemId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(403);

        // Денежное сообщение — условия перевода, а не реплика человека.
        await request(app.getHttpServer())
          .patch(`/api/conversations/${conversationId}/messages/${moneyMessageId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ body: 'перевод отменён' })
          .expect(403);

        await request(app.getHttpServer())
          .delete(`/api/conversations/${conversationId}/messages/${moneyMessageId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(403);

        const unreadOf = async (token: string): Promise<number> => {
          const response = await request(app.getHttpServer())
            .get('/api/conversations')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

          return (
            (
              response.body.conversations as Array<{
                id: string;
                unreadCount: number;
              }>
            ).find((item) => item.id === conversationId)?.unreadCount ?? 0
          );
        };

        const unreadBefore = await unreadOf(strangerToken);

        await request(app.getHttpServer())
          .delete(`/api/conversations/${conversationId}/messages/${messageId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(204);

        await vi.waitFor(() =>
          expect(
            received.some(
              (event) =>
                event.kind === 'message_deleted' &&
                event.actorId === userId &&
                event.messageId === messageId,
            ),
          ).toBe(true),
        );

        const page = await request(app.getHttpServer())
          .get(`/api/conversations/${conversationId}/messages`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        expect(
          (page.body.messages as Array<{ id: string }>).map(
            (message) => message.id,
          ),
        ).not.toContain(messageId);

        // Удалённой строки нет — непрочитанное у собеседника стало меньше.
        expect(await unreadOf(strangerToken)).toBe(unreadBefore - 1);

        // Повторное удаление — 404, а не тихий успех.
        await request(app.getHttpServer())
          .delete(`/api/conversations/${conversationId}/messages/${messageId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(404);
      } finally {
        subscription.unsubscribe();
        await dataSource
          .query(`DELETE FROM messages WHERE id = ANY($1::bigint[])`, [
            [systemId, moneyMessageId],
          ])
          .catch(() => undefined);
        await dataSource
          .query(`DELETE FROM message_actions WHERE id = $1`, [actionId])
          .catch(() => undefined);
      }
    });

    /**
     * Удаление последнего сообщения (25.11.2026, §10 п.9).
     *
     * После физического удаления `lastMessage` диалога — это предыдущее
     * сообщение, а не пустота: список и экран читают его одним запросом.
     * «Прочитано» живёт на диалоге (`peerLastReadAt`) и удалением не
     * двигается, а непрочитанное у собеседника пересчитывается по
     * оставшимся строкам. Удалили оба своих — диалог пуст.
     */
    it('удаление последнего сообщения отдаёт предыдущее и не трогает «Прочитано»', async () => {
      // Свежая пара: у неё нет истории от прошлых проверок, поэтому
      // «последнее» и «пусто» здесь означают ровно то, что проверяем.
      const own = await request(app.getHttpServer())
        .post('/api/conversations/direct')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ userId: coorgId })
        .expect(200);

      const conversationId = own.body.id as string;

      // Собеседник прочитал диалог до сообщений: у автора есть «Прочитано»,
      // и удаление не должно его сдвинуть.
      await request(app.getHttpServer())
        .post(`/api/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${coorgToken}`)
        .expect(204);

      const send = (body: string) =>
        request(app.getHttpServer())
          .post(`/api/conversations/${conversationId}/messages`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ body })
          .expect(201);

      const first = await send('первое');
      const second = await send('второе');

      const before = await request(app.getHttpServer())
        .get(`/api/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(before.body.lastMessage.id).toBe(second.body.id);
      expect(before.body.peerLastReadAt).toEqual(expect.any(String));

      const peerReadAt = before.body.peerLastReadAt as string;

      await request(app.getHttpServer())
        .delete(
          `/api/conversations/${conversationId}/messages/${second.body.id}`,
        )
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      const after = await request(app.getHttpServer())
        .get(`/api/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(after.body.lastMessage.id).toBe(first.body.id);
      expect(after.body.lastMessage.body).toBe('первое');
      expect(after.body.peerLastReadAt).toBe(peerReadAt);

      const peerList = await request(app.getHttpServer())
        .get('/api/conversations')
        .set('Authorization', `Bearer ${coorgToken}`)
        .expect(200);

      const row = (
        peerList.body.conversations as Array<{
          id: string;
          unreadCount: number;
          lastMessage: { id: string } | null;
        }>
      ).find((item) => item.id === conversationId);

      // Из двух непрочитанных осталось одно — удалённой строки нет.
      expect(row?.unreadCount).toBe(1);
      expect(row?.lastMessage?.id).toBe(first.body.id);

      await request(app.getHttpServer())
        .delete(
          `/api/conversations/${conversationId}/messages/${first.body.id}`,
        )
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      const empty = await request(app.getHttpServer())
        .get(`/api/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(empty.body.lastMessage).toBeNull();
      expect(empty.body.peerLastReadAt).toBe(peerReadAt);
    });

    it('без токена диалоги закрыты', async () => {
      await request(app.getHttpServer()).get('/api/conversations').expect(401);
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

    it('организатор видит все чаты похода, посторонний в публичном — только гостевой', async () => {
      const created = await createTrip({ announcement: 'Чаты похода' });
      const tripId = created.body.id as string;

      const mine = await request(app.getHttpServer())
        .get(`/api/trips/${tripId}/chats`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(mine.body.chats.map((c: { kind: string }) => c.kind)).toEqual([
        'trip_guest',
        'trip_members',
        'trip_meals',
        'trip_transfer',
        'trip_route',
        'trip_gear',
        'trip_first_aid',
        'trip_finance',
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

    it('чат табора: участник пишет, посторонний — 403', async () => {
      const created = await createTrip({ announcement: 'Табор' });
      const tripId = created.body.id as string;

      // Вкладка «Ночёвки» (код `route`) с 29.10.2026 разговаривает в своём
      // чате: он заводится вместе с походом и закрыт для посторонних, как
      // чаты питания и трансфера.
      await send(
        tripId,
        accessToken,
        'trip_route',
        'Ставим лагерь у реки',
      ).expect(201);

      await send(tripId, strangerToken, 'trip_route', 'А можно я?').expect(403);

      const page = await read(tripId, accessToken, 'kind=trip_route');
      expect(page.messages.map((message) => message.body)).toContain(
        'Ставим лагерь у реки',
      );
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

    it('приглашённый получает все чаты состава, ещё не ответив', async () => {
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
      // Восемь чатов: гостевой, членский, питания, трансфера, ночёвок,
      // снаряжения, аптечки и бухгалтерии.
      expect(chats.body.chats).toHaveLength(8);

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

    /**
     * Гость публичного похода (25.11.2026, §10 п.9).
     *
     * Он пишет в гостевой чат без строки состава, поэтому ручка
     * `/conversations/:id/messages/:messageId` ответила бы ему 403 —
     * правит и удаляет он через `/trips/:id/messages/:messageId`.
     * Чужое не трогается даже организатором.
     */
    it('гость правит и удаляет своё сообщение в гостевом чате, чужое — нет', async () => {
      const created = await createTrip({ announcement: 'Правка гостевого чата' });
      const tripId = created.body.id as string;

      const sent = await send(
        tripId,
        strangerToken,
        'trip_guest',
        '  ошипка  ',
      ).expect(201);
      const messageId = sent.body.id as string;
      const createdAt = sent.body.createdAt as string;

      expect(sent.body.editedAt).toBeNull();

      const guestChatId = (
        await request(app.getHttpServer())
          .get(`/api/trips/${tripId}/chats`)
          .set('Authorization', `Bearer ${strangerToken}`)
          .expect(200)
      ).body.chats.find(
        (chat: { kind: string }) => chat.kind === 'trip_guest',
      ).id as string;

      // Через ручку диалогов гостю нельзя: строки состава у него нет.
      await request(app.getHttpServer())
        .patch(`/api/conversations/${guestChatId}/messages/${messageId}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ body: 'исправлено' })
        .expect(403);

      const events = app.get(ConversationEventsService);
      const received: Array<{
        kind: string;
        actorId: string;
        messageId?: string;
        body?: string;
        editedAt?: string | null;
      }> = [];
      const subscription = events
        .stream(userId)
        .subscribe((event) => received.push(event));

      try {
        const edited = await request(app.getHttpServer())
          .patch(`/api/trips/${tripId}/messages/${messageId}`)
          .set('Authorization', `Bearer ${strangerToken}`)
          .send({ kind: 'trip_guest', body: '  исправлено  ' })
          .expect(200);

        expect(edited.body.body).toBe('исправлено');
        expect(edited.body.senderId).toBe(strangerId);
        expect(edited.body.createdAt).toBe(createdAt);
        expect(edited.body.editedAt).toEqual(expect.any(String));

        // Организатор видит правку гостя событием — без перезагрузки.
        await vi.waitFor(() =>
          expect(
            received.some(
              (event) =>
                event.kind === 'message_updated' &&
                event.actorId === strangerId &&
                event.messageId === messageId &&
                event.editedAt === edited.body.editedAt,
            ),
          ).toBe(true),
        );

        // Чужое сообщение не правит даже организатор.
        await request(app.getHttpServer())
          .patch(`/api/trips/${tripId}/messages/${messageId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ kind: 'trip_guest', body: 'чужое' })
          .expect(403);

        await request(app.getHttpServer())
          .delete(`/api/trips/${tripId}/messages/${messageId}?kind=trip_guest`)
          .set('Authorization', `Bearer ${strangerToken}`)
          .expect(204);

        const guest = await read(tripId, strangerToken, 'kind=trip_guest');

        expect(guest.messages.map((message) => message.body)).not.toContain(
          'исправлено',
        );

        // Удалённое было последним в чате — `lastMessage` стал пустым,
        // а не остался висеть ссылкой на несуществующую строку.
        const chats = await request(app.getHttpServer())
          .get(`/api/trips/${tripId}/chats`)
          .set('Authorization', `Bearer ${strangerToken}`)
          .expect(200);

        const guestChat = (
          chats.body.chats as Array<{
            kind: string;
            lastMessage: { id: string } | null;
          }>
        ).find((chat) => chat.kind === 'trip_guest');

        expect(guestChat?.lastMessage).toBeNull();

        // Повтор — 404; вид чата без доступа — 403.
        await request(app.getHttpServer())
          .delete(`/api/trips/${tripId}/messages/${messageId}?kind=trip_guest`)
          .set('Authorization', `Bearer ${strangerToken}`)
          .expect(404);

        await request(app.getHttpServer())
          .delete(`/api/trips/${tripId}/messages/${messageId}?kind=trip_members`)
          .set('Authorization', `Bearer ${strangerToken}`)
          .expect(403);
      } finally {
        subscription.unsubscribe();
      }
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

  /**
   * Правила после старта (20.11.2026).
   *
   * Заказчик: «набор закрывается на старте, но организатор и соорганизатор
   * могут добавить человека и после; сам человек после старта в `going`
   * не переводится; оба случая сразу ставят „на маршруте“; заявки
   * автоматически не удаляются». Даты считаются от «сейчас», а не от
   * фиксированного года: проверяется именно граница старта.
   */
  describe('правила после старта', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const aliveTrip = () => ({
      status: 'decided',
      startsAt: new Date(Date.now() - DAY).toISOString(),
      endsAt: new Date(Date.now() + 3 * DAY).toISOString(),
    });

    /** Участник из состава со всеми полями присутствия. */
    const participantOf = async (tripId: string, personId: string) => {
      const response = await request(app.getHttpServer())
        .get(`/api/trips/${tripId}/participants`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      return (
        response.body.participants as Array<{
          userId: string;
          status: string;
          presenceStatus: string;
          presenceUpdatedByUserId: string | null;
          presenceSource: string | null;
        }>
      ).find((item) => item.userId === personId);
    };

    it('набор закрыт стартом: заявка 409, приглашение участнику 403, организатор добавляет', async () => {
      const created = await createTrip({
        announcement: 'Набор закрыт стартом',
        ...aliveTrip(),
      });
      const tripId = created.body.id as string;

      // Посторонний «Хочу с вами» после старта уже не может.
      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ direction: 'apply' })
        .expect(409);

      // Организатор приглашает — это его дверь.
      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ direction: 'invite', userId: applicantId })
        .expect(201);

      // Приглашённый отвечает «иду»: он уже в поле, отметка — от того,
      // кто позвал, а не от него самого.
      const accepted = await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests/${applicantId}/accept`)
        .set('Authorization', `Bearer ${applicantToken}`)
        .send({ status: 'going' })
        .expect(200);

      expect(accepted.body.status).toBe('going');
      expect(accepted.body.presenceStatus).toBe('route');
      expect(accepted.body.presenceUpdatedByUserId).toBe(userId);
      expect(accepted.body.presenceSource).toBe('other');

      // Идущий участник после старта своих людей уже не приводит.
      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${applicantToken}`)
        .send({ direction: 'invite', userId: strangerId })
        .expect(403);

      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/participants/virtual`)
        .set('Authorization', `Bearer ${applicantToken}`)
        .send({ displayName: 'Дядя Витя' })
        .expect(403);

      // Организатор заводит человека без аккаунта — тоже сразу на маршруте.
      const virtual = await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/participants/virtual`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ displayName: 'Дядя Витя' })
        .expect(201);

      expect(virtual.body.status).toBe('going');
      expect(virtual.body.presenceStatus).toBe('route');
      expect(virtual.body.presenceUpdatedByUserId).toBe(userId);
      expect(virtual.body.presenceSource).toBe('other');
    });

    it('сам человек после старта в «иду» не переводится, организатор — может', async () => {
      const created = await createTrip({
        announcement: 'Перевод в иду после старта',
        ...aliveTrip(),
      });
      const tripId = created.body.id as string;

      // Приглашённый отвечает «пока не решил» — это его право.
      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ direction: 'invite', userId: strangerId })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests/${strangerId}/accept`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ status: 'maybe' })
        .expect(200);

      // Сам — не может: дверь закрыта на сервере, а не кнопкой.
      await request(app.getHttpServer())
        .patch(`/api/trips/${tripId}/participants/me`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ status: 'going' })
        .expect(409);

      // И чужой идущий участник тоже не может: перевод — дело организатора.
      await request(app.getHttpServer())
        .patch(`/api/trips/${tripId}/participants/${strangerId}/status`)
        .set('Authorization', `Bearer ${applicantToken}`)
        .send({ status: 'going' })
        .expect(403);

      // Организатор переводит — и человек сразу «на маршруте».
      const moved = await request(app.getHttpServer())
        .patch(`/api/trips/${tripId}/participants/${strangerId}/status`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ status: 'going' })
        .expect(200);

      expect(moved.body.status).toBe('going');
      expect(moved.body.presenceStatus).toBe('route');
      expect(moved.body.presenceUpdatedByUserId).toBe(userId);
      expect(moved.body.presenceSource).toBe('other');

      const saved = await participantOf(tripId, strangerId);
      expect(saved?.presenceStatus).toBe('route');

      // Повтор — 409, «не иду» этой ручкой не ставится.
      await request(app.getHttpServer())
        .patch(`/api/trips/${tripId}/participants/${strangerId}/status`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ status: 'going' })
        .expect(409);

      await request(app.getHttpServer())
        .patch(`/api/trips/${tripId}/participants/${strangerId}/status`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ status: 'declined' })
        .expect(400);

      // Поздний отказ человек по-прежнему ставит себе сам.
      await request(app.getHttpServer())
        .patch(`/api/trips/${tripId}/participants/me`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ status: 'declined' })
        .expect(200);
    });

    it('заявка остаётся после окончания похода, но подтвердить её нельзя', async () => {
      // Заявку подают до старта: так она и висит, пока организатор
      // не разберётся, — ровно случай из решения 20.11.2026.
      const created = await createTrip({
        announcement: 'Заявка через весь поход',
        status: 'decided',
        startsAt: new Date(Date.now() + DAY).toISOString(),
        endsAt: new Date(Date.now() + 3 * DAY).toISOString(),
      });
      const tripId = created.body.id as string;

      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({ direction: 'apply' })
        .expect(201);

      // Поход прошёл, заявку так и не разобрали.
      await request(app.getHttpServer())
        .patch(`/api/trips/${tripId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          startsAt: new Date(Date.now() - 5 * DAY).toISOString(),
          endsAt: new Date(Date.now() - DAY).toISOString(),
        })
        .expect(200);

      const tickets = await request(app.getHttpServer())
        .get(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(
        (tickets.body.requests as Array<{ userId: string }>).map(
          (item) => item.userId,
        ),
      ).toContain(strangerId);

      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests/${strangerId}/accept`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ status: 'going' })
        .expect(409);

      // Онлайн-правки после старта открыты: поход живёт, пока не завершён.
      await request(app.getHttpServer())
        .patch(`/api/trips/${tripId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ hasGuitar: true })
        .expect(200);
    });
  });

  /**
   * Завершение похода (20.11.2026).
   *
   * Заказчик: «Поход заканчивается решением автора, а не по дате». Условия:
   * `ends_at` прошёл, все идущие отметили «вернулся», спрашивают и завершают
   * только автора. После этого закрыто всё, кроме «Дневника»
   * и «Бухгалтерии»; присутствие по-прежнему отмечается.
   */
  describe('завершение похода', () => {
    const DAY = 24 * 60 * 60 * 1000;

    /** Поход, который по датам уже закончился: остаётся перекличка. */
    const finishedTrip = () => ({
      status: 'decided',
      startsAt: new Date(Date.now() - 5 * DAY).toISOString(),
      endsAt: new Date(Date.now() - DAY).toISOString(),
    });

    const readTrip = async (tripId: string, token: string) =>
      request(app.getHttpServer())
        .get(`/api/trips/${tripId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

    const markPresence = (tripId: string, status: string) =>
      request(app.getHttpServer())
        .put(`/api/trips/${tripId}/presence/${userId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ status })
        .expect(200);

    it('вопрос «поход состоялся?» — только автору и только когда все вернулись', async () => {
      const created = await createTrip({
        announcement: 'Пора завершать',
        ...finishedTrip(),
      });
      const tripId = created.body.id as string;

      // Конец прошёл, но я ещё на маршруте: завершать рано.
      await markPresence(tripId, 'route');
      expect((await readTrip(tripId, accessToken)).body.canComplete).toBe(false);

      // Вернулся — условия выполнены.
      await markPresence(tripId, 'returned');
      expect((await readTrip(tripId, accessToken)).body.canComplete).toBe(true);

      // Флаг личный: посторонний видит поход, но не вопрос.
      expect((await readTrip(tripId, strangerToken)).body.canComplete).toBe(false);
    });

    it('«Да» закрывает поход: правки 409, вкладки — только дневник и деньги', async () => {
      const created = await createTrip({
        announcement: 'Закрываем поход',
        ...finishedTrip(),
      });
      const tripId = created.body.id as string;

      // Пока никто не отметил возвращение, завершить нельзя.
      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/complete`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(409);

      // Чужому завершать нечего: поход его не.
      await markPresence(tripId, 'returned');
      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/complete`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(403);

      const completed = await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/complete`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(completed.body.completedAt).not.toBeNull();

      // Завершение необратимо и повторять его нечего.
      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/complete`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(409);

      // Закрыто навсегда: и шапка, и состав.
      await request(app.getHttpServer())
        .patch(`/api/trips/${tripId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ hasGuitar: true })
        .expect(409);
      await request(app.getHttpServer())
        .patch(`/api/trips/${tripId}/participants/me`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ status: 'declined' })
        .expect(409);

      // Вкладки видны все, править можно только две.
      const tabs = await request(app.getHttpServer())
        .get(`/api/trips/${tripId}/tabs`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const editable = (
        tabs.body.tabs as Array<{ code: string; canEdit: boolean }>
      )
        .filter((tab) => tab.canEdit)
        .map((tab) => tab.code)
        .sort();
      expect(editable).toEqual(['diary', 'finance']);

      // Присутствие — можно: перекличка не содержимое.
      await markPresence(tripId, 'route');
      await markPresence(tripId, 'returned');

      // Бухгалтерия принимает новые чеки: расчёты ещё идут.
      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/finance/expenses`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ amountRub: 350, description: 'Заправились на обратном пути', split: 'all' })
        .expect(201);
    });
  });

  /**
   * Соорганизатор (20.11.2026).
   *
   * Заказчик: «соорганизатор равен организатору во всём, отличий ровно
   * пять» ([lifecycle.md](../docs/ph/lifecycle.md) §4.5). Здесь проверяется
   * каждая сторона равенства и каждое отличие, которое живёт на сервере:
   * вкладки (правило кода, а не матрицы), правка шапки и дат, набор
   * и тикеты, роли, запрет снимать полномочия, свой выход и `helping`,
   * запрет виртуальных. Удаления похода в API нет вовсе, поэтому «не может
   * удалить поход» проверяется там, где решение автора: завершение.
   */
  describe('соорганизатор', () => {
    /**
     * Поход «решён» и с датами: без конкретного числа вкладок всего две
     * (`tabs.md` §7), и проверять права на десять было бы не на чем.
     */
    const fullTrip = () => {
      const day = 24 * 60 * 60 * 1000;
      return {
        status: 'decided',
        startsAt: new Date(Date.now() + 5 * day).toISOString(),
        endsAt: new Date(Date.now() + 9 * day).toISOString(),
      };
    };

    const tabsOf = async (tripId: string, token: string) => {
      const response = await request(app.getHttpServer())
        .get(`/api/trips/${tripId}/tabs`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      return (response.body.tabs as Array<{ code: string; canEdit: boolean }>)
        .filter((tab) => tab.canEdit)
        .map((tab) => tab.code)
        .sort();
    };

    const setRoles = (
      tripId: string,
      targetId: string,
      roleCodes: string[],
      token = accessToken,
    ) =>
      request(app.getHttpServer())
        .put(`/api/trips/${tripId}/participants/${targetId}/roles`)
        .set('Authorization', `Bearer ${token}`)
        .send({ roleCodes });

    /** Ввести человека в состав походом автора и назначить ему роль. */
    const addWithRole = async (
      tripId: string,
      targetId: string,
      targetToken: string,
      roleCodes: string[],
    ) => {
      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ direction: 'invite', userId: targetId })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests/${targetId}/accept`)
        .set('Authorization', `Bearer ${targetToken}`)
        .send({ status: 'going' })
        .expect(200);

      return setRoles(tripId, targetId, roleCodes).expect(200);
    };

    it('правит поход и все вкладки — права в коде, а не в матрице ролей', async () => {
      const created = await createTrip({
        announcement: 'Поход с соорганизатором',
        ...fullTrip(),
      });
      const tripId = created.body.id as string;
      await addWithRole(tripId, coorgId, coorgToken, [COORGANIZER_ROLE_CODE]);

      // Правка шапки и дат — наравне с автором.
      await request(app.getHttpServer())
        .patch(`/api/trips/${tripId}`)
        .set('Authorization', `Bearer ${coorgToken}`)
        .send({ announcement: 'Правит соорганизатор', hasGuitar: true })
        .expect(200);

      // Все вкладки правимы: матрицу `role_tab_permissions` тест не заливал,
      // значит права дал код (`tabsByRole`). «Выпуска» в списке нет —
      // он есть только у официального похода (`OFFICIAL_ONLY_TAB`).
      expect(await tabsOf(tripId, coorgToken)).toEqual([
        'diary',
        'finance',
        'firstAid',
        'gear',
        'guest',
        'meals',
        'members',
        'route',
        'transfer',
      ]);

      // А это отличие: завершение похода — решение автора, не его.
      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/complete`)
        .set('Authorization', `Bearer ${coorgToken}`)
        .expect(403);
    });

    it('набирает людей и закрывает тикеты, но не снимает полномочия', async () => {
      const created = await createTrip({
        announcement: 'Набор через соорганизатора',
        ...fullTrip(),
      });
      const tripId = created.body.id as string;
      await addWithRole(tripId, coorgId, coorgToken, [COORGANIZER_ROLE_CODE]);

      // Приглашение — не отличие соорганизатора.
      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/requests`)
        .set('Authorization', `Bearer ${coorgToken}`)
        .send({ direction: 'invite', userId: applicantId })
        .expect(201);

      // И отозвать приглашение он может.
      await request(app.getHttpServer())
        .delete(`/api/trips/${tripId}/requests/${applicantId}`)
        .set('Authorization', `Bearer ${coorgToken}`)
        .expect(204);

      // Назначать других соорганизаторов — может.
      await addWithRole(tripId, strangerId, strangerToken, [COORGANIZER_ROLE_CODE]);

      // А снимать — нет: ни с себя, ни с другого.
      await setRoles(tripId, coorgId, [], coorgToken).expect(403);
      await setRoles(tripId, strangerId, [], coorgToken).expect(403);

      // Убрать другого соорганизатора из состава — то же снятие полномочий.
      await request(app.getHttpServer())
        .delete(`/api/trips/${tripId}/participants/${strangerId}`)
        .set('Authorization', `Bearer ${coorgToken}`)
        .expect(403);

      // Организатор полномочия снимает, и права уходят вместе с ролью.
      await setRoles(tripId, coorgId, []).expect(200);
      expect(await tabsOf(tripId, coorgToken)).toEqual([]);
    });

    it('может быть helping и выйти сам, но после выхода прав не имеет', async () => {
      const created = await createTrip({
        announcement: 'Помогаю, но не иду',
        ...fullTrip(),
      });
      const tripId = created.body.id as string;
      await addWithRole(tripId, coorgId, coorgToken, [COORGANIZER_ROLE_CODE]);

      const helping = await request(app.getHttpServer())
        .patch(`/api/trips/${tripId}/participants/me`)
        .set('Authorization', `Bearer ${coorgToken}`)
        .send({ status: 'helping' })
        .expect(200);

      expect(helping.body.status).toBe('helping');

      // Роль не зависит от того, идёт ли он сам: правит он по-прежнему всё
      // (девять вкладок — «Выпуска» у обычного похода нет).
      expect(await tabsOf(tripId, coorgToken)).toHaveLength(9);

      // Свой выход разрешён — это одно из пяти отличий.
      await request(app.getHttpServer())
        .patch(`/api/trips/${tripId}/participants/me`)
        .set('Authorization', `Bearer ${coorgToken}`)
        .send({ status: 'declined' })
        .expect(200);

      // А вышедший не правит ничего — как и любой другой: роль за ним
      // осталась, вернут в состав — права вернутся.
      expect(await tabsOf(tripId, coorgToken)).toEqual([]);
    });

    it('виртуальным соорганизатором не бывает', async () => {
      const created = await createTrip({ announcement: 'Виртуальный не второй автор' });
      const tripId = created.body.id as string;

      const virtual = await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/participants/virtual`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ displayName: 'Дядя Витя' })
        .expect(201);

      const denied = await setRoles(
        tripId,
        virtual.body.userId as string,
        [COORGANIZER_ROLE_CODE],
      ).expect(400);

      expect(denied.body.message).toContain('только человек с аккаунтом');
    });
  });
});
