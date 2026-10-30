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
 * Личное снаряжение (e2e).
 *
 * Проверяем три вещи, которые легко сломать незаметно: **итог по весу**
 * (известные веса складываются, неизвестные считаются отдельно), **404
 * на чужой предмет** (а не 403 — иначе перебором id видно чужие каталоги)
 * и **три состояния веса** в `PATCH`: поля нет — не трогаем, число —
 * записываем, `null` — стираем.
 *
 * **Тип вместо вида (30.10.2026).** Каталог живёт на типах с Stage B,
 * а вид старого каталога удалён из контракта совсем. Здесь проверяется
 * именно каталог, а не справочник, поэтому тип заводится своим кодом
 * (`e2e_gear_*`) напрямую в базе: спека не должна зависеть от того,
 * прогнали ли на этой базе `seed:gear-types`.
 */
describe('Снаряжение (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  let ownerId: string;
  let ownerToken: string;
  let strangerId: string;
  let strangerToken: string;

  /** Тип без обязательных характеристик — годится любой вещи из спеки. */
  let plainTypeId: number;

  let lastCode: string | null = null;

  const ownerEmail = `gear-e2e-${Date.now()}@example.com`;
  const strangerEmail = `gear-e2e-stranger-${Date.now()}@example.com`;

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
   * Тип для проверок. Повторный прогон не спорит с прошлым: код уникален
   * сам по себе, а `ON CONFLICT` оставляет прежнюю строку.
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

    plainTypeId = await makeType('e2e_gear_plain', 'Проверочный ящик');

    const emailCodeService = moduleFixture.get(EmailCodeService);
    const realCreateCode = emailCodeService.createCode.bind(emailCodeService);
    vi.spyOn(emailCodeService, 'createCode').mockImplementation((mail) => {
      lastCode = realCreateCode(mail);
      return lastCode;
    });

    const owner = await login(ownerEmail);
    ownerToken = owner.token;
    ownerId = owner.id;

    const stranger = await login(strangerEmail);
    strangerToken = stranger.token;
    strangerId = stranger.id;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // Снаряжение — до типов и пользователей: `gear_type_id` — RESTRICT,
      // `owner_user_id` — RESTRICT.
      await dataSource.query(
        'DELETE FROM gear_items WHERE owner_user_id = ANY($1::uuid[])',
        [[ownerId, strangerId]],
      );
      await dataSource.query(`DELETE FROM gear_types WHERE code LIKE 'e2e\\_gear\\_%'`);
      await dataSource.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        [ownerId, strangerId],
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

  /** Добавить предмет и вернуть его тело. */
  async function addItem(body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const response = await call('post', '/api/gear', ownerToken, {
      typeId: plainTypeId,
      ...body,
    });
    expect(response.status).toBe(201);

    return response.body as Record<string, unknown>;
  }

  it('по умолчанию список пуст и итог нулевой', async () => {
    const response = await call('get', '/api/gear', ownerToken).expect(200);

    expect(response.body.items).toEqual([]);
    expect(response.body.totalWeightGrams).toBe(0);
    expect(response.body.itemsWithoutWeight).toBe(0);
  });

  it('предмет создаётся с типом, названием и весом', async () => {
    const item = await addItem({
      title: 'Палатка на четверых',
      weightGrams: 2400,
      note: 'проклеена',
    });

    expect(item.typeId).toBe(plainTypeId);
    expect(item.typeCode).toBe('e2e_gear_plain');
    expect(item.typeName).toBe('Проверочный ящик');
    expect(item.title).toBe('Палатка на четверых');
    expect(item.weightGrams).toBe(2400);
    expect(item.note).toBe('проклеена');
    // Вида старого каталога в ответе больше нет: экраны живут на кодах типов.
    expect(item.kind).toBeUndefined();
  });

  it('итог складывает известные веса и считает неизвестные отдельно', async () => {
    await addItem({ title: 'Спальник зимний', weightGrams: 1500 });
    await addItem({ title: 'Котелок 3 л' });

    const response = await call('get', '/api/gear', ownerToken).expect(200);

    expect(response.body.totalWeightGrams).toBe(2400 + 1500);
    expect(response.body.itemsWithoutWeight).toBe(1);

    const kettle = (
      response.body.items as Array<{ title: string; weightGrams: number | null }>
    ).find((item) => item.title === 'Котелок 3 л');
    expect(kettle?.weightGrams).toBeNull();
  });

  it('название из одних пробелов, несуществующий тип и отсутствие типа — 400', async () => {
    await call('post', '/api/gear', ownerToken, {
      typeId: plainTypeId,
      title: '   ',
    }).expect(400);

    await call('post', '/api/gear', ownerToken, {
      typeId: 999999,
      title: 'Ящик несуществующего типа',
    }).expect(400);

    // Тип обязателен: без него неизвестно даже, какие характеристики
    // спрашивать, и вещь молча легла бы в «прочее».
    await call('post', '/api/gear', ownerToken, {
      title: 'Ящик без типа',
    }).expect(400);
  });

  it('нулевой и отрицательный вес — 400', async () => {
    await call('post', '/api/gear', ownerToken, {
      typeId: plainTypeId,
      title: 'Невесомость',
      weightGrams: 0,
    }).expect(400);

    await call('post', '/api/gear', ownerToken, {
      typeId: plainTypeId,
      title: 'Антивес',
      weightGrams: -100,
    }).expect(400);
  });

  it('правка меняет поля, а null стирает вес', async () => {
    const item = await addItem({
      title: 'Рюкзак 90 л',
      weightGrams: 2100,
    });

    const renamed = await call('patch', `/api/gear/${item.id}`, ownerToken, {
      title: 'Рюкзак 90 л, старый',
    }).expect(200);
    expect(renamed.body.title).toBe('Рюкзак 90 л, старый');
    expect(renamed.body.weightGrams).toBe(2100);

    const cleared = await call('patch', `/api/gear/${item.id}`, ownerToken, {
      weightGrams: null,
    }).expect(200);
    expect(cleared.body.weightGrams).toBeNull();
  });

  it('чужой предмет не существует: 404 на правку и удаление', async () => {
    const item = await addItem({ title: 'Свой предмет' });

    await call('patch', `/api/gear/${item.id}`, strangerToken, {
      title: 'Чужой',
    }).expect(404);
    await call('delete', `/api/gear/${item.id}`, strangerToken).expect(404);
  });

  it('удаление убирает предмет и уменьшает итог', async () => {
    const item = await addItem({
      title: 'Ледоруб',
      weightGrams: 600,
    });

    await call('delete', `/api/gear/${item.id}`, ownerToken).expect(204);

    const response = await call('get', '/api/gear', ownerToken).expect(200);
    const ids = (response.body.items as Array<{ id: string }>).map((row) => row.id);
    expect(ids).not.toContain(item.id);
  });

  it('лишнее поле в теле — 400', async () => {
    await call('post', '/api/gear', ownerToken, {
      typeId: plainTypeId,
      title: 'Палатка',
      ownerUserId: strangerId,
    }).expect(400);
  });

  it('нечисловой id — 400, несуществующий — 404', async () => {
    await call('patch', '/api/gear/abc', ownerToken, { title: 'Название' }).expect(400);
    await call('patch', '/api/gear/999999', ownerToken, { title: 'Название' }).expect(404);
  });

  it('без токена — 401', async () => {
    await request(app.getHttpServer()).get('/api/gear').expect(401);
  });
});
