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
 * «Питание» похода (e2e): едоки, рецепты, мясной флаг, ручные строки.
 *
 * Проверяем то, ради чего раскладка существует:
 * - **рецепт считается на едоков**, мясное — без вегетарианцев;
 * - **ручная строка абсолютная** и складывается с рецептом в одну строку;
 * - **отдельное питание** выключает человека из едоков;
 * - **права**: читает состав, правит завхоз или организатор, чужие блюда
 *   не ставятся, посторонний не видит раскладку, у мечты её нет.
 *
 * Свой поход, продукты и блюда тест заводит сам и убирает за собой:
 * справочник продуктов общесистемный, зависеть от залитого сида нельзя.
 */
describe('Питание похода (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  let organizerId: string;
  let organizerToken: string;
  let memberId: string;
  let memberToken: string;
  let strangerId: string;
  let strangerToken: string;

  let objectId: string;
  let gramId: number;
  let canId: number;

  let tripId: string;
  let ideaTripId: string;

  let organizerDishId: string;
  let memberDishId: string;

  let lastCode: string | null = null;

  const objectName = `e2e-питание-${Date.now()}`;
  const gramName = `e2e-крупа-${Date.now()}`;
  const canName = `e2e-тушёнка-${Date.now()}`;
  const organizerDishTitle = `e2e-каша-${Date.now()}`;
  const memberDishTitle = `e2e-салат-${Date.now()}`;

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

  const tripProductIds = new Map<string, number>();

  /** Id продукта похода по имени: план ссылается на свои продукты. */
  async function tripProductId(name: string): Promise<number> {
    const cached = tripProductIds.get(name);
    if (cached !== undefined) return cached;

    const plan = await readPlan(organizerToken);
    const meals = plan.meals as Array<{
      products: Array<{ productId: number; name: string }>;
    }>;

    for (const meal of meals) {
      const product = meal.products.find((row) => row.name === name);
      if (product) {
        tripProductIds.set(name, product.productId);
        return product.productId;
      }
    }

    throw new Error(`Продукта «${name}» нет в плане похода`);
  }

  /** Ручная строка по названию: продукт похода заводится или копируется сам. */
  function addLine(day: number, kind: string, name: string, amount: number) {
    return call(
      'post',
      `/api/trips/${tripId}/meals/${day}/${kind}/lines`,
      organizerToken,
    ).send({ name, amount });
  }

  function call(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    token: string,
  ) {
    return request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${token}`);
  }

  async function readPlan(token: string): Promise<Record<string, unknown>> {
    const response = await call('get', `/api/trips/${tripId}/meal-plan`, token).expect(200);

    return response.body as Record<string, unknown>;
  }

  async function readChecks(token: string): Promise<
    Array<{
      productId: number;
      name: string;
      needAmount: number;
      isBought: boolean;
      isHome: boolean;
      boughtAmount: number | null;
      boughtByName: string | null;
      isOrphaned: boolean;
    }>
  > {
    const response = await call('get', `/api/trips/${tripId}/meal-checks`, token).expect(200);

    return response.body.checks as never;
  }

  function productOf(
    plan: Record<string, unknown>,
    name: string,
  ): { amount: number; recipeAmount: number; manualAmount: number; isMeat: boolean } {
    const meals = plan.meals as Array<{
      products: Array<{
        name: string;
        amount: number;
        recipeAmount: number;
        manualAmount: number;
        isMeat: boolean;
      }>;
    }>;

    const rows = meals
      .flatMap((meal) => meal.products)
      .filter((product) => product.name === name);

    if (rows.length === 0) throw new Error(`В раскладке нет продукта ${name}`);

    // Строка раскладки — на приём; для итогов по походу суммируем приёмы.
    return {
      amount: rows.reduce((sum, row) => sum + row.amount, 0),
      recipeAmount: rows.reduce((sum, row) => sum + row.recipeAmount, 0),
      manualAmount: rows.reduce((sum, row) => sum + row.manualAmount, 0),
      isMeat: rows.some((row) => row.isMeat),
    };
  }

  function packagesOf(
    plan: Record<string, unknown>,
  ): Array<{
    id: string;
    name: string;
    kind: string;
    mealId: string | null;
    weightActualGrams: number | null;
    weightActualStale: boolean;
    items: unknown[];
  }> {
    return (plan.packages ?? []) as never;
  }

  function mealProduct(
    plan: Record<string, unknown>,
    dayIndex: number,
    kind: string,
    name: string,
  ): {
    amount: number;
    allocations: Array<{ packageId: string; amount: number; isElastic: boolean }>;
  } {
    const meals = plan.meals as Array<{
      dayIndex: number;
      kind: string;
      products: Array<{
        name: string;
        amount: number;
        allocations: Array<{
          packageId: string;
          amount: number;
          isElastic: boolean;
        }>;
      }>;
    }>;

    const meal = meals.find((row) => row.dayIndex === dayIndex && row.kind === kind);
    const product = meal?.products.find((row) => row.name === name);

    if (!product) {
      throw new Error(`В приёме ${dayIndex}/${kind} нет продукта ${name}`);
    }

    return product;
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

    const stamp = Date.now();
    const organizer = await login(`meals-plan-${stamp}@example.com`);
    organizerToken = organizer.token;
    organizerId = organizer.id;

    const member = await login(`meals-plan-member-${stamp}@example.com`);
    memberToken = member.token;
    memberId = member.id;

    const stranger = await login(`meals-plan-stranger-${stamp}@example.com`);
    strangerToken = stranger.token;
    strangerId = stranger.id;

    // Женщина-вегетарианец: мясное на неё не считается.
    await dataSource.query(
      `UPDATE users SET gender = 'f', is_vegetarian = true WHERE id = $1`,
      [memberId],
    );

    objectId = (
      await dataSource.query(
        `INSERT INTO objects (name, type) VALUES ($1, 'вершина') RETURNING id`,
        [objectName],
      )
    )[0].id;

    gramId = (
      await dataSource.query(
        `INSERT INTO products (name, unit, weight_per_unit_grams)
         VALUES ($1, 'g', 1) RETURNING id`,
        [gramName],
      )
    )[0].id;

    canId = (
      await dataSource.query(
        `INSERT INTO products (name, unit, weight_per_unit_grams)
         VALUES ($1, 'can', 340) RETURNING id`,
        [canName],
      )
    )[0].id;

    const trip = await call('post', '/api/trips', organizerToken)
      .send({
        goalObjectId: Number(objectId),
        status: 'decided',
        startsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
        endsAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      })
      .expect(201);
    tripId = trip.body.id as string;

    await call('post', `/api/trips/${tripId}/requests`, organizerToken)
      .send({ direction: 'invite', userId: memberId })
      .expect(201);

    await call(
      'post',
      `/api/trips/${tripId}/requests/${memberId}/accept`,
      memberToken,
    )
      .send({ status: 'going' })
      .expect(200);

    const organizerDish = await call('post', '/api/dishes', organizerToken)
      .send({ title: organizerDishTitle })
      .expect(201);
    organizerDishId = organizerDish.body.id as string;

    await call(
      'post',
      `/api/dishes/${organizerDishId}/ingredients`,
      organizerToken,
    )
      .send({ productId: gramId, amount: 80 })
      .expect(201);

    await call(
      'post',
      `/api/dishes/${organizerDishId}/ingredients`,
      organizerToken,
    )
      .send({ productId: canId, amount: 100, isMeat: true })
      .expect(201);

    const memberDish = await call('post', '/api/dishes', memberToken)
      .send({ title: memberDishTitle })
      .expect(201);
    memberDishId = memberDish.body.id as string;

    await call(
      'post',
      `/api/dishes/${memberDishId}/ingredients`,
      memberToken,
    )
      .send({ productId: gramId, amount: 50 })
      .expect(201);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query('DELETE FROM trips WHERE id = ANY($1::bigint[])', [
        [tripId, ideaTripId].filter(Boolean),
      ]);
      await dataSource.query(
        'DELETE FROM dishes WHERE owner_user_id = ANY($1::uuid[])',
        [[organizerId, memberId]],
      );
      await dataSource.query('DELETE FROM products WHERE id = ANY($1::int[])', [
        [gramId, canId],
      ]);
      await dataSource.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        [organizerId, memberId, strangerId],
      ]);
      await dataSource.query('DELETE FROM objects WHERE id = $1', [objectId]);
    }
    await app?.close();
  });

  it('читает едоков: пол, вегетарианцы, дни похода', async () => {
    const plan = await readPlan(organizerToken);

    expect(plan.dayCount).toBe(5);
    expect(plan.eaters).toMatchObject({
      total: 2,
      men: 1,
      women: 1,
      vegetarians: 1,
    });
    expect((plan.eaters as { people: unknown[] }).people).toHaveLength(2);
  });

  it('рецепт считается на едоков, мясное — без вегетарианцев', async () => {
    const added = await call(
      'post',
      `/api/trips/${tripId}/meals/1/breakfast/dishes`,
      organizerToken,
    )
      .send({ dishId: organizerDishId })
      .expect(201);

    const plan = added.body as Record<string, unknown>;

    // Крупа — на двоих: 80 × 2 = 160. Тушёнка — на одного: 100 × (2−1) = 100.
    expect(productOf(plan, gramName)).toMatchObject({
      recipeAmount: 160,
      amount: 160,
      isMeat: false,
    });
    expect(productOf(plan, canName)).toMatchObject({
      recipeAmount: 100,
      amount: 100,
      isMeat: true,
    });
  });

  it('ручная строка абсолютная и складывается с рецептом', async () => {
    const response = await addLine(1, 'breakfast', gramName, 200).expect(200);

    const plan = response.body as Record<string, unknown>;

    expect(productOf(plan, gramName)).toMatchObject({
      recipeAmount: 160,
      manualAmount: 200,
      amount: 360,
    });
  });

  it('свой продукт заводится в походе и в справочник не попадает', async () => {
    const name = `Трава-${Date.now()}`;

    const response = await addLine(1, 'breakfast', name, 40).expect(200);
    const products = productOf(response.body as Record<string, unknown>, name);
    const createdId = await tripProductId(name);

    expect(products).toMatchObject({ amount: 40, manualAmount: 40 });

    // Продукт похода: справочник о нём не знает.
    const catalog = await call(
      'get',
      `/api/products?search=${encodeURIComponent(name)}`,
      organizerToken,
    ).expect(200);
    expect(catalog.body.products).toEqual([]);

    // Убираем за собой: дальше тест про пустой приём, лишняя строка мешает.
    await call(
      'delete',
      `/api/trips/${tripId}/meals/1/breakfast/lines/${createdId}`,
      organizerToken,
    ).expect(200);
  });

  it('форма приёма: перекус вместо готовки', async () => {
    const response = await call(
      'put',
      `/api/trips/${tripId}/meals/1/breakfast/form`,
      organizerToken,
    )
      .send({ form: 'snack' })
      .expect(200);

    const meals = (response.body as { meals: Array<{ form: string }> }).meals;
    expect(meals[0].form).toBe('snack');
  });

  it('посторонний не видит раскладку', async () => {
    await call('get', `/api/trips/${tripId}/meal-plan`, strangerToken).expect(403);
  });

  it('участник без роли «Питание» читает, но не правит', async () => {
    await readPlan(memberToken);

    await call(
      'post',
      `/api/trips/${tripId}/meals/1/lunch/dishes`,
      memberToken,
    )
      .send({ dishId: memberDishId })
      .expect(403);
  });

  it('завхоз правит, но чужие блюда не ставит', async () => {
    await call(
      'put',
      `/api/trips/${tripId}/participants/${memberId}/roles`,
      organizerToken,
    )
      .send({ roleCodes: ['quartermaster'] })
      .expect(200);

    await call(
      'post',
      `/api/trips/${tripId}/meals/1/lunch/dishes`,
      memberToken,
    )
      .send({ dishId: memberDishId })
      .expect(201);

    // Блюдо участника — его собственное: организатор в раскладку его не ставит.
    await call(
      'post',
      `/api/trips/${tripId}/meals/1/dinner/dishes`,
      organizerToken,
    )
      .send({ dishId: memberDishId })
      .expect(403);
  });

  it('отдельное питание выключает человека из едоков', async () => {
    await call(
      'patch',
      `/api/trips/${tripId}/participants/me`,
      memberToken,
    )
      .send({ status: 'going', eatsSeparately: true })
      .expect(200);

    const plan = await readPlan(organizerToken);

    expect(plan.eaters).toMatchObject({
      total: 1,
      men: 1,
      women: 0,
      vegetarians: 0,
    });

    const people = (plan.eaters as {
      people: Array<{ userId: string; eatsSeparately: boolean }>;
    }).people;
    expect(
      people.find((person) => person.userId === memberId)?.eatsSeparately,
    ).toBe(true);

    // Крупа: 80 (каша) + 50 (салат) на одного = 130 рецептовых
    // и 200 ручных (строка абсолютная) = 330. Тушёнка: 100 × 1 = 100.
    expect(productOf(plan, gramName)).toMatchObject({
      recipeAmount: 130,
      manualAmount: 200,
      amount: 330,
    });
    expect(productOf(plan, canName)).toMatchObject({ amount: 100 });
  });

  it('приём без данных исчезает: убрали блюда и строку', async () => {
    for (const day of [1]) {
      await call(
        'delete',
        `/api/trips/${tripId}/meals/${day}/breakfast/dishes/${organizerDishId}`,
        organizerToken,
      ).expect(200);
    }

    await call(
      'delete',
      `/api/trips/${tripId}/meals/1/breakfast/lines/${await tripProductId(gramName)}`,
      organizerToken,
    ).expect(200);

    const plan = await readPlan(organizerToken);
    const meals = plan.meals as Array<{ dayIndex: number; kind: string }>;

    expect(
      meals.some((meal) => meal.dayIndex === 1 && meal.kind === 'breakfast'),
    ).toBe(false);
  });

  it('пакет создаётся с именем «Пакет N»', async () => {
    const response = await call(
      'post',
      `/api/trips/${tripId}/meal-packages`,
      organizerToken,
    ).expect(201);

    expect(packagesOf(response.body as Record<string, unknown>).map((row) => row.name)).toContain(
      'Пакет 1',
    );
  });

  it('доли строки: фиксированная часть и эластичное «всё»', async () => {
    await call(
      'post',
      `/api/trips/${tripId}/meals/2/breakfast/dishes`,
      organizerToken,
    )
      .send({ dishId: organizerDishId })
      .expect(201);

    const created = await call(
      'post',
      `/api/trips/${tripId}/meal-packages`,
      organizerToken,
    ).expect(201);
    const packages = packagesOf(created.body as Record<string, unknown>);
    const first = packages.find((row) => row.name === 'Пакет 1')!;
    const second = packages.find((row) => row.name === 'Пакет 2')!;

    const response = await call(
      'put',
      `/api/trips/${tripId}/meals/2/breakfast/allocations/${await tripProductId(gramName)}`,
      organizerToken,
    )
      .send({
        allocations: [
          { packageId: first.id, amount: 50 },
          { packageId: second.id, amount: 0, isElastic: true },
        ],
      })
      .expect(200);

    const gram = mealProduct(response.body as Record<string, unknown>, 2, 'breakfast', gramName);

    // Крупа на второго завтрака: 80 г (организатор ест один, участница — отдельно).
    expect(gram.amount).toBe(80);
    expect(gram.allocations.find((row) => row.packageId === first.id)).toMatchObject({
      amount: 50,
      isElastic: false,
    });
    expect(gram.allocations.find((row) => row.packageId === second.id)).toMatchObject({
      amount: 30,
      isElastic: true,
    });
  });

  it('фактический вес и метка «перевесить»', async () => {
    const plan = await readPlan(organizerToken);
    const first = packagesOf(plan).find((row) => row.name === 'Пакет 1')!;
    const second = packagesOf(plan).find((row) => row.name === 'Пакет 2')!;

    const weighted = await call(
      'patch',
      `/api/trips/${tripId}/meal-packages/${first.id}`,
      organizerToken,
    )
      .send({ weightActualGrams: 500 })
      .expect(200);

    const afterWeight = packagesOf(weighted.body as Record<string, unknown>).find(
      (row) => row.id === first.id,
    )!;
    expect(afterWeight.weightActualGrams).toBe(500);
    expect(afterWeight.weightActualStale).toBe(false);

    // Содержимое поменяли — пакет просит перевесить.
    await call(
      'put',
      `/api/trips/${tripId}/meals/2/breakfast/allocations/${await tripProductId(gramName)}`,
      organizerToken,
    )
      .send({
        allocations: [
          { packageId: first.id, amount: 60 },
          { packageId: second.id, amount: 0, isElastic: true },
        ],
      })
      .expect(200);

    const changed = packagesOf(await readPlan(organizerToken)).find(
      (row) => row.id === first.id,
    )!;
    expect(changed.weightActualStale).toBe(true);

    const reweighed = await call(
      'patch',
      `/api/trips/${tripId}/meal-packages/${first.id}`,
      organizerToken,
    )
      .send({ weightActualGrams: 600 })
      .expect(200);

    expect(
      packagesOf(reweighed.body as Record<string, unknown>).find(
        (row) => row.id === first.id,
      )!.weightActualStale,
    ).toBe(false);
  });

  it('«всё» снимает остальные доли строки', async () => {
    const plan = await readPlan(organizerToken);
    const second = packagesOf(plan).find((row) => row.name === 'Пакет 2')!;

    // Так это делает интерфейс: выбрав «всё», остальные доли снимаются.
    const response = await call(
      'put',
      `/api/trips/${tripId}/meals/2/breakfast/allocations/${await tripProductId(gramName)}`,
      organizerToken,
    )
      .send({
        allocations: [{ packageId: second.id, amount: 0, isElastic: true }],
      })
      .expect(200);

    const gram = mealProduct(response.body as Record<string, unknown>, 2, 'breakfast', gramName);

    expect(gram.allocations).toHaveLength(1);
    expect(gram.allocations[0]).toMatchObject({
      packageId: second.id,
      amount: 80,
      isElastic: true,
    });
  });

  it('ингредиент рецепта убирается в приёме и возвращается', async () => {
    const excluded = await call(
      'put',
      `/api/trips/${tripId}/meals/2/breakfast/dishes/${organizerDishId}/exclusions`,
      organizerToken,
    )
      .send({ productIds: [await tripProductId(canName)] })
      .expect(200);

    const plan = excluded.body as {
      meals: Array<{
        dayIndex: number;
        kind: string;
        dishes: Array<{ dishId: string; excludedProductIds: number[] }>;
        products: Array<{ name: string }>;
      }>;
    };
    const meal = plan.meals.find(
      (row) => row.dayIndex === 2 && row.kind === 'breakfast',
    )!;

    expect(meal.dishes[0].excludedProductIds).toEqual([await tripProductId(canName)]);
    // Убранный ингредиент исчез из строк приёма.
    expect(meal.products.some((row) => row.name === canName)).toBe(false);

    const restored = await call(
      'put',
      `/api/trips/${tripId}/meals/2/breakfast/dishes/${organizerDishId}/exclusions`,
      organizerToken,
    )
      .send({ productIds: [] })
      .expect(200);

    const restoredPlan = restored.body as typeof plan;
    const restoredMeal = restoredPlan.meals.find(
      (row) => row.dayIndex === 2 && row.kind === 'breakfast',
    )!;

    expect(restoredMeal.dishes[0].excludedProductIds).toEqual([]);
    expect(restoredMeal.products.some((row) => row.name === canName)).toBe(true);
  });

  it('удаление пакета обнуляет его доли', async () => {
    const plan = await readPlan(organizerToken);
    const second = packagesOf(plan).find((row) => row.name === 'Пакет 2')!;

    const response = await call(
      'delete',
      `/api/trips/${tripId}/meal-packages/${second.id}`,
      organizerToken,
    ).expect(200);

    const gram = mealProduct(response.body as Record<string, unknown>, 2, 'breakfast', gramName);
    expect(gram.allocations).toHaveLength(0);
  });

  it('кулёк приёма: все продукты в пакет с кодом', async () => {
    await call(
      'post',
      `/api/trips/${tripId}/meals/3/breakfast/dishes`,
      organizerToken,
    )
      .send({ dishId: organizerDishId })
      .expect(201);

    const response = await call(
      'put',
      `/api/trips/${tripId}/meals/3/breakfast/kulek`,
      organizerToken,
    )
      .send({ enabled: true })
      .expect(200);

    const kulek = packagesOf(response.body as Record<string, unknown>).find(
      (row) => row.kind === 'kulek',
    )!;
    expect(kulek.name).toBe('3з');
    expect(kulek.mealId).toBeTruthy();
    // Крупа и тушёнка — оба продукта приёма в кульке.
    expect(kulek.items).toHaveLength(2);

    const off = await call(
      'put',
      `/api/trips/${tripId}/meals/3/breakfast/kulek`,
      organizerToken,
    )
      .send({ enabled: false })
      .expect(200);

    expect(
      packagesOf(off.body as Record<string, unknown>).some((row) => row.kind === 'kulek'),
    ).toBe(false);
  });

  it('посторонний не создаёт пакеты', async () => {
    await call('post', `/api/trips/${tripId}/meal-packages`, strangerToken).expect(403);
  });

  it('чек-лист — проекция раскладки: продукт и «надо»', async () => {
    const checks = await readChecks(organizerToken);
    const gramTripId = await tripProductId(gramName);
    const gram = checks.find((row) => row.productId === gramTripId)!;

    expect(gram.name).toBe(gramName);
    expect(gram.needAmount).toBeGreaterThan(0);
    expect(gram.isBought).toBe(false);
    expect(gram.isOrphaned).toBe(false);
  });

  it('отметку ставит любой участник, без роли «Питание»', async () => {
    // Снимаем роль завхоза: остаётся просто участник.
    await call(
      'put',
      `/api/trips/${tripId}/participants/${memberId}/roles`,
      organizerToken,
    )
      .send({ roleCodes: [] })
      .expect(200);

    const gramTripId = await tripProductId(gramName);
    const response = await call(
      'put',
      `/api/trips/${tripId}/meal-checks/${gramTripId}`,
      memberToken,
    )
      .send({ isBought: true, boughtAmount: 600 })
      .expect(200);

    const gram = (response.body.checks as Array<Record<string, unknown>>).find(
      (row) => row.productId === gramTripId,
    )!;
    expect(gram).toMatchObject({ isBought: true, boughtAmount: 600 });
    expect(gram.boughtByName).toBeTruthy();
  });

  it('«домашнее» — отдельная отметка, строка остаётся', async () => {
    const response = await call(
      'put',
      `/api/trips/${tripId}/meal-checks/${await tripProductId(canName)}`,
      organizerToken,
    )
      .send({ isHome: true })
      .expect(200);

    const canTripId = await tripProductId(canName);
    const can = (response.body.checks as Array<Record<string, unknown>>).find(
      (row) => row.productId === canTripId,
    )!;
    expect(can).toMatchObject({ isHome: true, isOrphaned: false });
    expect(can.needAmount).toBeGreaterThan(0);
  });

  it('продукт ушёл из плана, но куплен — строка остаётся', async () => {
    await call(
      'put',
      `/api/trips/${tripId}/meal-checks/${await tripProductId(canName)}`,
      organizerToken,
    )
      .send({ isBought: true, boughtAmount: 2 })
      .expect(200);

    // Убираем тушёнку из раскладки: блюда дня 2 и дня 3.
    await call(
      'delete',
      `/api/trips/${tripId}/meals/2/breakfast/dishes/${organizerDishId}`,
      organizerToken,
    ).expect(200);
    await call(
      'delete',
      `/api/trips/${tripId}/meals/3/breakfast/dishes/${organizerDishId}`,
      organizerToken,
    ).expect(200);

    const checks = await readChecks(organizerToken);
    const canTripId = await tripProductId(canName);
    const can = checks.find((row) => row.productId === canTripId)!;

    expect(can).toMatchObject({
      isBought: true,
      needAmount: 0,
      isOrphaned: true,
    });
  });

  it('посторонний не видит чек-лист', async () => {
    await call('get', `/api/trips/${tripId}/meal-checks`, strangerToken).expect(403);
  });

  it('у мечты раскладки нет', async () => {
    const idea = await call('post', '/api/trips', organizerToken)
      .send({ goalObjectId: Number(objectId), status: 'idea' })
      .expect(201);
    ideaTripId = idea.body.id as string;

    await call('get', `/api/trips/${ideaTripId}/meal-plan`, organizerToken).expect(400);
    await call('get', `/api/trips/${ideaTripId}/meal-checks`, organizerToken).expect(400);
  });

  it('продукт похода живёт только в своём походе', async () => {
    const created = await call('post', `/api/products?tripId=${tripId}`, organizerToken)
      .send({ name: 'Экзотика', unit: 'piece', weightPerUnitGrams: 0 })
      .expect(201);
    const productId = created.body.id as number;

    const mine = await call(
      'get',
      `/api/products?search=${encodeURIComponent('Экзотика')}&tripId=${tripId}`,
      organizerToken,
    ).expect(200);
    expect((mine.body.products as Array<{ id: number }>).map((p) => p.id)).toContain(productId);

    // Без tripId — только справочник: продукт похода туда не попадает.
    const global = await call(
      'get',
      `/api/products?search=${encodeURIComponent('Экзотика')}`,
      organizerToken,
    ).expect(200);
    expect((global.body.products as Array<{ id: number }>).map((p) => p.id)).not.toContain(
      productId,
    );

    // Чужой поход продукт не видит.
    const other = await call(
      'get',
      `/api/products?search=${encodeURIComponent('Экзотика')}&tripId=0`,
      organizerToken,
    ).expect(200);
    expect((other.body.products as Array<{ id: number }>).map((p) => p.id)).not.toContain(
      productId,
    );
  });
});
