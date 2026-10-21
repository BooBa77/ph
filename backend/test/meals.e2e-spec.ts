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
 * Питание (e2e): справочник продуктов и кулинарная книга.
 *
 * Проверяем то, что даёт вес: **состав блюда считается в граммах**
 * (количество × вес единицы), продукт в блюде один раз (409, а не две
 * строки с одним и тем же), чужое блюдо не существует (404) и справочник
 * отдаётся только чтением — без строки поиска пустой список, `%`
 * экранируется.
 *
 * Свои продукты тест заводит прямо в базе: справочник общесистемный,
 * и зависеть от залитого сида он не должен. Убирает за собой тоже сам.
 */
describe('Питание (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  let ownerId: string;
  let ownerToken: string;
  let strangerId: string;
  let strangerToken: string;

  /** Продукты теста: граммы (вес единицы 1) и банка (340 г). */
  let gramProductId: number;
  let canProductId: number;

  let lastCode: string | null = null;

  const ownerEmail = `meals-e2e-${Date.now()}@example.com`;
  const strangerEmail = `meals-e2e-stranger-${Date.now()}@example.com`;
  const gramName = `e2e-крупа-${Date.now()}`;
  const canName = `e2e-тушёнка-${Date.now()}`;

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

    const owner = await login(ownerEmail);
    ownerToken = owner.token;
    ownerId = owner.id;

    const stranger = await login(strangerEmail);
    strangerToken = stranger.token;
    strangerId = stranger.id;

    gramProductId = (
      await dataSource.query(
        `INSERT INTO products (name, unit, weight_per_unit_grams) VALUES ($1, 'g', 1) RETURNING id`,
        [gramName],
      )
    )[0].id;
    canProductId = (
      await dataSource.query(
        `INSERT INTO products (name, unit, weight_per_unit_grams) VALUES ($1, 'can', 340) RETURNING id`,
        [canName],
      )
    )[0].id;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // Блюда уносит каскад, но их владелец — пользователь, а на него
      // RESTRICT; поэтому сначала блюда, потом продукты, потом людей.
      await dataSource.query('DELETE FROM dishes WHERE owner_user_id = ANY($1::uuid[])', [
        [ownerId, strangerId],
      ]);
      await dataSource.query('DELETE FROM products WHERE id = ANY($1::int[])', [
        [gramProductId, canProductId],
      ]);
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

  /** Создать блюдо и вернуть его тело. */
  async function createDish(title = 'Каша с тушёнкой'): Promise<Record<string, unknown>> {
    const response = await call('post', '/api/dishes', ownerToken, { title });
    expect(response.status).toBe(201);

    return response.body as Record<string, unknown>;
  }

  describe('справочник продуктов', () => {
    it('находит продукт по подстроке названия', async () => {
      const response = await call(
        'get',
        `/api/products?search=${encodeURIComponent('тушёнка')}`,
        ownerToken,
      ).expect(200);

      const products = response.body.products as Array<{ id: number; name: string }>;
      expect(products.map((product) => product.id)).toContain(canProductId);
    });

    it('без строки поиска отдаёт пустой список, а не весь справочник', async () => {
      const response = await call('get', '/api/products', ownerToken).expect(200);

      expect(response.body.products).toEqual([]);
    });

    it('«%» не превращается в «найди всё»', async () => {
      const response = await call(
        'get',
        `/api/products?search=${encodeURIComponent('%')}`,
        ownerToken,
      ).expect(200);

      expect(response.body.products).toEqual([]);
    });

    it('без токена справочник закрыт', async () => {
      await request(app.getHttpServer()).get('/api/products?search=гречка').expect(401);
    });
  });

  describe('блюда', () => {
    it('по умолчанию блюд нет', async () => {
      const response = await call('get', '/api/dishes', ownerToken).expect(200);

      expect(response.body.dishes).toEqual([]);
    });

    it('блюдо создаётся с названием и пустым составом', async () => {
      const dish = await createDish('Каша с тушёнкой');

      expect(dish.title).toBe('Каша с тушёнкой');
      expect(dish.ingredients).toEqual([]);
      expect(dish.totalGrams).toBe(0);
    });

    it('пустое название — 400', async () => {
      await call('post', '/api/dishes', ownerToken, { title: '   ' }).expect(400);
    });

    it('состав считается в граммах: количество × вес единицы', async () => {
      const dish = await createDish('Каша');
      const dishId = dish.id as string;

      const krupa = await call('post', `/api/dishes/${dishId}/ingredients`, ownerToken, {
        productId: gramProductId,
        amount: 200,
      });
      expect(krupa.status).toBe(201);
      expect(krupa.body.grams).toBe(200);

      const tushonka = await call('post', `/api/dishes/${dishId}/ingredients`, ownerToken, {
        productId: canProductId,
        amount: 2,
      });
      expect(tushonka.status).toBe(201);
      expect(tushonka.body.grams).toBe(680);

      const list = await call('get', '/api/dishes', ownerToken).expect(200);
      const found = (
        list.body.dishes as Array<{ id: string; totalGrams: number; ingredients: unknown[] }>
      ).find((row) => row.id === dishId);
      expect(found?.totalGrams).toBe(880);
      expect(found?.ingredients).toHaveLength(2);
    });

    it('несуществующий продукт — 400, повторный — 409', async () => {
      const dish = await createDish('Проверка состава');
      const dishId = dish.id as string;

      await call('post', `/api/dishes/${dishId}/ingredients`, ownerToken, {
        productId: 999999,
        amount: 1,
      }).expect(400);

      await call('post', `/api/dishes/${dishId}/ingredients`, ownerToken, {
        productId: gramProductId,
        amount: 100,
      }).expect(201);

      await call('post', `/api/dishes/${dishId}/ingredients`, ownerToken, {
        productId: gramProductId,
        amount: 200,
      }).expect(409);
    });

    it('количество меняется и убирается', async () => {
      const dish = await createDish('С уточнением');
      const dishId = dish.id as string;

      const added = await call(
        'post',
        `/api/dishes/${dishId}/ingredients`,
        ownerToken,
        { productId: canProductId, amount: 1 },
      );
      const ingredientId = added.body.id as string;

      const updated = await call(
        'patch',
        `/api/dishes/ingredients/${ingredientId}`,
        ownerToken,
        { amount: 3 },
      );
      expect(updated.status).toBe(200);
      expect(updated.body.amount).toBe(3);
      expect(updated.body.grams).toBe(1020);

      await call('delete', `/api/dishes/ingredients/${ingredientId}`, ownerToken).expect(204);

      const list = await call('get', '/api/dishes', ownerToken).expect(200);
      const found = (list.body.dishes as Array<{ id: string; totalGrams: number }>).find(
        (row) => row.id === dishId,
      );
      expect(found?.totalGrams).toBe(0);
    });

    it('блюдо переименовывается, заметка пишется и стирается', async () => {
      const dish = await createDish('Старое имя');
      const dishId = dish.id as string;

      const renamed = await call('patch', `/api/dishes/${dishId}`, ownerToken, {
        title: 'Новое имя',
        note: 'варить 15 минут',
      });
      expect(renamed.status).toBe(200);
      expect(renamed.body.title).toBe('Новое имя');
      expect(renamed.body.note).toBe('варить 15 минут');

      const cleared = await call('patch', `/api/dishes/${dishId}`, ownerToken, {
        note: null,
      });
      expect(cleared.body.note).toBeNull();
    });

    it('чужое блюдо не существует: 404 на правку, состав и удаление', async () => {
      const dish = await createDish('Моё блюдо');
      const dishId = dish.id as string;

      const added = await call(
        'post',
        `/api/dishes/${dishId}/ingredients`,
        ownerToken,
        { productId: gramProductId, amount: 50 },
      );
      const ingredientId = added.body.id as string;

      await call('patch', `/api/dishes/${dishId}`, strangerToken, {
        title: 'Чужое',
      }).expect(404);
      await call('delete', `/api/dishes/${dishId}`, strangerToken).expect(404);
      await call('post', `/api/dishes/${dishId}/ingredients`, strangerToken, {
        productId: gramProductId,
        amount: 10,
      }).expect(404);
      await call(
        'patch',
        `/api/dishes/ingredients/${ingredientId}`,
        strangerToken,
        { amount: 10 },
      ).expect(404);
    });

    it('удаление блюда уносит состав', async () => {
      const dish = await createDish('Удаляемое блюдо');
      const dishId = dish.id as string;

      await call('post', `/api/dishes/${dishId}/ingredients`, ownerToken, {
        productId: gramProductId,
        amount: 100,
      }).expect(201);

      await call('delete', `/api/dishes/${dishId}`, ownerToken).expect(204);

      const left = await dataSource.query(
        'SELECT count(*)::int AS count FROM dish_ingredients WHERE dish_id = $1',
        [dishId],
      );
      expect(left[0].count).toBe(0);
    });

    it('лишнее поле в теле — 400', async () => {
      await call('post', '/api/dishes', ownerToken, {
        title: 'Блюдо',
        ownerUserId: strangerId,
      }).expect(400);
    });

    it('нечисловой id — 400, без токена — 401', async () => {
      await call('patch', '/api/dishes/abc', ownerToken, { title: 'Имя' }).expect(400);
      await request(app.getHttpServer()).get('/api/dishes').expect(401);
    });
  });
});
