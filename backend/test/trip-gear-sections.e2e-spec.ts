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
 * Разделы «Берём» и «Взял» вкладки «Снаряжение» (e2e) — 05.11.2026.
 *
 * Заказчик: «в секциях „Берём“ и „Взял“ … возможность создавать
 * (редактировать и удалять) разделы, типа „Альпинизм“, „Пешка“, а какие-то
 * даже шаблонами встают, например, „Табор“, если есть ночёвки и/или
 * Готовка». Проверяем ровно это:
 *
 * 1. **Шаблоны** — «Табор» при стоянке/готовке, «к Велосипедам» по типу
 *    похода, личные «Снаряга»/«Одежда»; удалённый шаблон не возвращается.
 * 2. **Права** — общественные разделы правит вкладка «Снаряжение», личные
 *    только владелец (чужой раздел — 404, а не «виден без кнопок»).
 * 3. **Вложенность** — подраздел и запрет вложить раздел в себя.
 * 4. **Удаление не теряет вещи** — вещь высыпается в корень, дочерние
 *    разделы уходят каскадом вместе со своими вещами.
 * 5. **Перенос вещи** — общественный раздел по праву вкладки, личный —
 *    только тому, кому вещь назначена; смена несущего обнуляет личный
 *    раздел.
 *
 * Поход и состав заводятся напрямую в базе, роль «завхоза» — своя, чтобы
 * не зависеть от сида: правило прав проверяется тем же путём, что у
 * `trip-gear.e2e-spec.ts`.
 */
describe('Разделы снаряжения похода (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  let organizerId: string;
  let organizerToken: string;
  let quartermasterId: string;
  let quartermasterToken: string;
  let memberId: string;
  let memberToken: string;
  let strangerId: string;
  let strangerToken: string;

  let objectId: string;
  let tripId: string;

  let tentId: string;
  let potId: string;

  /** Строка `trip_gear` палатки — через неё проверяются разделы. */
  let tentGearId: string;

  let tentTypeId: number;
  let plainTypeId: number;

  const gearRoleCode = `gearSectionsE2e${Date.now()}`;
  let lastCode: string | null = null;

  const organizerEmail = `trip-gear-sections-org-${Date.now()}@example.com`;
  const quartermasterEmail = `trip-gear-sections-qm-${Date.now()}@example.com`;
  const memberEmail = `trip-gear-sections-member-${Date.now()}@example.com`;
  const strangerEmail = `trip-gear-sections-stranger-${Date.now()}@example.com`;

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

  async function addGear(
    token: string,
    body: Record<string, unknown>,
  ): Promise<string> {
    const response = await call('post', '/api/gear', token, body).expect(201);

    return response.body.id as string;
  }

  /** Ответ `GET /gear` — вещи и разделы смотрящего. */
  async function list(token: string): Promise<{
    items: Array<{
      id: string;
      sharedSectionId: string | null;
      personalSectionId: string | null;
      assignedUserId: string | null;
    }>;
    sections: Array<{
      id: string;
      scope: string;
      ownerUserId: string | null;
      parentId: string | null;
      title: string;
    }>;
  }> {
    const response = await call('get', `/api/trips/${tripId}/gear`, token).expect(200);

    return response.body;
  }

  function sectionByTitle(
    data: Awaited<ReturnType<typeof list>>,
    title: string,
    scope = 'shared',
  ) {
    return data.sections.find((section) => section.title === title && section.scope === scope);
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

    tentTypeId = await makeType('e2e_section_tent', 'Проверочная палатка');
    plainTypeId = await makeType('e2e_section_plain', 'Проверочный ящик');

    const emailCodeService = moduleFixture.get(EmailCodeService);
    const realCreateCode = emailCodeService.createCode.bind(emailCodeService);
    vi.spyOn(emailCodeService, 'createCode').mockImplementation((mail) => {
      lastCode = realCreateCode(mail);
      return lastCode;
    });

    const organizer = await login(organizerEmail);
    organizerToken = organizer.token;
    organizerId = organizer.id;

    const quartermaster = await login(quartermasterEmail);
    quartermasterToken = quartermaster.token;
    quartermasterId = quartermaster.id;

    const member = await login(memberEmail);
    memberToken = member.token;
    memberId = member.id;

    const stranger = await login(strangerEmail);
    strangerToken = stranger.token;
    strangerId = stranger.id;

    objectId = (
      await dataSource.query(
        `INSERT INTO objects (name, type) VALUES ('Вершина разделов', 'вершина') RETURNING id`,
      )
    )[0].id;

    tripId = (
      await dataSource.query(
        `INSERT INTO trips (organizer_user_id, goal_object_id) VALUES ($1, $2) RETURNING id`,
        [organizerId, objectId],
      )
    )[0].id;

    await dataSource.query(
      `INSERT INTO trip_participants (trip_id, user_id, status)
       VALUES ($1, $2, 'going'), ($1, $3, 'going'), ($1, $4, 'going')`,
      [tripId, organizerId, quartermasterId, memberId],
    );

    // Своя роль «завхоз»: разделы «Берём» правит тот, кому дали вкладку.
    await dataSource.query(
      `INSERT INTO roles (code, name) VALUES ($1, 'Завхоз разделов (тест)')`,
      [gearRoleCode],
    );
    const roleId = (
      await dataSource.query(`SELECT id FROM roles WHERE code = $1`, [gearRoleCode])
    )[0].id;
    await dataSource.query(
      `INSERT INTO role_tab_permissions (role_id, tab) VALUES ($1, 'gear')`,
      [roleId],
    );
    await dataSource.query(
      `INSERT INTO trip_participant_roles (trip_id, user_id, role_id)
       VALUES ($1, $2, $3)`,
      [tripId, quartermasterId, roleId],
    );

    /**
     * Ночь с палаткой и готовкой — из неё сервер выводит шаблон «Табор».
     * Велосипедный тип похода заводит «к Велосипедам»; код типа приходит
     * из миграции `ActivityGroupsScope`, отдельной строки справочника
     * не создаём.
     */
    await dataSource.query(
      `INSERT INTO trip_route_nights (trip_id, position, kind, cooking)
       VALUES ($1, 1, 'tent', 'fire')`,
      [tripId],
    );
    await dataSource.query(
      `INSERT INTO trip_types (trip_id, activity_type_id)
       SELECT $1, id FROM calendar_activity_types WHERE code = 'trip_cycling'`,
      [tripId],
    );

    tentId = await addGear(organizerToken, {
      typeId: tentTypeId,
      title: 'Палатка в разделы',
      weightGrams: 2400,
    });
    potId = await addGear(memberToken, {
      typeId: plainTypeId,
      title: 'Котёл в разделы',
      weightGrams: 900,
    });
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query('DELETE FROM trips WHERE id = $1', [tripId]);
      await dataSource.query(
        'DELETE FROM gear_items WHERE owner_user_id = ANY($1::uuid[])',
        [[organizerId, memberId]],
      );
      await dataSource.query(`DELETE FROM gear_types WHERE code LIKE 'e2e\\_section\\_%'`);
      await dataSource.query('DELETE FROM roles WHERE code = $1', [gearRoleCode]);
      await dataSource.query('DELETE FROM objects WHERE id = $1', [objectId]);
      await dataSource.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        [organizerId, quartermasterId, memberId, strangerId],
      ]);
    }
    await app?.close();
  });

  it('шаблоны встают сами: «Табор», «к Велосипедам», личные «Снаряга» и «Одежда»', async () => {
    const data = await list(organizerToken);

    expect(sectionByTitle(data, 'Табор')?.scope).toBe('shared');
    expect(sectionByTitle(data, 'к Велосипедам')?.scope).toBe('shared');
    expect(sectionByTitle(data, 'Снаряга', 'personal')?.ownerUserId).toBe(organizerId);
    expect(sectionByTitle(data, 'Одежда', 'personal')?.ownerUserId).toBe(organizerId);
  });

  it('личные разделы чужим не видны', async () => {
    const data = await list(memberToken);

    expect(sectionByTitle(data, 'Снаряга', 'personal')?.ownerUserId).toBe(memberId);
    expect(
      data.sections.some(
        (section) => section.scope === 'personal' && section.ownerUserId === organizerId,
      ),
    ).toBe(false);
  });

  it('удалённый шаблон не возвращается при следующем открытии', async () => {
    const organizer = await list(organizerToken);
    const tabor = sectionByTitle(organizer, 'Табор');
    expect(tabor).toBeDefined();

    await call(
      'delete',
      `/api/trips/${tripId}/gear/sections/${tabor?.id}`,
      organizerToken,
    ).expect(204);

    const after = await list(organizerToken);
    expect(sectionByTitle(after, 'Табор')).toBeUndefined();
  });

  it('общественный раздел создаёт только тот, кому дали вкладку', async () => {
    await call('post', `/api/trips/${tripId}/gear/sections`, memberToken, {
      scope: 'shared',
      title: 'Пешка',
    }).expect(403);

    const created = await call(
      'post',
      `/api/trips/${tripId}/gear/sections`,
      quartermasterToken,
      { scope: 'shared', title: 'Пешка' },
    ).expect(201);

    expect(created.body.scope).toBe('shared');
    expect(created.body.ownerUserId).toBeNull();
    expect(created.body.title).toBe('Пешка');
  });

  it('личный раздел создаёт любой участник, и он принадлежит ему', async () => {
    const created = await call(
      'post',
      `/api/trips/${tripId}/gear/sections`,
      memberToken,
      { scope: 'personal', title: 'Альпинизм' },
    ).expect(201);

    expect(created.body.scope).toBe('personal');
    expect(created.body.ownerUserId).toBe(memberId);

    // Чужой личный раздел не существует даже по id.
    await call(
      'patch',
      `/api/trips/${tripId}/gear/sections/${created.body.id}`,
      organizerToken,
      { title: 'Мой?' },
    ).expect(404);
  });

  it('подраздел вкладывается, а раздел в себя — нельзя', async () => {
    const parent = await call(
      'post',
      `/api/trips/${tripId}/gear/sections`,
      organizerToken,
      { scope: 'shared', title: 'Альпинизм' },
    ).expect(201);

    const child = await call(
      'post',
      `/api/trips/${tripId}/gear/sections`,
      organizerToken,
      { scope: 'shared', title: 'Верёвки', parentId: Number(parent.body.id) },
    ).expect(201);

    expect(child.body.parentId).toBe(parent.body.id);

    await call(
      'patch',
      `/api/trips/${tripId}/gear/sections/${parent.body.id}`,
      organizerToken,
      { parentId: Number(child.body.id) },
    ).expect(400);
  });

  it('родитель обязан быть того же вида и владельца', async () => {
    const shared = await call(
      'post',
      `/api/trips/${tripId}/gear/sections`,
      organizerToken,
      { scope: 'shared', title: 'Вода' },
    ).expect(201);

    const personal = await call(
      'post',
      `/api/trips/${tripId}/gear/sections`,
      memberToken,
      { scope: 'personal', title: 'Обувь' },
    ).expect(201);

    await call(
      'post',
      `/api/trips/${tripId}/gear/sections`,
      memberToken,
      { scope: 'personal', title: 'Носки', parentId: Number(shared.body.id) },
    ).expect(400);

    await call(
      'post',
      `/api/trips/${tripId}/gear/sections`,
      organizerToken,
      { scope: 'shared', title: 'Чужая личная', parentId: Number(personal.body.id) },
    ).expect(400);
  });

  it('переименование: правят только свои', async () => {
    const section = await call(
      'post',
      `/api/trips/${tripId}/gear/sections`,
      organizerToken,
      { scope: 'shared', title: 'Пешка' },
    ).expect(201);

    await call(
      'patch',
      `/api/trips/${tripId}/gear/sections/${section.body.id}`,
      memberToken,
      { title: 'Не моё' },
    ).expect(403);

    const renamed = await call(
      'patch',
      `/api/trips/${tripId}/gear/sections/${section.body.id}`,
      organizerToken,
      { title: 'Пешая часть' },
    ).expect(200);

    expect(renamed.body.title).toBe('Пешая часть');
  });

  it('пустое название и несуществующий родитель — 400 и 404', async () => {
    await call('post', `/api/trips/${tripId}/gear/sections`, organizerToken, {
      scope: 'shared',
      title: '   ',
    }).expect(400);

    await call('post', `/api/trips/${tripId}/gear/sections`, organizerToken, {
      scope: 'shared',
      title: 'Сирота',
      parentId: 999999999,
    }).expect(404);
  });

  it('вещь кладут в общественный раздел по праву вкладки', async () => {
    const data = await list(organizerToken);
    const pedsha = sectionByTitle(data, 'Пешая часть');
    const proposed = await call(
      'post',
      `/api/trips/${tripId}/gear`,
      organizerToken,
      { gearItemId: Number(tentId) },
    ).expect(201);
    const gearId = proposed.body.id as string;
    tentGearId = gearId;

    await call(
      'patch',
      `/api/trips/${tripId}/gear/${gearId}`,
      memberToken,
      { sharedSectionId: Number(pedsha?.id) },
    ).expect(403);

    const assigned = await call(
      'patch',
      `/api/trips/${tripId}/gear/${gearId}`,
      quartermasterToken,
      { sharedSectionId: Number(pedsha?.id) },
    ).expect(200);

    expect(assigned.body.sharedSectionId).toBe(pedsha?.id);

    // Возврат в корень — тоже право вкладки.
    const root = await call(
      'patch',
      `/api/trips/${tripId}/gear/${gearId}`,
      quartermasterToken,
      { sharedSectionId: null },
    ).expect(200);
    expect(root.body.sharedSectionId).toBeNull();
  });

  it('личный раздел — только тому, кому вещь назначена', async () => {
    const pot = await call(
      'post',
      `/api/trips/${tripId}/gear`,
      memberToken,
      { gearItemId: Number(potId) },
    ).expect(201);
    const gearId = pot.body.id as string;

    await call(
      'patch',
      `/api/trips/${tripId}/gear/${gearId}`,
      quartermasterToken,
      { status: 'approved' },
    ).expect(200);

    const memberData = await list(memberToken);
    const alpinism = sectionByTitle(memberData, 'Альпинизм', 'personal');
    expect(alpinism).toBeDefined();

    // Чужой личный раздел — 404, даже если вещь у меня.
    const organizerData = await list(organizerToken);
    const organizerOwn = sectionByTitle(organizerData, 'Снаряга', 'personal');
    await call(
      'patch',
      `/api/trips/${tripId}/gear/${gearId}`,
      organizerToken,
      { personalSectionId: Number(organizerOwn?.id) },
    ).expect(403);

    const placed = await call(
      'patch',
      `/api/trips/${tripId}/gear/${gearId}`,
      memberToken,
      { personalSectionId: Number(alpinism?.id) },
    ).expect(200);

    expect(placed.body.personalSectionId).toBe(alpinism?.id);

    // Смена несущего обнуляет личный раздел: вещь уехала в чужой «Взял».
    const reassigned = await call(
      'patch',
      `/api/trips/${tripId}/gear/${gearId}`,
      memberToken,
      { assignedUserId: organizerId },
    ).expect(200);

    expect(reassigned.body.assignedUserId).toBe(organizerId);
    expect(reassigned.body.personalSectionId).toBeNull();
  });

  it('удаление раздела не теряет вещи — они высыпаются в корень', async () => {
    const section = await call(
      'post',
      `/api/trips/${tripId}/gear/sections`,
      organizerToken,
      { scope: 'shared', title: 'Удаляемый' },
    ).expect(201);

    await call(
      'patch',
      `/api/trips/${tripId}/gear/${tentGearId}`,
      quartermasterToken,
      { sharedSectionId: Number(section.body.id) },
    ).expect(200);

    await call(
      'delete',
      `/api/trips/${tripId}/gear/sections/${section.body.id}`,
      organizerToken,
    ).expect(204);

    const after = await list(organizerToken);
    const row = after.items.find((item) => item.id === tentGearId);
    expect(row?.sharedSectionId).toBeNull();
  });

  it('удаление родителя уносит подраздел, а его вещь остаётся в походе', async () => {
    const parent = await call(
      'post',
      `/api/trips/${tripId}/gear/sections`,
      organizerToken,
      { scope: 'shared', title: 'Родитель' },
    ).expect(201);
    const child = await call(
      'post',
      `/api/trips/${tripId}/gear/sections`,
      organizerToken,
      { scope: 'shared', title: 'Ребёнок', parentId: Number(parent.body.id) },
    ).expect(201);

    await call(
      'patch',
      `/api/trips/${tripId}/gear/${tentGearId}`,
      quartermasterToken,
      { sharedSectionId: Number(child.body.id) },
    ).expect(200);

    await call(
      'delete',
      `/api/trips/${tripId}/gear/sections/${parent.body.id}`,
      organizerToken,
    ).expect(204);

    const after = await list(organizerToken);
    expect(
      after.sections.some(
        (section) => section.id === child.body.id || section.id === parent.body.id,
      ),
    ).toBe(false);
    expect(after.items.find((item) => item.id === tentGearId)?.sharedSectionId).toBeNull();
  });

  it('посторонний не видит и не создаёт разделы', async () => {
    await call('get', `/api/trips/${tripId}/gear`, strangerToken).expect(403);
    await call('post', `/api/trips/${tripId}/gear/sections`, strangerToken, {
      scope: 'shared',
      title: 'Чужой',
    }).expect(403);
  });

  it('без токена — 401', async () => {
    await request(app.getHttpServer())
      .get(`/api/trips/${tripId}/gear`)
      .expect(401);
  });
});
