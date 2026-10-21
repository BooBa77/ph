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
 * Доступ к вкладкам похода и назначение ролей (e2e) — Ф6.
 *
 * Проверяем три решения заказчика 21.10.2026:
 *
 * 1. **Права на роль.** Роль даёт право править вкладки; завхозов может
 *    быть несколько; организатор правит всё независимо от матрицы.
 * 2. **Роли назначают организаторы** (и соорганизаторы — через право на
 *    вкладку «Участники»). Сами участники не управляют ролями даже своими.
 * 3. **Видят вкладки все участники.** `canEdit` — про правку, не про
 *    доступ к экрану; гость видит только гостевую вкладку.
 *
 * Поход и состав тест заводит напрямую в базе: правило видимости похода
 * проверено в `trips.e2e-spec.ts`, здесь важно только, что оно применяется
 * к вкладкам.
 */
describe('Вкладки и роли (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  let organizerId: string;
  let organizerToken: string;
  let coorgId: string;
  let coorgToken: string;
  let memberId: string;
  let memberToken: string;
  let strangerToken: string;
  let strangerId: string;

  let objectId: string;
  let tripId: string;
  let privateTripId: string;

  /** Тестовая роль с правом только на «Дневник» — чтобы не зависеть от сида. */
  const testRoleCode = `accessE2e${Date.now()}`;

  let lastCode: string | null = null;

  const organizerEmail = `access-e2e-org-${Date.now()}@example.com`;
  const coorgEmail = `access-e2e-coorg-${Date.now()}@example.com`;
  const memberEmail = `access-e2e-member-${Date.now()}@example.com`;
  const strangerEmail = `access-e2e-stranger-${Date.now()}@example.com`;

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

    const emailCodeService = moduleFixture.get(EmailCodeService);
    const realCreateCode = emailCodeService.createCode.bind(emailCodeService);
    vi.spyOn(emailCodeService, 'createCode').mockImplementation((mail) => {
      lastCode = realCreateCode(mail);
      return lastCode;
    });

    const organizer = await login(organizerEmail);
    organizerToken = organizer.token;
    organizerId = organizer.id;

    const coorg = await login(coorgEmail);
    coorgToken = coorg.token;
    coorgId = coorg.id;

    const member = await login(memberEmail);
    memberToken = member.token;
    memberId = member.id;

    const stranger = await login(strangerEmail);
    strangerToken = stranger.token;
    strangerId = stranger.id;

    objectId = (
      await dataSource.query(
        `INSERT INTO objects (name, type) VALUES ('Вершина для вкладок', 'вершина') RETURNING id`,
      )
    )[0].id;

    tripId = (
      await dataSource.query(
        `INSERT INTO trips (organizer_user_id, goal_object_id, route_text, announcement,
                            is_commercial, price_rub)
         VALUES ($1, $2, 'Подход от станции', 'Гостевой обзор', true, 5000) RETURNING id`,
        [organizerId, objectId],
      )
    )[0].id;

    privateTripId = (
      await dataSource.query(
        `INSERT INTO trips (organizer_user_id, goal_object_id, route_text, visibility)
         VALUES ($1, $2, '', 'private') RETURNING id`,
        [organizerId, objectId],
      )
    )[0].id;

    await dataSource.query(
      `INSERT INTO trip_participants (trip_id, user_id, status)
       VALUES ($1, $2, 'going'), ($1, $3, 'going'), ($1, $4, 'going'),
              ($5, $2, 'going')`,
      [tripId, organizerId, coorgId, memberId, privateTripId],
    );

    // Роли — справочные данные; доводим до существования, не удаляем.
    for (const [code, name] of [
      ['organizer', 'Организатор'],
      ['coOrganizer', 'Соорганизатор'],
      ['quartermaster', 'Завхоз'],
      ['doctor', 'Медик'],
    ] as const) {
      await dataSource.query(
        `INSERT INTO roles (code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`,
        [code, name],
      );
    }

    const roleId = async (code: string): Promise<string> =>
      (await dataSource.query(`SELECT id FROM roles WHERE code = $1`, [code]))[0]
        .id;

    await dataSource.query(
      `INSERT INTO trip_participant_roles (trip_id, user_id, role_id)
       VALUES ($1, $2, $3), ($1, $4, $5), ($1, $6, $7)
       ON CONFLICT DO NOTHING`,
      [
        tripId,
        organizerId,
        await roleId('organizer'),
        coorgId,
        await roleId('coOrganizer'),
        memberId,
        await roleId('quartermaster'),
      ],
    );

    // Матрица прав для этих ролей: соорганизатор ведёт «Участников»,
    // завхоз — «Питание». Организатору права не нужны: он правит всё.
    await dataSource.query(
      `INSERT INTO role_tab_permissions (role_id, tab)
       VALUES ($1, 'members'), ($1, 'general'), ($2, 'meals')
       ON CONFLICT DO NOTHING`,
      [await roleId('coOrganizer'), await roleId('quartermaster')],
    );

    /**
     * Своя роль для проверки матрицы: в dev справочник уже засеян, и
     * у «завхоза» там две вкладки, а у «соорганизатора» — все одиннадцать.
     * Проверка «роль даёт только свою вкладку» на чужих данных зависела бы
     * от сида, поэтому тест заводит роль с одной вкладкой и убирает её за
     * собой.
     */
    await dataSource.query(
      `INSERT INTO roles (code, name) VALUES ($1, 'Тестовая роль') ON CONFLICT (code) DO NOTHING`,
      [testRoleCode],
    );
    await dataSource.query(
      `INSERT INTO role_tab_permissions (role_id, tab)
       VALUES ($1, 'diary') ON CONFLICT DO NOTHING`,
      [await roleId(testRoleCode)],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(
        'DELETE FROM trips WHERE id = ANY($1::bigint[])',
        [[tripId, privateTripId]],
      );
      await dataSource.query('DELETE FROM objects WHERE id = $1', [objectId]);
      // Тестовую роль убираем: права уходят каскадом вместе с ней.
      await dataSource.query('DELETE FROM roles WHERE code = $1', [testRoleCode]);
      await dataSource.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        [organizerId, coorgId, memberId, strangerId],
      ]);
    }
    await app?.close();
  });

  function call(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
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

  /** Читаемое представление вкладок: код → canEdit. */
  async function tabsOf(token: string): Promise<Record<string, boolean>> {
    const response = await call('get', `/api/trips/${tripId}/tabs`, token).expect(200);
    const tabs = response.body.tabs as Array<{ code: string; canEdit: boolean }>;

    return Object.fromEntries(tabs.map((tab) => [tab.code, tab.canEdit]));
  }

  describe('вкладки', () => {
    it('организатор правит все одиннадцать', async () => {
      const tabs = await tabsOf(organizerToken);

      expect(Object.keys(tabs)).toHaveLength(11);
      expect(Object.values(tabs).every(Boolean)).toBe(true);
      expect(tabs.meals).toBe(true);
      expect(tabs.finance).toBe(true);
    });

    it('участник без ролей видит все вкладки, но не правит ни одну', async () => {
      // Нужен человек в составе без ролей: снимаем роль завхоза.
      await call(
        'put',
        `/api/trips/${tripId}/participants/${memberId}/roles`,
        organizerToken,
        { roleCodes: [] },
      ).expect(200);

      const tabs = await tabsOf(memberToken);

      expect(Object.keys(tabs)).toHaveLength(11);
      expect(Object.values(tabs).some(Boolean)).toBe(false);
    });

    it('роль даёт право на свою вкладку и только на неё', async () => {
      // Своя роль с одной вкладкой: не зависим от того, что засеяно в dev.
      const response = await call(
        'put',
        `/api/trips/${tripId}/participants/${memberId}/roles`,
        organizerToken,
        { roleCodes: [testRoleCode] },
      ).expect(200);
      expect(
        (response.body.roles as Array<{ code: string }>).map((role) => role.code),
      ).toEqual([testRoleCode]);

      const tabs = await tabsOf(memberToken);
      expect(tabs.diary).toBe(true);
      expect(tabs.meals).toBe(false);
      expect(tabs.finance).toBe(false);
      expect(tabs.members).toBe(false);
    });

    it('соорганизатор видит свои права из матрицы', async () => {
      // Права соорганизатора засеяны сидом («все функции подготовки»),
      // поэтому проверяем не «только», а что «Участники» ему доступны.
      const tabs = await tabsOf(coorgToken);

      expect(tabs.members).toBe(true);
    });

    it('гость видит только гостевую вкладку', async () => {
      const response = await call('get', `/api/trips/${tripId}/tabs`, strangerToken).expect(200);

      expect(response.body.tabs).toEqual([{ code: 'guest', canEdit: false }]);
    });

    it('отказавшийся от участия теряет и вкладки, и права', async () => {
      await dataSource.query(
        `UPDATE trip_participants SET status = 'declined' WHERE trip_id = $1 AND user_id = $2`,
        [tripId, memberId],
      );

      try {
        const response = await call(
          'get',
          `/api/trips/${tripId}/tabs`,
          memberToken,
        ).expect(200);
        expect(response.body.tabs).toEqual([{ code: 'guest', canEdit: false }]);
      } finally {
        await dataSource.query(
          `UPDATE trip_participants SET status = 'going' WHERE trip_id = $1 AND user_id = $2`,
          [tripId, memberId],
        );
      }
    });

    it('приватный чужой поход — 404, а не пустой список', async () => {
      await request(app.getHttpServer())
        .get(`/api/trips/${privateTripId}/tabs`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(404);
    });
  });

  describe('назначение ролей', () => {
    it('справочник ролей отдаёт код и название', async () => {
      const response = await call('get', '/api/trips/roles', organizerToken).expect(200);

      const roles = response.body.roles as Array<{ code: string; name: string }>;
      expect(roles.map((role) => role.code)).toContain('quartermaster');
      expect(roles.find((role) => role.code === 'doctor')?.name).toBe('Медик');
    });

    it('организатор назначает и снимает роли', async () => {
      const added = await call(
        'put',
        `/api/trips/${tripId}/participants/${memberId}/roles`,
        organizerToken,
        { roleCodes: ['quartermaster', 'doctor'] },
      ).expect(200);
      expect(
        (added.body.roles as Array<{ code: string }>).map((role) => role.code).sort(),
      ).toEqual(['doctor', 'quartermaster']);

      const cleared = await call(
        'put',
        `/api/trips/${tripId}/participants/${memberId}/roles`,
        organizerToken,
        { roleCodes: [] },
      ).expect(200);
      expect(cleared.body.roles).toEqual([]);
    });

    it('соорганизатор тоже может — по праву на вкладку «Участники»', async () => {
      const response = await call(
        'put',
        `/api/trips/${tripId}/participants/${memberId}/roles`,
        coorgToken,
        { roleCodes: ['quartermaster'] },
      ).expect(200);

      expect((response.body.roles as Array<{ code: string }>)[0]?.code).toBe('quartermaster');
    });

    it('участник без прав роли не назначает — 403', async () => {
      await call(
        'put',
        `/api/trips/${tripId}/participants/${coorgId}/roles`,
        memberToken,
        { roleCodes: ['doctor'] },
      ).expect(403);
    });

    it('незнакомая роль — 400, не участник — 404', async () => {
      await call(
        'put',
        `/api/trips/${tripId}/participants/${memberId}/roles`,
        organizerToken,
        { roleCodes: ['шаман'] },
      ).expect(400);

      await call(
        'put',
        `/api/trips/${tripId}/participants/${strangerId}/roles`,
        organizerToken,
        { roleCodes: ['doctor'] },
      ).expect(404);
    });

    it('второго организатора выдать нельзя — 400', async () => {
      await call(
        'put',
        `/api/trips/${tripId}/participants/${memberId}/roles`,
        organizerToken,
        { roleCodes: ['organizer'] },
      ).expect(400);
    });

    it('организатор роль организатора не теряет', async () => {
      const response = await call(
        'put',
        `/api/trips/${tripId}/participants/${organizerId}/roles`,
        organizerToken,
        { roleCodes: [] },
      ).expect(200);

      expect(
        (response.body.roles as Array<{ code: string }>).map((role) => role.code),
      ).toEqual(['organizer']);
    });

    it('без токена роли назначить нельзя', async () => {
      await request(app.getHttpServer())
        .put(`/api/trips/${tripId}/participants/${memberId}/roles`)
        .send({ roleCodes: [] })
        .expect(401);
    });
  });

  describe('гостевая вкладка', () => {
    it('отдаёт обзор из «Общей», но без места сбора и состава', async () => {
      const response = await call(
        'get',
        `/api/trips/${tripId}/guest`,
        strangerToken,
      ).expect(200);

      expect(response.body.announcement).toBe('Гостевой обзор');
      expect(response.body.routeText).toContain('Подход');
      expect(response.body.priceRub).toBe(5000);
      expect(response.body.goalObject).toBeTruthy();

      // Место сбора — решение заказчика: гостю не нужно.
      expect(response.body).not.toHaveProperty('meetingPlace');
      // Состава и фактических дат в гостевом обзоре нет.
      expect(response.body).not.toHaveProperty('participants');
      expect(response.body).not.toHaveProperty('actualStartedAt');
    });

    it('приватный поход гостю не виден — 404', async () => {
      await call('get', `/api/trips/${privateTripId}/guest`, strangerToken).expect(404);
    });

    it('без токена гостевая вкладка закрыта', async () => {
      await request(app.getHttpServer())
        .get(`/api/trips/${tripId}/guest`)
        .expect(401);
    });
  });
});
