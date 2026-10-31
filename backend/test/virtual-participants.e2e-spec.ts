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
 * Виртуальные участники (e2e) — люди без аккаунта (30.10.2026).
 *
 * Проверяем решения заказчика и задание
 * `docs/ph/virtual-participants.md` §3 и §6:
 *
 * 1. **Заводит только организатор**, и человек сразу в составе со статусом
 *    `going`: приглашать его некуда — входа у него нет.
 * 2. **Войти нельзя**: строки в `auth_identities` у него нет, поэтому
 *    ни одна ручка входа его не найдёт.
 * 3. **Его нет среди людей**: поиск людей и публичный профиль о нём
 *    не знают (поиск — фильтр, профиль — 404, как у удалённого).
 * 4. **Одна строка на человека**: заведённый в одном походе добавляется
 *    в следующий одним нажатием, и чужого добавить нельзя (404).
 * 5. **Роль виртуальному дать можно** (ответ заказчика 31.10.2026: «да, но
 *    по факту это только для информации другим участникам, все действия
 *    совершает организатор, а у него полный доступ») — роли остаются
 *    ролями, а прав у виртуального не появляется: он не может войти.
 * 6. **Уборка по правилам**: пока человек в составе, из личного списка его
 *    не убрать (409); убрали из состава — уходит и из списка (204).
 *
 * Поход, состав и роли тест заводит напрямую в базе — правило видимости
 * похода проверено в `trips.e2e-spec.ts`, а здесь важны участники. Одно
 * исключение — чат `trip_members`: он нужен, потому что добавление
 * человека без аккаунта пишет системное сообщение в чат участников.
 */
describe('Виртуальные участники (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  let organizerId: string;
  let organizerToken: string;
  let memberId: string;
  let memberToken: string;
  let strangerToken: string;
  let otherOrganizerId: string;
  let otherOrganizerToken: string;

  let objectId: string;

  /** Поход, где заводится виртуальный, и второй — «следующий поход». */
  let tripId: string;
  let secondTripId: string;

  /** Поход другого организатора: чужой виртуальный живёт там. */
  let foreignTripId: string;
  let foreignVirtualId: string;

  /** Мечта: состава у неё нет. */
  let ideaTripId: string;

  let virtualId: string;

  const roleCode = `virtualE2e${Date.now()}`;

  let lastCode: string | null = null;

  const organizerEmail = `virtual-e2e-org-${Date.now()}@example.com`;
  const memberEmail = `virtual-e2e-member-${Date.now()}@example.com`;
  const strangerEmail = `virtual-e2e-stranger-${Date.now()}@example.com`;
  const otherOrganizerEmail = `virtual-e2e-other-${Date.now()}@example.com`;

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
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
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

  /**
   * Поход настоящей подготовки: статус `planning` (у вставки по умолчанию
   * `idea`, а у мечты состава нет), организатор в составе и чат участников.
   */
  async function makeTrip(
    organizerUserId: string,
    status: 'planning' | 'idea' = 'planning',
  ): Promise<string> {
    const id = (
      await dataSource.query(
        `INSERT INTO trips (organizer_user_id, goal_object_id, status)
         VALUES ($1, $2, $3) RETURNING id`,
        [organizerUserId, objectId, status],
      )
    )[0].id;

    await dataSource.query(
      `INSERT INTO conversations (kind, trip_id)
       VALUES ('trip_members', $1), ('trip_guest', $1)`,
      [id],
    );
    await dataSource.query(
      `INSERT INTO trip_participants (trip_id, user_id, status)
       VALUES ($1, $2, 'going')`,
      [id, organizerUserId],
    );

    return id as string;
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

    const otherOrganizer = await login(otherOrganizerEmail);
    otherOrganizerToken = otherOrganizer.token;
    otherOrganizerId = otherOrganizer.id;

    objectId = (
      await dataSource.query(
        `INSERT INTO objects (name, type)
         VALUES ('Вершина для виртуальных', 'вершина') RETURNING id`,
      )
    )[0].id;

    tripId = await makeTrip(organizerId);
    secondTripId = await makeTrip(organizerId);
    ideaTripId = await makeTrip(organizerId, 'idea');

    await dataSource.query(
      `INSERT INTO trip_participants (trip_id, user_id, status)
       VALUES ($1, $2, 'going')`,
      [tripId, memberId],
    );

    // Своя роль: проверка «роль виртуальному назначить можно» не должна
    // зависеть от сида.
    await dataSource.query(
      `INSERT INTO roles (code, name) VALUES ($1, 'Завхоз (виртуальные)')`,
      [roleCode],
    );
    const roleId = (
      await dataSource.query('SELECT id FROM roles WHERE code = $1', [roleCode])
    )[0].id;
    await dataSource.query(
      `INSERT INTO role_tab_permissions (role_id, tab) VALUES ($1, 'gear')`,
      [roleId],
    );

    // Чужой поход и чужой виртуальный: добавить его нельзя.
    foreignTripId = await makeTrip(otherOrganizerId);
    foreignVirtualId = (
      await request(app.getHttpServer())
        .post(`/api/trips/${foreignTripId}/participants/virtual`)
        .set('Authorization', `Bearer ${otherOrganizerToken}`)
        .send({ displayName: 'Чужой человек' })
        .expect(201)
    ).body.userId as string;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(
        'DELETE FROM trips WHERE id = ANY($1::bigint[])',
        [[tripId, secondTripId, ideaTripId, foreignTripId]],
      );
      await dataSource.query(
        'DELETE FROM users WHERE id = ANY($1::uuid[])',
        [
          [
            organizerId,
            memberId,
            otherOrganizerId,
            virtualId,
            foreignVirtualId,
          ].filter(Boolean),
        ],
      );
      await dataSource.query('DELETE FROM roles WHERE code = $1', [roleCode]);
      await dataSource.query('DELETE FROM objects WHERE id = $1', [objectId]);
    }
    await app?.close();
  });

  it('организатор заводит человека без аккаунта — сразу в составе', async () => {
    const response = await call(
      'post',
      `/api/trips/${tripId}/participants/virtual`,
      organizerToken,
      { displayName: 'Дядя Витя', gender: 'f' },
    ).expect(201);

    virtualId = response.body.userId as string;

    expect(response.body.displayName).toBe('Дядя Витя');
    expect(response.body.gender).toBe('f');
    expect(response.body.isVirtual).toBe(true);
    // Приглашать некуда: человек сразу идёт.
    expect(response.body.status).toBe('going');
    expect(response.body.isOrganizer).toBe(false);
    expect(response.body.roles).toEqual([]);
  });

  it('он в составе и помечен «без аккаунта»', async () => {
    const response = await call(
      'get',
      `/api/trips/${tripId}/participants`,
      organizerToken,
    ).expect(200);

    const virtual = (response.body.participants as Array<{
      userId: string;
      isVirtual: boolean;
    }>).find((row) => row.userId === virtualId);

    expect(virtual?.isVirtual).toBe(true);

    const organizer = response.body.participants.find(
      (row: { userId: string }) => row.userId === organizerId,
    );
    expect(organizer.isVirtual).toBe(false);
  });

  it('войти под ним нельзя: строки в auth_identities нет', async () => {
    const rows: Array<{ count: number }> = await dataSource.query(
      'SELECT count(*)::int AS count FROM auth_identities WHERE user_id = $1',
      [virtualId],
    );

    expect(rows[0].count).toBe(0);
  });

  it('в поиске людей его нет', async () => {
    const response = await call(
      'get',
      `/api/users?search=${encodeURIComponent('Дядя Витя')}`,
      organizerToken,
    ).expect(200);

    expect(response.body.users).toEqual([]);
  });

  it('публичного профиля у него нет — 404, как у удалённого', async () => {
    await call('get', `/api/users/${virtualId}`, organizerToken).expect(404);
  });

  it('не организатор человека без аккаунта не заводит', async () => {
    await call('post', `/api/trips/${tripId}/participants/virtual`, memberToken, {
      displayName: 'Самозванец',
    }).expect(403);

    await call(
      'post',
      `/api/trips/${tripId}/participants/virtual`,
      strangerToken,
      { displayName: 'Посторонний' },
    ).expect(403);
  });

  it('у мечты состава нет — 400', async () => {
    await call(
      'post',
      `/api/trips/${ideaTripId}/participants/virtual`,
      organizerToken,
      { displayName: 'В мечте' },
    ).expect(400);
  });

  it('в моём списке он есть, у другого участника — нет', async () => {
    const mine = await call(
      'get',
      '/api/users/me/virtual',
      organizerToken,
    ).expect(200);
    const ids = (mine.body.users as Array<{ id: string }>).map(
      (user) => user.id,
    );
    expect(ids).toContain(virtualId);

    const others = await call(
      'get',
      '/api/users/me/virtual',
      memberToken,
    ).expect(200);
    expect(others.body.users).toEqual([]);
  });

  it('переименование видно в составе: строка одна на человека', async () => {
    const renamed = await call(
      'patch',
      `/api/users/me/virtual/${virtualId}`,
      organizerToken,
      { displayName: 'Дядя Витя Петров', gender: 'm' },
    ).expect(200);
    expect(renamed.body.displayName).toBe('Дядя Витя Петров');

    const participants = await call(
      'get',
      `/api/trips/${tripId}/participants`,
      organizerToken,
    ).expect(200);
    const virtual = participants.body.participants.find(
      (row: { userId: string }) => row.userId === virtualId,
    );

    expect(virtual.displayName).toBe('Дядя Витя Петров');
    expect(virtual.gender).toBe('m');
  });

  it('чужого человека без аккаунта не переименовать — 404', async () => {
    await call(
      'patch',
      `/api/users/me/virtual/${virtualId}`,
      memberToken,
      { displayName: 'Не моё' },
    ).expect(404);
  });

  it('роль виртуальному назначить можно — но прав она не даёт', async () => {
    const response = await call(
      'put',
      `/api/trips/${tripId}/participants/${virtualId}/roles`,
      organizerToken,
      { roleCodes: [roleCode] },
    ).expect(200);

    expect(response.body.isVirtual).toBe(true);
    expect(
      (response.body.roles as Array<{ code: string }>).map((role) => role.code),
    ).toContain(roleCode);
    // Войти он всё равно не может — «действия совершает организатор»:
    // логина нет ни до, ни после назначения роли.
    const rows: Array<{ count: number }> = await dataSource.query(
      'SELECT count(*)::int AS count FROM auth_identities WHERE user_id = $1',
      [virtualId],
    );
    expect(rows[0].count).toBe(0);
  });

  it('в следующий поход — тем же человеком, одной ручкой', async () => {
    const response = await call(
      'post',
      `/api/trips/${secondTripId}/participants/virtual/${virtualId}`,
      organizerToken,
    ).expect(201);

    expect(response.body.userId).toBe(virtualId);
    expect(response.body.isVirtual).toBe(true);
    // Имя тоже то же: переименование живёт в строке `users`.
    expect(response.body.displayName).toBe('Дядя Витя Петров');
  });

  it('повторное добавление в тот же поход — 409', async () => {
    await call(
      'post',
      `/api/trips/${secondTripId}/participants/virtual/${virtualId}`,
      organizerToken,
    ).expect(409);
  });

  it('чужого виртуального добавить нельзя — 404', async () => {
    await call(
      'post',
      `/api/trips/${secondTripId}/participants/virtual/${foreignVirtualId}`,
      organizerToken,
    ).expect(404);

    // И наоборот: чужой организатор не добавит моего.
    await call(
      'post',
      `/api/trips/${foreignTripId}/participants/virtual/${virtualId}`,
      otherOrganizerToken,
    ).expect(404);
  });

  it('не организатор своего виртуального в поход не добавит', async () => {
    await call(
      'post',
      `/api/trips/${secondTripId}/participants/virtual/${virtualId}`,
      memberToken,
    ).expect(403);
  });

  it('приглашение человеку без аккаунта не уходит — 400', async () => {
    await call('post', `/api/trips/${secondTripId}/requests`, organizerToken, {
      direction: 'invite',
      userId: virtualId,
    }).expect(400);
  });

  it('пока он в походе, из личного списка его не убрать — 409', async () => {
    await call(
      'delete',
      `/api/users/me/virtual/${virtualId}`,
      organizerToken,
    ).expect(409);
  });

  it('убрали из состава — ушёл из списка, и только после всех походов', async () => {
    await call(
      'delete',
      `/api/trips/${tripId}/participants/${virtualId}`,
      organizerToken,
    ).expect(204);

    // Он ещё во втором походе — убрать из списка всё равно нельзя.
    await call(
      'delete',
      `/api/users/me/virtual/${virtualId}`,
      organizerToken,
    ).expect(409);

    await call(
      'delete',
      `/api/trips/${secondTripId}/participants/${virtualId}`,
      organizerToken,
    ).expect(204);

    await call(
      'delete',
      `/api/users/me/virtual/${virtualId}`,
      organizerToken,
    ).expect(204);

    const list = await call(
      'get',
      '/api/users/me/virtual',
      organizerToken,
    ).expect(200);
    expect(
      (list.body.users as Array<{ id: string }>).map((user) => user.id),
    ).not.toContain(virtualId);
  });

  it('удалённого виртуального снова не добавить — 404', async () => {
    await call(
      'post',
      `/api/trips/${secondTripId}/participants/virtual/${virtualId}`,
      organizerToken,
    ).expect(404);
  });
});
