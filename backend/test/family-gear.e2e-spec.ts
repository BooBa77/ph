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
 * Общее снаряжение родных (e2e) — 10.11.2026, вечер.
 *
 * Заказчик: «у родных снаряжение общее… В походе родные равноправно могут
 * использовать снаряжение, но если один задействовал что-то, то второму
 * нельзя, нельзя один спальник обоим взять. Кто выставил снарягу для
 * общественных нужд, тот считается и владельцем».
 *
 * Проверяем ровно четыре следствия, которых не видно в unit-тестах:
 *
 * 1. **Каталог остаётся личным, а общая полка — отдельной.** `GET /gear`
 *    отдаёт мои вещи в `items`, вещи родных — в `familyItems` с именем
 *    владельца; чужое (не родного) туда не попадает.
 * 2. **В поход вещь родного берут как свою.** Предложить её в «Берём»,
 *    взять в «Взял» и положить в «Спальник» может любой из родных.
 * 3. **Владелец строки похода — тот, кто выставил,** даже если вещь лежит
 *    в каталоге родного: `ownerUserId` строки — автор запроса.
 * 4. **Одна вещь — одно использование.** Второй родной получает 409:
 *    и в «Взял», и в «Спальнике», и при попытке предложить занятую вещь
 *    в общественное снаряжение. Это правило стоит и в базе (уникальные
 *    индексы по `trip_id, gear_item_id`), и в сервисе (человеческий текст).
 *
 * Поход, типы и вещи тест заводит напрямую в базе: правила состава
 * и справочника проверены в `trips.e2e-spec.ts` и `gear-types.e2e-spec.ts`,
 * а здесь важна общая полка семьи.
 */
describe('Общее снаряжение родных (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  let annaId: string;
  let annaToken: string;
  let ivanId: string;
  let ivanToken: string;
  let strangerId: string;

  let objectId: string;
  let tripId: string;

  let tentTypeId: number;
  let bagTypeId: number;

  /** Мои вещи Анны и Ивана: палатки и спальники. */
  let annaTentId: string;
  let ivanTentId: string;
  let annaBagId: string;
  let ivanBagId: string;
  /** Вещь постороннего: родным она не принадлежит. */
  let strangerTentId: string;

  const realUserIds: string[] = [];

  let lastCode: string | null = null;

  const annaEmail = `family-gear-e2e-anna-${Date.now()}@example.com`;
  const ivanEmail = `family-gear-e2e-ivan-${Date.now()}@example.com`;
  const strangerEmail = `family-gear-e2e-stranger-${Date.now()}@example.com`;

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
   * Тип снаряжения — прямой вставкой: справочник типов проверяется
   * в своей спеке, а здесь нужны два стабильных кода. `ON CONFLICT`
   * оставляет прежнюю строку, поэтому повторный прогон не спорит.
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

  /** Предмет каталога: имя, тип и владелец. */
  async function makeItem(
    ownerUserId: string,
    gearTypeId: number,
    title: string,
  ): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO gear_items (owner_user_id, gear_type_id, title)
       VALUES ($1, $2, $3) RETURNING id`,
      [ownerUserId, gearTypeId, title],
    );

    return rows[0].id;
  }

  /** Поход, где оба родных идут: только в походе вещь родного доступна. */
  async function makeTrip(): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO trips (organizer_user_id, goal_object_id, status)
       VALUES ($1, $2, 'planning') RETURNING id`,
      [annaId, objectId],
    );
    const id = rows[0].id;

    await dataSource.query(
      `INSERT INTO trip_participants (trip_id, user_id, status)
       VALUES ($1, $2, 'going'), ($1, $3, 'going')`,
      [id, annaId, ivanId],
    );

    return id;
  }

  /** Имя в каталоге — по нему экран подписывает чужую вещь. */
  async function rename(token: string, displayName: string): Promise<void> {
    await call('patch', '/api/users/me', token, { displayName }).expect(200);
  }

  async function familyOf(token: string) {
    return (await call('get', '/api/users/me/family', token).expect(200)).body
      .family as Array<{ userId: string }>;
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

    const anna = await login(annaEmail);
    annaToken = anna.token;
    annaId = anna.id;

    const ivan = await login(ivanEmail);
    ivanToken = ivan.token;
    ivanId = ivan.id;

    const stranger = await login(strangerEmail);
    strangerId = stranger.id;

    realUserIds.push(annaId, ivanId, strangerId);

    await rename(annaToken, 'Анна');
    await rename(ivanToken, 'Иван');

    objectId = (
      await dataSource.query(
        `INSERT INTO objects (name, type)
         VALUES ('Озеро для общих вещей', 'озеро') RETURNING id`,
      )
    )[0].id;

    tentTypeId = await makeType('e2e_family_tent', 'Палатка семьи');
    bagTypeId = await makeType('e2e_family_bag', 'Спальник семьи');

    annaTentId = await makeItem(annaId, tentTypeId, 'Палатка Анны');
    ivanTentId = await makeItem(ivanId, tentTypeId, 'Палатка Ивана');
    annaBagId = await makeItem(annaId, bagTypeId, 'Спальник Анны');
    ivanBagId = await makeItem(ivanId, bagTypeId, 'Спальник Ивана');
    strangerTentId = await makeItem(strangerId, tentTypeId, 'Палатка постороннего');

    // Родство по-настоящему: запрос и согласие, как в «Контактах».
    await call('post', '/api/users/me/family', annaToken, {
      userId: ivanId,
    }).expect(201);
    await call(
      'post',
      `/api/users/me/family/${annaId}/accept`,
      ivanToken,
    ).expect(200);

    tripId = await makeTrip();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query('DELETE FROM trips WHERE id = $1', [tripId]);
      // Вещи — раньше людей: `gear_items.owner_user_id` держит RESTRICT.
      await dataSource.query(
        `DELETE FROM gear_items
          WHERE id = ANY($1::bigint[])`,
        [[annaTentId, ivanTentId, annaBagId, ivanBagId, strangerTentId]],
      );
      await dataSource.query(
        `DELETE FROM gear_types WHERE code IN ('e2e_family_tent', 'e2e_family_bag')`,
      );
      await dataSource.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        realUserIds,
      ]);
      await dataSource.query('DELETE FROM objects WHERE id = $1', [objectId]);
    }
    await app?.close();
  });

  // ─────────────────────────── общая полка ───────────────────────────

  it('родство подтверждено, поход общий', async () => {
    expect((await familyOf(annaToken)).map((row) => row.userId)).toEqual([
      ivanId,
    ]);
  });

  it('GET /gear отдаёт вещи родных отдельным списком и с именем владельца', async () => {
    const anna = await call('get', '/api/gear', annaToken).expect(200);

    const mine = (anna.body.items as Array<{ id: string }>).map((row) => row.id);
    expect(mine).toContain(annaTentId);
    expect(mine).toContain(annaBagId);
    expect(mine).not.toContain(ivanTentId);

    const family = anna.body.familyItems as Array<{
      id: string;
      ownerUserId: string;
      ownerName: string;
      groupName: string;
    }>;
    const ivanTent = family.find((row) => row.id === ivanTentId);
    expect(ivanTent?.ownerUserId).toBe(ivanId);
    expect(ivanTent?.ownerName).toBe('Иван');
    // Полка синтетическая: чужие вещи не разложены по моим группам.
    expect(ivanTent?.groupName).toBe('Снаряжение родных');

    // Вещь постороннего в семью не попала.
    expect(family.map((row) => row.id)).not.toContain(strangerTentId);
  });

  it('вещи постороннего родному недоступны — 404', async () => {
    await call('post', `/api/trips/${tripId}/gear`, annaToken, {
      gearItemId: Number(strangerTentId),
    }).expect(404);
  });

  // ─────────────────────── общественное снаряжение ───────────────────────

  it('родной предлагает вещь родного в «Берём», и владельцем становится он сам', async () => {
    const created = await call(
      'post',
      `/api/trips/${tripId}/gear`,
      annaToken,
      { gearItemId: Number(ivanTentId) },
    ).expect(201);

    // «Кто выставил снарягу для общественных нужд, тот считается и владельцем».
    expect(created.body.ownerUserId).toBe(annaId);
    expect(created.body.title).toBe('Палатка Ивана');

    const list = await call('get', `/api/trips/${tripId}/gear`, ivanToken).expect(
      200,
    );
    const row = (list.body.items as Array<{ gearItemId: string; ownerUserId: string }>).find(
      (item) => item.gearItemId === ivanTentId,
    );
    expect(row?.ownerUserId).toBe(annaId);
  });

  it('занятую в «Берём» вещь второй родной в «Взял» не возьмёт — 409', async () => {
    const response = await call(
      'post',
      `/api/trips/${tripId}/gear/personal`,
      ivanToken,
      { gearItemId: Number(ivanTentId) },
    ).expect(409);

    expect(response.body.message).toContain('общественном');
  });

  // ─────────────────────────── личные вещи ───────────────────────────

  it('спальник родного берут в «Взял» как свою вещь', async () => {
    const created = await call(
      'post',
      `/api/trips/${tripId}/gear/personal`,
      annaToken,
      { gearItemId: Number(ivanBagId) },
    ).expect(201);

    expect(created.body.gearItemId).toBe(ivanBagId);
    expect(created.body.title).toBe('Спальник Ивана');
  });

  it('ту же вещь второй родной в «Взял» не возьмёт — 409', async () => {
    const response = await call(
      'post',
      `/api/trips/${tripId}/gear/personal`,
      ivanToken,
      { gearItemId: Number(ivanBagId) },
    ).expect(409);

    expect(response.body.message).toContain('родной');
  });

  it('вещь из «Взял» не встаёт в «Спальник» — 409', async () => {
    await call(
      'post',
      `/api/trips/${tripId}/route/sleeping`,
      ivanToken,
      { gearItemId: ivanBagId },
    ).expect(409);
  });

  it('один спальник двоим не взять: второй родной получает 409', async () => {
    // Свой спальник Анны — в её «Спальник»: это обычный путь, не родной.
    await call(
      'post',
      `/api/trips/${tripId}/route/sleeping`,
      annaToken,
      { gearItemId: annaBagId },
    ).expect(200);

    // Иван видит спальник Анны в общей полке и пробует взять его себе.
    const response = await call(
      'post',
      `/api/trips/${tripId}/route/sleeping`,
      ivanToken,
      { gearItemId: annaBagId },
    ).expect(409);

    expect(response.body.message).toContain('родной');

    // Повтор своего же спальника ничего не ломает — вкладка возвращается.
    await call(
      'post',
      `/api/trips/${tripId}/route/sleeping`,
      annaToken,
      { gearItemId: annaBagId },
    ).expect(200);
  });

  it('в «Спальнике» у каждого свои строки: чужих не видно', async () => {
    const anna = await call('get', `/api/trips/${tripId}/route`, annaToken).expect(
      200,
    );
    const ivan = await call('get', `/api/trips/${tripId}/route`, ivanToken).expect(
      200,
    );

    expect(
      (anna.body.sleeping as Array<{ gearItemId: string }>).map(
        (row) => row.gearItemId,
      ),
    ).toEqual([annaBagId]);
    expect(ivan.body.sleeping).toEqual([]);
  });
});
