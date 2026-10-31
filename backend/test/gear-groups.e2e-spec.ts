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
 * Группы снаряжения и полка у вещи (e2e, 31.10.2026).
 *
 * Группа — полка каталога, а не тип: «Костровое» собирает топор, пилу
 * и розжиг. Проверяем всё, на чём держится контракт:
 *
 * - **публичный `GET /api/gear-groups`** отдаёт только действующие группы
 *   в порядке `sortOrder`, архивных в нём нет;
 * - **админка `/api/gear/admin/groups`** закрыта `isAdminUser`: 401/403,
 *   архив вместо удаления, `code` неизменяем (400), дубликат кода — 409;
 * - **«Прочее» не архивируется** (409): это умолчание для вещи без полки;
 * - **`groupId` необязателен**: без него вещь попадает в «Прочее»,
 *   с ним — на выбранную полку; архивная группа — 400;
 * - **личный порядок**: новые вещи встают в конец группы, стрелки
 *   `POST /api/gear/:id/move` меняют соседей местами, за границу группы
 *   не переставляют, чужую вещь двигать нельзя (404);
 * - **смена группы** переносит вещь в конец новой полки.
 *
 * Пользователей заводим напрямую в базе, токены — `JwtService`: стратегия
 * проверяет только подпись и не ходит в БД (тот же приём, что в
 * `gear-types.e2e-spec.ts`). За собой убираем всё с префиксом `e2e_…`.
 */
describe('Группы снаряжения (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  let adminToken: string;
  let ownerToken: string;
  let ownerId: string;
  let strangerToken: string;

  let typeId: number;
  let groupAId: number;
  let groupBId: number;
  let otherGroupId: number;

  /** Уникальный префикс кодов: повторный прогон не спорит с прошлым. */
  const suffix = Date.now().toString(36);

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
    adminToken = await jwtService.signAsync({
      sub: adminUserIds()[0] as string,
    });
    strangerToken = await jwtService.signAsync({ sub: randomUUID() });

    ownerId = (
      await dataSource.query(
        `INSERT INTO users (display_name) VALUES ('Хозяин каталога e2e')
         RETURNING id`,
      )
    )[0].id;
    ownerToken = await jwtService.signAsync({ sub: ownerId });

    typeId = (
      await dataSource.query(
        `INSERT INTO gear_types (code, name)
         VALUES ($1, 'Проверочный тип группы')
         ON CONFLICT (code) DO NOTHING
         RETURNING id`,
        [`e2e_${suffix}_type`],
      )
    )[0]?.id;

    if (typeId === undefined) {
      typeId = (
        await dataSource.query('SELECT id FROM gear_types WHERE code = $1', [
          `e2e_${suffix}_type`,
        ])
      )[0].id;
    }

    otherGroupId = (
      await dataSource.query(`SELECT id FROM gear_groups WHERE code = 'other'`)
    )[0].id;

    const groupA = await call('post', '/api/gear/admin/groups', adminToken, {
      code: `e2e_${suffix}_a`,
      name: 'Полка А',
      sortOrder: 10,
    });
    expect(groupA.status).toBe(201);
    groupAId = groupA.body.id as number;

    const groupB = await call('post', '/api/gear/admin/groups', adminToken, {
      code: `e2e_${suffix}_b`,
      name: 'Полка Б',
      sortOrder: 20,
    });
    expect(groupB.status).toBe(201);
    groupBId = groupB.body.id as number;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(
        'DELETE FROM gear_items WHERE owner_user_id = $1',
        [ownerId],
      );
      await dataSource.query(`DELETE FROM gear_groups WHERE code LIKE 'e2e\\_%'`);
      await dataSource.query(`DELETE FROM gear_types WHERE code LIKE 'e2e\\_%'`);
      await dataSource.query('DELETE FROM users WHERE id = $1', [ownerId]);
    }
    await app?.close();
  });

  /** Завести вещь и вернуть её тело. */
  async function addItem(body: Record<string, unknown> = {}) {
    const response = await call('post', '/api/gear', ownerToken, {
      typeId,
      title: 'Проверочная вещь',
      ...body,
    });
    expect(response.status).toBe(201);

    return response.body as Record<string, unknown>;
  }

  /** Вещи группы по названию — в том порядке, в каком их отдаёт список. */
  async function titlesOfGroup(groupId: number): Promise<string[]> {
    const response = await call('get', '/api/gear', ownerToken).expect(200);
    const items = response.body.items as Array<{
      title: string;
      groupId: number;
    }>;

    return items.filter((item) => item.groupId === groupId).map((item) => item.title);
  }

  // ─────────────────────────── доступ ───────────────────────────

  it('без токена публичный список не отдаёт', async () => {
    await call('get', '/api/gear-groups').expect(401);
  });

  it('чужому админский список не отдаёт — 403', async () => {
    await call('get', '/api/gear/admin/groups', strangerToken).expect(403);
  });

  it('без токена админский список не отдаёт — 401', async () => {
    await call('get', '/api/gear/admin/groups').expect(401);
  });

  // ─────────────────────────── публичный список ───────────────────────────

  it('публичный список: действующие группы в порядке админа', async () => {
    const response = await call('get', '/api/gear-groups', ownerToken).expect(200);
    const items = response.body.items as Array<{
      id: number;
      code: string;
      name: string;
      sortOrder: number;
      isActive?: boolean;
    }>;

    expect(items.length).toBeGreaterThan(0);

    const codes = items.map((group) => group.code);
    expect(codes).toContain('other');
    expect(codes).toContain(`e2e_${suffix}_a`);

    // Архивного флага в публичном ответе нет вовсе, а не `true`.
    expect(items.every((group) => group.isActive === undefined)).toBe(true);

    const orders = items.map((group) => group.sortOrder);
    expect([...orders].sort((left, right) => left - right)).toEqual(orders);
  });

  // ─────────────────────────── админка ───────────────────────────

  it('админ создаёт группу: код, имя, порядок, пустая полка', async () => {
    const response = await call('post', '/api/gear/admin/groups', adminToken, {
      code: `e2e_${suffix}_c`,
      name: 'Полка В',
      sortOrder: 30,
    }).expect(201);

    expect(response.body.code).toBe(`e2e_${suffix}_c`);
    expect(response.body.name).toBe('Полка В');
    expect(response.body.sortOrder).toBe(30);
    expect(response.body.isActive).toBe(true);
    expect(response.body.itemsCount).toBe(0);

    await call(
      'delete',
      `/api/gear/admin/groups/${response.body.id}`,
      adminToken,
    ).expect(204);
  });

  it('дубликат кода — 409, код занимается навсегда', async () => {
    await call('post', '/api/gear/admin/groups', adminToken, {
      code: `e2e_${suffix}_a`,
      name: 'Вторая полка А',
    }).expect(409);
  });

  it('кириллица в коде — 400', async () => {
    await call('post', '/api/gear/admin/groups', adminToken, {
      code: 'полка',
      name: 'Кириллица',
    }).expect(400);
  });

  it('код группы в PATCH не меняется — 400', async () => {
    await call('patch', `/api/gear/admin/groups/${groupAId}`, adminToken, {
      code: `e2e_${suffix}_new`,
    }).expect(400);
  });

  it('админ переименовывает и переставляет группу', async () => {
    const response = await call(
      'patch',
      `/api/gear/admin/groups/${groupAId}`,
      adminToken,
      { name: 'Полка А (переименована)', sortOrder: 40 },
    ).expect(200);

    expect(response.body.name).toBe('Полка А (переименована)');
    expect(response.body.sortOrder).toBe(40);
  });

  it('архив: 204, повторно 204, из публичного списка исчезает', async () => {
    await call(
      'delete',
      `/api/gear/admin/groups/${groupBId}`,
      adminToken,
    ).expect(204);
    await call(
      'delete',
      `/api/gear/admin/groups/${groupBId}`,
      adminToken,
    ).expect(204);

    const publicList = await call('get', '/api/gear-groups', ownerToken).expect(200);
    const codes = (publicList.body.items as Array<{ code: string }>).map(
      (group) => group.code,
    );
    expect(codes).not.toContain(`e2e_${suffix}_b`);

    const adminList = await call(
      'get',
      '/api/gear/admin/groups',
      adminToken,
    ).expect(200);
    const archived = (
      adminList.body.items as Array<{
        id: number;
        isActive: boolean;
        itemsCount: number;
      }>
    ).find((group) => group.id === groupBId);
    expect(archived?.isActive).toBe(false);
    expect(archived?.itemsCount).toBe(0);
  });

  it('«Прочее» в архив не убирается — 409', async () => {
    const response = await call(
      'delete',
      `/api/gear/admin/groups/${otherGroupId}`,
      adminToken,
    ).expect(409);

    expect(response.body.message as string).toContain('Прочее');
  });

  // ─────────────────────────── полка у вещи ───────────────────────────

  it('вещь без groupId попадает в «Прочее»', async () => {
    const item = await addItem({ title: 'Фонарик без полки' });

    expect(item.groupId).toBe(otherGroupId);
    expect(item.groupCode).toBe('other');
    expect(item.groupName).toBe('Прочее');
    expect(item.sortOrder as number).toBeGreaterThan(0);
  });

  it('вещь с groupId — на выбранной полке', async () => {
    const item = await addItem({ title: 'Топор на полке', groupId: groupAId });

    expect(item.groupId).toBe(groupAId);
    expect(item.groupCode).toBe(`e2e_${suffix}_a`);
  });

  it('несуществующая группа — 400', async () => {
    await call('post', '/api/gear', ownerToken, {
      typeId,
      title: 'Вещь в никуда',
      groupId: 2147483000,
    }).expect(400);
  });

  it('архивная группа в теле вещи — 400', async () => {
    await call('post', '/api/gear', ownerToken, {
      typeId,
      title: 'Вещь в архивной полке',
      groupId: groupBId,
    }).expect(400);
  });

  // ─────────────────────────── личный порядок ───────────────────────────

  it('новые вещи встают в конец своей группы', async () => {
    await addItem({ title: 'Вторая', groupId: groupAId });
    await addItem({ title: 'Третья', groupId: groupAId });

    expect(await titlesOfGroup(groupAId)).toEqual([
      'Топор на полке',
      'Вторая',
      'Третья',
    ]);
  });

  it('стрелка вниз меняет соседей местами', async () => {
    const items = (await call('get', '/api/gear', ownerToken).expect(200)).body
      .items as Array<{ id: string; title: string; groupId: number }>;
    const first = items.find((item) => item.title === 'Топор на полке');

    const response = await call(
      'post',
      `/api/gear/${first?.id}/move`,
      ownerToken,
      { direction: 'down' },
    ).expect(200);

    const titles = (
      response.body.items as Array<{ title: string; groupId: number }>
    )
      .filter((item) => item.groupId === groupAId)
      .map((item) => item.title);

    expect(titles).toEqual(['Вторая', 'Топор на полке', 'Третья']);
  });

  it('стрелка вверх в начале группы ничего не меняет', async () => {
    const items = (await call('get', '/api/gear', ownerToken).expect(200)).body
      .items as Array<{ id: string; title: string; groupId: number }>;
    const first = items.find(
      (item) => item.groupId === groupAId && item.title === 'Вторая',
    );

    await call('post', `/api/gear/${first?.id}/move`, ownerToken, {
      direction: 'up',
    }).expect(200);

    expect(await titlesOfGroup(groupAId)).toEqual([
      'Вторая',
      'Топор на полке',
      'Третья',
    ]);
  });

  it('чужую вещь двигать нельзя — 404', async () => {
    const items = (await call('get', '/api/gear', ownerToken).expect(200)).body
      .items as Array<{ id: string }>;

    await call('post', `/api/gear/${items[0]?.id}/move`, strangerToken, {
      direction: 'up',
    }).expect(404);
  });

  it('направление вне up/down — 400', async () => {
    const items = (await call('get', '/api/gear', ownerToken).expect(200)).body
      .items as Array<{ id: string }>;

    await call('post', `/api/gear/${items[0]?.id}/move`, ownerToken, {
      direction: 'left',
    }).expect(400);
  });

  it('смена группы переносит вещь в конец новой полки', async () => {
    const items = (await call('get', '/api/gear', ownerToken).expect(200)).body
      .items as Array<{ id: string; title: string; sortOrder: number }>;
    const moved = items.find((item) => item.title === 'Вторая');

    const response = await call(
      'patch',
      `/api/gear/${moved?.id}`,
      ownerToken,
      { groupId: otherGroupId },
    ).expect(200);

    expect(response.body.groupId).toBe(otherGroupId);
    expect(response.body.sortOrder as number).toBeGreaterThan(
      moved?.sortOrder as number,
    );

    expect(await titlesOfGroup(groupAId)).toEqual(['Топор на полке', 'Третья']);
  });

  it('архивная группа не принимается и в PATCH — 400', async () => {
    const items = (await call('get', '/api/gear', ownerToken).expect(200)).body
      .items as Array<{ id: string }>;

    await call('patch', `/api/gear/${items[0]?.id}`, ownerToken, {
      groupId: groupBId,
    }).expect(400);
  });
});
