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
 * Общественное снаряжение похода (e2e) — Ф7, шаг «таблица и назначения».
 *
 * Проверяем решения заказчика 21.10.2026 (`docs/ph/gear-distribution.md`):
 *
 * 1. **Владелец и назначенный — разные люди.** Предложить можно только
 *    свой предмет каталога; несущий по умолчанию — владелец, но поменять
 *    его может **любой участник** (перетаскивание), а не только завхоз.
 * 2. **«Берём / Не берём» — право вкладки** (завхоз, организатор),
 *    а не участника: в вес идут только утверждённые вещи.
 * 3. **Участники похода, и только они.** Посторонний не видит и не
 *    предлагает; назначить груз можно только тому, кто идёт.
 * 4. **Уход участника.** Вещи ушедшего уходят из похода, назначение
 *    на него обнуляется — это держат внешние ключи на `trip_participants`.
 * 5. **Каталог не теряет вещь молча.** Предмет, который едет в походе,
 *    нельзя удалить из каталога: 409 вместо ошибки внешнего ключа.
 *
 * Поход и состав тест заводит напрямую в базе — правило видимости похода
 * проверено в `trips.e2e-spec.ts`, здесь важно снаряжение. Роль для
 * «завхоза» тоже своя (с правом только на «Снаряжение»), чтобы не
 * зависеть от сида.
 */
describe('Снаряжение похода (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  let organizerId: string;
  let organizerToken: string;
  let quartermasterId: string;
  let quartermasterToken: string;
  let memberId: string;
  let memberToken: string;
  let maybeId: string;
  let maybeToken: string;
  let strangerId: string;
  let strangerToken: string;

  let objectId: string;
  let tripId: string;

  let tentId: string;
  let ropeId: string;
  let potId: string;
  /** Вещь «незабинденного» типа для кнопки «Добавить ещё» (01.11.2026). */
  let extraId: string;

  /**
   * Типы заводим свои: спека про снаряжение похода, а не про справочник,
   * и зависеть от `seed:gear-types` ей незачем. Коды с префиксом
   * `e2e_trip_` убираются за собой в `afterAll`.
   */
  let tentTypeId: number;
  let plainTypeId: number;

  /** Строки снаряжения похода, которые заводятся по ходу тестов. */
  let tentTripGearId: string;
  let ropeTripGearId: string;

  const gearRoleCode = `gearE2e${Date.now()}`;

  let lastCode: string | null = null;

  const organizerEmail = `trip-gear-e2e-org-${Date.now()}@example.com`;
  const quartermasterEmail = `trip-gear-e2e-qm-${Date.now()}@example.com`;
  const memberEmail = `trip-gear-e2e-member-${Date.now()}@example.com`;
  const maybeEmail = `trip-gear-e2e-maybe-${Date.now()}@example.com`;
  const strangerEmail = `trip-gear-e2e-stranger-${Date.now()}@example.com`;

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

  /**
   * Тип для проверок — прямая вставка в базу: спека про снаряжение похода,
   * а справочник типов проверяется в `gear-types.e2e-spec.ts`. Повторный
   * прогон не спорит с прошлым: `ON CONFLICT` оставляет прежнюю строку.
   */
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

    tentTypeId = await makeType('e2e_trip_tent', 'Проверочная палатка');
    plainTypeId = await makeType('e2e_trip_plain', 'Проверочный ящик');

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

    const maybe = await login(maybeEmail);
    maybeId = maybe.id;
    maybeToken = maybe.token;

    const stranger = await login(strangerEmail);
    strangerToken = stranger.token;
    strangerId = stranger.id;

    // Пол «пока не решил» — женский, чтобы заодно проверить, что состав
    // похода отдаёт пол (нужен распределению веса).
    await request(app.getHttpServer())
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${maybe.token}`)
      .send({ gender: 'f' })
      .expect(200);

    objectId = (
      await dataSource.query(
        `INSERT INTO objects (name, type) VALUES ('Вершина для снаряжения', 'вершина') RETURNING id`,
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
       VALUES ($1, $2, 'going'), ($1, $3, 'going'), ($1, $4, 'going'), ($1, $5, 'maybe')`,
      [tripId, organizerId, quartermasterId, memberId, maybeId],
    );

    // Своя роль «завхоз» с правом только на «Снаряжение»: проверка
    // «роль даёт вкладку» не должна зависеть от сида.
    await dataSource.query(
      `INSERT INTO roles (code, name) VALUES ($1, 'Завхоз (тест)')`,
      [gearRoleCode],
    );
    const roleId = (
      await dataSource.query(`SELECT id FROM roles WHERE code = $1`, [
        gearRoleCode,
      ])
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

    // Предметы каталога — через API: путь тот же, что у человека.
    tentId = await addGear(organizerToken, {
      typeId: tentTypeId,
      title: 'Палатка на четверых',
      weightGrams: 2400,
    });
    ropeId = await addGear(organizerToken, {
      typeId: plainTypeId,
      title: 'Верёвка 40 м',
    });
    potId = await addGear(quartermasterToken, {
      typeId: plainTypeId,
      title: 'Котелок 5 л',
      weightGrams: 900,
    });
    extraId = await addGear(organizerToken, {
      typeId: plainTypeId,
      title: 'Лодка надувная',
      weightGrams: 12000,
    });
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // Поход уносит снаряжение похода каскадом; предметы каталога —
      // после него (на них RESTRICT).
      await dataSource.query('DELETE FROM trips WHERE id = $1', [tripId]);
      // Вещи заводят не только организатор и завхоз: «чужой предмет»
      // и личные строки создаются от участника и постороннего. Всех их
      // надо убрать до типа — иначе RESTRICT не даст удалить тип.
      await dataSource.query(
        'DELETE FROM gear_items WHERE owner_user_id = ANY($1::uuid[])',
        [[organizerId, quartermasterId, memberId, maybeId, strangerId]],
      );
      await dataSource.query(`DELETE FROM gear_types WHERE code LIKE 'e2e\\_trip\\_%'`);
      await dataSource.query('DELETE FROM roles WHERE code = $1', [
        gearRoleCode,
      ]);
      await dataSource.query('DELETE FROM objects WHERE id = $1', [objectId]);
      await dataSource.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        [organizerId, quartermasterId, memberId, maybeId, strangerId],
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

  /** Предмет каталога через API; возвращает его id. */
  async function addGear(
    token: string,
    body: Record<string, unknown>,
  ): Promise<string> {
    const response = await call('post', '/api/gear', token, body).expect(201);

    return response.body.id as string;
  }

  /** Предложить предмет в поход. */
  function propose(
    token: string,
    gearItemId: string,
    routeSection?: string,
  ) {
    const body: Record<string, unknown> = {
      gearItemId: Number(gearItemId),
    };
    if (routeSection !== undefined) body.routeSection = routeSection;

    return call('post', `/api/trips/${tripId}/gear`, token, body);
  }

  it('по умолчанию список пуст и итог нулевой', async () => {
    const response = await call(
      'get',
      `/api/trips/${tripId}/gear`,
      organizerToken,
    ).expect(200);

    expect(response.body.items).toEqual([]);
    expect(response.body.totalWeightGrams).toBe(0);
    expect(response.body.itemsWithoutWeight).toBe(0);
  });

  it('посторонний не видит снаряжение похода', async () => {
    await call('get', `/api/trips/${tripId}/gear`, strangerToken).expect(403);
    await propose(strangerToken, tentId).expect(403);
  });

  it('предложение своего предмета: владелец — я, несущий — тоже я', async () => {
    const response = await propose(organizerToken, tentId).expect(201);
    tentTripGearId = response.body.id as string;

    expect(response.body.ownerUserId).toBe(organizerId);
    expect(response.body.assignedUserId).toBe(organizerId);
    expect(response.body.status).toBe('proposed');
    // Тип, название и вес приходят из каталога, а не копируются в поход.
    expect(response.body.typeCode).toBe('e2e_trip_tent');
    expect(response.body.title).toBe('Палатка на четверых');
    expect(response.body.weightGrams).toBe(2400);
    // Вида старого каталога в строке похода больше нет: «Ночёвки» читают
    // `typeCode` и значения характеристик.
    expect(response.body.kind).toBeUndefined();
  });

  it('чужой предмет в свой поход не предложить: 404', async () => {
    await propose(organizerToken, potId).expect(404);
  });

  /**
   * Ответ заказчику 03.11.2026: «могут ли не100%-участники предлагать своё
   * снаряжение?» — **да**. Владелец палатки может взять её на группу, сам
   * не идти, и тогда «пока не решил» — ещё не повод отбирать предложение.
   * Но несущим он не становится: вещь ложится в «нераспределённые».
   */
  it('«пока не решил» предлагает своё снаряжение, но не становится несущим', async () => {
    const item = await addGear(maybeToken, {
      typeId: tentTypeId,
      title: 'Палатка «пока не решил»',
      weightGrams: 2000,
    });

    const response = await propose(maybeToken, item).expect(201);

    expect(response.body.ownerUserId).toBe(maybeId);
    expect(response.body.assignedUserId).toBeNull();
    expect(response.body.status).toBe('proposed');

    // Убираем за собой: следующие проверки ждут прежний список вещей.
    await call(
      'delete',
      `/api/trips/${tripId}/gear/${response.body.id}`,
      maybeToken,
    ).expect(204);
    await call('delete', `/api/gear/${item}`, maybeToken).expect(204);
  });

  it('повторное предложение того же предмета — 409', async () => {
    await propose(organizerToken, tentId).expect(409);
  });

  it('нечисловой и несуществующий предмет — 400 и 404', async () => {
    await call('post', `/api/trips/${tripId}/gear`, organizerToken, {
      gearItemId: 'tent',
    }).expect(400);
    await call('post', `/api/trips/${tripId}/gear`, organizerToken, {
      gearItemId: 0,
    }).expect(400);
    await propose(organizerToken, '999999999').expect(404);
  });

  it('вес предложенного в итог не входит — «берём» ещё нет', async () => {
    const response = await call(
      'get',
      `/api/trips/${tripId}/gear`,
      memberToken,
    ).expect(200);

    expect(response.body.items).toHaveLength(1);
    expect(response.body.totalWeightGrams).toBe(0);
    expect(response.body.itemsWithoutWeight).toBe(0);
  });

  /**
   * «Добавить ещё» (01.11.2026): вещь запоминает секцию, где её добавили.
   * Обычная вещь секции не имеет — её место показывает тип, и `null`
   * в ответе это и значит.
   */
  it('«Добавить ещё» помнит секцию, обычная вещь — нет', async () => {
    const withSection = await propose(organizerToken, extraId, 'tent').expect(201);
    expect(withSection.body.routeSection).toBe('tent');

    const plain = await call(
      'get',
      `/api/trips/${tripId}/gear`,
      organizerToken,
    ).expect(200);
    const tent = (plain.body.items as Array<{ id: string; routeSection: unknown }>)
      .find((item) => item.id === tentTripGearId);
    expect(tent?.routeSection).toBeNull();

    // Секция — словарь: «boat» в базе не появится.
    await propose(organizerToken, tentId, 'boat').expect(400);

    // За собой убираем: дальше спека считает вещи похода поштучно.
    await call(
      'delete',
      `/api/trips/${tripId}/gear/${withSection.body.id}`,
      organizerToken,
    ).expect(204);
  });

  it('«берём / не берём» — не участнику, а тому, у кого вкладка', async () => {
    await call(
      'patch',
      `/api/trips/${tripId}/gear/${tentTripGearId}`,
      memberToken,
      { status: 'approved' },
    ).expect(403);

    const approved = await call(
      'patch',
      `/api/trips/${tripId}/gear/${tentTripGearId}`,
      quartermasterToken,
      { status: 'approved' },
    ).expect(200);
    expect(approved.body.status).toBe('approved');
  });

  it('вес утверждённой вещи входит в итог', async () => {
    const response = await call(
      'get',
      `/api/trips/${tripId}/gear`,
      organizerToken,
    ).expect(200);

    expect(response.body.totalWeightGrams).toBe(2400);
    expect(response.body.itemsWithoutWeight).toBe(0);
  });

  it('вещь без веса считается отдельно, а не нулём', async () => {
    const proposed = await propose(organizerToken, ropeId).expect(201);
    ropeTripGearId = proposed.body.id as string;

    expect(proposed.body.weightGrams).toBeNull();

    await call(
      'patch',
      `/api/trips/${tripId}/gear/${ropeTripGearId}`,
      organizerToken,
      { status: 'approved' },
    ).expect(200);

    const response = await call(
      'get',
      `/api/trips/${tripId}/gear`,
      organizerToken,
    ).expect(200);

    expect(response.body.totalWeightGrams).toBe(2400);
    expect(response.body.itemsWithoutWeight).toBe(1);
  });

  it('перетащить вещь может любой участник', async () => {
    const response = await call(
      'patch',
      `/api/trips/${tripId}/gear/${ropeTripGearId}`,
      memberToken,
      { assignedUserId: organizerId },
    ).expect(200);

    expect(response.body.assignedUserId).toBe(organizerId);
  });

  it('назначить можно только тому, кто идёт', async () => {
    await call(
      'patch',
      `/api/trips/${tripId}/gear/${ropeTripGearId}`,
      memberToken,
      { assignedUserId: maybeId },
    ).expect(400);

    await call(
      'patch',
      `/api/trips/${tripId}/gear/${ropeTripGearId}`,
      memberToken,
      { assignedUserId: strangerId },
    ).expect(400);
  });

  it('назначение снимается null — «нераспределённая»', async () => {
    const response = await call(
      'patch',
      `/api/trips/${tripId}/gear/${ropeTripGearId}`,
      memberToken,
      { assignedUserId: null },
    ).expect(200);

    expect(response.body.assignedUserId).toBeNull();
  });

  it('лишнее поле в теле — 400', async () => {
    await call(
      'patch',
      `/api/trips/${tripId}/gear/${ropeTripGearId}`,
      organizerToken,
      { ownerUserId: maybeId },
    ).expect(400);
  });

  it('чужую вещь убирает владелец или тот, кто ведёт снаряжение', async () => {
    await call(
      'delete',
      `/api/trips/${tripId}/gear/${ropeTripGearId}`,
      memberToken,
    ).expect(403);

    await call(
      'delete',
      `/api/trips/${tripId}/gear/${ropeTripGearId}`,
      quartermasterToken,
    ).expect(204);

    const response = await call(
      'get',
      `/api/trips/${tripId}/gear`,
      organizerToken,
    ).expect(200);
    expect(response.body.items).toHaveLength(1);
  });

  it('каталог не теряет предмет, который едет в живом походе', async () => {
    // С 11.11.2026 удаление мягкое, а блокирует его только **решённый**
    // и ещё не закончившийся поход. Планирующий — не блокирует: поход
    // ещё не решён, и архив похода знает, что вещь удалена из каталога.
    await dataSource.query(
      `UPDATE trips
          SET status = 'decided',
              starts_at = now() + interval '1 day',
              ends_at = now() + interval '2 days'
        WHERE id = $1`,
      [tripId],
    );

    // Палатка ещё в походе — удалить её из каталога нельзя, иначе она
    // исчезла бы из подготовки молча.
    await call('delete', `/api/gear/${tentId}`, organizerToken).expect(409);

    // Освободили из похода — каталог снова распоряжается предметом сам.
    await call('delete', `/api/gear/${ropeId}`, organizerToken).expect(204);
  });

  it('владелец убирает свою вещь из похода', async () => {
    await call(
      'delete',
      `/api/trips/${tripId}/gear/${tentTripGearId}`,
      organizerToken,
    ).expect(204);

    const response = await call(
      'get',
      `/api/trips/${tripId}/gear`,
      organizerToken,
    ).expect(200);
    expect(response.body.items).toEqual([]);
  });

  it('уход участника: его вещи уходят, назначение обнуляется', async () => {
    const pot = await propose(quartermasterToken, potId).expect(201);
    const orgTent = await propose(organizerToken, tentId).expect(201);

    await call(
      'patch',
      `/api/trips/${tripId}/gear/${orgTent.body.id}`,
      organizerToken,
      { assignedUserId: quartermasterId },
    ).expect(200);

    // Убираем завхоза из состава напрямую в базе: правило ухода
    // держат внешние ключи на trip_participants, а не сервис.
    await dataSource.query(
      'DELETE FROM trip_participants WHERE trip_id = $1 AND user_id = $2',
      [tripId, quartermasterId],
    );

    const response = await call(
      'get',
      `/api/trips/${tripId}/gear`,
      organizerToken,
    ).expect(200);

    const items = response.body.items as Array<{
      id: string;
      assignedUserId: string | null;
    }>;

    // Котелок завхоза ушёл вместе с ним, палатка осталась в походе,
    // но нераспределённой.
    expect(items.map((item) => item.id)).not.toContain(pot.body.id);
    expect(items.map((item) => item.id)).toContain(orgTent.body.id);
    expect(
      items.find((item) => item.id === orgTent.body.id)?.assignedUserId,
    ).toBeNull();
  });

  it('состав похода отдаёт пол участника — он нужен расчёту веса', async () => {
    const response = await call(
      'get',
      `/api/trips/${tripId}/participants`,
      organizerToken,
    ).expect(200);

    const participants = response.body.participants as Array<{
      userId: string;
      gender: string;
      status: string;
    }>;

    expect(
      participants.find((participant) => participant.userId === maybeId)?.gender,
    ).toBe('f');
    expect(
      participants.find((participant) => participant.userId === organizerId)
        ?.gender,
    ).toBe('m');
  });

  it('нечисловой id строки — 400, несуществующий — 404', async () => {
    await call(
      'patch',
      `/api/trips/${tripId}/gear/abc`,
      organizerToken,
      { status: 'approved' },
    ).expect(400);

    await call(
      'patch',
      `/api/trips/${tripId}/gear/999999`,
      organizerToken,
      { status: 'approved' },
    ).expect(404);
  });

  it('без токена — 401', async () => {
    await request(app.getHttpServer())
      .get(`/api/trips/${tripId}/gear`)
      .expect(401);
  });
});
