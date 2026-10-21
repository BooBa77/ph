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
 * Чек-листы (e2e): шаблоны, общий список похода и личный в походе.
 *
 * Проверяем **правила доступа**, а не CRUD: CRUD проверяется тем, что тест
 * вообще доходит до ответа. Самое дорогое здесь — три исхода одного
 * действия у трёх людей (владелец, участник, посторонний) и то, что «не
 * твой» список отвечает 404, а не 403: иначе перебором id можно узнать,
 * какие шаблоны и личные списки у людей есть.
 *
 * Походы и состав тест заводит **прямо в базе**: правило «виден ли поход»
 * проверяется в `trips.e2e-spec.ts`, а здесь важно только, что оно
 * применяется к спискам. Так тест не зависит от сидов ролей и от
 * эндпоинтов состава.
 */
describe('Чек-листы (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  let organizerId: string;
  let organizerToken: string;
  let memberId: string;
  let memberToken: string;
  let strangerId: string;
  let strangerToken: string;

  let objectId: string;
  let tripId: string;
  let privateTripId: string;
  /** Отдельный поход для проверки копии шаблона: там свой общий список. */
  let copyTripId: string;

  let lastCode: string | null = null;

  const email = `checklists-e2e-${Date.now()}@example.com`;
  const memberEmail = `checklists-e2e-member-${Date.now()}@example.com`;
  const strangerEmail = `checklists-e2e-stranger-${Date.now()}@example.com`;

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

    const emailCodeService = moduleFixture.get(EmailCodeService);
    const realCreateCode = emailCodeService.createCode.bind(emailCodeService);
    vi.spyOn(emailCodeService, 'createCode').mockImplementation((mail) => {
      lastCode = realCreateCode(mail);
      return lastCode;
    });

    const organizer = await login(email);
    organizerToken = organizer.token;
    organizerId = organizer.id;

    const member = await login(memberEmail);
    memberToken = member.token;
    memberId = member.id;

    const stranger = await login(strangerEmail);
    strangerToken = stranger.token;
    strangerId = stranger.id;

    objectId = (
      await dataSource.query(
        `INSERT INTO objects (name, type) VALUES ('Вершина для чек-листов', 'вершина') RETURNING id`,
      )
    )[0].id;

    tripId = (
      await dataSource.query(
        `INSERT INTO trips (organizer_user_id, goal_object_id, route_text)
         VALUES ($1, $2, '') RETURNING id`,
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

    copyTripId = (
      await dataSource.query(
        `INSERT INTO trips (organizer_user_id, goal_object_id, route_text, visibility)
         VALUES ($1, $2, '', 'private') RETURNING id`,
        [organizerId, objectId],
      )
    )[0].id;

    // Организатор и участник в составе; посторонний — нет. В походах,
    // которые проверяют приватность, организатор тоже в составе: иначе
    // его собственный поход отвечал бы ему 404 и тест врал бы.
    await dataSource.query(
      `INSERT INTO trip_participants (trip_id, user_id, status)
       VALUES ($1, $2, 'going'), ($1, $3, 'going'),
              ($4, $2, 'going'), ($5, $2, 'going')`,
      [tripId, organizerId, memberId, privateTripId, copyTripId],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // Списки — до пользователей: внешний ключ на владельца RESTRICT.
      // Списки походов уедут каскадом вместе с походами.
      await dataSource.query(
        'DELETE FROM checklists WHERE owner_user_id = ANY($1::uuid[])',
        [[organizerId, memberId, strangerId]],
      );
      await dataSource.query(
        'DELETE FROM trips WHERE id = ANY($1::bigint[])',
        [[tripId, privateTripId, copyTripId]],
      );
      await dataSource.query('DELETE FROM objects WHERE id = $1', [objectId]);
      await dataSource.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        [organizerId, memberId, strangerId],
      ]);
    }
    await app?.close();
  });

  /** Что вернул API на отмеченный запрос. */
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

  /** Завести шаблон и вернуть его тело. */
  async function createTemplate(title = 'Снаряжение, лето'): Promise<string> {
    const response = await call('post', '/api/checklists', organizerToken, { title });
    expect(response.status).toBe(201);

    return response.body.id as string;
  }

  describe('шаблоны', () => {
    it('список шаблонов по умолчанию пуст', async () => {
      const response = await call('get', '/api/checklists', strangerToken).expect(200);

      expect(response.body.checklists).toEqual([]);
    });

    it('шаблон создаётся с заголовком и без пунктов', async () => {
      const response = await call('post', '/api/checklists', strangerToken, {
        title: 'Аптечка',
      });

      expect(response.status).toBe(201);
      expect(response.body.scope).toBe('template');
      expect(response.body.title).toBe('Аптечка');
      expect(response.body.items).toEqual([]);
      expect(response.body.ownerUserId).toBe(strangerId);
      expect(response.body.tripId).toBeNull();
    });

    it('заголовок из одних пробелов — 400', async () => {
      const response = await call('post', '/api/checklists', organizerToken, {
        title: '   ',
      });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('заголовок');
    });

    it('без заголовка — 400 от валидации', async () => {
      await call('post', '/api/checklists', organizerToken, {}).expect(400);
    });

    it('слишком длинный заголовок — 400', async () => {
      await call('post', '/api/checklists', organizerToken, {
        title: 'я'.repeat(121),
      }).expect(400);
    });

    it('пункты добавляются и возвращаются вместе со списком', async () => {
      const id = await createTemplate('Снаряжение, зима');

      const added = await call('post', `/api/checklists/${id}/items`, organizerToken, {
        title: 'Палатка',
      });
      expect(added.status).toBe(201);
      expect(added.body.title).toBe('Палатка');
      expect(added.body.isDone).toBe(false);
      expect(added.body.doneAt).toBeNull();
      expect(added.body.createdByUserId).toBe(organizerId);

      const list = await call('get', '/api/checklists', organizerToken).expect(200);
      const found = (
        list.body.checklists as Array<{ id: string; items: unknown[] }>
      ).find((checklist) => checklist.id === id);
      expect(found?.items).toHaveLength(1);
    });

    it('пустой пункт — 400', async () => {
      const id = await createTemplate();

      await call('post', `/api/checklists/${id}/items`, organizerToken, {
        title: '  ',
      }).expect(400);
    });

    it('отметка ставится с автором и временем, снимается вместе с ними', async () => {
      const id = await createTemplate();
      const item = (
        await call('post', `/api/checklists/${id}/items`, organizerToken, {
          title: 'Газ',
        })
      ).body.id as string;

      const done = await call('patch', `/api/checklists/items/${item}`, organizerToken, {
        isDone: true,
      });
      expect(done.status).toBe(200);
      expect(done.body.isDone).toBe(true);
      expect(done.body.doneByUserId).toBe(organizerId);
      expect(done.body.doneAt).toBeTruthy();

      const cleared = await call('patch', `/api/checklists/items/${item}`, organizerToken, {
        isDone: false,
      });
      expect(cleared.body.isDone).toBe(false);
      expect(cleared.body.doneByUserId).toBeNull();
      expect(cleared.body.doneAt).toBeNull();
    });

    it('пункт переименовывается', async () => {
      const id = await createTemplate();
      const item = (
        await call('post', `/api/checklists/${id}/items`, organizerToken, {
          title: 'Старое имя',
        })
      ).body.id as string;

      const renamed = await call('patch', `/api/checklists/items/${item}`, organizerToken, {
        title: 'Новое имя',
      });

      expect(renamed.status).toBe(200);
      expect(renamed.body.title).toBe('Новое имя');
    });

    it('чужой шаблон не существует: 404 на чтение, правку и удаление', async () => {
      const id = await createTemplate();

      await call('get', `/api/checklists/${id}`, strangerToken).expect(404);
      await call('patch', `/api/checklists/${id}`, strangerToken, {
        title: 'Мой',
      }).expect(404);
      await call('delete', `/api/checklists/${id}`, strangerToken).expect(404);
      await call('post', `/api/checklists/${id}/items`, strangerToken, {
        title: 'Пункт',
      }).expect(404);
    });

    it('чужой пункт не существует: 404 на правку и удаление', async () => {
      const id = await createTemplate();
      const item = (
        await call('post', `/api/checklists/${id}/items`, organizerToken, {
          title: 'Газ',
        })
      ).body.id as string;

      await call('patch', `/api/checklists/items/${item}`, strangerToken, {
        isDone: true,
      }).expect(404);
      await call('delete', `/api/checklists/items/${item}`, strangerToken).expect(404);
    });

    it('удаление шаблона уносит его пункты', async () => {
      const id = await createTemplate('Удаляемый');
      await call('post', `/api/checklists/${id}/items`, organizerToken, {
        title: 'Пункт',
      }).expect(201);

      await call('delete', `/api/checklists/${id}`, organizerToken).expect(204);

      const items = await dataSource.query(
        'SELECT count(*)::int AS count FROM checklist_items WHERE checklist_id = $1',
        [id],
      );
      expect(items[0].count).toBe(0);
      await call('get', `/api/checklists/${id}`, organizerToken).expect(404);
    });

    it('лишнее поле в теле — 400', async () => {
      await call('post', '/api/checklists', organizerToken, {
        title: 'Шаблон',
        scope: 'trip',
      }).expect(400);
    });

    it('без токена — 401', async () => {
      await request(app.getHttpServer()).get('/api/checklists').expect(401);
    });
  });

  describe('списки похода', () => {
    it('у нового похода списков нет: null, а не пустой список', async () => {
      const response = await call(
        'get',
        `/api/trips/${tripId}/checklists`,
        organizerToken,
      ).expect(200);

      expect(response.body.shared).toBeNull();
      expect(response.body.personal).toBeNull();
    });

    it('общий список заводит организатор, повтор — 409', async () => {
      const created = await call(
        'post',
        `/api/trips/${tripId}/checklists`,
        organizerToken,
        { scope: 'trip' },
      );
      expect(created.status).toBe(201);
      expect(created.body.scope).toBe('trip');
      expect(created.body.tripId).toBe(tripId);
      expect(created.body.ownerUserId).toBeNull();

      await call('post', `/api/trips/${tripId}/checklists`, organizerToken, {
        scope: 'trip',
      }).expect(409);
    });

    it('общий список участнику не завести — 403', async () => {
      await call('post', `/api/trips/${privateTripId}/checklists`, memberToken, {
        scope: 'trip',
      }).expect(404);

      await call('post', `/api/trips/${tripId}/checklists`, memberToken, {
        scope: 'trip',
      }).expect(403);
    });

    it('личный список заводит участник, постороннему — 403', async () => {
      const created = await call(
        'post',
        `/api/trips/${tripId}/checklists`,
        memberToken,
        { scope: 'personal' },
      );

      expect(created.status).toBe(201);
      expect(created.body.scope).toBe('personal');
      expect(created.body.ownerUserId).toBe(memberId);

      await call('post', `/api/trips/${tripId}/checklists`, strangerToken, {
        scope: 'personal',
      }).expect(403);
    });

    it('чужой личный список не виден: и в списке похода, и по id', async () => {
      const personal = await dataSource.query(
        `SELECT id FROM checklists WHERE trip_id = $1 AND scope = 'personal' AND owner_user_id = $2`,
        [tripId, memberId],
      );
      expect(personal).toHaveLength(1);

      const view = await call(
        'get',
        `/api/trips/${tripId}/checklists`,
        organizerToken,
      ).expect(200);
      expect(view.body.personal).toBeNull();

      await call(
        'get',
        `/api/checklists/${personal[0].id as string}`,
        organizerToken,
      ).expect(404);

      const own = await call(
        'get',
        `/api/trips/${tripId}/checklists`,
        memberToken,
      ).expect(200);
      expect(own.body.personal).not.toBeNull();
    });

    it('отметку в общем списке ставит любой участник, посторонний — 403', async () => {
      const shared = await dataSource.query(
        `SELECT id FROM checklists WHERE trip_id = $1 AND scope = 'trip'`,
        [tripId],
      );
      const item = (
        await call(
          'post',
          `/api/checklists/${shared[0].id as string}/items`,
          organizerToken,
          { title: 'Газ' },
        )
      ).body.id as string;

      const done = await call('patch', `/api/checklists/items/${item}`, memberToken, {
        isDone: true,
      });
      expect(done.status).toBe(200);
      expect(done.body.doneByUserId).toBe(memberId);

      await call('patch', `/api/checklists/items/${item}`, strangerToken, {
        isDone: true,
      }).expect(403);
    });

    it('править общий список участник не может — 403', async () => {
      const shared = await dataSource.query(
        `SELECT id FROM checklists WHERE trip_id = $1 AND scope = 'trip'`,
        [tripId],
      );
      const id = shared[0].id as string;

      await call('post', `/api/checklists/${id}/items`, memberToken, {
        title: 'Пункт от участника',
      }).expect(403);

      const list = await call('get', `/api/checklists/${id}`, organizerToken).expect(200);
      const item = (list.body.items as Array<{ id: string }>)[0];

      await call('patch', `/api/checklists/items/${item.id}`, memberToken, {
        title: 'Переименую',
      }).expect(403);
      await call('delete', `/api/checklists/items/${item.id}`, memberToken).expect(403);
    });

    it('приватный поход: списки постороннему не видны — 404', async () => {
      await call(
        'get',
        `/api/trips/${privateTripId}/checklists`,
        strangerToken,
      ).expect(404);
    });

    it('отказавшийся от участия отмечать не может', async () => {
      const shared = await dataSource.query(
        `SELECT id FROM checklists WHERE trip_id = $1 AND scope = 'trip'`,
        [tripId],
      );
      const item = (
        await call(
          'post',
          `/api/checklists/${shared[0].id as string}/items`,
          organizerToken,
          { title: 'Спальник' },
        )
      ).body.id as string;

      await dataSource.query(
        `UPDATE trip_participants SET status = 'declined' WHERE trip_id = $1 AND user_id = $2`,
        [tripId, memberId],
      );

      try {
        await call('patch', `/api/checklists/items/${item}`, memberToken, {
          isDone: true,
        }).expect(403);
      } finally {
        await dataSource.query(
          `UPDATE trip_participants SET status = 'going' WHERE trip_id = $1 AND user_id = $2`,
          [tripId, memberId],
        );
      }
    });

    it('общий список удаляет организатор', async () => {
      const shared = await dataSource.query(
        `SELECT id FROM checklists WHERE trip_id = $1 AND scope = 'trip'`,
        [tripId],
      );

      await call('delete', `/api/checklists/${shared[0].id as string}`, organizerToken).expect(
        204,
      );

      const view = await call(
        'get',
        `/api/trips/${tripId}/checklists`,
        organizerToken,
      ).expect(200);
      expect(view.body.shared).toBeNull();
    });
  });

  describe('копия шаблона в поход', () => {
    it('пункты копируются, а не ссылаются: правка шаблона поход не трогает', async () => {
      const template = await createTemplate('Аптечка, лето');
      await call('post', `/api/checklists/${template}/items`, organizerToken, {
        title: 'Бинт',
      }).expect(201);
      await call('post', `/api/checklists/${template}/items`, organizerToken, {
        title: 'Пластырь',
      }).expect(201);

      const created = await call(
        'post',
        `/api/trips/${privateTripId}/checklists`,
        organizerToken,
        { scope: 'trip', fromTemplateId: Number(template) },
      );
      expect(created.status).toBe(201);
      expect(created.body.title).toBe('Аптечка, лето');
      expect((created.body.items as unknown[]).length).toBe(2);

      // Меняем шаблон: пункты похода должны остаться прежними.
      const templateItems = (
        await call('get', `/api/checklists/${template}`, organizerToken)
      ).body.items as Array<{ id: string }>;
      await call('patch', `/api/checklists/items/${templateItems[0].id}`, organizerToken, {
        title: 'Бинт стерильный',
      }).expect(200);

      const tripChecklists = await call(
        'get',
        `/api/trips/${privateTripId}/checklists`,
        organizerToken,
      ).expect(200);
      const titles = (tripChecklists.body.shared.items as Array<{ title: string }>).map(
        (item) => item.title,
      );
      expect(titles).toContain('Бинт');
      expect(titles).not.toContain('Бинт стерильный');
    });

    it('удаление шаблона не трогает скопированный список', async () => {
      const template = await createTemplate('Удаляемый шаблон');
      await call('post', `/api/checklists/${template}/items`, organizerToken, {
        title: 'Пункт',
      }).expect(201);

      const created = await call(
        'post',
        `/api/trips/${copyTripId}/checklists`,
        organizerToken,
        { scope: 'trip', fromTemplateId: Number(template) },
      );
      expect(created.status).toBe(201);

      await call('delete', `/api/checklists/${template}`, organizerToken).expect(204);

      const view = await call(
        'get',
        `/api/trips/${copyTripId}/checklists`,
        organizerToken,
      ).expect(200);
      expect(view.body.shared).not.toBeNull();
      expect((view.body.shared.items as unknown[]).length).toBe(1);
    });

    it('чужой шаблон скопировать нельзя — 404', async () => {
      const template = await createTemplate('Чужой не нужен');

      // Личный список у участника уже есть (проверяли выше), а повтор
      // даёт 409 до чтения шаблона: убираем его, чтобы проверялось именно
      // право на шаблон, а не уникальность списка.
      await dataSource.query(
        `DELETE FROM checklists WHERE trip_id = $1 AND scope = 'personal' AND owner_user_id = $2`,
        [tripId, memberId],
      );

      await call(
        'post',
        `/api/trips/${tripId}/checklists`,
        memberToken,
        { scope: 'personal', fromTemplateId: Number(template) },
      ).expect(404);
    });
  });

  describe('отказы', () => {
    it('нечисловой id — 400, несуществующий — 404', async () => {
      await call('get', '/api/checklists/abc', organizerToken).expect(400);
      await call('get', '/api/checklists/999999', organizerToken).expect(404);
      await call('get', '/api/trips/abc/checklists', organizerToken).expect(400);
    });

    it('без токена списки похода закрыты', async () => {
      await request(app.getHttpServer())
        .get(`/api/trips/${tripId}/checklists`)
        .expect(401);
    });
  });
});
