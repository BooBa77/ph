import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { EmailCodeService } from './../src/email/services/email-code.service';
import { SmtpService } from './../src/email/services/smtp.service';
import type { TripTransferDto } from './../src/trips/dto/trip-transfer.dto';

/**
 * «Трансфер» похода (e2e) — 27–28.10.2026.
 *
 * Проверяем решения заказчика по раскладке вкладки:
 *
 * 1. **Карточка = перемещение.** Сторона (`there` / `back`), тип транспорта,
 *    время, откуда и куда хранятся в одной строке; машины отдельной
 *    сущности больше нет.
 * 2. **Обязательные поля**: время отправления, откуда, докуда. Без них 400,
 *    а не карточка-пожелание.
 * 3. **«Наше ТС»** — флаг права вкладки; участник свой транспорт получает
 *    с флагом сам, а рейс (автобус, ж/д, корабль, вертолёт) заводит без
 *    флага — и вручную флаг поставить не может.
 * 4. **Компенсация**: цена билета только у рейсов, общие расходы только
 *    у своего транспорта, сумма нужна всему, кроме «безвозмездно».
 *    «Туда-обратно» ставится при любой компенсации (28.10.2026), но сумма
 *    у пары одна и только не у общественного транспорта.
 * 5. **Присоединение**: на рейс — сразу, на чужое ТС — заявкой; принимает
 *    владелец ТС, уйти человек может сам.
 * 6. **Места**: заполненные не пускают сверх счёта — ни заявкой, ни
 *    принятием.
 * 7. **Уход участника**: его ТС уходит с ним, чужие карточки остаются.
 * 8. **Заброска** — цепочка этапов из тех же карточек: нумеруется по времени
 *    отправления и свободно переплетает стороны — маршрут бывает и парой.
 * 9. **Пара «туда-обратно»** — одна поездка на два конца: оплата задаётся
 *    на исходной и живёт в зеркале, составы пассажиров дальше живут врозь,
 *    а порядок дат проверяется по тем, кто едет в оба конца. Пар у группы
 *    может быть несколько, а у рейсов пары не бывает вовсе.
 * 10. **Техника из каталога** освобождается закрытым походом: 409 —
 *     только пока поход не закрыт.
 * 11. **Один человек — один рейс «туда» и один «обратно».** Второй рейс
 *     того же направления не сажаем: ни посадкой, ни принятием заявки,
 *     ни владельцем в своём ТС. Заявки (`requested`) и заброски (`is_stage`)
 *     не считаются — заявка место не занимает, а этап это внутренний
 *     переезд, а не дорога от дома.
 *
 * Поход, состав и чаты тест заводит напрямую в базе: видимость похода и
 * создание чатов проверены в `trips.e2e-spec.ts`.
 */
describe('Трансфер похода (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  let organizerId: string;
  let organizerToken: string;
  let driverId: string;
  let driverToken: string;
  let memberId: string;
  let memberToken: string;
  let annaId: string;
  let annaToken: string;
  let petrId: string;
  let petrToken: string;
  let maybeId: string;
  let maybeToken: string;
  let strangerToken: string;

  let objectId: string;
  let tripId: string;
  /**
   * Отдельный поход для правила «один человек — один рейс»: в общей
   * цепочке люди уже сидят в карточках, заведённых раньше, и проверка
   * мешала бы соседним тестам.
   */
  let ruleTripId: string;

  /** Карточки, которые заводятся по ходу тестов. */
  let memberCarId: string;
  let busId: string;
  let organizerCarId: string;

  const transferRoleCode = `transferE2e${Date.now()}`;

  let lastCode: string | null = null;

  const stamp = Date.now();
  const organizerEmail = `transfer-e2e-org-${stamp}@example.com`;
  const driverEmail = `transfer-e2e-driver-${stamp}@example.com`;
  const memberEmail = `transfer-e2e-member-${stamp}@example.com`;
  const annaEmail = `transfer-e2e-anna-${stamp}@example.com`;
  const petrEmail = `transfer-e2e-petr-${stamp}@example.com`;
  const maybeEmail = `transfer-e2e-maybe-${stamp}@example.com`;
  const strangerEmail = `transfer-e2e-stranger-${stamp}@example.com`;

  const DEPARTS = '2026-11-07T01:00:00.000Z';

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

  /** Вкладка глазами кого-то из участников. */
  async function planOf(trip: string, token: string): Promise<TripTransferDto> {
    const response = await request(app.getHttpServer())
      .get(`/api/trips/${trip}/transfer`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    return response.body as TripTransferDto;
  }

  function plan(token: string): Promise<TripTransferDto> {
    return planOf(tripId, token);
  }

  function legOf(body: TripTransferDto, id: string) {
    return body.legs.find((leg) => leg.id === id);
  }

  function passengerOf(body: TripTransferDto, legId: string, userId: string) {
    return legOf(body, legId)?.passengers.find((person) => person.userId === userId);
  }

  /** Создать карточку и вернуть ответ целиком. */
  async function createLegIn(
    trip: string,
    token: string,
    body: Record<string, unknown>,
  ): Promise<TripTransferDto> {
    const response = await request(app.getHttpServer())
      .post(`/api/trips/${trip}/transfer/legs`)
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(200);

    return response.body as TripTransferDto;
  }

  function createLeg(
    token: string,
    body: Record<string, unknown>,
  ): Promise<TripTransferDto> {
    return createLegIn(tripId, token, body);
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

    const driver = await login(driverEmail);
    driverToken = driver.token;
    driverId = driver.id;

    const member = await login(memberEmail);
    memberToken = member.token;
    memberId = member.id;

    const anna = await login(annaEmail);
    annaToken = anna.token;
    annaId = anna.id;

    const petr = await login(petrEmail);
    petrToken = petr.token;
    petrId = petr.id;

    const maybe = await login(maybeEmail);
    maybeId = maybe.id;
    maybeToken = maybe.token;

    const stranger = await login(strangerEmail);
    strangerToken = stranger.token;

    objectId = (
      await dataSource.query(
        `INSERT INTO objects (name, type) VALUES ('Перевал для трансфера', 'перевал') RETURNING id`,
      )
    )[0].id;

    tripId = (
      await dataSource.query(
        `INSERT INTO trips (organizer_user_id, goal_object_id) VALUES ($1, $2) RETURNING id`,
        [organizerId, objectId],
      )
    )[0].id;

    await dataSource.query(
      `INSERT INTO trip_participants (trip_id, user_id, status)
       VALUES ($1, $2, 'going'), ($1, $3, 'going'), ($1, $4, 'going'),
              ($1, $5, 'going'), ($1, $6, 'going'), ($1, $7, 'maybe')`,
      [tripId, organizerId, driverId, memberId, annaId, petrId, maybeId],
    );

    ruleTripId = (
      await dataSource.query(
        `INSERT INTO trips (organizer_user_id, goal_object_id) VALUES ($1, $2) RETURNING id`,
        [organizerId, objectId],
      )
    )[0].id;

    await dataSource.query(
      `INSERT INTO trip_participants (trip_id, user_id, status)
       VALUES ($1, $2, 'going'), ($1, $3, 'going'), ($1, $4, 'going'),
              ($1, $5, 'going'), ($1, $6, 'going')`,
      [ruleTripId, organizerId, driverId, memberId, annaId, petrId],
    );

    /**
     * Роль «водитель» с правом только на «Трансфер»: проверка «роль даёт
     * вкладку» не должна зависеть от сида.
     */
    await dataSource.query(
      `INSERT INTO roles (code, name) VALUES ($1, 'Водитель (тест)')`,
      [transferRoleCode],
    );
    const roleId = (
      await dataSource.query(`SELECT id FROM roles WHERE code = $1`, [
        transferRoleCode,
      ])
    )[0].id;
    await dataSource.query(
      `INSERT INTO role_tab_permissions (role_id, tab) VALUES ($1, 'transfer')`,
      [roleId],
    );
    await dataSource.query(
      `INSERT INTO trip_participant_roles (trip_id, user_id, role_id)
       VALUES ($1, $2, $3)`,
      [tripId, driverId, roleId],
    );

    await dataSource.query(
      `INSERT INTO conversations (kind, trip_id)
       VALUES ('trip_guest', $1), ('trip_members', $1),
              ('trip_meals', $1), ('trip_transfer', $1)`,
      [tripId],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query('DELETE FROM trips WHERE id = ANY($1::bigint[])', [
        [tripId, ruleTripId],
      ]);
      await dataSource.query(
        'DELETE FROM vehicles WHERE owner_user_id = ANY($1::uuid[])',
        [[organizerId, driverId, memberId]],
      );
      await dataSource.query('DELETE FROM objects WHERE id = $1', [objectId]);
      await dataSource.query('DELETE FROM roles WHERE code = $1', [
        transferRoleCode,
      ]);
    }

    await app?.close();
  });

  it('участник видит пустые области, гость — нет', async () => {
    const organizer = await plan(organizerToken);

    expect(organizer.legs).toEqual([]);
    expect(organizer.canEdit).toBe(true);

    const travelerIds = organizer.travelers.map((person) => person.userId);
    expect(travelerIds).toContain(organizerId);
    expect(travelerIds).toContain(driverId);
    expect(travelerIds).toContain(memberId);
    // «Пока не решил» в список не попадает: место он не занимает.
    expect(travelerIds).not.toContain(maybeId);

    expect((await plan(memberToken)).canEdit).toBe(false);

    await request(app.getHttpServer())
      .get(`/api/trips/${tripId}/transfer`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .expect(403);
  });

  it('участник заводит своё ТС — с флагом и владельцем автоматически', async () => {
    const body = await createLeg(memberToken, {
      direction: 'there',
      mode: 'car',
      departsAt: DEPARTS,
      fromPlace: '  Иркутск, автовокзал  ',
      toPlace: 'Олхинское плато, Витязь',
      compensation: 'shared',
      compensationAmountRub: 3000,
      seats: 4,
    });

    expect(body.legs).toHaveLength(1);
    const leg = body.legs[0];
    memberCarId = leg.id;

    expect(leg.direction).toBe('there');
    expect(leg.isOwnVehicle).toBe(true);
    expect(leg.ownerUserId).toBe(memberId);
    expect(leg.ownerName).toBeTruthy();
    // Точки обрезаются по краям.
    expect(leg.fromPlace).toBe('Иркутск, автовокзал');
    // Владелец едет в своём ТС и место занимает.
    expect(leg.occupied).toBe(1);
    expect(passengerOf(body, memberCarId, memberId)?.status).toBe('accepted');
    // Карточку правит владелец — даже без права на вкладку.
    expect(leg.canEdit).toBe(true);
    expect(body.canEdit).toBe(false);

    // Флаг вручную участник не ставит: он и так его.
    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({
        direction: 'there',
        mode: 'car',
        departsAt: DEPARTS,
        fromPlace: 'Иркутск',
        toPlace: 'Витязь',
        compensation: 'free',
        isOwnVehicle: true,
      })
      .expect(403);
  });

  it('рейс участник заводит тоже, но без флага и владельца', async () => {
    const body = await createLeg(memberToken, {
      direction: 'there',
      mode: 'bus',
      departsAt: DEPARTS,
      fromPlace: 'Иркутск, автовокзал',
      toPlace: 'Олхинское плато, Витязь',
      compensation: 'ticket',
      compensationAmountRub: 500,
    });

    busId = body.legs.find((leg) => leg.mode === 'bus')!.id;

    expect(legOf(body, busId)?.isOwnVehicle).toBe(false);
    expect(legOf(body, busId)?.ownerUserId).toBeNull();
    expect(legOf(body, busId)?.occupied).toBe(0);
  });

  it('техника из каталога: тип, марка, номер и места', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ kind: 'car', brand: 'Нива', seats: 4, plate: 'А123ВС38' })
      .expect(201);

    const vehicleId = created.body.id as string;
    expect(created.body.brand).toBe('Нива');
    expect(created.body.kind).toBe('car');

    // Тип, которого нет в типах транспорта, в каталог всё равно можно:
    // снегоход, мотоцикл и велосипед — личная техника.
    await request(app.getHttpServer())
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ kind: 'снегоход', brand: 'Буран' })
      .expect(400);

    // Велосипед в каталоге есть, а этапом заброски не бывает (28.10.2026).
    const bike = await request(app.getHttpServer())
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ kind: 'bicycle', brand: 'Стелс' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({
        direction: 'there',
        mode: 'car',
        departsAt: DEPARTS,
        fromPlace: 'Иркутск',
        toPlace: 'Витязь',
        compensation: 'free',
        vehicleId: Number(bike.body.id),
      })
      .expect(400);

    await request(app.getHttpServer())
      .delete(`/api/vehicles/${bike.body.id}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(204);

    const list = await request(app.getHttpServer())
      .get('/api/vehicles')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);
    expect((list.body.vehicles as { id: string }[]).map((row) => row.id)).toContain(
      vehicleId,
    );

    // Та же машина второй раз — 409: «владелец + марка + номер».
    await request(app.getHttpServer())
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ kind: 'car', brand: ' нива ', seats: 5, plate: 'а123вс38' })
      .expect(409);

    // Без номера сравнивать нечего: две «Нивы» без номеров — законно.
    await request(app.getHttpServer())
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ kind: 'car', brand: 'Нива' })
      .expect(201);

    // Чужой транспорт в карточку не подставить — его просто нет в каталоге.
    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        direction: 'back',
        mode: 'car',
        departsAt: DEPARTS,
        fromPlace: 'Витязь',
        toPlace: 'Иркутск',
        compensation: 'free',
        vehicleId: Number(vehicleId),
      })
      .expect(404);

    // Способ и места присылаем неверные — каталог их перепишет.
    const body = await createLeg(memberToken, {
      direction: 'back',
      mode: 'boat',
      departsAt: DEPARTS,
      fromPlace: 'Витязь',
      toPlace: 'Иркутск',
      compensation: 'shared',
      compensationAmountRub: 2000,
      seats: 9,
      vehicleId: Number(vehicleId),
    });

    const leg = body.legs.find((item) => item.vehicleId === vehicleId)!;

    expect(leg.mode).toBe('car');
    expect(leg.seats).toBe(4);
    expect(leg.vehicleTitle).toBe('Нива');
    expect(leg.isOwnVehicle).toBe(true);
    expect(leg.ownerUserId).toBe(memberId);
    // Транспорт, который уже едет в походе, из каталога не удаляется.
    await request(app.getHttpServer())
      .delete(`/api/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(409);

    // Убрали карточку — транспорт удаляется.
    await request(app.getHttpServer())
      .delete(`/api/trips/${tripId}/transfer/legs/${leg.id}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/api/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(204);
  });

  it('обязательные поля: время, откуда, докуда и способ из списка', async () => {
    for (const broken of [
      { mode: 'car', fromPlace: 'Иркутск', toPlace: 'Витязь', compensation: 'free' },
      { mode: 'car', departsAt: DEPARTS, toPlace: 'Витязь', compensation: 'free' },
      { mode: 'car', departsAt: DEPARTS, fromPlace: 'Иркутск', compensation: 'free' },
      { mode: 'пешком', departsAt: DEPARTS, fromPlace: 'Иркутск', toPlace: 'Витязь', compensation: 'free' },
    ]) {
      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/transfer/legs`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ direction: 'there', ...broken })
        .expect(400);
    }

    // Велосипед убран из типов 28.10.2026: в каталоге техники он остался,
    // а этапом заброски не бывает — группу с вещами он не возит.
    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        direction: 'there',
        mode: 'bicycle',
        departsAt: DEPARTS,
        fromPlace: 'Иркутск',
        toPlace: 'Витязь',
        compensation: 'free',
      })
      .expect(400);

    // «Пешком» убрано из списка способов, но старые коды не проходят вовсе.
    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        direction: 'вперёд',
        mode: 'car',
        departsAt: DEPARTS,
        fromPlace: 'Иркутск',
        toPlace: 'Витязь',
        compensation: 'free',
      })
      .expect(400);
  });

  it('компенсация: что с чем сочетается, а «туда-обратно» от неё не зависит', async () => {
    const base = {
      direction: 'back',
      departsAt: DEPARTS,
      fromPlace: 'Витязь',
      toPlace: 'Иркутск',
    };

    /** Пара рождается только на рейсе «Туда», поэтому флаг — с этой стороны. */
    const round = {
      direction: 'there',
      departsAt: DEPARTS,
      fromPlace: 'Иркутск',
      toPlace: 'Витязь',
    };

    // Цена билета — только у рейса.
    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ ...base, mode: 'car', compensation: 'ticket', compensationAmountRub: 500 })
      .expect(400);

    // Общий расход — только у своего транспорта.
    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ ...base, mode: 'train', compensation: 'shared', compensationAmountRub: 500 })
      .expect(400);

    // Сумма нужна всему, кроме «безвозмездно».
    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ ...base, mode: 'car', compensation: 'shared' })
      .expect(400);

    // У «безвозмездно» суммы не остаётся, даже если её прислали.
    const free = await createLeg(organizerToken, {
      ...base,
      mode: 'airboat',
      compensation: 'free',
      compensationAmountRub: 1000,
    });

    const airboat = free.legs.find((leg) => leg.mode === 'airboat')!;
    expect(airboat.compensationAmountRub).toBeNull();

    // «Туда-обратно» без денег — можно: флаг про план, а не про оплату.
    const freeRound = await createLeg(organizerToken, {
      ...round,
      mode: 'airboat',
      departsAt: '2026-11-10T01:00:00.000Z',
      compensation: 'free',
      isRoundTrip: true,
    });

    const freeSource = freeRound.legs.find(
      (leg) => leg.mode === 'airboat' && leg.isRoundTrip,
    )!;
    expect(freeRound.legs.some((leg) => leg.sourceLegId === freeSource.id)).toBe(true);

    // И у рейса тоже: «вернёмся тем же поездом» — это планирование,
    // а билеты на обоих концах будут свои.
    const ticketRound = await createLeg(organizerToken, {
      ...round,
      mode: 'helicopter',
      compensation: 'ticket',
      compensationAmountRub: 50000,
      isRoundTrip: true,
    });

    const heli = ticketRound.legs.find(
      (leg) => leg.mode === 'helicopter' && leg.isRoundTrip,
    )!;
    expect(ticketRound.legs.some((leg) => leg.sourceLegId === heli.id)).toBe(true);
  });

  it('организатор ставит флаг сам и называет владельца', async () => {
    const body = await createLeg(organizerToken, {
      direction: 'there',
      mode: 'atv',
      departsAt: DEPARTS,
      fromPlace: 'Иркутск',
      toPlace: 'Витязь',
      compensation: 'shared',
      compensationAmountRub: 2000,
      isOwnVehicle: true,
      ownerUserId: organizerId,
      seats: 2,
    });

    organizerCarId = body.legs.find((leg) => leg.mode === 'atv')!.id;

    expect(legOf(body, organizerCarId)?.isOwnVehicle).toBe(true);
    expect(legOf(body, organizerCarId)?.ownerUserId).toBe(organizerId);

    // У рейса «наше ТС» не бывает.
    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        direction: 'there',
        mode: 'helicopter',
        departsAt: DEPARTS,
        fromPlace: 'Иркутск',
        toPlace: 'Витязь',
        compensation: 'ticket',
        compensationAmountRub: 50000,
        isOwnVehicle: true,
        ownerUserId: organizerId,
      })
      .expect(400);

    // Смена способа на рейс у своего ТС — 400 с текстом, а не CHECK из базы.
    await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}/transfer/legs/${organizerCarId}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ mode: 'bus' })
      .expect(400);
  });

  it('карточку правит владелец или право вкладки', async () => {
    // Владелец свою — правит.
    await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}/transfer/legs/${memberCarId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ seats: 5, note: 'свободно одно место' })
      .expect(200);

    // Чужую — нет.
    await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}/transfer/legs/${organizerCarId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ note: 'не моё' })
      .expect(403);

    // Организатор правит любую.
    await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}/transfer/legs/${memberCarId}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ note: 'проверено организатором' })
      .expect(200);
  });

  it('присоединение: на рейс сразу, на чужое ТС — заявкой', async () => {
    /**
     * Сажаем «Анну»: у каждого в рейсе своё место, и правило «один рейс
     * туда» ей не мешает. Организатора сажать нельзя — он уже едет своей
     * машиной, а второго рейса того же направления не бывает (отдельно
     * это проверяет тест про правило ниже).
     */
    const onBus = await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${busId}/join`)
      .set('Authorization', `Bearer ${annaToken}`)
      .expect(200);

    expect(passengerOf(onBus.body, busId, annaId)?.status).toBe('accepted');

    const onCar = await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${memberCarId}/join`)
      .set('Authorization', `Bearer ${petrToken}`)
      .expect(200);

    expect(passengerOf(onCar.body, memberCarId, petrId)?.status).toBe('requested');
    // Заявка место не занимает.
    expect(legOf(onCar.body, memberCarId)?.occupied).toBe(1);

    // Повторно — 409.
    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${memberCarId}/join`)
      .set('Authorization', `Bearer ${petrToken}`)
      .expect(409);

    // Сам владелец к своей карточке не присоединяется: он уже там.
    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${memberCarId}/join`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(409);
  });

  it('заявку принимает владелец, и места считаются', async () => {
    // Принять заявку может только владелец или право вкладки.
    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${memberCarId}/passengers/${petrId}/accept`)
      .set('Authorization', `Bearer ${maybeToken}`)
      .expect(403);

    const accepted = await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${memberCarId}/passengers/${petrId}/accept`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);

    expect(passengerOf(accepted.body, memberCarId, petrId)?.status).toBe(
      'accepted',
    );
    expect(legOf(accepted.body, memberCarId)?.occupied).toBe(2);

    // Владелец ужал места до двух — третьего уже не посадить.
    await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}/transfer/legs/${memberCarId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ seats: 2 })
      .expect(200);

    // Проситься можно и в полную машину: заявка места не занимает.
    const requested = await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${memberCarId}/join`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);

    expect(passengerOf(requested.body, memberCarId, driverId)?.status).toBe(
      'requested',
    );

    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${memberCarId}/passengers/${driverId}/accept`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(400);
  });

  it('уйти человек может сам, а владельца убирают с карточкой', async () => {
    /**
     * «Пётр» снимает себя с чужой машины сам: принятую заявку владелец
     * подтверждать не должен — «пассажир может отказаться».
     */
    const left = await request(app.getHttpServer())
      .delete(`/api/trips/${tripId}/transfer/legs/${memberCarId}/passengers/${petrId}`)
      .set('Authorization', `Bearer ${petrToken}`)
      .expect(200);

    expect(passengerOf(left.body, memberCarId, petrId)).toBeUndefined();

    // Владельца своего ТС из пассажиров не убирают — он уходит с карточкой.
    await request(app.getHttpServer())
      .delete(`/api/trips/${tripId}/transfer/legs/${memberCarId}/passengers/${memberId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(400);

    // Чужого человека без права вкладки не убрать.
    await request(app.getHttpServer())
      .delete(`/api/trips/${tripId}/transfer/legs/${busId}/passengers/${annaId}`)
      .set('Authorization', `Bearer ${maybeToken}`)
      .expect(403);
  });

  it('сажают только тех, кто идёт', async () => {
    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${busId}/passengers`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ userId: maybeId })
      .expect(400);

    const seated = await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${busId}/passengers`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ userId: petrId })
      .expect(200);

    expect(passengerOf(seated.body, busId, petrId)?.status).toBe('accepted');
  });

  it('один человек — один рейс туда: второй не сажаем, а заявку и заброску можно', async () => {
    const withBus = await createLegIn(ruleTripId, organizerToken, {
      direction: 'there',
      mode: 'bus',
      departsAt: '2026-11-07T01:00:00.000Z',
      fromPlace: 'Иркутск, автовокзал',
      toPlace: 'Витязь',
      compensation: 'ticket',
      compensationAmountRub: 500,
    });

    const ruleBusId = withBus.legs.find((leg) => leg.mode === 'bus')!.id;

    const withCar = await createLegIn(ruleTripId, organizerToken, {
      direction: 'there',
      mode: 'car',
      departsAt: '2026-11-08T01:00:00.000Z',
      fromPlace: 'Иркутск, гараж',
      toPlace: 'Витязь',
      compensation: 'free',
      isOwnVehicle: true,
      ownerUserId: organizerId,
      seats: 4,
    });

    const ruleCarId = withCar.legs.find(
      (leg) => leg.fromPlace === 'Иркутск, гараж',
    )!.id;

    // «Водитель» едет автобусом — это его рейс «туда».
    const onBus = await request(app.getHttpServer())
      .post(`/api/trips/${ruleTripId}/transfer/legs/${ruleBusId}/join`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);

    expect(passengerOf(onBus.body, ruleBusId, driverId)?.status).toBe('accepted');

    // Второй «туда» не сажаем — даже организатору с правом вкладки.
    const byOrganizer = await request(app.getHttpServer())
      .post(`/api/trips/${ruleTripId}/transfer/legs/${ruleCarId}/passengers`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ userId: driverId })
      .expect(400);

    expect(byOrganizer.body.message).toContain('уже определён на рейс туда');

    // Заявка — не посадка: место она не занимает, проситься можно.
    const requested = await request(app.getHttpServer())
      .post(`/api/trips/${ruleTripId}/transfer/legs/${ruleCarId}/join`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);

    expect(passengerOf(requested.body, ruleCarId, driverId)?.status).toBe(
      'requested',
    );

    // А принять её нельзя: рейс «туда» у «водителя» уже есть.
    const accepted = await request(app.getHttpServer())
      .post(`/api/trips/${ruleTripId}/transfer/legs/${ruleCarId}/passengers/${driverId}/accept`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .expect(400);

    expect(accepted.body.message).toContain('уже определён на рейс туда');

    // Заброска — не дорога от дома: этап у человека не один.
    const withStage = await createLegIn(ruleTripId, organizerToken, {
      direction: 'there',
      isStage: true,
      mode: 'train',
      departsAt: '2026-11-08T05:00:00.000Z',
      fromPlace: 'Большое Голоустное',
      toPlace: 'Сухой ручей',
      compensation: 'ticket',
      compensationAmountRub: 300,
    });

    const stageId = withStage.legs.find((leg) => leg.isStage)!.id;

    const onStage = await request(app.getHttpServer())
      .post(`/api/trips/${ruleTripId}/transfer/legs/${stageId}/join`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);

    expect(passengerOf(onStage.body, stageId, driverId)?.status).toBe('accepted');

    /**
     * На экране у второго рейса кнопки «Присоединиться» нет: правило одно,
     * и интерфейс не должен предлагать то, на что сервис ответит 400.
     */
    const third = await createLegIn(ruleTripId, organizerToken, {
      direction: 'there',
      mode: 'bus',
      departsAt: '2026-11-09T01:00:00.000Z',
      fromPlace: 'Иркутск, рынок',
      toPlace: 'Витязь',
      compensation: 'ticket',
      compensationAmountRub: 500,
    });

    const thirdBusId = third.legs.find(
      (leg) => leg.fromPlace === 'Иркутск, рынок',
    )!.id;

    const view = await planOf(ruleTripId, driverToken);

    expect(legOf(view, ruleBusId)?.joinStatus).toBeNull(); // уже едет
    expect(legOf(view, ruleCarId)?.joinStatus).toBeNull(); // там его заявка
    expect(legOf(view, thirdBusId)?.joinStatus).toBeNull(); // второй «туда» нельзя
    expect(legOf(view, stageId)?.joinStatus).toBeNull(); // уже в этапе
  });

  it('пара сажает на оба конца, и второго возвращения не бывает', async () => {
    const withPair = await createLegIn(ruleTripId, organizerToken, {
      direction: 'there',
      mode: 'car',
      departsAt: '2026-11-09T03:00:00.000Z',
      fromPlace: 'Иркутск, пара',
      toPlace: 'Витязь, пара',
      compensation: 'free',
      isRoundTrip: true,
    });

    const source = withPair.legs.find(
      (leg) => leg.isRoundTrip && leg.fromPlace === 'Иркутск, пара',
    )!;
    const mirror = withPair.legs.find((leg) => leg.sourceLegId === source.id)!;

    // Посадили в «туда» — в «обратно» «Анна» приходит автоматически.
    await request(app.getHttpServer())
      .post(`/api/trips/${ruleTripId}/transfer/legs/${source.id}/passengers`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ userId: annaId })
      .expect(200);

    const seated = await planOf(ruleTripId, annaToken);
    expect(passengerOf(seated, source.id, annaId)).toBeDefined();
    expect(passengerOf(seated, mirror.id, annaId)).toBeDefined();

    // Отдельный обратный рейс — второй «обратно», не сажаем.
    const withTrain = await createLegIn(ruleTripId, organizerToken, {
      direction: 'back',
      mode: 'train',
      departsAt: '2026-11-10T01:00:00.000Z',
      fromPlace: 'Слюдянка',
      toPlace: 'Иркутск',
      compensation: 'ticket',
      compensationAmountRub: 900,
    });

    const trainId = withTrain.legs.find(
      (leg) => leg.fromPlace === 'Слюдянка',
    )!.id;

    const blocked = await request(app.getHttpServer())
      .post(`/api/trips/${ruleTripId}/transfer/legs/${trainId}/join`)
      .set('Authorization', `Bearer ${annaToken}`)
      .expect(400);

    expect(blocked.body.message).toContain('уже определён на обратный рейс');

    // И кнопки «Присоединиться» на нём у «Анны» нет.
    expect(
      legOf(await planOf(ruleTripId, annaToken), trainId)?.joinStatus,
    ).toBeNull();

    // Сняли её с обратного конца пары — поезд стал доступен.
    await request(app.getHttpServer())
      .delete(`/api/trips/${ruleTripId}/transfer/legs/${mirror.id}/passengers/${annaId}`)
      .set('Authorization', `Bearer ${annaToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/trips/${ruleTripId}/transfer/legs/${trainId}/join`)
      .set('Authorization', `Bearer ${annaToken}`)
      .expect(200);

    /**
     * А «Пётр» уже едет обратно поездом. На прямой конец пары его тоже
     * не посадят: в зеркало он пришёл бы автоматически, и «обратно»
     * у него стало бы два. Проверка второго конца — до вставки.
     */
    await request(app.getHttpServer())
      .post(`/api/trips/${ruleTripId}/transfer/legs/${trainId}/join`)
      .set('Authorization', `Bearer ${petrToken}`)
      .expect(200);

    const withSecondPair = await createLegIn(ruleTripId, organizerToken, {
      direction: 'there',
      mode: 'car',
      departsAt: '2026-11-10T02:00:00.000Z',
      fromPlace: 'Иркутск, вторая пара',
      toPlace: 'Витязь, вторая пара',
      compensation: 'free',
      isRoundTrip: true,
    });

    const secondSource = withSecondPair.legs.find(
      (leg) => leg.isRoundTrip && leg.fromPlace === 'Иркутск, вторая пара',
    )!;

    const onPair = await request(app.getHttpServer())
      .post(`/api/trips/${ruleTripId}/transfer/legs/${secondSource.id}/passengers`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ userId: petrId })
      .expect(400);

    expect(onPair.body.message).toContain('уже определён на обратный рейс');
  });

  it('стороны не смешиваются: у «Обратно» свой порядок', async () => {
    const body = await plan(organizerToken);

    const there = body.legs.filter((leg) => leg.direction === 'there');
    const back = body.legs.filter((leg) => leg.direction === 'back');

    expect(there.length).toBeGreaterThan(0);
    expect(back.length).toBeGreaterThan(0);

    /**
     * Номера карточек в стороне свои и не повторяются — с единицы.
     * Идут они теперь не по номеру, а по времени отправления: порядок
     * задаёт дата, номер остался от прежней раскладки.
     */
    for (const section of [there, back]) {
      const positions = section.map((leg) => leg.position);

      expect(Math.min(...positions)).toBe(1);
      expect(new Set(positions).size).toBe(positions.length);
    }
  });

  it('удаление карточки: владелец свою, организатор любую', async () => {
    await request(app.getHttpServer())
      .delete(`/api/trips/${tripId}/transfer/legs/${organizerCarId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(403);

    const removed = await request(app.getHttpServer())
      .delete(`/api/trips/${tripId}/transfer/legs/${organizerCarId}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .expect(200);

    expect(legOf(removed.body, organizerCarId)).toBeUndefined();
  });

  it('уход участника уносит его ТС, а чужие карточки остаются', async () => {
    // Своя карточка участника без роли — на ней и проверим каскад. У роли
    // «водитель» флаг не проставляется сам: он распоряжается вкладкой.
    const body = await createLeg(memberToken, {
      direction: 'back',
      mode: 'horses',
      departsAt: DEPARTS,
      fromPlace: 'Витязь',
      toPlace: 'Иркутск',
      compensation: 'shared',
      compensationAmountRub: 1500,
    });

    const horses = body.legs.find((leg) => leg.mode === 'horses')!;
    expect(horses.ownerUserId).toBe(memberId);

    await dataSource.query(
      'DELETE FROM trip_participants WHERE trip_id = $1 AND user_id = $2',
      [tripId, memberId],
    );

    const after = await plan(organizerToken);

    // Своё ТС ушло вместе с владельцем, его машина — тоже.
    expect(legOf(after, horses.id)).toBeUndefined();
    expect(legOf(after, memberCarId)).toBeUndefined();
    // А рейс без владельца (общественный автобус) остался в подготовке.
    expect(legOf(after, busId)).toBeDefined();
    expect(after.travelers.map((person) => person.userId)).not.toContain(memberId);
  });

  it('в зеркало сажают автоматически, а снимают свободно', async () => {
    const body = await createLeg(organizerToken, {
      direction: 'there',
      mode: 'car',
      departsAt: DEPARTS,
      fromPlace: 'Иркутск, парк',
      toPlace: 'Витязь, тропа',
      compensation: 'shared',
      compensationAmountRub: 4000,
      isRoundTrip: true,
    });

    const source = body.legs.find(
      (leg) => leg.isRoundTrip && leg.fromPlace === 'Иркутск, парк',
    )!;
    const mirror = body.legs.find((leg) => leg.sourceLegId === source.id)!;

    expect(source.sourceLegId).toBeNull();
    expect(mirror.direction).toBe('back');
    expect(mirror.fromPlace).toBe('Витязь, тропа');
    expect(mirror.toPlace).toBe('Иркутск, парк');

    // Посадили в исходную — в зеркало он приходит автоматически.
    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${source.id}/passengers`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ userId: driverId })
      .expect(200);

    const afterAdd = await plan(organizerToken);
    expect(passengerOf(afterAdd, source.id, driverId)).toBeDefined();
    expect(passengerOf(afterAdd, mirror.id, driverId)).toBeDefined();

    // Сняли с обратного — на прямой это не влияет.
    await request(app.getHttpServer())
      .delete(`/api/trips/${tripId}/transfer/legs/${mirror.id}/passengers/${driverId}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .expect(200);

    const afterBackLeave = await plan(organizerToken);
    expect(passengerOf(afterBackLeave, source.id, driverId)).toBeDefined();
    expect(passengerOf(afterBackLeave, mirror.id, driverId)).toBeUndefined();

    // Посадили прямо в обратную — на прямой тоже не влияет.
    const onBack = await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${mirror.id}/passengers`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ userId: organizerId })
      .expect(200);

    expect(passengerOf(onBack.body, mirror.id, organizerId)).toBeDefined();
    expect(passengerOf(onBack.body, source.id, organizerId)).toBeUndefined();

    // А ушёл из исходной — исчез и из зеркала, остальные там остаются.
    await request(app.getHttpServer())
      .delete(`/api/trips/${tripId}/transfer/legs/${source.id}/passengers/${driverId}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .expect(200);

    const afterLeave = await plan(organizerToken);
    expect(passengerOf(afterLeave, source.id, driverId)).toBeUndefined();
    expect(passengerOf(afterLeave, mirror.id, driverId)).toBeUndefined();
    expect(passengerOf(afterLeave, mirror.id, organizerId)).toBeDefined();
  });

  it('карточки в секции идут по времени отправления', async () => {
    const body = await plan(organizerToken);

    for (const direction of ['there', 'back'] as const) {
      const times = body.legs
        .filter((leg) => leg.direction === direction)
        .map((leg) => new Date(leg.departsAt).getTime());

      const sorted = [...times].sort((left, right) => left - right);
      expect(times).toEqual(sorted);
    }
  });
  it('этап заброски — это рейс с флагом, а не группа', async () => {
    const body = await createLeg(organizerToken, {
      direction: 'there',
      isStage: true,
      mode: 'horses',
      departsAt: '2026-11-07T05:00:00.000Z',
      fromPlace: 'Большое Голоустное',
      toPlace: 'Сухой ручей',
      compensation: 'free',
    });

    const stage = body.legs.find((leg) => leg.fromPlace === 'Большое Голоустное')!;

    // Никаких цепочек и номеров: строка просто помечена как этап.
    expect(stage.isStage).toBe(true);
    expect(stage).not.toHaveProperty('chainId');

    // Обычный рейс рядом — с флагом false.
    const plain = await createLeg(organizerToken, {
      direction: 'there',
      mode: 'boat',
      departsAt: '2026-11-07T09:00:00.000Z',
      fromPlace: 'Сухой ручей',
      toPlace: 'мыс Витязь',
      compensation: 'free',
    });

    expect(plain.legs.find((leg) => leg.mode === 'boat')!.isStage).toBe(false);

    // И флаг можно снять — рейс вернётся в общий список.
    const moved = await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}/transfer/legs/${stage.id}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ isStage: false })
      .expect(200);

    expect(moved.body.legs.find((leg: { id: string }) => leg.id === stage.id).isStage).toBe(
      false,
    );
  });

  it('пара на рейсе — это планирование, а не общий кошелёк', async () => {
    const body = await createLeg(organizerToken, {
      direction: 'there',
      mode: 'train',
      departsAt: '2026-11-17T06:00:00.000Z',
      fromPlace: 'Иркутск, вокзал',
      toPlace: 'Слюдянка',
      compensation: 'ticket',
      compensationAmountRub: 900,
      isRoundTrip: true,
    });

    const source = body.legs.find(
      (leg) => leg.isRoundTrip && leg.fromPlace === 'Иркутск, вокзал',
    )!;
    const mirror = body.legs.find((leg) => leg.sourceLegId === source.id)!;

    // Обратный рейс есть, и он тоже с билетом.
    expect(mirror.mode).toBe('train');
    expect(mirror.compensation).toBe('ticket');

    // А цена у него своя: билеты могут отличаться.
    const repriced = await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}/transfer/legs/${mirror.id}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ compensationAmountRub: 1200 })
      .expect(200);

    const mirrorAfter = repriced.body.legs.find(
      (leg: { id: string }) => leg.id === mirror.id,
    );
    const sourceAfter = repriced.body.legs.find(
      (leg: { id: string }) => leg.id === source.id,
    );

    expect(mirrorAfter.compensationAmountRub).toBe(1200);
    expect(sourceAfter.compensationAmountRub).toBe(900);
  });

  it('удаление исходного рейса уносит обратный — у любого транспорта', async () => {
    const body = await createLeg(organizerToken, {
      direction: 'there',
      mode: 'train',
      departsAt: '2026-11-18T06:00:00.000Z',
      fromPlace: 'Иркутск, пригородный',
      toPlace: 'Байкальск',
      compensation: 'ticket',
      compensationAmountRub: 700,
      isRoundTrip: true,
    });

    const source = body.legs.find(
      (leg) => leg.isRoundTrip && leg.fromPlace === 'Иркутск, пригородный',
    )!;
    const mirror = body.legs.find((leg) => leg.sourceLegId === source.id)!;

    const removed = await request(app.getHttpServer())
      .delete(`/api/trips/${tripId}/transfer/legs/${source.id}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .expect(200);

    expect(legOf(removed.body, source.id)).toBeUndefined();
    expect(legOf(removed.body, mirror.id)).toBeUndefined();
  });

  it('флаг «туда-обратно» живёт только на рейсе «Туда»', async () => {
    /**
     * Заказчик 28.10.2026: «у обратных рейсов не должно быть флага
     * „Туда-обратно“». Пара рождается на рейсе «Туда», а обратный —
     * её зеркало; флаг на «Обратно» сделал бы «туда» из обратной карточки.
     */
    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        direction: 'back',
        mode: 'car',
        departsAt: '2026-11-19T06:00:00.000Z',
        fromPlace: 'Витязь, стоянка',
        toPlace: 'Иркутск, гараж',
        compensation: 'free',
        isRoundTrip: true,
      })
      .expect(400);

    const body = await createLeg(organizerToken, {
      direction: 'there',
      mode: 'car',
      departsAt: '2026-11-19T06:00:00.000Z',
      fromPlace: 'Иркутск, гараж',
      toPlace: 'Витязь, стоянка',
      compensation: 'free',
      isRoundTrip: true,
    });

    const source = body.legs.find(
      (leg) => leg.isRoundTrip && leg.fromPlace === 'Иркутск, гараж',
    )!;
    const mirror = body.legs.find((leg) => leg.sourceLegId === source.id)!;

    // У зеркала флага нет вовсе — включить его нельзя.
    await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}/transfer/legs/${mirror.id}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ isRoundTrip: true })
      .expect(400);

    // А сторону исходного рейса пары не меняют: у неё два конца.
    await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}/transfer/legs/${source.id}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ direction: 'back' })
      .expect(400);
  });

  it('обратный выезд не раньше прямого — у кого оба конца', async () => {
    const body = await createLeg(organizerToken, {
      direction: 'there',
      mode: 'car',
      departsAt: '2026-11-12T06:00:00.000Z',
      fromPlace: 'Иркутск, аэропорт',
      toPlace: 'Витязь, водопад',
      compensation: 'free',
      isRoundTrip: true,
    });

    const source = body.legs.find(
      (leg) => leg.isRoundTrip && leg.fromPlace === 'Иркутск, аэропорт',
    )!;
    const mirror = body.legs.find((leg) => leg.sourceLegId === source.id)!;

    // Посадили на прямой конец — он же появился на обратном.
    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${source.id}/passengers`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ userId: driverId })
      .expect(200);

    const seeded = await plan(organizerToken);
    expect(passengerOf(seeded, source.id, driverId)).toBeDefined();
    expect(passengerOf(seeded, mirror.id, driverId)).toBeDefined();

    // Вернуться раньше, чем уехал, нельзя.
    await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}/transfer/legs/${mirror.id}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ departsAt: '2026-11-11T06:00:00.000Z' })
      .expect(400);

    // Позже — можно.
    const later = await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}/transfer/legs/${mirror.id}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ departsAt: '2026-11-13T06:00:00.000Z' })
      .expect(200);

    expect(
      later.body.legs.find((leg: { id: string }) => leg.id === mirror.id).departsAt,
    ).toBe('2026-11-13T06:00:00.000Z');

    /**
     * Убрали общего человека — проверять стало нечего: у пары нет людей,
     * которые едут «туда и обратно». Обратный выезд может быть раньше.
     */
    await request(app.getHttpServer())
      .delete(`/api/trips/${tripId}/transfer/legs/${source.id}/passengers/${driverId}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}/transfer/legs/${mirror.id}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ departsAt: '2026-11-10T06:00:00.000Z' })
      .expect(200);
  });

  it('у пары одна оплата: задали на исходной — она же в зеркале', async () => {
    const body = await createLeg(organizerToken, {
      direction: 'there',
      mode: 'car',
      departsAt: '2026-11-14T06:00:00.000Z',
      fromPlace: 'Иркутск, рынок',
      toPlace: 'Витязь, ручей',
      compensation: 'free',
      isRoundTrip: true,
    });

    const source = body.legs.find(
      (leg) => leg.isRoundTrip && leg.fromPlace === 'Иркутск, рынок',
    )!;
    const mirror = body.legs.find((leg) => leg.sourceLegId === source.id)!;

    // Поставили общий расход на исходной — в зеркале он же.
    const priced = await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}/transfer/legs/${source.id}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ compensation: 'shared', compensationAmountRub: 2500 })
      .expect(200);

    const mirrorAfter = priced.body.legs.find(
      (leg: { id: string }) => leg.id === mirror.id,
    );
    expect(mirrorAfter.compensation).toBe('shared');
    expect(mirrorAfter.compensationAmountRub).toBe(2500);

    // А правка оплаты в зеркале не проходит: пара живёт ценой исходной.
    const attempt = await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}/transfer/legs/${mirror.id}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ compensation: 'free' })
      .expect(200);

    const mirrorAgain = attempt.body.legs.find(
      (leg: { id: string }) => leg.id === mirror.id,
    );
    expect(mirrorAgain.compensation).toBe('shared');
    expect(mirrorAgain.compensationAmountRub).toBe(2500);
  });

  it('пар может быть несколько: у каждой машины своя обратная', async () => {
    const before = (await plan(organizerToken)).legs.length;

    await createLeg(organizerToken, {
      direction: 'there',
      mode: 'car',
      departsAt: '2026-11-15T06:00:00.000Z',
      fromPlace: 'Иркутск, первая машина',
      toPlace: 'Витязь, перевал',
      compensation: 'free',
      isRoundTrip: true,
    });

    // Вторая машина той же группы — своя пара, а не та же самая.
    const body = await createLeg(organizerToken, {
      direction: 'there',
      mode: 'suv',
      departsAt: '2026-11-15T06:30:00.000Z',
      fromPlace: 'Иркутск, вторая машина',
      toPlace: 'Витязь, перевал',
      compensation: 'free',
      isRoundTrip: true,
    });

    // Две пары — четыре новые строки.
    expect(body.legs.length).toBe(before + 4);

    for (const place of ['Иркутск, первая машина', 'Иркутск, вторая машина']) {
      const pair = body.legs.filter(
        (leg) => leg.fromPlace === place || leg.toPlace === place,
      );
      expect(pair).toHaveLength(2);
    }
  });

  it('зеркало пары второй раз не зеркалится', async () => {
    const body = await createLeg(organizerToken, {
      direction: 'there',
      mode: 'car',
      departsAt: '2026-11-07T02:00:00.000Z',
      fromPlace: 'Иркутск, театр',
      toPlace: 'Витязь, ручей',
      compensation: 'free',
      isRoundTrip: true,
    });

    const source = body.legs.find(
      (leg) => leg.isRoundTrip && leg.fromPlace === 'Иркутск, театр',
    )!;
    const mirror = body.legs.find((leg) => leg.sourceLegId === source.id)!;

    await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}/transfer/legs/${mirror.id}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ isRoundTrip: true })
      .expect(400);
  });

  it('закрытый поход отпускает технику', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ kind: 'boat', brand: 'Прогресс' })
      .expect(201);

    const vehicleId = created.body.id as string;

    const closedTripId = (
      await dataSource.query(
        `INSERT INTO trips (organizer_user_id, goal_object_id)
         VALUES ($1, $2) RETURNING id`,
        [organizerId, objectId],
      )
    )[0].id;

    await dataSource.query(
      `INSERT INTO trip_participants (trip_id, user_id, status)
       VALUES ($1, $2, 'going')`,
      [closedTripId, organizerId],
    );

    const legId = (
      await dataSource.query(
        `INSERT INTO trip_transfer_legs
           (trip_id, direction, position, departs_at, from_place, to_place, mode, vehicle_id)
         VALUES ($1, 'there', 1, now(), 'Иркутск', 'Витязь', 'boat', $2)
         RETURNING id`,
        [closedTripId, vehicleId],
      )
    )[0].id;

    // Поход идёт — техника занята.
    await request(app.getHttpServer())
      .delete(`/api/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .expect(409);

    // Вернулись — поход закрыт, и техника свободна.
    await dataSource.query(
      `UPDATE trips
          SET actual_started_at = now(), actual_finished_at = now()
        WHERE id = $1`,
      [closedTripId],
    );

    await request(app.getHttpServer())
      .delete(`/api/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .expect(204);

    // Ссылка в карточке снята, сама карточка жива: поездка была.
    const after = await dataSource.query(
      `SELECT vehicle_id FROM trip_transfer_legs WHERE id = $1`,
      [legId],
    );
    expect(after[0].vehicle_id).toBeNull();

    await dataSource.query('DELETE FROM trips WHERE id = $1', [closedTripId]);
  });

  it('перестал идти — снят с рейсов, и машина освободилась', async () => {
    // Своё ТС водителя: флаг ставит организатор, владелец — водитель.
    const withCar = await createLeg(organizerToken, {
      direction: 'there',
      mode: 'car',
      departsAt: '2026-11-21T06:00:00.000Z',
      fromPlace: 'Иркутск, кольцо',
      toPlace: 'Витязь, кордон',
      compensation: 'free',
      isOwnVehicle: true,
      ownerUserId: driverId,
      seats: 4,
      isRoundTrip: true,
    });

    const car = withCar.legs.find((leg) => leg.fromPlace === 'Иркутск, кольцо')!;
    const mirror = withCar.legs.find((leg) => leg.sourceLegId === car.id)!;

    // Водитель сам у себя в карточке — и в обратной тоже.
    expect(passengerOf(withCar, car.id, driverId)).toBeDefined();
    expect(passengerOf(withCar, mirror.id, driverId)).toBeDefined();

    // Перестал идти: его рейсы уходят вместе с машиной.
    await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}/participants/me`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ status: 'maybe' })
      .expect(200);

    const after = await plan(organizerToken);

    expect(legOf(after, car.id)).toBeUndefined();
    expect(legOf(after, mirror.id)).toBeUndefined();

    // Ни одной карточки, где он ещё «едет», не осталось.
    expect(
      after.legs.some((leg) =>
        leg.passengers.some((person) => person.userId === driverId),
      ),
    ).toBe(false);
  });

  it('рейс вне дат похода не заводится', async () => {
    await dataSource.query(
      `UPDATE trips SET starts_at = $2, ends_at = $3 WHERE id = $1`,
      [tripId, '2026-11-25T00:00:00.000Z', '2026-11-27T21:00:00.000Z'],
    );

    try {
      // В день выезда — можно, даже рано утром.
      await createLeg(organizerToken, {
        direction: 'there',
        mode: 'bus',
        departsAt: '2026-11-25T03:00:00.000Z',
        fromPlace: 'Иркутск, автовокзал',
        toPlace: 'Витязь',
        compensation: 'ticket',
        compensationAmountRub: 700,
      });

      // За два дня до выезда — уже нет: «старт рейса вышел за рамки выезда».
      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/transfer/legs`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          direction: 'there',
          isStage: true,
          mode: 'tractor',
          departsAt: '2026-11-23T09:00:00.000Z',
          fromPlace: 'Баяндай',
          toPlace: 'Сухой ручей',
          compensation: 'free',
        })
        .expect(400);

      // И после возвращения — тоже.
      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/transfer/legs`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          direction: 'back',
          mode: 'bus',
          departsAt: '2026-11-29T09:00:00.000Z',
          fromPlace: 'Витязь',
          toPlace: 'Иркутск',
          compensation: 'ticket',
          compensationAmountRub: 700,
        })
        .expect(400);
    } finally {
      await dataSource.query(
        `UPDATE trips SET starts_at = NULL, ends_at = NULL WHERE id = $1`,
        [tripId],
      );
    }
  });

  it('смена типа переносится в обратный рейс и новых не плодит', async () => {
    const body = await createLeg(organizerToken, {
      direction: 'there',
      mode: 'train',
      departsAt: '2026-12-02T06:00:00.000Z',
      fromPlace: 'Иркутск, пригородный вокзал',
      toPlace: 'Слюдянка',
      compensation: 'ticket',
      compensationAmountRub: 300,
      isRoundTrip: true,
    });

    const source = body.legs.find(
      (leg) => leg.isRoundTrip && leg.fromPlace === 'Иркутск, пригородный вокзал',
    )!;
    const mirror = body.legs.find((leg) => leg.sourceLegId === source.id)!;
    const before = body.legs.length;

    const changed = await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}/transfer/legs/${source.id}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ mode: 'car', compensation: 'free' })
      .expect(200);

    // Ни одной новой карточки: правится та же самая.
    expect(changed.body.legs.length).toBe(before);

    const sourceAfter = changed.body.legs.find(
      (leg: { id: string }) => leg.id === source.id,
    );
    const mirrorAfter = changed.body.legs.find(
      (leg: { id: string }) => leg.id === mirror.id,
    );

    expect(sourceAfter.mode).toBe('car');
    // Пара едет одним способом: обратный тоже стал автомобилем.
    expect(mirrorAfter.mode).toBe('car');
    expect(mirrorAfter.compensation).toBe('free');
  });

  it('заброска не выходит за выезд и возвращение', async () => {
    await dataSource.query(
      `UPDATE trips SET starts_at = $2, ends_at = $3 WHERE id = $1`,
      [tripId, '2026-12-05T06:00:00.000Z', '2026-12-07T18:00:00.000Z'],
    );

    try {
      await createLeg(organizerToken, {
        direction: 'there',
        mode: 'bus',
        departsAt: '2026-12-05T06:00:00.000Z',
        fromPlace: 'Иркутск, застава',
        toPlace: 'Витязь',
        compensation: 'ticket',
        compensationAmountRub: 400,
      });

      const backTrip = await createLeg(organizerToken, {
        direction: 'back',
        mode: 'bus',
        departsAt: '2026-12-07T18:00:00.000Z',
        fromPlace: 'Витязь',
        toPlace: 'Иркутск, застава',
        compensation: 'ticket',
        compensationAmountRub: 400,
      });

      const backBusId = backTrip.legs.find(
        (leg) => leg.direction === 'back' && leg.departsAt === '2026-12-07T18:00:00.000Z',
      )!.id;

      // Трактор после возвращения группы — нельзя: вышел за день похода.
      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/transfer/legs`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          direction: 'there',
          isStage: true,
          mode: 'tractor',
          departsAt: '2026-12-08T03:00:00.000Z',
          fromPlace: 'Витязь',
          toPlace: 'Сухой ручей',
          compensation: 'free',
        })
        .expect(400);

      // Между выездом и возвращением — можно.
      await createLeg(organizerToken, {
        direction: 'there',
        isStage: true,
        mode: 'tractor',
        departsAt: '2026-12-06T03:00:00.000Z',
        fromPlace: 'Витязь',
        toPlace: 'Сухой ручей',
        compensation: 'free',
      });

      /**
       * **Заброска без участников** — только рамки похода (заказчик
       * 28.10.2026: «вещи будут вывозить, временные рамки соблюдены»).
       * 20:00 того же дня — уже после последнего обратного рейса (18:00),
       * но внутри похода: заводить можно.
       */
      const late = await createLeg(organizerToken, {
        direction: 'there',
        isStage: true,
        mode: 'tractor',
        departsAt: '2026-12-07T20:00:00.000Z',
        fromPlace: 'Витязь',
        toPlace: 'Сухой ручей',
        compensation: 'free',
      });

      const lateStage = late.legs.find(
        (leg) => leg.isStage && leg.departsAt === '2026-12-07T20:00:00.000Z',
      )!;

      /**
       * А с человеком — по человеку: «водитель» уезжает в 18:00, в 20:00
       * его уже нет, и в этот этап его не посадят.
       */
      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/transfer/legs/${backBusId}/passengers`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ userId: petrId })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/transfer/legs/${lateStage.id}/passengers`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({ userId: petrId })
        .expect(400);

      // И водителем его на этот этап не выбрать: «если был выбран Пётр
      // как водитель» — тогда его выезд в 18:00 и есть граница.
      await request(app.getHttpServer())
        .post(`/api/trips/${tripId}/transfer/legs`)
        .set('Authorization', `Bearer ${organizerToken}`)
        .send({
          direction: 'there',
          isStage: true,
          mode: 'truck',
          departsAt: '2026-12-07T20:30:00.000Z',
          fromPlace: 'Витязь, кордон',
          toPlace: 'Сухой ручей',
          compensation: 'free',
          isOwnVehicle: true,
          ownerUserId: petrId,
        })
        .expect(400);
    } finally {
      await dataSource.query(
        `UPDATE trips SET starts_at = NULL, ends_at = NULL WHERE id = $1`,
        [tripId],
      );
    }
  });

  it('чат трансфера видит только состав', async () => {
    const chats = await request(app.getHttpServer())
      .get(`/api/trips/${tripId}/chats`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .expect(200);

    const kinds = (chats.body.chats as { kind: string }[]).map((chat) => chat.kind);
    expect(kinds).toContain('trip_transfer');
    expect(kinds).toContain('trip_meals');

    await request(app.getHttpServer())
      .get(`/api/trips/${tripId}/messages`)
      .query({ kind: 'trip_transfer' })
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/trips/${tripId}/messages`)
      .query({ kind: 'trip_transfer' })
      .set('Authorization', `Bearer ${strangerToken}`)
      .expect(403);
  });
});
