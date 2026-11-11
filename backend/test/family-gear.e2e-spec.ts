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
 * Семейный каталог: клоны вещи у родных (e2e) — 11.11.2026.
 *
 * Заказчик: «Один физический предмет — один неизменный `gear_uid`. В каталоге
 * каждого члена семьи лежит свой клон с тем же `gear_uid`… Правка обновляет
 * все активные клоны `gear_uid` в текущей компоненте… Удаление — `deleted_at`
 * на клонах текущей компоненты; у бывшего остаётся его копия».
 *
 * Здесь проверяются следствия, которых не видно в unit-тестах:
 *
 * 1. добавленная вещь сразу появляется клоном у родного, с тем же `gear_uid`
 *    и тем же автором (`origin_user_id`);
 * 2. правка (включая характеристики) зеркалится по компоненте, в какую
 *    сторону её ни сделай;
 * 3. удаление — мягкое и по компоненте: вещь исчезает из обоих каталогов,
 *    но строки походов остаются (проверяется `deleted_at`, а не отсутствием
 *    строки);
 * 4. вещь в живом решённом походе удалить нельзя (409), а после окончания
 *    похода — можно;
 * 5. выход из семьи рвёт все связи, но **не** удаляет клоны: копии остаются,
 *    а правки перестают зеркалиться;
 * 6. в поход ставится свой клон: вещь родного по её id не предлагается (404).
 *
 * Поход, типы и объект тест заводит напрямую в базе: правила состава
 * и справочника проверены в `trips.e2e-spec.ts` и `gear-types.e2e-spec.ts`.
 */
describe('Семейный каталог: клоны вещи (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  let annaId: string;
  let annaToken: string;
  let ivanId: string;
  let ivanToken: string;
  let strangerId: string;
  let strangerToken: string;

  let objectId: string;
  let tripId: string;

  let tentTypeId: number;

  /** Мои вещи Анны и клон Ивана: ключ один, строки разные. */
  let annaTentId: string;
  let ivanTentCloneId: string;

  const realUserIds: string[] = [];

  let lastCode: string | null = null;

  const annaEmail = `family-clones-e2e-anna-${Date.now()}@example.com`;
  const ivanEmail = `family-clones-e2e-ivan-${Date.now()}@example.com`;
  const strangerEmail = `family-clones-e2e-stranger-${Date.now()}@example.com`;

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

  /** Характеристика типа: «вместимость» числом, чтобы проверить зеркало. */
  async function makeAttribute(typeId: number): Promise<void> {
    await dataSource.query(
      `INSERT INTO gear_type_attributes (gear_type_id, code, name, value_kind)
       VALUES ($1, 'seats', 'Мест', 'number')
       ON CONFLICT DO NOTHING`,
      [typeId],
    );
  }

  /** Поход, где оба родных идут; даты — чтобы решённый поход был живым. */
  async function makeTrip(status: 'planning' | 'decided'): Promise<string> {
    const rows: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO trips
         (organizer_user_id, goal_object_id, status, announcement, starts_at, ends_at)
       VALUES ($1, $2, $3, 'Витязь', now() + interval '1 day',
               now() + interval '2 days')
       RETURNING id`,
      [annaId, objectId, status],
    );
    const id = rows[0].id;

    await dataSource.query(
      `INSERT INTO trip_participants (trip_id, user_id, status)
       VALUES ($1, $2, 'going'), ($1, $3, 'going')`,
      [id, annaId, ivanId],
    );

    return id;
  }

  /** Строка каталога как она лежит в базе: ключ, автор, мягкое удаление. */
  async function gearRow(id: string) {
    const rows: Array<{
      id: string;
      gear_uid: string;
      origin_user_id: string;
      deleted_at: Date | null;
      title: string;
      weight_grams: number | null;
      location: string | null;
      note: string | null;
    }> = await dataSource.query(
      `SELECT id, gear_uid, origin_user_id, deleted_at, title, weight_grams,
              location, note
         FROM gear_items
        WHERE id = $1`,
      [id],
    );

    return rows[0];
  }

  /** Вещь из ответа `GET /gear` по названию. */
  async function itemByTitle(
    token: string,
    title: string,
  ): Promise<{
    id: string;
    title: string;
    weightGrams: number | null;
    note: string | null;
    location: string | null;
    attributes: Array<{ code: string; value: number | string | boolean }>;
  }> {
    const list = await call('get', '/api/gear', token).expect(200);
    const item = (
      list.body.items as Array<{
        id: string;
        title: string;
        weightGrams: number | null;
        note: string | null;
        location: string | null;
        attributes: Array<{ code: string; value: number | string | boolean }>;
      }>
    ).find((row) => row.title === title);

    if (!item) throw new Error(`В каталоге нет вещи «${title}»`);
    return item;
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
    strangerToken = stranger.token;

    realUserIds.push(annaId, ivanId, strangerId);

    objectId = (
      await dataSource.query(
        `INSERT INTO objects (name, type)
         VALUES ('Озеро для семейного каталога', 'озеро') RETURNING id`,
      )
    )[0].id;

    tentTypeId = await makeType('e2e_family_clone_tent', 'Палатка семьи');
    await makeAttribute(tentTypeId);

    // Родство по-настоящему: заявка на объединение семей и согласие,
    // как в «Контактах» (с 11.11.2026 заявка собирает обе компоненты).
    const union = await call('post', '/api/users/me/family', annaToken, {
      userId: ivanId,
    }).expect(201);
    await call(
      'post',
      `/api/users/me/family/unions/${union.body.unionId}/accept`,
      ivanToken,
    ).expect(200);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query('DELETE FROM trips WHERE id = $1', [tripId]);
      // Вещи — раньше людей: `gear_items.owner_user_id` держит RESTRICT.
      await dataSource.query(
        'DELETE FROM gear_items WHERE owner_user_id = ANY($1::uuid[])',
        [realUserIds],
      );
      await dataSource.query(
        `DELETE FROM gear_types WHERE code = 'e2e_family_clone_tent'`,
      );
      await dataSource.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        realUserIds,
      ]);
      await dataSource.query('DELETE FROM objects WHERE id = $1', [objectId]);
    }
    await app?.close();
  });

  it('родство подтверждено', async () => {
    expect((await familyOf(annaToken)).map((row) => row.userId)).toEqual([
      ivanId,
    ]);
  });

  // ───────────────────────────── клоны ─────────────────────────────

  it('новая вещь Анны встаёт Ивану клоном с тем же ключом и тем же автором', async () => {
    const created = await call('post', '/api/gear', annaToken, {
      typeId: tentTypeId,
      title: 'Палатка семьи',
      weightGrams: 2400,
      location: 'балкон',
      note: 'проклеена',
      attributes: { seats: 3 },
    }).expect(201);

    annaTentId = created.body.id as string;

    const clone = await itemByTitle(ivanToken, 'Палатка семьи');
    ivanTentCloneId = clone.id;

    expect(clone.id).not.toBe(annaTentId);
    expect(clone.weightGrams).toBe(2400);
    expect(clone.attributes.find((row) => row.code === 'seats')?.value).toBe(3);

    const annaRow = await gearRow(annaTentId);
    const ivanRow = await gearRow(ivanTentCloneId);
    expect(ivanRow.gear_uid).toBe(annaRow.gear_uid);
    expect(ivanRow.origin_user_id).toBe(annaId);
    // У Анны ключ тот же: это одна и та же физическая вещь.
    expect(annaRow.origin_user_id).toBe(annaId);
  });

  it('вещь постороннему не видна', async () => {
    const stranger = await call('get', '/api/gear', strangerToken).expect(200);

    expect(stranger.body.items).toEqual([]);
  });

  it('правка клона у Ивана зеркалится Анне — включая характеристики', async () => {
    await call('patch', `/api/gear/${ivanTentCloneId}`, ivanToken, {
      title: 'Палатка на четверых',
      weightGrams: 2600,
      location: 'гараж',
      note: 'новая молния',
      attributes: { seats: 4 },
    }).expect(200);

    const anna = await itemByTitle(annaToken, 'Палатка на четверых');
    expect(anna.id).toBe(annaTentId);
    expect(anna.weightGrams).toBe(2600);
    expect(anna.location).toBe('гараж');
    expect(anna.note).toBe('новая молния');
    expect(anna.attributes.find((row) => row.code === 'seats')?.value).toBe(4);
  });

  it('в поход ставится свой клон: вещь родного по её id — 404', async () => {
    tripId = await makeTrip('planning');

    // Анна не может предложить вещь Ивана: в её каталоге лежит свой клон.
    await call('post', `/api/trips/${tripId}/gear`, annaToken, {
      gearItemId: Number(ivanTentCloneId),
    }).expect(404);

    // А свой клон — может.
    const created = await call(
      'post',
      `/api/trips/${tripId}/gear`,
      annaToken,
      { gearItemId: Number(annaTentId) },
    ).expect(201);
    expect(created.body.ownerUserId).toBe(annaId);

    await dataSource.query('DELETE FROM trip_gear WHERE trip_id = $1', [
      tripId,
    ]);
  });

  it('удаление мягкое и по компоненте: вещь уходит из обоих каталогов', async () => {
    await call('delete', `/api/gear/${ivanTentCloneId}`, ivanToken).expect(204);

    await expect(itemByTitle(annaToken, 'Палатка на четверых')).rejects.toThrow(
      'нет вещи',
    );
    await expect(
      itemByTitle(ivanToken, 'Палатка на четверых'),
    ).rejects.toThrow('нет вещи');

    // Строка не исчезла: история походов ссылается на неё.
    const annaRow = await gearRow(annaTentId);
    const ivanRow = await gearRow(ivanTentCloneId);
    expect(annaRow.deleted_at).not.toBeNull();
    expect(ivanRow.deleted_at).not.toBeNull();
  });

  it('вещь в живом решённом походе удалить нельзя, после окончания — можно', async () => {
    const created = await call('post', '/api/gear', annaToken, {
      typeId: tentTypeId,
      title: 'Походная палатка',
    }).expect(201);
    const annaItemId = created.body.id as string;
    const ivanClone = await itemByTitle(ivanToken, 'Походная палатка');

    await dataSource.query(
      `UPDATE trips SET status = 'decided', cancelled_at = NULL WHERE id = $1`,
      [tripId],
    );

    await call('post', `/api/trips/${tripId}/gear`, ivanToken, {
      gearItemId: Number(ivanClone.id),
    }).expect(201);

    const blocked = await call(
      'delete',
      `/api/gear/${ivanClone.id}`,
      ivanToken,
    ).expect(409);
    expect(blocked.body.message).toContain('Витязь');

    // Поход закончился — вещь больше не занята, удаление разрешено.
    await dataSource.query(
      `UPDATE trips
          SET actual_started_at = now() - interval '2 days',
              actual_finished_at = now() - interval '1 day'
        WHERE id = $1`,
      [tripId],
    );

    await call('delete', `/api/gear/${ivanClone.id}`, ivanToken).expect(204);
    expect((await gearRow(annaItemId)).deleted_at).not.toBeNull();
  });

  // ─────────────────────────── выход из семьи ───────────────────────────

  it('выход из семьи рвёт связи, но оставляет клоны и прекращает зеркало', async () => {
    const created = await call('post', '/api/gear', annaToken, {
      typeId: tentTypeId,
      title: 'Палатка до развода',
    }).expect(201);
    const annaItemId = created.body.id as string;
    const ivanClone = await itemByTitle(ivanToken, 'Палатка до развода');

    await call('delete', '/api/users/me/family', ivanToken).expect(204);

    expect(await familyOf(ivanToken)).toEqual([]);
    expect(await familyOf(annaToken)).toEqual([]);

    // Копия у Ивана осталась.
    expect((await itemByTitle(ivanToken, 'Палатка до развода')).id).toBe(
      ivanClone.id,
    );

    // Компонента распалась — правка Анны до Ивана не доезжает.
    await call('patch', `/api/gear/${annaItemId}`, annaToken, {
      weightGrams: 3000,
    }).expect(200);

    expect(
      (await itemByTitle(ivanToken, 'Палатка до развода')).weightGrams,
    ).toBeNull();
  });

  // ─────────────────────── объединение семей (шаг 2) ───────────────────────

  /**
   * Слияние каталогов при объединении семей (11.11.2026, шаг 2).
   *
   * Заказчик: «For each origin-вещь каждой стороны — upsert клона для
   * каждого участника другой стороны: нет строки — создать; мягко
   * удалена — оживить и залить характеристики из активной копии».
   * После выхода из семьи (тест выше) у Анны лежит **мягко удалённый**
   * клон палатки, у Ивана — активная копия с новым весом, а ещё есть
   * вещь, которую Анна никогда не видела. Одна новая заявка проверяет
   * обе ветки `mergeClones`: создание и оживление.
   */
  it('объединение семей создаёт клоны новой стороны и оживляет удалённые', async () => {
    // Иван завёл вещь уже после развода — Анна её не видела.
    const created = await call('post', '/api/gear', ivanToken, {
      typeId: tentTypeId,
      title: 'Коврик Ивана',
      weightGrams: 700,
    }).expect(201);
    const ivanMatId = created.body.id as string;

    // После развода правки не зеркалятся: Анна взвесила свою копию палатки
    // (3000), а у Ивана вес остался пустым. Теперь вес правит Иван — именно
    // его активная копия станет источником при оживлении.
    const ivanTent = await itemByTitle(ivanToken, 'Палатка до развода');
    await call('patch', `/api/gear/${ivanTent.id}`, ivanToken, {
      weightGrams: 3000,
    }).expect(200);

    // Анна удалила свою копию палатки: компоненты уже разные, поэтому
    // у Ивана копия осталась активной.
    const annaTent = await itemByTitle(annaToken, 'Палатка до развода');
    await call('delete', `/api/gear/${annaTent.id}`, annaToken).expect(204);

    const union = await call('post', '/api/users/me/family', ivanToken, {
      userId: annaId,
    }).expect(201);
    await call(
      'post',
      `/api/users/me/family/unions/${union.body.unionId}/accept`,
      annaToken,
    ).expect(200);

    // Родство взаимно: одна пара, вторая сторона видит без второго запроса.
    expect((await familyOf(annaToken)).map((row) => row.userId)).toEqual([
      ivanId,
    ]);

    // Создание: вещь Ивана приехала Анне клоном с тем же ключом и автором.
    const annaMat = await itemByTitle(annaToken, 'Коврик Ивана');
    expect(annaMat.weightGrams).toBe(700);
    const ivanMatRow = await gearRow(ivanMatId);
    const annaMatRow = await gearRow(annaMat.id);
    expect(annaMatRow.gear_uid).toBe(ivanMatRow.gear_uid);
    expect(annaMatRow.origin_user_id).toBe(ivanId);

    // Оживление: строка Анны не задвоилась, `deleted_at` снят, а вес
    // приехал из активной копии Ивана.
    const annaTentRows = (await dataSource.query(
      `SELECT id, deleted_at, weight_grams FROM gear_items
        WHERE owner_user_id = $1 AND gear_uid = $2`,
      [annaId, (await gearRow(annaTent.id)).gear_uid],
    )) as Array<{
      id: string;
      deleted_at: Date | null;
      weight_grams: number | null;
    }>;

    expect(annaTentRows).toHaveLength(1);
    expect(annaTentRows[0].deleted_at).toBeNull();
    expect(annaTentRows[0].weight_grams).toBe(3000);
  });
});
