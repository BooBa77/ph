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
 * Раскладка груза по рюкзакам (e2e) — 06.11.2026.
 *
 * Заказчик: «Пакеты с едой переносятся в рюкзаки… автоматическое
 * распределение между рюкзаками, учитывая владельцев вещей и пол
 * участников». Правила закрыты 21.10.2026 (`docs/ph/gear-distribution.md`
 * §4–§5), здесь проверяем, что API их соблюдает:
 *
 * 1. **Раскладка = вещи похода + пакеты еды.** Пакет из «Питания» —
 *    такая же единица груза, как палатка, и попадает в общую сумму.
 * 2. **Рюкзаки — только «иду». ** «Пока не решил» груз не несёт,
 *    и назначить на него нельзя.
 * 3. **Автораспределение — полный сброс**: прежние ручные назначения
 *    не переживают кнопку, иначе алгоритм спорил бы с прошлым расчётом.
 * 4. **Своё — владельцу, тяжёлое вперёд, остаток — самому свободному**,
 *    доля с поправкой на пол.
 * 5. **Аптечка закреплена за медиком** — единственное исключение.
 * 6. **Снаряга «Ночёвок» ложится в свой раздел**: палатка — в «Табор»,
 *    а личные вещи живут в «Спальнике» и в «Берём» не попадают.
 *
 * Поход, раскладку и пакет тест заводит напрямую в базе: правила
 * «Питания» проверены в `trip-meals.e2e-spec.ts`, а здесь важно, как вес
 * пакета доезжает до рюкзака.
 */
describe('Раскладка груза по рюкзакам (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  let organizerId: string;
  let organizerToken: string;
  let memberId: string;
  let memberToken: string;
  let maybeId: string;
  let maybeToken: string;
  let strangerId: string;
  let strangerToken: string;

  let objectId: string;
  let tripId: string;

  /** Типы: палатка и спальник — настоящие коды (на них опирается раскладка). */
  let tentTypeId: number;
  let sleepingTypeId: number;
  let plainTypeId: number;
  let firstAidTypeId: number;

  let tentTripGearId: string;
  let tentSharedSectionId: string | null = null;
  let packageId: string;
  let personalPackageId: string;

  let gearRoleCode: string;
  let lastCode: string | null = null;

  const organizerEmail = `trip-load-e2e-org-${Date.now()}@example.com`;
  const memberEmail = `trip-load-e2e-member-${Date.now()}@example.com`;
  const maybeEmail = `trip-load-e2e-maybe-${Date.now()}@example.com`;
  const strangerEmail = `trip-load-e2e-stranger-${Date.now()}@example.com`;

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

  /** Тип по коду: заводим, если справочник свежий и кода ещё нет. */
  async function ensureType(code: string, name: string): Promise<number> {
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

  async function addGear(
    token: string,
    body: Record<string, unknown>,
  ): Promise<string> {
    const response = await call('post', '/api/gear', token, body).expect(201);

    return response.body.id as string;
  }

  /** Предложить вещь в поход. */
  function propose(token: string, gearItemId: string) {
    return call('post', `/api/trips/${tripId}/gear`, token, {
      gearItemId: Number(gearItemId),
    });
  }

  /** Утвердить вещь: в вес и в раскладку идут только «берём». */
  async function approve(token: string, tripGearId: string): Promise<void> {
    await call('patch', `/api/trips/${tripId}/gear/${tripGearId}`, token, {
      status: 'approved',
    }).expect(200);
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

    const organizer = await login(organizerEmail);
    organizerToken = organizer.token;
    organizerId = organizer.id;

    const member = await login(memberEmail);
    memberToken = member.token;
    memberId = member.id;

    const maybe = await login(maybeEmail);
    maybeToken = maybe.token;
    maybeId = maybe.id;

    const stranger = await login(strangerEmail);
    strangerToken = stranger.token;
    strangerId = stranger.id;

    // Женский пол у «иду»: от него зависит доля в раскладке.
    await call('patch', '/api/users/me', memberToken, { gender: 'f' }).expect(
      200,
    );
    await call('patch', '/api/users/me', maybeToken, { gender: 'f' }).expect(
      200,
    );

    tentTypeId = await ensureType('tent', 'Палатка');
    sleepingTypeId = await ensureType('sleeping_bag', 'Спальник');
    plainTypeId = await ensureType(`e2eload_plain`, 'Проверочный ящик');
    firstAidTypeId = await ensureType('first_aid', 'Аптечка');

    objectId = (
      await dataSource.query(
        `INSERT INTO objects (name, type) VALUES ('Вершина для раскладки', 'вершина') RETURNING id`,
      )
    )[0].id;

    tripId = (
      await dataSource.query(
        `INSERT INTO trips (organizer_user_id, goal_object_id, route_text,
                            status, starts_at, ends_at)
         VALUES ($1, $2, '', 'decided', now() + interval '10 days',
                 now() + interval '12 days') RETURNING id`,
        [organizerId, objectId],
      )
    )[0].id;

    await dataSource.query(
      `INSERT INTO trip_participants (trip_id, user_id, status)
       VALUES ($1, $2, 'going'), ($1, $3, 'going'), ($1, $4, 'maybe')`,
      [tripId, organizerId, memberId, maybeId],
    );

    // Своя роль с правом на «Снаряжение»: проверка «роль даёт вкладку»
    // не должна зависеть от сида. Медик — из справочника: код `doctor`
    // читает автораспределение.
    gearRoleCode = `loadE2e${Date.now()}`;
    await dataSource.query(
      `INSERT INTO roles (code, name) VALUES ($1, 'Завхоз (тест)')`,
      [gearRoleCode],
    );
    const gearRoleId = (
      await dataSource.query('SELECT id FROM roles WHERE code = $1', [
        gearRoleCode,
      ])
    )[0].id;
    await dataSource.query(
      `INSERT INTO role_tab_permissions (role_id, tab) VALUES ($1, 'gear')`,
      [gearRoleId],
    );
    await dataSource.query(
      `INSERT INTO trip_participant_roles (trip_id, user_id, role_id)
       VALUES ($1, $2, $3)`,
      [tripId, organizerId, gearRoleId],
    );

    await dataSource.query(`
      INSERT INTO roles (code, name) VALUES ('doctor', 'Медик')
      ON CONFLICT (code) DO NOTHING
    `);
    const doctorRoleId = (
      await dataSource.query(`SELECT id FROM roles WHERE code = 'doctor'`)
    )[0].id;
    await dataSource.query(
      `INSERT INTO trip_participant_roles (trip_id, user_id, role_id)
       VALUES ($1, $2, $3)`,
      [tripId, memberId, doctorRoleId],
    );

    // Предметы каталога — через API, как у человека.
    const tentId = await addGear(organizerToken, {
      typeId: tentTypeId,
      attributes: { seats: 2 },
      title: 'Палатка на четверых',
      weightGrams: 4000,
    });
    const ropeId = await addGear(organizerToken, {
      typeId: plainTypeId,
      title: 'Верёвка 40 м',
      weightGrams: 1000,
    });
    const potId = await addGear(memberToken, {
      typeId: plainTypeId,
      title: 'Котелок 5 л',
      weightGrams: 2000,
    });
    const firstAidId = await addGear(organizerToken, {
      typeId: firstAidTypeId,
      title: 'Аптечка походная',
      weightGrams: 500,
    });
    const maybeItemId = await addGear(maybeToken, {
      typeId: plainTypeId,
      title: 'Вещь «пока не решил»',
      weightGrams: 700,
    });

    const tent = await propose(organizerToken, tentId).expect(201);
    tentTripGearId = tent.body.id as string;
    // Палатка — табор: раздел заводится и заполняется сам (06.11.2026).
    tentSharedSectionId = tent.body.sharedSectionId as string | null;

    const rope = await propose(organizerToken, ropeId).expect(201);
    const pot = await propose(memberToken, potId).expect(201);
    const firstAid = await propose(organizerToken, firstAidId).expect(201);
    // «Пока не решил» предлагает вещь, но в раскладку она не идёт:
    // статус остаётся `proposed`.
    await propose(maybeToken, maybeItemId).expect(201);

    await approve(organizerToken, tentTripGearId);
    await approve(organizerToken, rope.body.id as string);
    await approve(organizerToken, pot.body.id as string);
    await approve(organizerToken, firstAid.body.id as string);

    // Пакет еды в «Питании»: приём с ручной строкой и долей в пакет.
    const productId = (
      await dataSource.query(
        `INSERT INTO trip_products (trip_id, name, unit, weight_per_unit_grams)
         VALUES ($1, 'Крупа проверочная', 'g', 5) RETURNING id`,
        [tripId],
      )
    )[0].id;
    const mealId = (
      await dataSource.query(
        `INSERT INTO trip_meals (trip_id, day_index, kind, form)
         VALUES ($1, 1, 'breakfast', 'cook') RETURNING id`,
        [tripId],
      )
    )[0].id;
    await dataSource.query(
      `INSERT INTO trip_meal_lines (meal_id, product_id, amount)
       VALUES ($1, $2, 400)`,
      [mealId, productId],
    );
    packageId = (
      await dataSource.query(
        `INSERT INTO trip_meal_packages (trip_id, name, kind)
         VALUES ($1, 'Пакет 1', 'normal') RETURNING id`,
        [tripId],
      )
    )[0].id;
    await dataSource.query(
      `INSERT INTO trip_meal_allocations (meal_id, product_id, package_id, amount)
       VALUES ($1, $2, $3, 400)`,
      [mealId, productId, packageId],
    );

    // Личный пакет автономного питания: назначать его другому нельзя.
    personalPackageId = (
      await dataSource.query(
        `INSERT INTO trip_meal_packages (trip_id, eater_user_id, name, kind)
         VALUES ($1, $2, 'Мой пакет', 'normal') RETURNING id`,
        [tripId, memberId],
      )
    )[0].id;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query('DELETE FROM trips WHERE id = $1', [tripId]);
      await dataSource.query(
        'DELETE FROM gear_items WHERE owner_user_id = ANY($1::uuid[])',
        [[organizerId, memberId, maybeId]],
      );
      await dataSource.query(
        `DELETE FROM gear_types WHERE code LIKE 'e2eload\\_%'`,
      );
      await dataSource.query('DELETE FROM roles WHERE code = $1', [
        gearRoleCode,
      ]);
      await dataSource.query('DELETE FROM objects WHERE id = $1', [objectId]);
      await dataSource.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        [organizerId, memberId, maybeId, strangerId],
      ]);
    }
    await app?.close();
  });

  it('посторонний не видит раскладку', async () => {
    await call('get', `/api/trips/${tripId}/gear/load`, strangerToken).expect(
      403,
    );
  });

  it('рюкзаки — только «иду», пакет ждёт несущего, медик известен', async () => {
    const response = await call(
      'get',
      `/api/trips/${tripId}/gear/load`,
      organizerToken,
    ).expect(200);

    expect(response.body.backpacks).toHaveLength(2);
    const ids = response.body.backpacks.map(
      (backpack: { userId: string }) => backpack.userId,
    );
    expect(ids).toContain(organizerId);
    expect(ids).toContain(memberId);
    expect(ids).not.toContain(maybeId);

    // Вещи без веса и «пока не решил» в сумму не входят:
    // палатка 4000 + верёвка 1000 + котёл 2000 + аптечка 500 + пакет 2000.
    expect(response.body.totalWeightGrams).toBe(9500);
    expect(response.body.itemsWithoutWeight).toBe(0);
    expect(response.body.packagesWithoutWeight).toBe(0);

    // Пакет еды ещё никому не назначен — он в нераспределённых.
    const unassigned = response.body.unassigned as Array<{
      kind: string;
      id: string;
      weightGrams: number;
      title: string;
    }>;
    const packages = unassigned.filter((unit) => unit.kind === 'package');
    expect(packages).toHaveLength(1);
    expect(packages[0]).toMatchObject({
      id: packageId,
      title: 'Пакет 1',
      weightGrams: 2000,
    });

    // Аптечка закрепляется при автораспределении: до нажатия кнопки она
    // лежит у владельца, как любая вещь. Медик при этом уже известен —
    // экран скажет, кому она достанется.
    expect(response.body.doctorUserId).toBe(memberId);
    expect(response.body.doctorMissing).toBe(false);
    const organizerBag = response.body.backpacks.find(
      (backpack: { userId: string }) => backpack.userId === organizerId,
    );
    expect(organizerBag.gear).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Аптечка походная', weightGrams: 500 }),
      ]),
    );

    /**
     * Общественная аптечка вкладки «Аптечка» — у медика, даже пустая
     * (09.11.2026: «Общественную аптечку отображаем даже пустую»).
     * Вкладку здесь никто не открывал, списка нет — и это как раз случай,
     * когда единица обязана появиться нулём, а не исчезнуть.
     */
    const doctorBag = response.body.backpacks.find(
      (backpack: { userId: string }) => backpack.userId === memberId,
    );
    expect(doctorBag.gear).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'firstAid',
          title: 'Общественная аптечка',
          weightGrams: 0,
          weightKnown: false,
          assignedUserId: memberId,
        }),
      ]),
    );
  });

  it('доли считаются с поправкой на пол', async () => {
    const response = await call(
      'get',
      `/api/trips/${tripId}/gear/load`,
      organizerToken,
    ).expect(200);

    const byUser = new Map(
      (
        response.body.backpacks as Array<{
          userId: string;
          gender: string;
          targetWeightGrams: number;
        }>
      ).map((backpack) => [backpack.userId, backpack]),
    );

    // 9500 / (1 + 0,8) ≈ 5277,78 и 4222,22 — не поровну: у женщины 0,8.
    expect(byUser.get(organizerId)?.gender).toBe('m');
    expect(byUser.get(memberId)?.gender).toBe('f');
    expect(byUser.get(organizerId)?.targetWeightGrams).toBe(5278);
    expect(byUser.get(memberId)?.targetWeightGrams).toBe(4222);
  });

  it('пакет еды назначается любому участнику и переезжает в рюкзак', async () => {
    const response = await call(
      'patch',
      `/api/trips/${tripId}/gear/packages/${packageId}`,
      memberToken,
      { assignedUserId: organizerId },
    ).expect(200);

    const organizerBag = response.body.backpacks.find(
      (backpack: { userId: string }) => backpack.userId === organizerId,
    );
    expect(organizerBag.packages.map((unit: { id: string }) => unit.id)).toContain(
      packageId,
    );
    expect(
      (response.body.unassigned as Array<{ id: string }>).map(
        (unit) => unit.id,
      ),
    ).not.toContain(packageId);
    // Пакет — отдельная сумма в рюкзаке, а не добавка к вещам.
    expect(organizerBag.packagesWeightGrams).toBe(2000);
  });

  it('назначить груз «пока не решил» нельзя', async () => {
    await call(
      'patch',
      `/api/trips/${tripId}/gear/packages/${packageId}`,
      memberToken,
      { assignedUserId: maybeId },
    ).expect(400);
  });

  it('личный пакет автономного питания не назначается', async () => {
    await call(
      'patch',
      `/api/trips/${tripId}/gear/packages/${personalPackageId}`,
      memberToken,
      { assignedUserId: organizerId },
    ).expect(400);
  });

  it('без права вкладки кнопка автораспределения недоступна', async () => {
    await call(
      'post',
      `/api/trips/${tripId}/gear/auto-distribute`,
      memberToken,
    ).expect(403);
  });

  it('снаряга «Ночёвок» ложится в «Табор», а личное остаётся личным (06.11.2026)', async () => {
    // Палатка добавлена через «Ночёвки» — раздел завёлся и заполнился сам.
    expect(tentSharedSectionId).not.toBeNull();

    const list = await call(
      'get',
      `/api/trips/${tripId}/gear`,
      organizerToken,
    ).expect(200);

    const campSection = (
      list.body.sections as Array<{ id: string; scope: string; title: string }>
    ).find((section) => section.id === tentSharedSectionId);
    expect(campSection).toMatchObject({ scope: 'shared', title: 'Табор' });
    expect(
      (list.body.items as Array<{ id: string; sharedSectionId: string }>).find(
        (item) => item.id === tentTripGearId,
      )?.sharedSectionId,
    ).toBe(tentSharedSectionId);

    /**
     * Спальник, предложенный в снаряжение похода, — **общественная вещь**:
     * заказчик 06.11.2026 сказал, что перенос вещи похода в личный раздел
     * владельца «не верен в корне». Вещь остаётся в «Берём» без личного
     * раздела, а её личная копия в «Ночёвках» — отдельная строка.
     */
    const sleepingId = await addGear(organizerToken, {
      typeId: sleepingTypeId,
      title: 'Спальник проверочный',
      weightGrams: 1500,
    });
    const sleeping = await propose(organizerToken, sleepingId).expect(201);
    expect(sleeping.body.personalSectionId).toBeNull();

    // Личная вещь из «Ночёвок» приезжает в «Взял» отдельным массивом.
    const plan = await call(
      'post',
      `/api/trips/${tripId}/route/sleeping`,
      organizerToken,
      { gearItemId: String(sleepingId) },
    ).expect(200);
    const sleepingRow = (
      plan.body.sleeping as Array<{ id: string; gearItemId: string }>
    ).find((row) => row.gearItemId === String(sleepingId));
    expect(sleepingRow).toBeDefined();

    const after = await call(
      'get',
      `/api/trips/${tripId}/gear`,
      organizerToken,
    ).expect(200);
    expect(after.body.sleeping).toEqual([
      expect.objectContaining({
        gearItemId: String(sleepingId),
        typeCode: 'sleeping_bag',
        title: 'Спальник проверочный',
        weightGrams: 1500,
      }),
    ]);

    // Личные строки чужим не отдаются — даже организатору.
    const memberView = await call(
      'get',
      `/api/trips/${tripId}/gear`,
      memberToken,
    ).expect(200);
    expect(memberView.body.sleeping).toEqual([]);

    // Убираем за собой: личная строка и строка похода.
    await call(
      'delete',
      `/api/trips/${tripId}/route/sleeping/${sleepingRow?.id}`,
      organizerToken,
    ).expect(200);
    await call(
      'delete',
      `/api/trips/${tripId}/gear/${sleeping.body.id}`,
      organizerToken,
    ).expect(204);
  });

  it('автораспределение: полный сброс, аптечка у медика, тяжёлое владельцу', async () => {
    const response = await call(
      'post',
      `/api/trips/${tripId}/gear/auto-distribute`,
      organizerToken,
    ).expect(200);

    const bags = new Map<string, { gear: Array<{ title: string }>; packages: Array<{ id: string }>; totalWeightGrams: number }>(
      (
        response.body.backpacks as Array<{
          userId: string;
          gear: Array<{ title: string }>;
          packages: Array<{ id: string }>;
          totalWeightGrams: number;
        }>
      ).map((backpack) => [backpack.userId, backpack]),
    );
    const organizerBag = bags.get(organizerId);
    const memberBag = bags.get(memberId);

    // Палатка и верёвка — владельцу, пока он не дошёл до доли.
    expect(organizerBag?.gear.map((unit) => unit.title)).toEqual(
      expect.arrayContaining(['Палатка на четверых', 'Верёвка 40 м']),
    );
    // Котёл и аптечка — медику: котёл его, аптечка закреплена правилом.
    expect(memberBag?.gear.map((unit) => unit.title)).toEqual(
      expect.arrayContaining(['Котелок 5 л', 'Аптечка походная']),
    );
    // Пакет вернулся из рук организатора: кнопка всё стёрла.
    expect(organizerBag?.packages).toHaveLength(0);
    expect(memberBag?.packages.map((unit) => unit.id)).toContain(packageId);

    expect(organizerBag?.totalWeightGrams).toBe(5000);
    expect(memberBag?.totalWeightGrams).toBe(4500);
    expect(response.body.unassigned).toHaveLength(0);
  });

  it('личные вещи «Взял»: добавляются в свой раздел, видны только владельцу и идут в «Личное» рюкзака', async () => {
    // Разделы засеялись при первом `GET /gear` — берём «Одежду» организатора.
    const list = await call(
      'get',
      `/api/trips/${tripId}/gear`,
      organizerToken,
    ).expect(200);
    const clothes = (
      list.body.sections as Array<{
        id: string;
        scope: string;
        title: string;
        templateCode: string | null;
      }>
    ).find(
      (section) =>
        section.scope === 'personal' && section.templateCode === 'clothes',
    );
    expect(clothes).toBeDefined();

    const jacketId = await addGear(organizerToken, {
      typeId: plainTypeId,
      title: 'Куртка мембранная',
      weightGrams: 800,
    });

    const created = await call(
      'post',
      `/api/trips/${tripId}/gear/personal`,
      organizerToken,
      { gearItemId: Number(jacketId), sectionId: Number(clothes?.id) },
    ).expect(201);

    expect(created.body).toMatchObject({
      title: 'Куртка мембранная',
      weightGrams: 800,
      personalSectionId: clothes?.id,
      sharedSectionId: null,
      status: 'approved',
    });

    // Повторно ту же вещь в тот же поход не положить.
    await call('post', `/api/trips/${tripId}/gear/personal`, organizerToken, {
      gearItemId: Number(jacketId),
    }).expect(409);

    const own = await call(
      'get',
      `/api/trips/${tripId}/gear`,
      organizerToken,
    ).expect(200);
    expect(own.body.personalItems).toEqual([
      expect.objectContaining({
        id: created.body.id,
        title: 'Куртка мембранная',
        personalSectionId: clothes?.id,
      }),
    ]);

    // Чужие личные вещи не отдаются — даже организатор чужой «Взял» не видит.
    const memberView = await call(
      'get',
      `/api/trips/${tripId}/gear`,
      memberToken,
    ).expect(200);
    expect(memberView.body.personalItems).toEqual([]);

    // В раскладке — отдельный блок «Личное», в общественные доли не входит.
    const load = await call(
      'get',
      `/api/trips/${tripId}/gear/load`,
      organizerToken,
    ).expect(200);
    expect(load.body.personal.gear).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'personal',
          title: 'Куртка мембранная',
          weightGrams: 800,
        }),
      ]),
    );
    expect(load.body.personal.gearWeightGrams).toBeGreaterThanOrEqual(800);
    expect(
      (load.body.backpacks as Array<{
        gear: Array<{ title: string }>;
      }>).flatMap((bag) => bag.gear.map((unit) => unit.title)),
    ).not.toContain('Куртка мембранная');

    // Крестик: убираем строку, предмет каталога остаётся.
    await call(
      'delete',
      `/api/trips/${tripId}/gear/personal/${created.body.id}`,
      organizerToken,
    ).expect(204);

    const after = await call(
      'get',
      `/api/trips/${tripId}/gear`,
      organizerToken,
    ).expect(200);
    expect(after.body.personalItems).toEqual([]);

    // Чужой предмет в личные не положить.
    await call('post', `/api/trips/${tripId}/gear/personal`, memberToken, {
      gearItemId: Number(jacketId),
    }).expect(404);
  });

  it('«Мои продукты»: личная еда без пакета видна в «Личном» рюкзака (09.11.2026)', async () => {
    // Заказчик: «в Личном рюкзаке не отображается пакет „Мои продукты“».
    // В «Питании» это сводка по личным приёмам, а не строка в базе —
    // проверяем, что сервер сам считает её вес и отдаёт владельцу.
    const foodProductId = (
      await dataSource.query(
        `INSERT INTO trip_products (trip_id, name, unit, weight_per_unit_grams)
         VALUES ($1, 'Печенье проверочное', 'g', 5) RETURNING id`,
        [tripId],
      )
    )[0].id;
    const myMealId = (
      await dataSource.query(
        `INSERT INTO trip_meals (trip_id, day_index, kind, form, eater_user_id)
         VALUES ($1, 2, 'dinner', 'snack', $2) RETURNING id`,
        [tripId, organizerId],
      )
    )[0].id;
    await dataSource.query(
      `INSERT INTO trip_meal_lines (meal_id, product_id, amount)
       VALUES ($1, $2, 30)`,
      [myMealId, foodProductId],
    );

    try {
      const load = await call(
        'get',
        `/api/trips/${tripId}/gear/load`,
        organizerToken,
      ).expect(200);

      // 30 × 5 г = 150 г — расчётный вес сводки.
      expect(load.body.personal.packages).toEqual([
        expect.objectContaining({
          id: 'my-food',
          name: 'Мои продукты',
          weightGrams: 150,
          isActual: false,
        }),
      ]);
      expect(load.body.personal.packagesWeightGrams).toBe(150);

      // Чужой личной еды не видно: у участника нет своих приёмов,
      // поэтому сводки «Мои продукты» в его рюкзаке тоже нет.
      const memberView = await call(
        'get',
        `/api/trips/${tripId}/gear/load`,
        memberToken,
      ).expect(200);
      expect(
        (memberView.body.personal.packages as Array<{ id: string }>).map(
          (pack) => pack.id,
        ),
      ).not.toContain('my-food');
    } finally {
      await dataSource.query('DELETE FROM trip_meals WHERE id = $1', [
        myMealId,
      ]);
      await dataSource.query('DELETE FROM trip_products WHERE id = $1', [
        foodProductId,
      ]);
    }
  });

  it('питающийся отдельно не несёт общий пакет: автораскладка обходит его рюкзак', async () => {
    // Участник перешёл на своё питание (правило «Питания» 06.11.2026).
    await call('patch', `/api/trips/${tripId}/participants/me`, memberToken, {
      status: 'going',
      eatsSeparately: true,
    }).expect(200);

    // Назначить ему пакет вручную тоже нельзя.
    await call(
      'patch',
      `/api/trips/${tripId}/gear/packages/${packageId}`,
      organizerToken,
      { assignedUserId: memberId },
    ).expect(400);

    const response = await call(
      'post',
      `/api/trips/${tripId}/gear/auto-distribute`,
      organizerToken,
    ).expect(200);

    const bags = new Map<string, { packages: Array<{ id: string }> }>(
      (
        response.body.backpacks as Array<{
          userId: string;
          packages: Array<{ id: string }>;
        }>
      ).map((backpack) => [backpack.userId, backpack]),
    );

    // Общий пакет ушёл единственному едоку, а рюкзак «отдельного» пуст по еде.
    expect(bags.get(organizerId)?.packages.map((unit) => unit.id)).toContain(
      packageId,
    );
    expect(bags.get(memberId)?.packages).toHaveLength(0);
  });
});
