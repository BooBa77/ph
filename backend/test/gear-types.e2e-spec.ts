import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { adminUserIds } from './../src/calendar/admin';

/**
 * Типы снаряжения и их характеристики (e2e, Stage A).
 *
 * Проверяем справочник целиком — оба контракта и все правила, на которых
 * держится Stage B:
 *
 * - **публичный `GET /api/gear-types`** отдаёт только активное; архивный тип
 *   и архивная характеристика из него исчезают, но остаются в админке;
 * - **`gear/admin/types`** закрыт `isAdminUser`: 401 без токена, 403 чужому;
 * - **архив вместо удаления**: `DELETE` — 204 и `isActive = false`,
 *   повторный `DELETE` тоже 204 (идемпотентность);
 * - **`code` и `valueKind` неизменяемы**: 400 на код, 409 на вид — правило
 *   поставлено сразу, чтобы в Stage B не менять контракт;
 * - **`fillMissing`**: без него обязательную характеристику не создать
 *   и нельзя переключить `false → true`, вид значения проверяется
 *   (число / непустая строка / boolean), но в Stage A никуда не пишется —
 *   таблицы значений ещё нет.
 *
 * Пользователей в базе не заводим: `JwtStrategy` проверяет только подпись,
 * а `isAdminUser` — UUID из списка админов (тот же приём, что в
 * `moderation.e2e-spec.ts`). За собой убираем все типы с кодом `e2e_…`:
 * у них атрибуты уходят каскадом.
 */
describe('Типы снаряжения (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let strangerToken: string;

  /** Уникальный префикс кодов: повторный прогон не спорит с прошлым. */
  const suffix = Date.now().toString(36);

  let typeId: number;
  let attributeId: number;

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

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();

    dataSource = moduleFixture.get(DataSource);

    const jwtService = moduleFixture.get(JwtService);
    const adminId = adminUserIds()[0] as string;

    adminToken = await jwtService.signAsync({ sub: adminId });
    strangerToken = await jwtService.signAsync({ sub: randomUUID() });
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // Код с префиксом `e2e_` — только тестовый: сид таких не заводит.
      // Характеристики уходят каскадом вместе с типами.
      await dataSource.query(`DELETE FROM gear_types WHERE code LIKE 'e2e\\_%'`);
    }
    await app?.close();
  });

  /** Создать тип под этим прогоном; возвращает id. */
  async function createType(code: string, name = 'Тестовый тип'): Promise<number> {
    const response = await call('post', '/api/gear/admin/types', adminToken, {
      code: `e2e_${suffix}_${code}`,
      name,
    });
    expect(response.status).toBe(201);

    return response.body.id as number;
  }

  // ─────────────────────────── доступ ───────────────────────────

  it('без токена публичный список не отдаёт', async () => {
    await call('get', '/api/gear-types').expect(401);
  });

  it('чужому админский список не отдаёт — 403', async () => {
    await call('get', '/api/gear/admin/types', strangerToken).expect(403);
  });

  it('чужому создать тип не даёт — 403', async () => {
    await call('post', '/api/gear/admin/types', strangerToken, {
      code: `e2e_${suffix}_stranger`,
      name: 'Чужой тип',
    }).expect(403);
  });

  // ─────────────────────────── типы ───────────────────────────

  it('админ создаёт тип: код, имя, порядок, пустые характеристики', async () => {
    const response = await call(
      'post',
      '/api/gear/admin/types',
      adminToken,
      { code: `e2e_${suffix}_tent`, name: 'Палатка', sortOrder: 10 },
    ).expect(201);

    expect(response.body.code).toBe(`e2e_${suffix}_tent`);
    expect(response.body.name).toBe('Палатка');
    expect(response.body.sortOrder).toBe(10);
    expect(response.body.isActive).toBe(true);
    expect(response.body.attributes).toEqual([]);

    typeId = response.body.id as number;
  });

  it('дубликат кода — 409, код занимается навсегда', async () => {
    await call('post', '/api/gear/admin/types', adminToken, {
      code: `e2e_${suffix}_tent`,
      name: 'Вторая палатка',
    }).expect(409);
  });

  it('нелатинский и невалидный код — 400', async () => {
    for (const code of ['Tent', '1tent', 'палатка', 'with space', '']) {
      await call('post', '/api/gear/admin/types', adminToken, {
        code,
        name: 'Тип',
      }).expect(400);
    }
  });

  it('пустое имя после обрезки — 400', async () => {
    await call('post', '/api/gear/admin/types', adminToken, {
      code: `e2e_${suffix}_blank`,
      name: '   ',
    }).expect(400);
  });

  it('лишнее поле в теле — 400', async () => {
    await call('post', '/api/gear/admin/types', adminToken, {
      code: `e2e_${suffix}_extra`,
      name: 'Тип',
      is_active: true,
    }).expect(400);
  });

  it('код в PATCH — 400: код меняется архивом и новым кодом', async () => {
    await call('patch', `/api/gear/admin/types/${typeId}`, adminToken, {
      code: `e2e_${suffix}_other`,
    }).expect(400);
  });

  it('PATCH меняет имя и порядок', async () => {
    const response = await call(
      'patch',
      `/api/gear/admin/types/${typeId}`,
      adminToken,
      { name: 'Палатка зимняя', sortOrder: 20 },
    ).expect(200);

    expect(response.body.name).toBe('Палатка зимняя');
    expect(response.body.sortOrder).toBe(20);
    expect(response.body.isActive).toBe(true);
  });

  it('несуществующий тип — 404, нечисловой id — 400', async () => {
    await call('patch', '/api/gear/admin/types/999999', adminToken, {
      name: 'Нет такого',
    }).expect(404);
    await call('patch', '/api/gear/admin/types/abc', adminToken, {
      name: 'Нет такого',
    }).expect(400);
  });

  // ─────────────────────── характеристики ───────────────────────

  it('характеристика создаётся: вид, единица, обязательность', async () => {
    const response = await call(
      'post',
      `/api/gear/admin/types/${typeId}/attributes`,
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

    expect(response.body.code).toBe('seats');
    expect(response.body.valueKind).toBe('number');
    expect(response.body.unit).toBe('мест');
    expect(response.body.isRequired).toBe(true);
    expect(response.body.isActive).toBe(true);

    attributeId = response.body.id as number;
  });

  it('обязательная характеристика без fillMissing — 400', async () => {
    await call(
      'post',
      `/api/gear/admin/types/${typeId}/attributes`,
      adminToken,
      {
        code: 'model',
        name: 'Модель',
        valueKind: 'text',
        isRequired: true,
      },
    ).expect(400);
  });

  it('fillMissing не того вида — 400', async () => {
    await call(
      'post',
      `/api/gear/admin/types/${typeId}/attributes`,
      adminToken,
      {
        code: 'model',
        name: 'Модель',
        valueKind: 'text',
        isRequired: true,
        fillMissing: 42,
      },
    ).expect(400);

    await call(
      'post',
      `/api/gear/admin/types/${typeId}/attributes`,
      adminToken,
      {
        code: 'heavy',
        name: 'Тяжёлая',
        valueKind: 'bool',
        isRequired: true,
        fillMissing: 'да',
      },
    ).expect(400);
  });

  it('необязательная характеристика без fillMissing создаётся', async () => {
    const response = await call(
      'post',
      `/api/gear/admin/types/${typeId}/attributes`,
      adminToken,
      { code: 'model', name: 'Модель', valueKind: 'text' },
    ).expect(201);

    expect(response.body.isRequired).toBe(false);
    expect(response.body.unit).toBeNull();
  });

  it('вид значения вне number/text/bool — 400', async () => {
    await call(
      'post',
      `/api/gear/admin/types/${typeId}/attributes`,
      adminToken,
      { code: 'volume', name: 'Объём', valueKind: 'число' },
    ).expect(400);
  });

  it('дубликат кода характеристики у типа — 409', async () => {
    await call(
      'post',
      `/api/gear/admin/types/${typeId}/attributes`,
      adminToken,
      { code: 'seats', name: 'Места', valueKind: 'number' },
    ).expect(409);
  });

  it('код в PATCH характеристики — 400', async () => {
    await call(
      'patch',
      `/api/gear/admin/types/${typeId}/attributes/${attributeId}`,
      adminToken,
      { code: 'places' },
    ).expect(400);
  });

  it('вид значения в PATCH — 409, даже если тот же', async () => {
    await call(
      'patch',
      `/api/gear/admin/types/${typeId}/attributes/${attributeId}`,
      adminToken,
      { valueKind: 'number' },
    ).expect(409);
  });

  it('включение обязательности без fillMissing — 400, с ним — 200', async () => {
    // `model` — единственная необязательная характеристика типа; id её
    // зависит от прогона, поэтому ищем по коду, а не запоминаем.
    const admin = await call('get', '/api/gear/admin/types', adminToken).expect(
      200,
    );
    const model = (
      admin.body.items as Array<{
        id: number;
        attributes: Array<{ id: number; code: string }>;
      }>
    )
      .find((type) => type.id === typeId)
      ?.attributes.find((row) => row.code === 'model');

    expect(model).toBeDefined();

    await call(
      'patch',
      `/api/gear/admin/types/${typeId}/attributes/${model?.id}`,
      adminToken,
      { isRequired: true },
    ).expect(400);

    const required = await call(
      'patch',
      `/api/gear/admin/types/${typeId}/attributes/${model?.id}`,
      adminToken,
      { isRequired: true, fillMissing: 'Не указана' },
    ).expect(200);
    expect(required.body.isRequired).toBe(true);
  });

  it('архив характеристики: 204, из публичного списка исчезает', async () => {
    await call(
      'delete',
      `/api/gear/admin/types/${typeId}/attributes/${attributeId}`,
      adminToken,
    ).expect(204);

    // Повторный DELETE идемпотентен.
    await call(
      'delete',
      `/api/gear/admin/types/${typeId}/attributes/${attributeId}`,
      adminToken,
    ).expect(204);

    const publicList = await call('get', '/api/gear-types', adminToken).expect(
      200,
    );
    const type = (
      publicList.body.items as Array<{
        id: number;
        attributes: Array<{ id: number }>;
      }>
    ).find((row) => row.id === typeId);
    expect(type).toBeDefined();
    expect(type?.attributes.map((row) => row.id)).not.toContain(attributeId);

    const adminList = await call(
      'get',
      '/api/gear/admin/types',
      adminToken,
    ).expect(200);
    const archived = (
      adminList.body.items as Array<{
        id: number;
        attributes: Array<{ id: number; isActive: boolean }>;
      }>
    )
      .find((row) => row.id === typeId)
      ?.attributes.find((row) => row.id === attributeId);
    expect(archived?.isActive).toBe(false);
  });

  it('вернуть характеристику из архива — PATCH isActive: true', async () => {
    const response = await call(
      'patch',
      `/api/gear/admin/types/${typeId}/attributes/${attributeId}`,
      adminToken,
      { isActive: true },
    ).expect(200);

    expect(response.body.isActive).toBe(true);
  });

  it('характеристика чужого типа — 404', async () => {
    const otherTypeId = await createType('axe', 'Топор');

    await call(
      'patch',
      `/api/gear/admin/types/${otherTypeId}/attributes/${attributeId}`,
      adminToken,
      { name: 'Вместимость топора' },
    ).expect(404);

    await call(
      'delete',
      `/api/gear/admin/types/${otherTypeId}/attributes/${attributeId}`,
      adminToken,
    ).expect(404);
  });

  it('характеристики несуществующего типа — 404', async () => {
    await call(
      'post',
      '/api/gear/admin/types/999999/attributes',
      adminToken,
      { code: 'seats', name: 'Вместимость', valueKind: 'number' },
    ).expect(404);
  });

  // ──────────────────────── архив типа ─────────────────────────

  it('архив типа: 204, публичный список без него, админский — с ним', async () => {
    const archivedTypeId = await createType('gas', 'Газовый баллон');

    await call(
      'delete',
      `/api/gear/admin/types/${archivedTypeId}`,
      adminToken,
    ).expect(204);

    // Идемпотентность: повторный архив — снова 204.
    await call(
      'delete',
      `/api/gear/admin/types/${archivedTypeId}`,
      adminToken,
    ).expect(204);

    const publicList = await call('get', '/api/gear-types', adminToken).expect(
      200,
    );
    const publicIds = (publicList.body.items as Array<{ id: number }>).map(
      (row) => row.id,
    );
    expect(publicIds).not.toContain(archivedTypeId);

    const adminList = await call(
      'get',
      '/api/gear/admin/types',
      adminToken,
    ).expect(200);
    const archived = (
      adminList.body.items as Array<{ id: number; isActive: boolean }>
    ).find((row) => row.id === archivedTypeId);
    expect(archived?.isActive).toBe(false);
  });

  it('вернуть тип из архива — PATCH isActive: true, публичный список снова отдаёт', async () => {
    const adminList = await call(
      'get',
      '/api/gear/admin/types',
      adminToken,
    ).expect(200);
    const archived = (
      adminList.body.items as Array<{
        id: number;
        code: string;
        isActive: boolean;
      }>
    ).find(
      (row) => row.code === `e2e_${suffix}_gas` && row.isActive === false,
    );
    expect(archived).toBeDefined();

    await call(
      'patch',
      `/api/gear/admin/types/${archived?.id}`,
      adminToken,
      { isActive: true },
    ).expect(200);

    const publicList = await call('get', '/api/gear-types', adminToken).expect(
      200,
    );
    const publicIds = (publicList.body.items as Array<{ id: number }>).map(
      (row) => row.id,
    );
    expect(publicIds).toContain(archived?.id);
  });

  it('архив типа не отдаёт его характеристики публично', async () => {
    const typeWithAttribute = await createType('saw', 'Пила');
    await call(
      'post',
      `/api/gear/admin/types/${typeWithAttribute}/attributes`,
      adminToken,
      { code: 'drive', name: 'Привод', valueKind: 'text' },
    ).expect(201);

    await call(
      'delete',
      `/api/gear/admin/types/${typeWithAttribute}`,
      adminToken,
    ).expect(204);

    const publicList = await call('get', '/api/gear-types', adminToken).expect(
      200,
    );
    const publicIds = (publicList.body.items as Array<{ id: number }>).map(
      (row) => row.id,
    );
    expect(publicIds).not.toContain(typeWithAttribute);
  });

  // ──────────────────── форма публичного ответа ────────────────────

  it('публичный ответ: items и никакого isActive', async () => {
    const response = await call('get', '/api/gear-types', adminToken).expect(
      200,
    );

    expect(Array.isArray(response.body.items)).toBe(true);
    for (const type of response.body.items as Array<Record<string, unknown>>) {
      expect(type).not.toHaveProperty('isActive');
      expect(Array.isArray(type.attributes)).toBe(true);
      for (const attribute of type.attributes as Array<
        Record<string, unknown>
      >) {
        expect(attribute).not.toHaveProperty('isActive');
      }
    }
  });
});
