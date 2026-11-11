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
 * Занятость снаряжения по `gear_uid` и архив похода (e2e) — 11.11.2026, шаг 2.
 *
 * Заказчик (план §5–§9): «Завершённые походы не занимают снаряжение.
 * Занятость — только решённые (`decided`) нескончавшиеся походы; `proposed`
 * занимает, `declined` — нет»; «Смена дат и переход в `decided` — проверка
 * конфликтов: сдвигаемый поход теряет вещь, в чаты `trip_route` и `trip_gear`
 * уходит сообщение»; «Если строка ссылается на удалённую вещь, сначала ищем
 * активные клоны по `gear_uid`. Есть — пишем „вещь удалена из каталога, но она
 * есть у …“».
 *
 * Проверяется то, чего не видно в юнит-тестах, — правила на трёх таблицах
 * похода и на двух чатах:
 *
 * 1. вещь занята в чужом живом решённом походе на пересекающихся датах —
 *    `propose`, `addPersonal` и `addSleeping` отвечают 409;
 * 2. второй клон той же вещи в том же походе — тоже 409: уникальный индекс
 *    `(trip_id, gear_item_id)` его не видит;
 * 3. на непересекающиеся даты — можно;
 * 4. переход в `decided` снимает ставшую занятой строку и пишет одно
 *    сообщение в оба чата;
 * 5. сдвиг дат решённого похода делает то же, а второй поход сохраняет вещь;
 * 6. `GET /gear?tripId=` отдаёт занятые вещи для бейджа «занята»;
 * 7. мягко удалённая вещь остаётся в строке похода с `itemDeleted: true`,
 *    а `itemHolders` называет живые клоны («она есть у Ивана»); после удаления
 *    всех копий держателей нет.
 *
 * Походы здесь создаются через API: у них должны быть чаты, иначе системное
 * сообщение о снятых строках некуда писать (и сервер честно упадёт). Участие
 * второго человека — прямой вставкой: правила состава проверены в
 * `trips.e2e-spec.ts`.
 */
describe('Занятость снаряжения и архив похода (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  let annaId: string;
  let annaToken: string;
  let ivanId: string;
  let ivanToken: string;

  let objectId: string;
  let typeId: number;

  /** Походы: A и D пересекаются, B и E — нет, P сначала «планирую». */
  let tripA: string;
  let tripB: string;
  let tripD: string;
  let tripE: string;
  let tripPlan: string;
  let tripPast: string;

  /** Вещи: у каждой по клону у Анны и у Ивана. */
  let tentAnneId: string;
  let tentIvanId: string;
  let bagAnneId: string;
  let bagIvanId: string;
  let matAnneId: string;
  let matIvanId: string;
  let cupAnneId: string;
  let cupIvanId: string;
  let spoonAnneId: string;
  let plaidAnneId: string;
  let plaidIvanId: string;

  const realUserIds: string[] = [];
  const tripIds: string[] = [];

  let lastCode: string | null = null;

  const annaEmail = `gear-busy-e2e-anna-${Date.now()}@example.com`;
  const ivanEmail = `gear-busy-e2e-ivan-${Date.now()}@example.com`;

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

  /** Дата похода: смещение в днях от сегодня, полночь UTC. */
  function isoDay(offset: number): string {
    const moment = new Date(Date.now() + offset * 86_400_000);
    return `${moment.toISOString().slice(0, 10)}T00:00:00.000Z`;
  }

  /** Поход через API — с чатами, составом и ролями. Второй участник — SQL. */
  async function makeTrip(
    title: string,
    status: 'planning' | 'decided',
    from: number,
    to: number,
  ): Promise<string> {
    const created = await call('post', '/api/trips', annaToken, {
      goalObjectId: Number(objectId),
      status,
      announcement: title,
      startsAt: isoDay(from),
      endsAt: isoDay(to),
    }).expect(201);

    const id = String(created.body.id);
    tripIds.push(id);

    await dataSource.query(
      `INSERT INTO trip_participants (trip_id, user_id, status)
       VALUES ($1, $2, 'going')
       ON CONFLICT DO NOTHING`,
      [id, ivanId],
    );

    return id;
  }

  async function makeGear(title: string): Promise<string> {
    const created = await call('post', '/api/gear', annaToken, {
      typeId,
      title,
      weightGrams: 1000,
    }).expect(201);

    return created.body.id as string;
  }

  /** Клон вещи в каталоге Ивана: та же `gear_uid`, своя строка. */
  async function ivanCloneOf(title: string): Promise<string> {
    const list = await call('get', '/api/gear', ivanToken).expect(200);
    const item = (
      list.body.items as Array<{ id: string; title: string }>
    ).find((row) => row.title === title);

    if (!item) throw new Error(`У Ивана нет клона «${title}»`);
    return item.id;
  }

  /** Строки похода по вещи: три таблицы, которые держат снаряжение. */
  async function tripRowsOf(
    tripId: string,
    gearItemId: string,
  ): Promise<{
    shared: number;
    personal: number;
    sleeping: number;
  }> {
    const [shared] = await dataSource.query(
      'SELECT count(*)::int AS "count" FROM trip_gear WHERE trip_id = $1 AND gear_item_id = $2',
      [tripId, gearItemId],
    );
    const [personal] = await dataSource.query(
      'SELECT count(*)::int AS "count" FROM trip_personal_gear WHERE trip_id = $1 AND gear_item_id = $2',
      [tripId, gearItemId],
    );
    const [sleeping] = await dataSource.query(
      'SELECT count(*)::int AS "count" FROM trip_route_sleeping WHERE trip_id = $1 AND gear_item_id = $2',
      [tripId, gearItemId],
    );

    return {
      shared: shared.count as number,
      personal: personal.count as number,
      sleeping: sleeping.count as number,
    };
  }

  /** Последнее сообщение чата: системные тексты о снятых строках. */
  async function lastMessage(
    tripId: string,
    kind: 'trip_route' | 'trip_gear',
  ): Promise<string | null> {
    const rows: Array<{ body: string }> = await dataSource.query(
      `SELECT m.body
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE c.trip_id = $1 AND c.kind = $2
        ORDER BY m.id DESC
        LIMIT 1`,
      [tripId, kind],
    );

    return rows[0]?.body ?? null;
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

    realUserIds.push(annaId, ivanId);

    objectId = (
      await dataSource.query(
        `INSERT INTO objects (name, type)
         VALUES ('Озеро для занятости снаряжения', 'озеро') RETURNING id`,
      )
    )[0].id;

    const typeRows: Array<{ id: number }> = [];
    typeRows.push(
      ...(await dataSource.query(
        `INSERT INTO gear_types (code, name)
         VALUES ('e2e_gear_busy', 'Вещь для занятости')
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
      )),
    );
    typeId = typeRows[0].id;

    // Родство: у каждого своя копия вещи с тем же `gear_uid`.
    await call('post', '/api/users/me/family', annaToken, {
      userId: ivanId,
    }).expect(201);
    await call(
      'post',
      `/api/users/me/family/${annaId}/accept`,
      ivanToken,
    ).expect(200);

    // Пары походов: A и D пересекаются (10–12 и 11–13), B и E — нет.
    tripA = await makeTrip('Ратный', 'decided', 10, 12);
    tripD = await makeTrip('Витязь', 'decided', 11, 13);
    tripB = await makeTrip('Байкал', 'decided', 20, 22);
    tripE = await makeTrip('Хамар', 'decided', 40, 41);
    tripPlan = await makeTrip('Планируемый', 'planning', 11, 13);
    tripPast = await makeTrip('Прошедший', 'decided', -10, -8);

    // Вещи заводит Анна: Ивану они встают клонами.
    tentAnneId = await makeGear('Палатка общая');
    bagAnneId = await makeGear('Сидушка общая');
    matAnneId = await makeGear('Коврик общий');
    cupAnneId = await makeGear('Кружка общая');
    spoonAnneId = await makeGear('Ложка общая');
    plaidAnneId = await makeGear('Плед архивный');

    tentIvanId = await ivanCloneOf('Палатка общая');
    bagIvanId = await ivanCloneOf('Сидушка общая');
    matIvanId = await ivanCloneOf('Коврик общий');
    cupIvanId = await ivanCloneOf('Кружка общая');
    plaidIvanId = await ivanCloneOf('Плед архивный');
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      if (tripIds.length > 0) {
        await dataSource.query('DELETE FROM trips WHERE id = ANY($1::bigint[])', [
          tripIds,
        ]);
      }
      // Вещи — раньше людей: `gear_items.owner_user_id` держит RESTRICT.
      await dataSource.query(
        'DELETE FROM gear_items WHERE owner_user_id = ANY($1::uuid[])',
        [realUserIds],
      );
      await dataSource.query(
        `DELETE FROM gear_types WHERE code = 'e2e_gear_busy'`,
      );
      await dataSource.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        realUserIds,
      ]);
      await dataSource.query('DELETE FROM objects WHERE id = $1', [objectId]);
    }
    await app?.close();
  });

  it('у Ивана лежит клон каждой вещи Анны', async () => {
    const rows: Array<{ count: number }> = await dataSource.query(
      `SELECT count(*)::int AS "count"
         FROM gear_items gi
         JOIN gear_items anna ON anna.gear_uid = gi.gear_uid
        WHERE gi.owner_user_id = $1 AND anna.owner_user_id = $2`,
      [ivanId, annaId],
    );

    expect(rows[0].count).toBe(6);
    expect(tentIvanId).not.toBe(tentAnneId);
  });

  it('второй клон той же вещи в том же походе — 409', async () => {
    await call('post', `/api/trips/${tripA}/gear`, annaToken, {
      gearItemId: Number(tentAnneId),
    }).expect(201);

    const refused = await call(
      'post',
      `/api/trips/${tripA}/gear`,
      ivanToken,
      { gearItemId: Number(tentIvanId) },
    ).expect(409);

    expect(refused.body.message).toContain('уже в этом походе');
  });

  it('вещь занята в другом решённом походе на те же даты — 409', async () => {
    await call('post', `/api/trips/${tripA}/gear`, annaToken, {
      gearItemId: Number(bagAnneId),
    }).expect(201);

    // D (11–13) пересекается с A (10–12), а вещь в A.
    const refused = await call(
      'post',
      `/api/trips/${tripD}/gear`,
      ivanToken,
      { gearItemId: Number(bagIvanId) },
    ).expect(409);

    expect(refused.body.message).toContain('Сидушка общая');
    expect(refused.body.message).toContain('Ратный');
    expect((await tripRowsOf(tripD, bagIvanId)).shared).toBe(0);
  });

  it('на непересекающиеся даты эту же вещь взять можно', async () => {
    await call('post', `/api/trips/${tripB}/gear`, ivanToken, {
      gearItemId: Number(bagIvanId),
    }).expect(201);

    expect((await tripRowsOf(tripB, bagIvanId)).shared).toBe(1);
  });

  it('«Взял» проверяет занятость так же, как снаряжение похода', async () => {
    await call('post', `/api/trips/${tripA}/gear`, annaToken, {
      gearItemId: Number(matAnneId),
    }).expect(201);

    // tripPlan (11–13) пересекается с A (10–12), коврик занят в A.
    const refused = await call(
      'post',
      `/api/trips/${tripPlan}/gear/personal`,
      ivanToken,
      { gearItemId: Number(matIvanId) },
    ).expect(409);

    expect(refused.body.message).toContain('Коврик общий');
    expect(refused.body.message).toContain('Ратный');
    expect((await tripRowsOf(tripPlan, matIvanId)).personal).toBe(0);
  });

  it('«Спальник» тоже не берёт занятую вещь', async () => {
    const refused = await call(
      'post',
      `/api/trips/${tripPlan}/route/sleeping`,
      ivanToken,
      // «Спальник» принимает id **строкой** — так устроен его DTO.
      { gearItemId: matIvanId },
    ).expect(409);

    expect(refused.body.message).toContain('Коврик общий');
    expect((await tripRowsOf(tripPlan, matIvanId)).sleeping).toBe(0);
  });

  it('бейдж «занята»: каталог для похода знает, где вещь занята', async () => {
    const forD = await call(
      'get',
      `/api/gear?tripId=${tripD}`,
      annaToken,
    ).expect(200);

    const busy = (forD.body.busyGear as Array<{
      gearItemId: string;
      tripTitle: string;
    }>).find((row) => row.gearItemId === bagAnneId);
    expect(busy?.tripTitle).toBe('Ратный');

    const forE = await call(
      'get',
      `/api/gear?tripId=${tripE}`,
      annaToken,
    ).expect(200);
    expect(forE.body.busyGear).toEqual([]);

    // Обычный каталог про походы не знает: подсказки в нём нет.
    const plain = await call('get', '/api/gear', annaToken).expect(200);
    expect(plain.body.busyGear).toBeUndefined();
  });

  it('переход в decided снимает конфликт и пишет в оба чата', async () => {
    await call('post', `/api/trips/${tripA}/gear`, annaToken, {
      gearItemId: Number(cupAnneId),
    }).expect(201);

    // Пока поход «планирую» и даты не пересекаются — строку ставят.
    await call('patch', `/api/trips/${tripPlan}`, annaToken, {
      startsAt: isoDay(25),
      endsAt: isoDay(26),
    }).expect(200);

    await call('post', `/api/trips/${tripPlan}/gear`, ivanToken, {
      gearItemId: Number(cupIvanId),
    }).expect(201);

    expect((await tripRowsOf(tripPlan, cupIvanId)).shared).toBe(1);

    // Решение на пересекающиеся даты: сдвигаемый поход теряет вещь.
    await call('patch', `/api/trips/${tripPlan}`, annaToken, {
      status: 'decided',
      startsAt: isoDay(11),
      endsAt: isoDay(13),
    }).expect(200);

    expect((await tripRowsOf(tripPlan, cupIvanId)).shared).toBe(0);
    expect((await tripRowsOf(tripA, cupAnneId)).shared).toBe(1);

    const inRoute = await lastMessage(tripPlan, 'trip_route');
    const inGear = await lastMessage(tripPlan, 'trip_gear');

    expect(inRoute).toContain('Поход решён');
    expect(inRoute).toContain('Кружка общая');
    expect(inRoute).toContain('Ратный');
    expect(inGear).toBe(inRoute);
  });

  it('сдвиг дат решённого похода снимает ставшие занятыми строки', async () => {
    // Та же ложка живёт и в A (10–12), и в B (20–22): даты не пересекаются.
    await call('post', `/api/trips/${tripA}/gear`, annaToken, {
      gearItemId: Number(spoonAnneId),
    }).expect(201);
    await call('post', `/api/trips/${tripB}/gear`, annaToken, {
      gearItemId: Number(spoonAnneId),
    }).expect(201);

    expect((await tripRowsOf(tripB, spoonAnneId)).shared).toBe(1);

    // Сдвигаем B на даты A — «сдвигаемый поход теряет вещь».
    await call('patch', `/api/trips/${tripB}`, annaToken, {
      startsAt: isoDay(10),
      endsAt: isoDay(12),
    }).expect(200);

    expect((await tripRowsOf(tripB, spoonAnneId)).shared).toBe(0);
    expect((await tripRowsOf(tripA, spoonAnneId)).shared).toBe(1);

    // Заодно из B ушла сидушка: она тоже стоит в A на этих датах.
    expect((await tripRowsOf(tripB, bagIvanId)).shared).toBe(0);

    const message = await lastMessage(tripB, 'trip_gear');
    expect(message).toContain('Даты изменились');
    expect(message).toContain('Ложка общая');
    expect(message).toContain('Сидушка общая');
    expect(await lastMessage(tripB, 'trip_route')).toBe(message);
  });

  it('удалённая вещь остаётся в истории, а «есть у …» находит живой клон', async () => {
    // Прошедший поход: он не занимает снаряжение и не блокирует удаление.
    await call('post', `/api/trips/${tripPast}/gear`, annaToken, {
      gearItemId: Number(plaidAnneId),
    }).expect(201);

    // Выход из семьи рвёт связи, но копии остаются: у Ивана свой плед.
    await call('delete', '/api/users/me/family', ivanToken).expect(204);
    await call('delete', `/api/gear/${plaidAnneId}`, annaToken).expect(204);

    const list = await call('get', `/api/trips/${tripPast}/gear`, annaToken).expect(
      200,
    );
    const row = (list.body.items as Array<{
      gearItemId: string;
      itemDeleted: boolean;
      itemHolders: Array<{ userId: string; name: string }>;
    }>).find((item) => item.gearItemId === plaidAnneId);

    expect(row?.itemDeleted).toBe(true);
    expect(row?.itemHolders.map((person) => person.userId)).toEqual([ivanId]);
    expect(row?.itemHolders[0].name.length).toBeGreaterThan(0);

    // Удаляем последнюю копию — держателей больше нет, экран скажет
    // «снаряжение недоступно».
    await call('delete', `/api/gear/${plaidIvanId}`, ivanToken).expect(204);

    const after = await call(
      'get',
      `/api/trips/${tripPast}/gear`,
      annaToken,
    ).expect(200);
    const gone = (after.body.items as Array<{
      gearItemId: string;
      itemDeleted: boolean;
      itemHolders: unknown[];
    }>).find((item) => item.gearItemId === plaidAnneId);

    expect(gone?.itemDeleted).toBe(true);
    expect(gone?.itemHolders).toEqual([]);
  });
});
