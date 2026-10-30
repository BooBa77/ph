import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { adminUserIds } from './../src/calendar/admin';
import { EmailCodeService } from './../src/email/services/email-code.service';
import { SmtpService } from './../src/email/services/smtp.service';

/**
 * Тип вещи и значения её характеристик (e2e, Stage B, часть 1).
 *
 * Проверяем то, ради чего вещь переехала с вида на тип:
 *
 * - **`typeId` + `attributes`** — вещь создаётся с типом, а значения ложатся
 *   в свои колонки и возвращаются **в своём типе** (число числом, галочка
 *   галочкой), а не строкой;
 * - **правила значений**: неизвестный код характеристики, архивная
 *   характеристика, число в текстовую, строка в числовую, вариант вне
 *   списка — 400; своё значение разрешено, только если характеристика
 *   это позволяет;
 * - **обязательные характеристики**: без них вещь с `typeId` не создаётся,
 *   а у смены типа спрашиваются заново;
 * - **`fillMissing` в дело**: когда админ делает характеристику
 *   обязательной, пустые значения у существующих вещей заполняются
 *   замещающим — это первое место, где замещающее значение пишется, а не
 *   только проверяется;
 * - **переходная прослойка `kind`**: старая форма каталога присылает вид,
 *   сервер переводит его в код типа, а в ответе вид считается по типу.
 *
 * Своих пользователей заводим через вход по коду (как в `gear.e2e-spec`):
 * у `gear_items` внешний ключ на владельца, а `JwtStrategy` проверяет только
 * подпись — для прав «мой каталог» нужен настоящий человек. Типы и
 * характеристики создаём через админский API с префиксом `e2e_`, чтобы
 * повторный прогон не спорил с прошлым и не зависел от сида.
 */
describe('Тип вещи и значения характеристик (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  let ownerId: string;
  let ownerToken: string;
  let strangerToken: string;
  let adminToken: string;

  let lastCode: string | null = null;

  /** Уникальный префикс: два прогона подряд не спорят за коды. */
  const suffix = Date.now().toString(36);

  /** Тип «как палатка»: обязательная вместимость и необязательная модель. */
  let tentTypeId: number;
  let tentCode: string;

  /** Тип со списком вариантов: один строгий, второй разрешает своё. */
  let selectTypeId: number;

  /** Тип, который уйдёт в архив. */
  let archivedTypeId: number;

  type Method = 'get' | 'post' | 'patch' | 'delete';

  function call(
    method: Method,
    path: string,
    token?: string,
    body?: unknown,
  ): request.Test {
    const agent = request(app.getHttpServer())[method](path);
    if (token) agent.set('Authorization', `Bearer ${token}`);

    return body === undefined ? agent : agent.send(body as object);
  }

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

    const owner = await login(`gear-item-types-${suffix}@example.com`);
    ownerToken = owner.token;
    ownerId = owner.id;

    const jwtService = moduleFixture.get(JwtService);
    strangerToken = await jwtService.signAsync({ sub: '00000000-0000-4000-8000-000000000000' });

    // Админский токен: `isAdminUser` смотрит только на UUID из списка.
    adminToken = await jwtService.signAsync({
      sub: adminUserIds()[0] as string,
    });

    // Тип «палатка»: вместимость обязательна — на ней проверяются
    // и обязательность, и `fillMissing`.
    tentCode = `e2e_${suffix}_tentlike`;
    const tent = await call('post', '/api/gear/admin/types', adminToken, {
      code: tentCode,
      name: 'Проверочная палатка',
      sortOrder: 900,
    }).expect(201);
    tentTypeId = tent.body.id as number;

    await call(
      'post',
      `/api/gear/admin/types/${tentTypeId}/attributes`,
      adminToken,
      {
        code: 'seats',
        name: 'Вместимость',
        valueKind: 'number',
        unit: 'мест',
        isRequired: true,
        fillMissing: 3,
      },
    ).expect(201);

    await call(
      'post',
      `/api/gear/admin/types/${tentTypeId}/attributes`,
      adminToken,
      { code: 'model', name: 'Модель', valueKind: 'text' },
    ).expect(201);

    // Тип со списками: строгий список и список со своим значением.
    const selectType = await call('post', '/api/gear/admin/types', adminToken, {
      code: `e2e_${suffix}_stove`,
      name: 'Проверочная горелка',
      sortOrder: 901,
    }).expect(201);
    selectTypeId = selectType.body.id as number;

    await call(
      'post',
      `/api/gear/admin/types/${selectTypeId}/attributes`,
      adminToken,
      {
        code: 'connection',
        name: 'Соединение',
        valueKind: 'select',
        options: [
          { code: 'thread', name: 'резьбовой' },
          { code: 'collet', name: 'цанговый' },
        ],
      },
    ).expect(201);

    await call(
      'post',
      `/api/gear/admin/types/${selectTypeId}/attributes`,
      adminToken,
      {
        code: 'custom',
        name: 'Своё',
        valueKind: 'select',
        allowCustomValue: true,
        options: [{ code: 'known', name: 'известное' }],
      },
    ).expect(201);

    // Архивный тип: вещь в архив не принимается.
    const archived = await call('post', '/api/gear/admin/types', adminToken, {
      code: `e2e_${suffix}_archived`,
      name: 'Проверочный архив',
      sortOrder: 902,
    }).expect(201);
    archivedTypeId = archived.body.id as number;
    await call(
      'delete',
      `/api/gear/admin/types/${archivedTypeId}`,
      adminToken,
    ).expect(204);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // Вещи — до типов: `gear_items.gear_type_id` держит тип RESTRICT,
      // а значения уходят каскадом вместе с вещью.
      await dataSource.query(
        'DELETE FROM gear_items WHERE owner_user_id = $1::uuid',
        [ownerId],
      );
      await dataSource.query(`DELETE FROM gear_types WHERE code LIKE 'e2e\\_%'`);
      await dataSource.query('DELETE FROM users WHERE id = $1::uuid', [ownerId]);
    }
    await app?.close();
  });

  /** Вещь с типом «палатка» и заполненной обязательной вместимостью. */
  async function addTent(
    body: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const response = await call('post', '/api/gear', ownerToken, {
      typeId: tentTypeId,
      title: 'Проверочная палатка',
      attributes: { seats: 3 },
      ...body,
    });
    expect(response.status).toBe(201);

    return response.body as Record<string, unknown>;
  }

  // ─────────────────────── тип и значения ───────────────────────

  it('вещь создаётся с типом и значениями; числа остаются числами', async () => {
    const item = await addTent({
      title: 'Палатка MSR',
      weightGrams: 2400,
      attributes: { seats: 3, model: 'MSR' },
    });

    expect(item.typeId).toBe(tentTypeId);
    expect(item.typeCode).toBe(tentCode);
    expect(item.typeName).toBe('Проверочная палатка');
    expect(item.weightGrams).toBe(2400);

    const attributes = item.attributes as Array<{
      code: string;
      value: unknown;
      valueKind: string;
      unit: string | null;
    }>;

    const seats = attributes.find((row) => row.code === 'seats');
    expect(seats?.valueKind).toBe('number');
    expect(seats?.value).toBe(3);
    expect(seats?.unit).toBe('мест');

    const model = attributes.find((row) => row.code === 'model');
    expect(model?.valueKind).toBe('text');
    expect(model?.value).toBe('MSR');

    // Значения в порядке справочника: вместимость заведена первой.
    expect(attributes.map((row) => row.code)).toEqual(['seats', 'model']);
  });

  it('значение с запятой в числе принимается: 2,5 → 2.5', async () => {
    const item = await addTent({ attributes: { seats: '2,5' } });
    const seats = (item.attributes as Array<{ code: string; value: unknown }>).find(
      (row) => row.code === 'seats',
    );

    expect(seats?.value).toBe(2.5);
  });

  it('список: только активный вариант, а со «своим значением» — любое', async () => {
    const strict = await call('post', '/api/gear', ownerToken, {
      typeId: selectTypeId,
      title: 'Горелка строгая',
      attributes: { connection: 'резьбовой' },
    }).expect(201);
    expect(
      (strict.body.attributes as Array<{ code: string; value: unknown }>).find(
        (row) => row.code === 'connection',
      )?.value,
    ).toBe('резьбовой');

    await call('post', '/api/gear', ownerToken, {
      typeId: selectTypeId,
      title: 'Горелка не та',
      attributes: { connection: 'гравитационный' },
    }).expect(400);

    const custom = await call('post', '/api/gear', ownerToken, {
      typeId: selectTypeId,
      title: 'Горелка своя',
      attributes: { custom: 'гравитационный' },
    }).expect(201);
    expect(
      (custom.body.attributes as Array<{ code: string; value: unknown }>).find(
        (row) => row.code === 'custom',
      )?.value,
    ).toBe('гравитационный');
  });

  it('неизвестный код характеристики — 400 с перечнем', async () => {
    const response = await call('post', '/api/gear', ownerToken, {
      typeId: tentTypeId,
      title: 'Палатка с опечаткой',
      attributes: { seats: 3, seets: 4 },
    }).expect(400);

    expect(response.body.message).toContain('seets');
    expect(response.body.message).toContain('seats');
  });

  it('значение не того вида — 400', async () => {
    // Текст в число.
    await call('post', '/api/gear', ownerToken, {
      typeId: tentTypeId,
      title: 'Палатка',
      attributes: { seats: 'три' },
    }).expect(400);

    // Число в текст.
    await call('post', '/api/gear', ownerToken, {
      typeId: tentTypeId,
      title: 'Палатка',
      attributes: { seats: 3, model: 42 },
    }).expect(400);
  });

  it('обязательная характеристика требуется при создании с типом', async () => {
    const response = await call('post', '/api/gear', ownerToken, {
      typeId: tentTypeId,
      title: 'Палатка без вместимости',
    }).expect(400);

    expect(response.body.message).toContain('Вместимость');
  });

  it('обязательная характеристика, присланная null, — тоже 400', async () => {
    // Форма нового каталога присылает карту целиком, а пустые значения —
    // `null`: «ключ есть» не значит «значение заполнено», и без этой
    // проверки вещь сохранялась бы без обязательной вместимости.
    const response = await call('post', '/api/gear', ownerToken, {
      typeId: tentTypeId,
      title: 'Палатка с пустой вместимостью',
      attributes: { seats: null },
    }).expect(400);

    expect(response.body.message).toContain('Вместимость');
  });

  it('архивный тип не принимается — 400', async () => {
    await call('post', '/api/gear', ownerToken, {
      typeId: archivedTypeId,
      title: 'Вещь в архив',
    }).expect(400);
  });

  it('пустой список значений у необязательного типа не мешает', async () => {
    const item = await call('post', '/api/gear', ownerToken, {
      typeId: selectTypeId,
      title: 'Горелка без значений',
    }).expect(201);

    expect(item.body.attributes).toEqual([]);
  });

  // ─────────────────────── переходный вид ───────────────────────

  it('старая форма присылает вид — сервер переводит его в тип', async () => {
    // Виды старого каталога переводятся в коды типов миграцией
    // `1792271000000-GearItemTypes`; `other` («Прочее») есть в любой базе,
    // потому что на него приходится вид по умолчанию.
    const response = await call('post', '/api/gear', ownerToken, {
      kind: 'other',
      title: 'Вещь по-старому',
    }).expect(201);

    expect(response.body.typeCode).toBe('other');
    expect(response.body.kind).toBe('other');
    // Старая форма не умеет заполнять значения — обязательные
    // характеристики у неё не спрашиваются.
    expect(response.body.attributes).toEqual([]);
  });

  it('вид переводится в тип и у палатки: kind = tent → тип tent', async () => {
    const response = await call('post', '/api/gear', ownerToken, {
      kind: 'tent',
      title: 'Палатка по-старому',
    }).expect(201);

    expect(response.body.typeCode).toBe('tent');
    expect(response.body.kind).toBe('tent');
  });

  it('неизвестный вид — 400', async () => {
    await call('post', '/api/gear', ownerToken, {
      kind: 'spaceship',
      title: 'Звездолёт',
    }).expect(400);
  });

  it('без типа и вида — 400', async () => {
    const response = await call('post', '/api/gear', ownerToken, {
      title: 'Вещь в никуда',
    }).expect(400);

    expect(response.body.message).toContain('тип');
  });

  // ─────────────────────── правка ───────────────────────

  it('значение стирается null, а остальные остаются', async () => {
    const item = await addTent({ attributes: { seats: 2, model: 'Naturehike' } });

    const response = await call(
      'patch',
      `/api/gear/${item.id}`,
      ownerToken,
      { attributes: { model: null } },
    ).expect(200);

    const attributes = response.body.attributes as Array<{
      code: string;
      value: unknown;
    }>;
    expect(attributes.map((row) => row.code)).toEqual(['seats']);
    expect(attributes[0]?.value).toBe(2);
  });

  it('пустая строка тоже стирает значение', async () => {
    const item = await addTent({ attributes: { seats: 1, model: 'Ветхая' } });

    const response = await call(
      'patch',
      `/api/gear/${item.id}`,
      ownerToken,
      { attributes: { model: '   ' } },
    ).expect(200);

    expect(
      (response.body.attributes as Array<{ code: string }>).map((row) => row.code),
    ).toEqual(['seats']);
  });

  it('смена типа убирает значения старого типа', async () => {
    const item = await addTent({ attributes: { seats: 4, model: 'MSR' } });

    const response = await call(
      'patch',
      `/api/gear/${item.id}`,
      ownerToken,
      { typeId: selectTypeId, attributes: { connection: 'цанговый' } },
    ).expect(200);

    expect(response.body.typeId).toBe(selectTypeId);
    const codes = (response.body.attributes as Array<{ code: string }>).map(
      (row) => row.code,
    );
    expect(codes).toEqual(['connection']);
  });

  it('смена типа без обязательных значений нового типа — 400', async () => {
    const item = await addTent({ attributes: { seats: 4 } });

    await call('patch', `/api/gear/${item.id}`, ownerToken, {
      typeId: tentTypeId,
      attributes: {},
    }).expect(200);

    // Тип тот же — значения на месте; уходим в тип без обязательных
    // характеристик и возвращаемся в палатку без вместимости.
    const moved = await call('patch', `/api/gear/${item.id}`, ownerToken, {
      typeId: selectTypeId,
    }).expect(200);
    expect(moved.body.attributes).toEqual([]);

    await call('patch', `/api/gear/${item.id}`, ownerToken, {
      typeId: tentTypeId,
      attributes: { model: 'Без мест' },
    }).expect(400);
  });

  it('чужой предмет — 404, без токена — 401', async () => {
    const item = await addTent();

    await call('get', '/api/gear', strangerToken).expect(200);
    await call('patch', `/api/gear/${item.id}`, strangerToken, {
      title: 'Чужое',
    }).expect(404);
    await request(app.getHttpServer()).get('/api/gear').expect(401);
  });

  // ─────────────────── значения в списке каталога ───────────────────

  it('список отдаёт тип и значения у каждого предмета', async () => {
    const response = await call('get', '/api/gear', ownerToken).expect(200);
    const items = response.body.items as Array<{
      typeCode: string;
      attributes: Array<{ code: string; value: unknown }>;
    }>;

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(typeof item.typeCode).toBe('string');
      expect(Array.isArray(item.attributes)).toBe(true);
    }
  });

  // ─────────────────── fillMissing в дело ───────────────────

  it('обязательная характеристика заполняет пустые значения у вещей', async () => {
    // Тип без характеристик и вещь в нём — как «старая вещь до Stage B».
    const type = await call('post', '/api/gear/admin/types', adminToken, {
      code: `e2e_${suffix}_backfill`,
      name: 'Проверочный рюкзак',
      sortOrder: 903,
    }).expect(201);

    const item = await call('post', '/api/gear', ownerToken, {
      typeId: type.body.id as number,
      title: 'Рюкзак без объёма',
    }).expect(201);
    expect(item.body.attributes).toEqual([]);

    // Админ заводит обязательную характеристику с замещающим значением.
    await call(
      'post',
      `/api/gear/admin/types/${type.body.id}/attributes`,
      adminToken,
      {
        code: 'volume',
        name: 'Объём',
        valueKind: 'number',
        unit: 'л',
        isRequired: true,
        fillMissing: 60,
      },
    ).expect(201);

    const after = await call(
      'get',
      '/api/gear',
      ownerToken,
    ).expect(200);
    const saved = (
      after.body.items as Array<{
        id: string;
        attributes: Array<{ code: string; value: unknown }>;
      }>
    ).find((row) => row.id === (item.body.id as string));

    expect(saved?.attributes).toEqual([
      expect.objectContaining({ code: 'volume', value: 60 }),
    ]);
  });
});
