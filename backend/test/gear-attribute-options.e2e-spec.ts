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

/** Строки ответов, которые нужны этому тесту: лишние поля не описываем. */
interface OptionRow {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
}

interface AttributeRow {
  id: number;
  code: string;
  valueKind: string;
  allowCustomValue: boolean;
  isRequired: boolean;
  isActive: boolean;
  options: OptionRow[];
}

interface TypeRow {
  id: number;
  attributes: AttributeRow[];
}

/**
 * Списки вариантов у характеристики типа (e2e, 30.10.2026).
 *
 * Четвёртый вид значения — `select`: короткий выбор из предложенных вариантов
 * плюс, если админ разрешил, своё значение. Варианты живут отдельной таблицей
 * (`gear_attribute_options`), потому что их переименовывают, добавляют
 * и архивируют, а массиву в характеристике нечем держать ни стабильный код,
 * ни архив, ни порядок.
 *
 * Проверяем то, на чём этот вид держится:
 *
 * - **список создаётся сразу с вариантами** одной транзакцией — админ не
 *   получает «мёртвую» характеристику без единого варианта;
 * - **«мёртвый» список запрещён**: без вариантов и без разрешённого своего
 *   значения — 400 на создание и 409 на попытку убрать последний вариант;
 * - **`allowCustomValue` только у списка** — у числа, строки и галочки 400
 *   (в базе то же правило держит CHECK);
 * - **варианты — отдельные строки**: код неизменяем (400), имя меняется,
 *   архив вместо удаления, имена внутри списка не повторяются;
 * - **публичный ответ** отдаёт только активные варианты, архивные остаются
 *   в админском;
 * - **вложенность проверяется**: чужой тип, характеристика или вариант — 404.
 *
 * `fillMissing` для списка — название варианта: в Stage B именно имя ляжет
 * в `text_value`. Замещающее значение по-прежнему только проверяется
 * (таблицы значений ещё нет).
 *
 * Пользователей не заводим: `JwtStrategy` проверяет подпись, а `isAdminUser`
 * — UUID из списка админов. За собой убираем типы с кодом `e2e_opt_…`:
 * характеристики и варианты уходят каскадом.
 */
describe('Варианты характеристик-списков (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let strangerToken: string;

  /** Уникальный префикс кодов: повторный прогон не спорит с прошлым. */
  const suffix = Date.now().toString(36);
  const code = (name: string): string => `e2e_opt_${suffix}_${name}`;

  let typeId: number;
  /** Характеристика-список «Соединение» с вариантами. */
  let listId: number;
  /** Характеристика-список «Топливо» со своим значением. */
  let fuelId: number;

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

  async function createAttribute(
    body: Record<string, unknown>,
  ): Promise<AttributeRow> {
    const response = await call(
      'post',
      `/api/gear/admin/types/${typeId}/attributes`,
      adminToken,
      body,
    ).expect(201);

    return response.body as AttributeRow;
  }

  async function adminTypes(): Promise<TypeRow[]> {
    const response = await call(
      'get',
      '/api/gear/admin/types',
      adminToken,
    ).expect(200);

    return response.body.items as TypeRow[];
  }

  async function adminAttribute(attributeId: number): Promise<AttributeRow> {
    const type = (await adminTypes()).find((row) => row.id === typeId);
    const attribute = type?.attributes.find((row) => row.id === attributeId);
    if (!attribute) throw new Error('Характеристика не найдена в админке');

    return attribute;
  }

  /** Тип из публичного ответа — то, что увидит пользовательский конец API. */
  async function publicType(): Promise<TypeRow> {
    const response = await call('get', '/api/gear-types', adminToken).expect(
      200,
    );
    const found = (response.body.items as TypeRow[]).find(
      (row) => row.id === typeId,
    );
    if (!found) throw new Error('Тип не найден в публичном списке');

    return found;
  }

  async function publicAttribute(codeName: string): Promise<AttributeRow> {
    const attribute = (await publicType()).attributes.find(
      (row) => row.code === codeName,
    );
    if (!attribute) throw new Error(`Характеристики ${codeName} нет`);

    return attribute;
  }

  async function optionId(
    attributeId: number,
    optionCode: string,
  ): Promise<number> {
    const option = (await adminAttribute(attributeId)).options.find(
      (row) => row.code === optionCode,
    );
    if (!option) throw new Error(`Варианта ${optionCode} нет`);

    return option.id;
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

    const type = await call('post', '/api/gear/admin/types', adminToken, {
      code: code('stove'),
      name: 'Горелка',
    }).expect(201);
    typeId = type.body.id as number;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // Код с префиксом `e2e_opt_` — только тестовый. Характеристики
      // и варианты уходят каскадом вместе с типом.
      await dataSource.query(
        `DELETE FROM gear_types WHERE code LIKE 'e2e\\_opt\\_%'`,
      );
    }
    await app?.close();
  });

  // ─────────────────────────── доступ ───────────────────────────

  it('без токена варианты не создать — 401', async () => {
    await call(
      'post',
      `/api/gear/admin/types/1/attributes/1/options`,
      undefined,
      { code: 'thread', name: 'резьбовой' },
    ).expect(401);
  });

  it('чужому варианты не создать — 403', async () => {
    await call(
      'post',
      `/api/gear/admin/types/${typeId}/attributes/1/options`,
      strangerToken,
      { code: 'thread', name: 'резьбовой' },
    ).expect(403);
  });

  // ─────────────────── создание списка вместе с вариантами ───────────────────

  it('список создаётся сразу с вариантами: коды, имена, порядок', async () => {
    const created = await createAttribute({
      code: 'connection',
      name: 'Соединение',
      valueKind: 'select',
      options: [
        { code: 'thread', name: 'резьбовой', sortOrder: 10 },
        { code: 'collet', name: 'цанговый', sortOrder: 20 },
      ],
    });

    listId = created.id;

    expect(created.valueKind).toBe('select');
    expect(created.allowCustomValue).toBe(false);
    expect(created.options.map((option) => [option.code, option.name])).toEqual(
      [
        ['thread', 'резьбовой'],
        ['collet', 'цанговый'],
      ],
    );
  });

  it('публичный список отдаёт варианты списка в порядке показа', async () => {
    const attribute = await publicAttribute('connection');

    expect(attribute.allowCustomValue).toBe(false);
    expect(attribute.options.map((option) => option.name)).toEqual([
      'резьбовой',
      'цанговый',
    ]);
  });

  it('список без вариантов и без своего значения — 400', async () => {
    await call(
      'post',
      `/api/gear/admin/types/${typeId}/attributes`,
      adminToken,
      { code: 'port', name: 'Разъём', valueKind: 'select' },
    ).expect(400);
  });

  it('список без вариантов, но со своим значением — создаётся', async () => {
    const created = await createAttribute({
      code: 'fuel',
      name: 'Топливо',
      valueKind: 'select',
      allowCustomValue: true,
    });

    fuelId = created.id;

    expect(created.allowCustomValue).toBe(true);
    expect(created.options).toEqual([]);
  });

  it('«своё значение» у числа — 400: флаг имеет смысл только у списка', async () => {
    await call(
      'post',
      `/api/gear/admin/types/${typeId}/attributes`,
      adminToken,
      {
        code: 'weight',
        name: 'Вес',
        valueKind: 'number',
        allowCustomValue: true,
      },
    ).expect(400);
  });

  it('варианты у числа при создании — 400', async () => {
    await call(
      'post',
      `/api/gear/admin/types/${typeId}/attributes`,
      adminToken,
      {
        code: 'mass',
        name: 'Масса',
        valueKind: 'number',
        options: [{ code: 'heavy', name: 'тяжёлая' }],
      },
    ).expect(400);
  });

  it('повтор кода варианта в одном запросе — 409', async () => {
    await call(
      'post',
      `/api/gear/admin/types/${typeId}/attributes`,
      adminToken,
      {
        code: 'duplicate_code',
        name: 'Дубль кода',
        valueKind: 'select',
        options: [
          { code: 'thread', name: 'резьбовой' },
          { code: 'thread', name: 'резьбовой второй' },
        ],
      },
    ).expect(409);
  });

  it('повтор имени варианта без учёта регистра — 409', async () => {
    await call(
      'post',
      `/api/gear/admin/types/${typeId}/attributes`,
      adminToken,
      {
        code: 'duplicate_name',
        name: 'Дубль имени',
        valueKind: 'select',
        options: [
          { code: 'thread', name: 'Резьбовой' },
          { code: 'collet', name: 'резьбовой' },
        ],
      },
    ).expect(409);
  });

  // ─────────────────────── замещающее значение ───────────────────────

  it('замещающее значение списка — название варианта', async () => {
    // Обязательная характеристика без значения — 400.
    await call(
      'post',
      `/api/gear/admin/types/${typeId}/attributes`,
      adminToken,
      {
        code: 'nozzle',
        name: 'Сопло',
        valueKind: 'select',
        isRequired: true,
        options: [{ code: 'wide', name: 'широкое' }],
      },
    ).expect(400);

    // Своё значение не разрешено — значение вне списка 400.
    await call(
      'post',
      `/api/gear/admin/types/${typeId}/attributes`,
      adminToken,
      {
        code: 'nozzle',
        name: 'Сопло',
        valueKind: 'select',
        isRequired: true,
        fillMissing: 'гравитационное',
        options: [{ code: 'wide', name: 'широкое' }],
      },
    ).expect(400);

    // Название варианта — 201.
    const created = await createAttribute({
      code: 'nozzle',
      name: 'Сопло',
      valueKind: 'select',
      isRequired: true,
      fillMissing: 'широкое',
      options: [{ code: 'wide', name: 'широкое' }],
    });

    expect(created.isRequired).toBe(true);
  });

  it('включение обязательности у списка проверяет значение по вариантам', async () => {
    const created = await createAttribute({
      code: 'adapter',
      name: 'Переходник',
      valueKind: 'select',
      options: [{ code: 'straight', name: 'прямой' }],
    });

    await call(
      'patch',
      `/api/gear/admin/types/${typeId}/attributes/${created.id}`,
      adminToken,
      { isRequired: true, fillMissing: 'угловой' },
    ).expect(400);

    const required = await call(
      'patch',
      `/api/gear/admin/types/${typeId}/attributes/${created.id}`,
      adminToken,
      { isRequired: true, fillMissing: 'прямой' },
    ).expect(200);

    expect(required.body.isRequired).toBe(true);
  });

  // ─────────────────────── отдельные ручки вариантов ───────────────────────

  it('вариант добавляется к существующему списку', async () => {
    const response = await call(
      'post',
      `/api/gear/admin/types/${typeId}/attributes/${listId}/options`,
      adminToken,
      { code: 'gravity', name: 'гравитационный', sortOrder: 30 },
    ).expect(201);

    expect(response.body.code).toBe('gravity');
    expect(response.body.isActive).toBe(true);

    const attribute = await publicAttribute('connection');
    expect(attribute.options.map((option) => option.name)).toContain(
      'гравитационный',
    );
  });

  it('дубликат кода варианта — 409, нелатинский код — 400', async () => {
    await call(
      'post',
      `/api/gear/admin/types/${typeId}/attributes/${listId}/options`,
      adminToken,
      { code: 'thread', name: 'резьбовой снова' },
    ).expect(409);

    await call(
      'post',
      `/api/gear/admin/types/${typeId}/attributes/${listId}/options`,
      adminToken,
      { code: 'Гравитация', name: 'Гравитация' },
    ).expect(400);
  });

  it('вариант у числовой характеристики — 400', async () => {
    const created = await createAttribute({
      code: 'mass',
      name: 'Масса',
      valueKind: 'number',
    });

    await call(
      'post',
      `/api/gear/admin/types/${typeId}/attributes/${created.id}/options`,
      adminToken,
      { code: 'heavy', name: 'тяжёлая' },
    ).expect(400);
  });

  it('переименование варианта: имя меняется, код — нет', async () => {
    const thread = await optionId(listId, 'thread');
    const collet = await optionId(listId, 'collet');

    const renamed = await call(
      'patch',
      `/api/gear/admin/types/${typeId}/attributes/${listId}/options/${thread}`,
      adminToken,
      { name: 'резьбовое' },
    ).expect(200);

    expect(renamed.body.name).toBe('резьбовое');
    expect(renamed.body.code).toBe('thread');

    await call(
      'patch',
      `/api/gear/admin/types/${typeId}/attributes/${listId}/options/${thread}`,
      adminToken,
      { code: 'threaded' },
    ).expect(400);

    await call(
      'patch',
      `/api/gear/admin/types/${typeId}/attributes/${listId}/options/${collet}`,
      adminToken,
      { name: 'резьбовое' },
    ).expect(409);
  });

  it('архив варианта: 204, из публичного списка исчезает, в админке остаётся', async () => {
    const gravity = await optionId(listId, 'gravity');

    await call(
      'delete',
      `/api/gear/admin/types/${typeId}/attributes/${listId}/options/${gravity}`,
      adminToken,
    ).expect(204);

    // Повторный DELETE идемпотентен.
    await call(
      'delete',
      `/api/gear/admin/types/${typeId}/attributes/${listId}/options/${gravity}`,
      adminToken,
    ).expect(204);

    const publicOptions = (await publicAttribute('connection')).options;
    expect(publicOptions.map((option) => option.code)).not.toContain('gravity');

    const archived = (await adminAttribute(listId)).options.find(
      (option) => option.id === gravity,
    );
    expect(archived?.isActive).toBe(false);
  });

  it('вернуть вариант из архива — PATCH isActive: true', async () => {
    const gravity = await optionId(listId, 'gravity');

    const restored = await call(
      'patch',
      `/api/gear/admin/types/${typeId}/attributes/${listId}/options/${gravity}`,
      adminToken,
      { isActive: true },
    ).expect(200);

    expect(restored.body.isActive).toBe(true);

    const publicOptions = (await publicAttribute('connection')).options;
    expect(publicOptions.map((option) => option.code)).toContain('gravity');
  });

  it('последний вариант списка убрать нельзя — 409', async () => {
    const active = (await adminAttribute(listId)).options.filter(
      (option) => option.isActive,
    );

    // Оставляем один вариант: «последний» — это состояние, а не свойство.
    for (const option of active.slice(1)) {
      await call(
        'delete',
        `/api/gear/admin/types/${typeId}/attributes/${listId}/options/${option.id}`,
        adminToken,
      ).expect(204);
    }

    const last = active[0];
    if (!last) throw new Error('У списка не осталось активных вариантов');

    await call(
      'delete',
      `/api/gear/admin/types/${typeId}/attributes/${listId}/options/${last.id}`,
      adminToken,
    ).expect(409);

    // Через PATCH тот же запрет: isActive: false — это и есть архив.
    await call(
      'patch',
      `/api/gear/admin/types/${typeId}/attributes/${listId}/options/${last.id}`,
      adminToken,
      { isActive: false },
    ).expect(409);
  });

  it('у списка со своим значением последний вариант убрать можно — 204', async () => {
    const created = await call(
      'post',
      `/api/gear/admin/types/${typeId}/attributes/${fuelId}/options`,
      adminToken,
      { code: 'gasoline', name: 'бензин' },
    ).expect(201);

    await call(
      'delete',
      `/api/gear/admin/types/${typeId}/attributes/${fuelId}/options/${created.body.id}`,
      adminToken,
    ).expect(204);

    const options = (await adminAttribute(fuelId)).options;
    expect(options.every((option) => !option.isActive)).toBe(true);
  });

  it('варианты в PATCH характеристики — 400: у них отдельные ручки', async () => {
    await call(
      'patch',
      `/api/gear/admin/types/${typeId}/attributes/${listId}`,
      adminToken,
      { options: [] },
    ).expect(400);
  });

  // ─────────────────────── вложенность и 404 ───────────────────────

  it('чужой тип, характеристика или вариант — 404', async () => {
    const otherType = await call(
      'post',
      '/api/gear/admin/types',
      adminToken,
      { code: code('axe'), name: 'Топор' },
    ).expect(201);

    const thread = await optionId(listId, 'thread');

    // Вариант существует, но не у этого типа.
    await call(
      'patch',
      `/api/gear/admin/types/${otherType.body.id}/attributes/${listId}/options/${thread}`,
      adminToken,
      { name: 'чужой' },
    ).expect(404);

    // Характеристика существует, но не у этого типа.
    await call(
      'post',
      `/api/gear/admin/types/${otherType.body.id}/attributes/${listId}/options`,
      adminToken,
      { code: 'alien', name: 'чужой' },
    ).expect(404);

    // Варианта нет.
    await call(
      'patch',
      `/api/gear/admin/types/${typeId}/attributes/${listId}/options/999999`,
      adminToken,
      { name: 'нет такого' },
    ).expect(404);
  });

  // ─────────────────── форма публичного ответа ───────────────────

  it('у числа и строки options пустой, а у списка только активные варианты', async () => {
    const type = await publicType();

    for (const attribute of type.attributes) {
      expect(Array.isArray(attribute.options)).toBe(true);
    }

    const mass = type.attributes.find((row) => row.code === 'mass');
    expect(mass?.options).toEqual([]);

    const connection = type.attributes.find(
      (row) => row.code === 'connection',
    );
    expect(connection?.options.map((option) => option.code)).toEqual([
      'thread',
    ]);
  });
});
