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
 * «Трансфер» похода (e2e) — Ф7, вкладка `transfer`.
 *
 * Проверяем решения, согласованные 27.10.2026 (`docs/ph/transfer.md`):
 *
 * 1. **Строку заводит право вкладки**, а не любой участник: «кто ведёт
 *    трансфер» — это роль или организатор.
 * 2. **Свою машину водитель правит сам**, даже без права на вкладку;
 *    чужую — нет. Именно поэтому право считается по машине, а не по роли.
 * 3. **Сажают только «иду»**: «пока не решил» место в машине не занимает.
 * 4. **Места считаются вместе с водителем**, и у наёмной машины место
 *    водителя тоже занято, хотя аккаунта у него нет.
 * 5. **Пассажир снимает себя сам** — это и есть «может отказаться».
 * 6. **Убрали машину — пассажиры остались в строке нераспределёнными**,
 *    а уход участника унёс его машину каскадом (внешние ключи).
 * 7. **«Вернуться так же»** — копия строки с обратными точками, машинами и
 *    людьми, но **без даты**.
 * 8. **Чат трансфера** видит только состав.
 *
 * Поход, состав и чаты тест заводит напрямую в базе: видимость похода и
 * создание чатов проверены в `trips.e2e-spec.ts`, здесь важно само
 * устройство вкладки.
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
  let ownerId: string;
  let ownerToken: string;
  let maybeId: string;
  let strangerToken: string;

  let objectId: string;
  let tripId: string;

  /** Строки и машины, которые заводятся по ходу тестов. */
  let legId: string;
  let busLegId: string;
  let ownCarId: string;
  let hiredCarId: string;

  const transferRoleCode = `transferE2e${Date.now()}`;

  let lastCode: string | null = null;

  const stamp = Date.now();
  const organizerEmail = `transfer-e2e-org-${stamp}@example.com`;
  const driverEmail = `transfer-e2e-driver-${stamp}@example.com`;
  const memberEmail = `transfer-e2e-member-${stamp}@example.com`;
  const ownerEmail = `transfer-e2e-owner-${stamp}@example.com`;
  const maybeEmail = `transfer-e2e-maybe-${stamp}@example.com`;
  const strangerEmail = `transfer-e2e-stranger-${stamp}@example.com`;

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
  async function plan(token: string): Promise<TripTransferDto> {
    const response = await request(app.getHttpServer())
      .get(`/api/trips/${tripId}/transfer`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    return response.body as TripTransferDto;
  }

  function legOf(body: TripTransferDto, id: string) {
    return body.legs.find((leg) => leg.id === id);
  }

  function passengerOf(body: TripTransferDto, leg: string, userId: string) {
    return legOf(body, leg)?.passengers.find((person) => person.userId === userId);
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

    const owner = await login(ownerEmail);
    ownerToken = owner.token;
    ownerId = owner.id;

    const maybe = await login(maybeEmail);
    maybeId = maybe.id;

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
              ($1, $5, 'going'), ($1, $6, 'maybe')`,
      [tripId, organizerId, driverId, memberId, ownerId, maybeId],
    );

    /**
     * Роль «водитель» с правом только на «Трансфер»: проверка «роль даёт
     * вкладку» не должна зависеть от сида. У `owner` роли нет — на нём
     * проверяется право по машине, а не по матрице.
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

    /** Чаты похода: прямой INSERT их не создаёт, а вкладке нужен свой. */
    await dataSource.query(
      `INSERT INTO conversations (kind, trip_id)
       VALUES ('trip_guest', $1), ('trip_members', $1),
              ('trip_meals', $1), ('trip_transfer', $1)`,
      [tripId],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query('DELETE FROM trips WHERE id = $1', [tripId]);
      await dataSource.query('DELETE FROM objects WHERE id = $1', [objectId]);
      await dataSource.query('DELETE FROM roles WHERE code = $1', [
        transferRoleCode,
      ]);
    }

    await app?.close();
  });

  it('участник видит пустую вкладку, гость — нет', async () => {
    const organizer = await plan(organizerToken);

    expect(organizer.legs).toEqual([]);
    expect(organizer.canEdit).toBe(true);
    expect(organizer.meetingPlace).toBeNull();

    // Кого можно посадить: только идущие, и «пока не решил» сюда не входит.
    const travelerIds = organizer.travelers.map((person) => person.userId);
    expect(travelerIds).toContain(organizerId);
    expect(travelerIds).toContain(driverId);
    expect(travelerIds).toContain(memberId);
    expect(travelerIds).toContain(ownerId);
    expect(travelerIds).not.toContain(maybeId);

    // Участнику правка не положена: он просто видит вкладку.
    expect((await plan(memberToken)).canEdit).toBe(false);

    await request(app.getHttpServer())
      .get(`/api/trips/${tripId}/transfer`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .expect(403);
  });

  it('строку заводит право вкладки, а не любой участник', async () => {
    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ mode: 'car', fromPlace: 'Иркутск', toPlace: 'Витязь' })
      .expect(403);

    const created = await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        mode: 'car',
        fromPlace: '  Иркутск, автовокзал  ',
        toPlace: 'Олхинское плато, Витязь',
        note: 'сбор у первой платформы',
      })
      .expect(200);

    const body = created.body as TripTransferDto;
    expect(body.legs).toHaveLength(1);
    expect(body.legs[0].position).toBe(1);
    // Точки обрезаются по краям: лишние пробелы в данных не нужны.
    expect(body.legs[0].fromPlace).toBe('Иркутск, автовокзал');
    // Даты нет — «время уточняется», а не ошибка.
    expect(body.legs[0].departsAt).toBeNull();

    legId = body.legs[0].id;

    // Роль с правом вкладки строку тоже заводит.
    const byDriver = await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ mode: 'bus', fromPlace: 'Витязь', toPlace: 'Иркутск' })
      .expect(200);

    busLegId = (byDriver.body as TripTransferDto).legs[1].id;
    expect((byDriver.body as TripTransferDto).legs).toHaveLength(2);

    // Мусор в теле — 400, а не 500.
    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ mode: 'вертолёт', fromPlace: 'Иркутск', toPlace: 'Витязь' })
      .expect(400);
  });

  it('строку правят и стирают поля, машины у не-авто запрещены', async () => {
    await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}/transfer/legs/${legId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ fromPlace: 'Иркутск' })
      .expect(403);

    const changed = await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}/transfer/legs/${legId}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ fromPlace: 'Иркутск, ж/д вокзал', note: 'сбор у касс' })
      .expect(200);

    expect(legOf(changed.body, legId)?.fromPlace).toBe('Иркутск, ж/д вокзал');
    expect(legOf(changed.body, legId)?.note).toBe('сбор у касс');

    // `null` — осознанная очистка, как у похода.
    const cleared = await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}/transfer/legs/${legId}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ note: null })
      .expect(200);

    expect(legOf(cleared.body, legId)?.note).toBeNull();

    // Машины у автобуса: 400 с понятным текстом, а не внешний ключ.
    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${busLegId}/cars`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ ownership: 'own', driverUserId: organizerId })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}/transfer/legs/99999`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ note: 'нет такой строки' })
      .expect(404);
  });

  it('свою машину водитель заводит и правит сам, без права вкладки', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${legId}/cars`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ownership: 'own', driverUserId: ownerId, seats: 2 })
      .expect(200);

    const body = created.body as TripTransferDto;
    ownCarId = legOf(body, legId)!.cars[0].id;

    // Водитель занимает место в своей машине с того момента, как её завёл.
    expect(legOf(body, legId)?.cars[0].occupied).toBe(1);
    expect(passengerOf(body, legId, ownerId)?.carId).toBe(ownCarId);
    // Право на эту машину считается по машине: она его.
    expect(legOf(body, legId)?.cars[0].canEdit).toBe(true);
    // А вкладку целиком он не правит: роли нет.
    expect(body.canEdit).toBe(false);

    // Свою машину он правит и дальше — тоже без права на вкладку.
    const edited = await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}/transfer/cars/${ownCarId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ seats: 3, driverPhone: '+7 902 000-11-22' })
      .expect(200);

    expect(legOf(edited.body, legId)?.cars[0].seats).toBe(3);

    // Свою машину заводит и участник без права на вкладку: «я поеду
    // на своей» — его решение, а не распоряжение организатора.
    const ownCar = await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${legId}/cars`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ ownership: 'own', driverUserId: memberId })
      .expect(200);

    // ...а наёмную — только тот, кому роль дала вкладку.
    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${legId}/cars`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ ownership: 'hired', driverName: 'Сергей' })
      .expect(403);

    // Убираем за собой: машину — организатор, человека — тоже он.
    const memberCar = legOf(ownCar.body, legId)!.cars.find(
      (car) => car.driverUserId === memberId,
    )!;
    await request(app.getHttpServer())
      .delete(`/api/trips/${tripId}/transfer/cars/${memberCar.id}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/api/trips/${tripId}/transfer/legs/${legId}/passengers/${memberId}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .expect(200);
  });

  it('наёмной машине нужно имя, и её водитель тоже занимает место', async () => {
    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${legId}/cars`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ ownership: 'hired' })
      .expect(400);

    const created = await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${legId}/cars`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        ownership: 'hired',
        driverName: '  Сергей  ',
        driverPhone: '+7 902 111-22-33',
        seats: 4,
      })
      .expect(200);

    const body = created.body as TripTransferDto;
    const hired = legOf(body, legId)!.cars.find((car) => car.ownership === 'hired')!;
    hiredCarId = hired.id;

    expect(hired.driverUserId).toBeNull();
    expect(hired.driverName).toBe('Сергей');
    // Место наёмного водителя занято, хотя аккаунта у него нет.
    expect(hired.occupied).toBe(1);
    expect(hired.seats).toBe(4);

    // Чужой человек эту машину не правит: своей она ему не приходится.
    await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}/transfer/cars/${hiredCarId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ seats: 9 })
      .expect(403);
  });

  it('сажают только идущих, и место в машине — по счёту', async () => {
    // «Пока не решил» место не занимает.
    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${legId}/passengers`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ userId: maybeId })
      .expect(400);

    // Себя можно добавить самому, а другого — только ведущему.
    const added = await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${legId}/passengers`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ userId: memberId })
      .expect(200);

    expect(passengerOf(added.body, legId, memberId)?.carId).toBeNull();

    // Себя в строку он поставил, а сесть в чужую машину без водителя —
    // не может: место даёт водитель, он и выбирает пассажиров.
    await request(app.getHttpServer())
      .put(`/api/trips/${tripId}/transfer/legs/${legId}/passengers/${memberId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ carId: Number(ownCarId) })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${legId}/passengers`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ userId: driverId })
      .expect(403);

    // Повторно того же человека — 409, а не вторая строка.
    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${legId}/passengers`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ userId: memberId })
      .expect(409);

    // Своя машина «на троих»: водитель + пассажир = 2 места, третье свободно.
    const seat = await request(app.getHttpServer())
      .put(`/api/trips/${tripId}/transfer/legs/${legId}/passengers/${memberId}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ carId: Number(ownCarId) })
      .expect(200);

    expect(passengerOf(seat.body, legId, memberId)?.carId).toBe(ownCarId);
    expect(
      legOf(seat.body, legId)!.cars.find((car) => car.id === ownCarId)?.occupied,
    ).toBe(2);

    // Третьего в неё сажаем, четвёртого — уже нет: 400 «нет мест».
    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${legId}/passengers`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ userId: driverId })
      .expect(200);

    await request(app.getHttpServer())
      .put(`/api/trips/${tripId}/transfer/legs/${legId}/passengers/${driverId}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ carId: Number(ownCarId) })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${legId}/passengers`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ userId: organizerId })
      .expect(200);

    await request(app.getHttpServer())
      .put(`/api/trips/${tripId}/transfer/legs/${legId}/passengers/${organizerId}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ carId: Number(ownCarId) })
      .expect(400);
  });

  it('машина из другой строки — 400, а не чужое место', async () => {
    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${busLegId}/passengers`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ userId: memberId })
      .expect(200);

    await request(app.getHttpServer())
      .put(
        `/api/trips/${tripId}/transfer/legs/${busLegId}/passengers/${memberId}`,
      )
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ carId: Number(ownCarId) })
      .expect(400);

    // `null` — обратно «без машины», и это не ошибка.
    const freed = await request(app.getHttpServer())
      .put(`/api/trips/${tripId}/transfer/legs/${legId}/passengers/${memberId}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ carId: null })
      .expect(200);

    expect(passengerOf(freed.body, legId, memberId)?.carId).toBeNull();
  });

  it('пассажир снимает себя сам — это и есть «может отказаться»', async () => {
    const dropped = await request(app.getHttpServer())
      .delete(`/api/trips/${tripId}/transfer/legs/${legId}/passengers/${memberId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);

    expect(passengerOf(dropped.body, legId, memberId)).toBeUndefined();

    // А чужого человека без права вкладки снять нельзя.
    await request(app.getHttpServer())
      .delete(`/api/trips/${tripId}/transfer/legs/${legId}/passengers/${driverId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(403);
  });

  it('«вернуться так же» копирует строку с обратными точками и без даты', async () => {
    const before = await plan(organizerToken);
    const source = legOf(before, legId)!;
    const carCount = source.cars.length;
    const peopleCount = source.passengers.length;

    const returned = await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${legId}/return`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .expect(200);

    const body = returned.body as TripTransferDto;
    const copy = body.legs[body.legs.length - 1];

    // Строк было две (авто и автобус), копия — третья.
    expect(body.legs).toHaveLength(3);
    expect(copy.fromPlace).toBe(source.toPlace);
    expect(copy.toPlace).toBe(source.fromPlace);
    // Дату обратного выезда не выдумываем.
    expect(copy.departsAt).toBeNull();
    expect(copy.cars).toHaveLength(carCount);
    expect(copy.passengers).toHaveLength(peopleCount);
    // Пассажиры копий машин остаются в своих копиях, а не «без машины».
    expect(copy.passengers.filter((person) => person.carId !== null)).toHaveLength(
      source.passengers.filter((person) => person.carId !== null).length,
    );

    // Копию убираем: дальше счёт ведётся по двум строкам.
    await request(app.getHttpServer())
      .delete(`/api/trips/${tripId}/transfer/legs/${copy.id}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .expect(200);
  });

  it('убрали машину — пассажиры остались в строке нераспределёнными', async () => {
    // Сажаем организатора в наёмную машину: там уже занято место водителя.
    const seated = await request(app.getHttpServer())
      .put(`/api/trips/${tripId}/transfer/legs/${legId}/passengers/${organizerId}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ carId: Number(hiredCarId) })
      .expect(200);

    expect(passengerOf(seated.body, legId, organizerId)?.carId).toBe(hiredCarId);

    const before = seated.body as TripTransferDto;
    const ownedByHired = legOf(before, legId)!.passengers.filter(
      (person) => person.carId === hiredCarId,
    );
    expect(ownedByHired.length).toBeGreaterThan(0);

    const after = await request(app.getHttpServer())
      .delete(`/api/trips/${tripId}/transfer/cars/${hiredCarId}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .expect(200);

    const body = after.body as TripTransferDto;
    expect(legOf(body, legId)!.cars.map((car) => car.id)).not.toContain(hiredCarId);

    for (const person of ownedByHired) {
      // Человек на месте, но места у него больше нет.
      expect(passengerOf(body, legId, person.userId)?.carId).toBeNull();
    }
  });

  it('уход участника уносит его машину каскадом', async () => {
    await dataSource.query(
      'DELETE FROM trip_participants WHERE trip_id = $1 AND user_id = $2',
      [tripId, ownerId],
    );

    const body = await plan(organizerToken);

    // Машина ушла вместе с водителем, а сама строка осталась.
    expect(legOf(body, legId)).toBeDefined();
    expect(legOf(body, legId)!.cars.map((car) => car.id)).not.toContain(ownCarId);
    // Ушедшего нет ни в строке, ни в списке «кого посадить».
    expect(passengerOf(body, legId, ownerId)).toBeUndefined();
    expect(body.travelers.map((person) => person.userId)).not.toContain(ownerId);
  });

  it('удаление строки убирает её машины и пассажиров', async () => {
    const removed = await request(app.getHttpServer())
      .delete(`/api/trips/${tripId}/transfer/legs/${legId}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .expect(200);

    const body = removed.body as TripTransferDto;
    expect(legOf(body, legId)).toBeUndefined();
    expect(body.legs.map((leg) => leg.id)).toEqual([busLegId]);

    const cars = await dataSource.query(
      'SELECT id FROM trip_transfer_cars WHERE leg_id = $1',
      [legId],
    );
    const passengers = await dataSource.query(
      'SELECT id FROM trip_transfer_passengers WHERE leg_id = $1',
      [legId],
    );
    expect(cars).toHaveLength(0);
    expect(passengers).toHaveLength(0);
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
