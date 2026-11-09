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
 * Вкладка «Аптечка» (e2e) — 09.11.2026.
 *
 * Заказчик: две секции — общественная (если назначен доктор) и личная,
 * у каждой свой чек-лист и поле веса. Общественную аптечку в раскладке
 * несёт доктор, личная стоит в личном рюкзаке; неизвестный вес — 0,
 * и цифры на экране нет.
 *
 * Здесь проверяется API, а не экран:
 *
 * 1. **Секции заводятся при первом чтении**: обе, если есть доктор,
 *    личная — всегда.
 * 2. **Вес пишется в список** и возвращается вместе с состоянием вкладки;
 *    `null` — «не взвешена», а не ноль.
 * 3. **Общественная аптечка едет доктору** как единица `firstAid`
 *    в его рюкзаке; без веса она весит 0 и помечена `weightKnown: false`.
 * 4. **Личная аптечка — в личном рюкзаке** смотрящего строкой `firstAid`,
 *    но только собранная (есть выполненный пункт) и взвешенная: пустая
 *    или без веса в рюкзаке не показывается (замечание 09.11.2026).
 * 5. **Без доктора общественной секции нет** и в раскладке аптечки нет.
 *
 * Поход, роли и состав тест заводит напрямую в базе: правила походов
 * проверены в `trips.e2e-spec.ts`, здесь важно, как аптечка связана
 * со списками и раскладкой.
 */
describe('Аптечка похода (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  let organizerId: string;
  let organizerToken: string;
  let doctorId: string;
  let doctorToken: string;
  let otherId: string;
  let otherToken: string;
  let strangerToken: string;

  let objectId: string;
  let tripId: string;
  let doctorRoleId: string;
  let lastCode: string | null = null;

  const organizerEmail = `first-aid-e2e-org-${Date.now()}@example.com`;
  const doctorEmail = `first-aid-e2e-doctor-${Date.now()}@example.com`;
  const otherEmail = `first-aid-e2e-other-${Date.now()}@example.com`;
  const strangerEmail = `first-aid-e2e-stranger-${Date.now()}@example.com`;

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

  function state(token: string) {
    return call('get', `/api/trips/${tripId}/first-aid`, token);
  }

  /**
   * Отметить пункт личной аптечки. Личный рюкзак показывает аптечку только
   * с выполненным пунктом (замечание заказчика 09.11.2026), поэтому тестам
   * раскладки нужна настоящая отметка, а не строка в базе.
   */
  async function markPersonalItem(
    token: string,
    isDone: boolean,
  ): Promise<void> {
    const personal = await state(token).expect(200);
    const item = personal.body.personal.checklist.items.find(
      (row: { title: string }) => row.title === 'Пластырь',
    );

    await call('patch', `/api/checklists/items/${item.id}`, token, {
      isDone,
    }).expect(200);
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

    const doctor = await login(doctorEmail);
    doctorToken = doctor.token;
    doctorId = doctor.id;

    const other = await login(otherEmail);
    otherToken = other.token;
    otherId = other.id;

    const stranger = await login(strangerEmail);
    strangerToken = stranger.token;

    objectId = (
      await dataSource.query(
        `INSERT INTO objects (name, type) VALUES ('Вершина для аптечки', 'вершина') RETURNING id`,
      )
    )[0].id;

    tripId = (
      await dataSource.query(
        `INSERT INTO trips (organizer_user_id, goal_object_id, route_text,
                            status, starts_at, ends_at, visibility)
         VALUES ($1, $2, '', 'decided', now() + interval '10 days',
                 now() + interval '12 days', 'public') RETURNING id`,
        [organizerId, objectId],
      )
    )[0].id;

    await dataSource.query(
      `INSERT INTO trip_participants (trip_id, user_id, status)
       VALUES ($1, $2, 'going'), ($1, $3, 'going'), ($1, $4, 'going')`,
      [tripId, organizerId, doctorId, otherId],
    );

    await dataSource.query(`
      INSERT INTO roles (code, name) VALUES ('doctor', 'Медик')
      ON CONFLICT (code) DO NOTHING
    `);
    doctorRoleId = (
      await dataSource.query(`SELECT id FROM roles WHERE code = 'doctor'`)
    )[0].id;
    await dataSource.query(
      `INSERT INTO trip_participant_roles (trip_id, user_id, role_id)
       VALUES ($1, $2, $3)`,
      [tripId, doctorId, doctorRoleId],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query('DELETE FROM trips WHERE id = $1', [tripId]);
      await dataSource.query('DELETE FROM objects WHERE id = $1', [objectId]);
    }
    await app?.close();
  });

  it('первое чтение заводит обе секции: общественную у доктора и личную', async () => {
    const response = await state(organizerToken).expect(200);

    expect(response.body.doctorUserId).toBe(doctorId);
    expect(response.body.chatKind).toBe('trip_first_aid');
    expect(response.body.canEdit).toBe(true);
    expect(response.body.shared).not.toBeNull();
    expect(response.body.shared.checklist).not.toBeNull();
    expect(response.body.shared.checklist.area).toBe('first_aid');
    expect(response.body.shared.checklist.scope).toBe('trip');
    expect(response.body.personal.checklist.scope).toBe('personal');
    expect(response.body.personal.checklist.area).toBe('first_aid');

    // Повторное чтение не заводит второй список.
    const again = await state(organizerToken).expect(200);
    expect(again.body.shared.checklist.id).toBe(
      response.body.shared.checklist.id,
    );
    expect(again.body.personal.checklist.id).toBe(
      response.body.personal.checklist.id,
    );
  });

  it('общественную аптечку заполняет ведущий, личную — сам человек', async () => {
    const organizerState = await state(organizerToken).expect(200);
    const sharedId = organizerState.body.shared.checklist.id as string;

    const doctorState = await state(doctorToken).expect(200);
    const personalId = doctorState.body.personal.checklist.id as string;

    await call('post', `/api/checklists/${sharedId}/items`, organizerToken, {
      title: 'Бинт стерильный',
    }).expect(201);

    await call('post', `/api/checklists/${personalId}/items`, doctorToken, {
      title: 'Пластырь',
    }).expect(201);

    // Доктор ведёт общественную аптечку: роль `doctor` даёт вкладку
    // `firstAid`. Участнику без роли она только читается.
    await call('post', `/api/checklists/${sharedId}/items`, doctorToken, {
      title: 'Жгут',
    }).expect(201);

    await call('post', `/api/checklists/${sharedId}/items`, otherToken, {
      title: 'Чужое',
    }).expect(403);

    const seen = await state(doctorToken).expect(200);
    expect(
      seen.body.shared.checklist.items.map((row: { title: string }) => row.title),
    ).toContain('Бинт стерильный');
    expect(
      seen.body.personal.checklist.items.map((row: { title: string }) => row.title),
    ).toContain('Пластырь');
  });

  it('вес пишется в свою секцию и возвращается состоянием вкладки', async () => {
    const saved = await call(
      'patch',
      `/api/trips/${tripId}/first-aid/weight`,
      organizerToken,
      { scope: 'shared', weightGrams: 900 },
    ).expect(200);

    expect(saved.body.shared.weightGrams).toBe(900);
    expect(saved.body.shared.checklist.weightGrams).toBe(900);

    const personal = await call(
      'patch',
      `/api/trips/${tripId}/first-aid/weight`,
      doctorToken,
      { scope: 'personal', weightGrams: 300 },
    ).expect(200);
    expect(personal.body.personal.weightGrams).toBe(300);

    // Личный вес не подменяет общественный, и наоборот.
    expect(personal.body.shared.weightGrams).toBe(900);
  });

  it('пустой вес — «не взвешена», а не ноль', async () => {
    const cleared = await call(
      'patch',
      `/api/trips/${tripId}/first-aid/weight`,
      organizerToken,
      { scope: 'shared', weightGrams: null },
    ).expect(200);

    expect(cleared.body.shared.weightGrams).toBeNull();
    expect(cleared.body.shared.checklist.weightGrams).toBeNull();
  });

  it('общественная аптечка едет доктору, личная — в личном рюкзаке', async () => {
    // Вес обратно: без него проверить «аптечка весит» нечего.
    await call(
      'patch',
      `/api/trips/${tripId}/first-aid/weight`,
      organizerToken,
      { scope: 'shared', weightGrams: 900 },
    ).expect(200);

    /**
     * Личная аптечка попадает в рюкзак только собранная и взвешенная:
     * замечание заказчика 09.11.2026. Отмечаем пункт, иначе строки нет.
     */
    await markPersonalItem(doctorToken, true);

    const load = await call(
      'get',
      `/api/trips/${tripId}/gear/load`,
      doctorToken,
    ).expect(200);

    const doctorBag = load.body.backpacks.find(
      (bag: { userId: string }) => bag.userId === doctorId,
    );
    const publicFirstAid = doctorBag.gear.find(
      (unit: { kind: string }) => unit.kind === 'firstAid',
    );

    expect(publicFirstAid).toMatchObject({
      title: 'Общественная аптечка',
      weightGrams: 900,
      weightKnown: true,
      assignedUserId: doctorId,
    });

    const personalFirstAid = load.body.personal.gear.find(
      (row: { kind: string }) => row.kind === 'firstAid',
    );
    expect(personalFirstAid).toMatchObject({
      title: 'Личная аптечка',
      weightGrams: 300,
    });
    expect(load.body.personal.gearWeightGrams).toBe(300);
  });

  it('личная аптечка без веса в рюкзак не попадает', async () => {
    await call(
      'patch',
      `/api/trips/${tripId}/first-aid/weight`,
      doctorToken,
      { scope: 'personal', weightGrams: null },
    ).expect(200);

    const load = await call(
      'get',
      `/api/trips/${tripId}/gear/load`,
      doctorToken,
    ).expect(200);

    expect(
      load.body.personal.gear.some(
        (row: { kind: string }) => row.kind === 'firstAid',
      ),
    ).toBe(false);
    expect(load.body.personal.gearWeightGrams).toBe(0);
  });

  it('личная аптечка без выполненного пункта в рюкзак не попадает', async () => {
    // Вес есть, отметки нет: пустой список — не груз.
    await call(
      'patch',
      `/api/trips/${tripId}/first-aid/weight`,
      doctorToken,
      { scope: 'personal', weightGrams: 300 },
    ).expect(200);
    await markPersonalItem(doctorToken, false);

    const load = await call(
      'get',
      `/api/trips/${tripId}/gear/load`,
      doctorToken,
    ).expect(200);

    expect(
      load.body.personal.gear.some(
        (row: { kind: string }) => row.kind === 'firstAid',
      ),
    ).toBe(false);
  });

  it('без доктора общественной секции и общественной аптечки нет', async () => {
    await dataSource.query(
      `DELETE FROM trip_participant_roles
        WHERE trip_id = $1 AND user_id = $2 AND role_id = $3`,
      [tripId, doctorId, doctorRoleId],
    );

    const response = await state(organizerToken).expect(200);
    expect(response.body.doctorUserId).toBeNull();
    expect(response.body.shared).toBeNull();

    const load = await call(
      'get',
      `/api/trips/${tripId}/gear/load`,
      organizerToken,
    ).expect(200);
    expect(
      load.body.backpacks.some((bag: { gear: Array<{ kind: string }> }) =>
        bag.gear.some((unit) => unit.kind === 'firstAid'),
      ),
    ).toBe(false);
  });

  it('посторонний аптечку не видит', async () => {
    await call('get', `/api/trips/${tripId}/first-aid`, strangerToken).expect(
      403,
    );
  });
});
