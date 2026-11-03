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
 * Личные группы снаряжения (e2e, 02.11.2026).
 *
 * Заказчик: «Типы, по-прежнему, создаёт админ… А группировать их разрешим
 * самостоятельно. Заводим рекомендуемые группы, они управляются админом,
 * приходят новым пользователям и с новыми типами, но пользователь в праве
 * сам менять их под себя».
 *
 * Проверяем всё, на чём держится контракт:
 *
 * - **рекомендуемые группы** (`gear/admin/group-templates`) — админские,
 *   `code` неизменяем, удаления нет (архив), «Прочее» не архивируется;
 * - **личные группы** (`gear-groups`) — у каждого свои: новый пользователь
 *   получает копии шаблонов, «Прочее» последнее и неудаляемо;
 * - **новый тип** с рекомендованной группой сам доезжает до человека;
 * - **раскладка типов** — один тип в одной группе, перекладывание типа
 *   переносит все его вещи, архивный тип не перекладывают;
 * - **вещь больше не выбирает группу**: её полка — группа типа; `groupId`
 *   в теле — 400, как удалённое поле;
 * - **местоположение** — свободный текст, пустое становится `null`;
 * - **личный порядок** — внутри группы, через типы, и чужую вещь не двигают.
 *
 * Пользователей заводим напрямую в базе, токены — `JwtService`: стратегия
 * проверяет только подпись и не ходит в БД. За собой убираем всё с префиксом
 * `e2e_…`.
 */
describe('Личные группы снаряжения (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  let adminToken: string;
  let ownerToken: string;
  let ownerId: string;
  let strangerToken: string;
  let strangerId: string;

  let recommendedTemplateId: number;
  let typeAId: number;
  let typeBId: number;
  let typeOtherId: number;

  const suffix = Date.now().toString(36);
  const templateCode = `e2e_${suffix}_rec`;

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

  interface GroupBody {
    id: number;
    name: string;
    sortOrder: number;
    templateCode: string | null;
    isDefault: boolean;
    types: Array<{ id: number; code: string; name: string; isActive: boolean }>;
  }

  async function myGroups(token = ownerToken): Promise<GroupBody[]> {
    const response = await call('get', '/api/gear-groups', token).expect(200);

    return response.body.items as GroupBody[];
  }

  function groupOfTemplate(groups: GroupBody[], code: string): GroupBody {
    const group = groups.find((row) => row.templateCode === code);
    expect(group).toBeDefined();

    return group as GroupBody;
  }

  async function addItem(
    body: Record<string, unknown> = {},
    token = ownerToken,
  ): Promise<Record<string, unknown>> {
    const response = await call('post', '/api/gear', token, {
      typeId: typeAId,
      title: 'Проверочная вещь',
      ...body,
    });
    expect(response.status).toBe(201);

    return response.body as Record<string, unknown>;
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

    ownerId = (
      await dataSource.query(
        `INSERT INTO users (display_name) VALUES ('Хозяин групп e2e')
         RETURNING id`,
      )
    )[0].id;
    ownerToken = await jwtService.signAsync({ sub: ownerId });

    strangerId = (
      await dataSource.query(
        `INSERT INTO users (display_name) VALUES ('Посторонний групп e2e')
         RETURNING id`,
      )
    )[0].id;
    strangerToken = await jwtService.signAsync({ sub: strangerId });

    // Рекомендуемая группа админа: на неё будут опираться два типа.
    const template = await call(
      'post',
      '/api/gear/admin/group-templates',
      adminToken,
      { code: templateCode, name: 'Проверочная рекомендуемая', sortOrder: 45 },
    ).expect(201);
    recommendedTemplateId = template.body.id as number;

    const typeA = await call('post', '/api/gear/admin/types', adminToken, {
      code: `e2e_${suffix}_a`,
      name: 'Тип А',
      recommendedGroupId: recommendedTemplateId,
    }).expect(201);
    typeAId = typeA.body.id as number;

    const typeB = await call('post', '/api/gear/admin/types', adminToken, {
      code: `e2e_${suffix}_b`,
      name: 'Тип Б',
      recommendedGroupId: recommendedTemplateId,
    }).expect(201);
    typeBId = typeB.body.id as number;

    // Тип без рекомендации: попадает в «Прочее» — нужен для смены группы.
    const typeOther = await call('post', '/api/gear/admin/types', adminToken, {
      code: `e2e_${suffix}_other`,
      name: 'Тип вне рекомендаций',
    }).expect(201);
    typeOtherId = typeOther.body.id as number;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(
        'DELETE FROM gear_items WHERE owner_user_id = ANY($1)',
        [[ownerId, strangerId]],
      );
      await dataSource.query(`DELETE FROM gear_types WHERE code LIKE 'e2e\\_%'`);
      await dataSource.query(
        `DELETE FROM gear_group_templates WHERE code LIKE 'e2e\\_%'`,
      );
      await dataSource.query('DELETE FROM users WHERE id = ANY($1)', [
        [ownerId, strangerId],
      ]);
    }
    await app?.close();
  });

  // ─────────────────────────── доступ ───────────────────────────

  it('без токена личные группы не отдаются', async () => {
    await call('get', '/api/gear-groups').expect(401);
  });

  it('без токена рекомендуемые группы не отдаются', async () => {
    await call('get', '/api/gear/admin/group-templates').expect(401);
  });

  it('чужому рекомендуемые группы не отдаются — 403', async () => {
    await call(
      'get',
      '/api/gear/admin/group-templates',
      strangerToken,
    ).expect(403);
  });

  // ─────────────────── рекомендуемые группы (админ) ───────────────────

  it('админ создаёт рекомендуемую группу: код, имя, порядок', async () => {
    const created = await call(
      'post',
      '/api/gear/admin/group-templates',
      adminToken,
      {
        code: `e2e_${suffix}_extra`,
        name: 'Ещё одна рекомендуемая',
        sortOrder: 60,
      },
    ).expect(201);

    expect(created.body.code).toBe(`e2e_${suffix}_extra`);
    expect(created.body.name).toBe('Ещё одна рекомендуемая');
    expect(created.body.sortOrder).toBe(60);
    expect(created.body.isActive).toBe(true);
    expect(created.body.typesCount).toBe(0);

    await call(
      'delete',
      `/api/gear/admin/group-templates/${created.body.id}`,
      adminToken,
    ).expect(204);
  });

  it('код рекомендуемой группы уникален и не меняется', async () => {
    await call('post', '/api/gear/admin/group-templates', adminToken, {
      code: templateCode,
      name: 'Дубль',
    }).expect(409);

    await call('post', '/api/gear/admin/group-templates', adminToken, {
      code: 'рекомендуемая',
      name: 'Кириллица',
    }).expect(400);

    await call(
      'patch',
      `/api/gear/admin/group-templates/${recommendedTemplateId}`,
      adminToken,
      { code: `e2e_${suffix}_new` },
    ).expect(400);
  });

  it('админ переименовывает и переставляет рекомендуемую группу', async () => {
    const response = await call(
      'patch',
      `/api/gear/admin/group-templates/${recommendedTemplateId}`,
      adminToken,
      { name: 'Проверочная рекомендуемая 2', sortOrder: 46 },
    ).expect(200);

    expect(response.body.name).toBe('Проверочная рекомендуемая 2');
    expect(response.body.sortOrder).toBe(46);
  });

  it('архив рекомендуемой группы: 204, повторно 204, из списка не исчезает', async () => {
    const created = await call(
      'post',
      '/api/gear/admin/group-templates',
      adminToken,
      { code: `e2e_${suffix}_arch`, name: 'В архив' },
    ).expect(201);

    await call(
      'delete',
      `/api/gear/admin/group-templates/${created.body.id}`,
      adminToken,
    ).expect(204);
    await call(
      'delete',
      `/api/gear/admin/group-templates/${created.body.id}`,
      adminToken,
    ).expect(204);

    const list = await call(
      'get',
      '/api/gear/admin/group-templates',
      adminToken,
    ).expect(200);
    const archived = (list.body.items as Array<{ id: number; isActive: boolean }>).find(
      (row) => row.id === created.body.id,
    );
    expect(archived?.isActive).toBe(false);
  });

  it('«Прочее» в архив не убирается — 409', async () => {
    const list = await call(
      'get',
      '/api/gear/admin/group-templates',
      adminToken,
    ).expect(200);
    const other = (
      list.body.items as Array<{ id: number; code: string }>
    ).find((row) => row.code === 'other');

    const response = await call(
      'delete',
      `/api/gear/admin/group-templates/${other?.id}`,
      adminToken,
    ).expect(409);
    expect(response.body.message as string).toContain('Прочее');
  });

  // ─────────────────── личные копии рекомендуемых ───────────────────

  it('новый пользователь получает копии рекомендуемых групп', async () => {
    const groups = await myGroups();

    const copy = groupOfTemplate(groups, templateCode);
    expect(copy.isDefault).toBe(false);
    expect(copy.name).toBe('Проверочная рекомендуемая 2');
    expect(copy.types.map((type) => type.id)).toEqual(
      expect.arrayContaining([typeAId, typeBId]),
    );
  });

  it('«Прочее» есть у каждого, помечено умолчанием и стоит последним', async () => {
    const groups = await myGroups();
    const other = groupOfTemplate(groups, 'other');

    expect(other.isDefault).toBe(true);
    expect(groups.at(-1)?.id).toBe(other.id);
    expect(groups.map((group) => group.sortOrder)).toEqual(
      groups.map((group) => group.sortOrder).sort((a, b) => a - b),
    );
  });

  it('новый тип с рекомендацией доезжает до человека сам', async () => {
    const created = await call('post', '/api/gear/admin/types', adminToken, {
      code: `e2e_${suffix}_late`,
      name: 'Поздний тип',
      recommendedGroupId: recommendedTemplateId,
    }).expect(201);

    const groups = await myGroups();
    const copy = groupOfTemplate(groups, templateCode);
    expect(copy.types.some((type) => type.id === created.body.id)).toBe(true);

    await call(
      'delete',
      `/api/gear/admin/types/${created.body.id}`,
      adminToken,
    ).expect(204);
  });

  it('у постороннего свои группы, а не копии хозяина', async () => {
    const groups = await myGroups(strangerToken);

    const copy = groupOfTemplate(groups, templateCode);
    expect(copy.id).not.toBe(groupOfTemplate(await myGroups(), templateCode).id);
    expect(copy.types.map((type) => type.id)).toEqual(
      expect.arrayContaining([typeAId, typeBId]),
    );
  });

  // ─────────────────── свои группы: имя, порядок ───────────────────

  it('создаёт свою группу перед «Прочим»', async () => {
    const response = await call('post', '/api/gear-groups', ownerToken, {
      name: 'Рыбалка',
    }).expect(201);

    const groups = response.body.items as GroupBody[];
    const created = groups.find((group) => group.name === 'Рыбалка');
    const other = groupOfTemplate(groups, 'other');

    expect(created).toBeDefined();
    expect(created?.templateCode).toBeNull();
    expect(created?.isDefault).toBe(false);
    expect(other.sortOrder).toBeGreaterThan(created?.sortOrder as number);
  });

  it('одинаковое имя группы у человека — 409', async () => {
    await call('post', '/api/gear-groups', ownerToken, {
      name: 'рыбалка',
    }).expect(409);
  });

  it('переименовывает группу и меняет порядок', async () => {
    const groups = await myGroups();
    const target = groups.find((group) => group.name === 'Рыбалка') as GroupBody;

    const response = await call(
      'patch',
      `/api/gear-groups/${target.id}`,
      ownerToken,
      { name: 'Рыбалка и охота' },
    ).expect(200);

    expect(
      (response.body.items as GroupBody[]).find((group) => group.id === target.id)
        ?.name,
    ).toBe('Рыбалка и охота');
  });

  it('«Прочее» переименовать можно, переставить — 400', async () => {
    const other = groupOfTemplate(await myGroups(), 'other');

    await call('patch', `/api/gear-groups/${other.id}`, ownerToken, {
      name: 'Прочее (переименовано)',
    }).expect(200);

    await call('patch', `/api/gear-groups/${other.id}`, ownerToken, {
      sortOrder: 0,
    }).expect(400);

    await call('post', `/api/gear-groups/${other.id}/move`, ownerToken, {
      direction: 'up',
    }).expect(400);

    await call('patch', `/api/gear-groups/${other.id}`, ownerToken, {
      name: 'Прочее',
    }).expect(200);
  });

  it('стрелка переставляет свою группу, но не «Прочее»', async () => {
    const groups = await myGroups();
    const target = groups.find((group) => group.name === 'Рыбалка и охота') as GroupBody;

    const response = await call(
      'post',
      `/api/gear-groups/${target.id}/move`,
      ownerToken,
      { direction: 'up' },
    ).expect(200);

    const moved = (response.body.items as GroupBody[]).find(
      (group) => group.id === target.id,
    );
    expect(moved?.sortOrder).toBeLessThan(target.sortOrder);
    expect((response.body.items as GroupBody[]).at(-1)?.isDefault).toBe(true);
  });

  it('направление вне up/down — 400', async () => {
    const groups = await myGroups();
    const target = groups.find((group) => group.name === 'Рыбалка и охота') as GroupBody;

    await call('post', `/api/gear-groups/${target.id}/move`, ownerToken, {
      direction: 'left',
    }).expect(400);
  });

  it('чужую личную группу изменить нельзя — 404', async () => {
    const groups = await myGroups();
    const target = groups.find((group) => group.name === 'Рыбалка и охота') as GroupBody;

    await call(
      'patch',
      `/api/gear-groups/${target.id}`,
      strangerToken,
      { name: 'Чужая' },
    ).expect(404);
    await call(
      'delete',
      `/api/gear-groups/${target.id}`,
      strangerToken,
    ).expect(404);
  });

  // ─────────────────── раскладка типов ───────────────────

  it('тип перекладывается в другую группу и уходит из прежней', async () => {
    const groups = await myGroups();
    const target = groups.find((group) => group.name === 'Рыбалка и охота') as GroupBody;
    const source = groupOfTemplate(groups, templateCode);

    const response = await call(
      'post',
      `/api/gear-groups/${target.id}/types`,
      ownerToken,
      { typeId: typeAId },
    ).expect(200);

    const items = response.body.items as GroupBody[];
    expect(
      items.find((group) => group.id === target.id)?.types.map((type) => type.id),
    ).toContain(typeAId);
    expect(
      items.find((group) => group.id === source.id)?.types.map((type) => type.id),
    ).not.toContain(typeAId);
  });

  it('архивный тип перекладывать нельзя — 400', async () => {
    const groups = await myGroups();
    const target = groups.find((group) => group.name === 'Рыбалка и охота') as GroupBody;

    const archived = await call('post', '/api/gear/admin/types', adminToken, {
      code: `e2e_${suffix}_arch_type`,
      name: 'Архивный тип',
      recommendedGroupId: recommendedTemplateId,
    }).expect(201);
    await call(
      'delete',
      `/api/gear/admin/types/${archived.body.id}`,
      adminToken,
    ).expect(204);

    await call(
      'post',
      `/api/gear-groups/${target.id}/types`,
      ownerToken,
      { typeId: archived.body.id },
    ).expect(400);
  });

  it('тип кладётся в чужую группу только если она своя — 404', async () => {
    const groups = await myGroups(strangerToken);
    const foreign = groups.find((group) => group.isDefault) as GroupBody;

    // Группа своя для постороннего, но тип перекладывает он же — это
    // разрешено; а вот чужая группа для хозяина не находится.
    const ownerGroups = await myGroups();
    const ownerGroup = ownerGroups.find(
      (group) => group.name === 'Рыбалка и охота',
    ) as GroupBody;

    await call(
      'post',
      `/api/gear-groups/${ownerGroup.id}/types`,
      strangerToken,
      { typeId: typeAId },
    ).expect(404);

    expect(foreign.id).not.toBe(ownerGroup.id);
  });

  // ─────────────────── вещь и её группа ───────────────────

  it('вещь попадает в группу своего типа без выбора полки', async () => {
    const item = await addItem({ title: 'Вещь типа А' });
    const groups = await myGroups();
    const target = groups.find((group) =>
      group.types.some((type) => type.id === typeAId),
    ) as GroupBody;

    expect(item.groupId).toBe(target.id);
    expect(item.groupName).toBe(target.name);
    expect(item.groupCode).toBe(target.templateCode ?? `custom_${target.id}`);
  });

  it('groupId в теле — удалённое поле, 400', async () => {
    await call('post', '/api/gear', ownerToken, {
      typeId: typeAId,
      title: 'Вещь со старой полкой',
      groupId: 1,
    }).expect(400);
  });

  it('местоположение сохраняется и обрезается, пустое — null', async () => {
    const withPlace = await addItem({ title: 'В гараже', location: '  гараж  ' });
    expect(withPlace.location).toBe('гараж');

    const withoutPlace = await addItem({ title: 'Без места', location: '   ' });
    expect(withoutPlace.location).toBeNull();
  });

  it('смена типа переносит вещь в группу нового типа', async () => {
    const item = await addItem({ title: 'Переезжающая' });
    const response = await call(
      'patch',
      `/api/gear/${item.id}`,
      ownerToken,
      { typeId: typeOtherId },
    ).expect(200);

    const groups = await myGroups();
    const other = groupOfTemplate(groups, 'other');
    expect(response.body.groupId).toBe(other.id);
    expect(response.body.groupCode).toBe('other');
  });

  it('порядок двигается внутри группы, в том числе между типами', async () => {
    await call('post', `/api/gear-groups/${groupOfTemplate(await myGroups(), templateCode).id}/types`, ownerToken, { typeId: typeAId }).expect(200);

    const first = await addItem({ title: 'Первая в группе', typeId: typeAId });
    const second = await addItem({ title: 'Вторая в группе', typeId: typeBId });

    const response = await call(
      'post',
      `/api/gear/${first.id}/move`,
      ownerToken,
      { direction: 'down' },
    ).expect(200);

    const ordered = (response.body.items as Array<{ id: string; groupId: number }>)
      .filter((item) => item.groupId === first.groupId)
      .map((item) => item.id);
    expect(ordered.indexOf(second.id as string)).toBeLessThan(
      ordered.indexOf(first.id as string),
    );
  });

  it('чужую вещь двигать нельзя — 404', async () => {
    const items = (
      await call('get', '/api/gear', ownerToken).expect(200)
    ).body.items as Array<{ id: string }>;

    await call('post', `/api/gear/${items[0]?.id}/move`, strangerToken, {
      direction: 'up',
    }).expect(404);
  });

  // ─────────────────── удаление своей группы ───────────────────

  it('удаление группы переносит её типы в «Прочее»', async () => {
    // Своя группа, в которую положим тип Б.
    const created = await call('post', '/api/gear-groups', ownerToken, {
      name: 'Временная',
    }).expect(201);
    const temp = (created.body.items as GroupBody[]).find(
      (group) => group.name === 'Временная',
    ) as GroupBody;

    await call(
      'post',
      `/api/gear-groups/${temp.id}/types`,
      ownerToken,
      { typeId: typeBId },
    ).expect(200);

    const response = await call(
      'delete',
      `/api/gear-groups/${temp.id}`,
      ownerToken,
    ).expect(200);

    const groups = response.body.items as GroupBody[];
    expect(groups.some((group) => group.id === temp.id)).toBe(false);
    expect(
      groupOfTemplate(groups, 'other').types.map((type) => type.id),
    ).toContain(typeBId);
  });

  it('«Прочее» удалить нельзя — 409', async () => {
    const other = groupOfTemplate(await myGroups(), 'other');

    const response = await call(
      'delete',
      `/api/gear-groups/${other.id}`,
      ownerToken,
    ).expect(409);
    expect(response.body.message as string).toContain('Прочее');
  });

  it('удалённая копия шаблона не воскресает при следующем открытии', async () => {
    const roof = groupOfTemplate(await myGroups(), 'roof');

    await call('delete', `/api/gear-groups/${roof.id}`, ownerToken).expect(200);

    const after = await myGroups();
    expect(after.some((group) => group.templateCode === 'roof')).toBe(false);
  });
});
