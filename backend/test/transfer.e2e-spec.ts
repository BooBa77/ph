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
 * «Трансфер» похода (e2e) — вторая редакция, 27.10.2026.
 *
 * Проверяем решения заказчика по новой раскладке вкладки:
 *
 * 1. **Карточка = перемещение.** Сторона (`there` / `back`), способ доставки,
 *    время, откуда и куда хранятся в одной строке; машины отдельной
 *    сущности больше нет.
 * 2. **Обязательные поля**: время отправления, откуда, докуда. Без них 400,
 *    а не карточка-пожелание.
 * 3. **«Наше ТС»** — флаг организатора; участник свой транспорт получает
 *    с флагом сам, а рейс (автобус, ж/д, корабль, вертолёт) заводит без
 *    флага — и вручную флаг поставить не может.
 * 4. **Компенсация**: цена билета только у рейсов, общие расходы только
 *    у своего транспорта, «туда-обратно» только у общих, сумма нужна
 *    всему, кроме «безвозмездно».
 * 5. **Присоединение**: на рейс — сразу, на чужое ТС — заявкой; принимает
 *    владелец ТС, уйти человек может сам.
 * 6. **Места**: заполненные не пускают сверх счёта — ни заявкой, ни
 *    принятием.
 * 7. **Уход участника**: его ТС уходит с ним, чужие карточки остаются.
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
  let maybeId: string;
  let maybeToken: string;
  let strangerToken: string;

  let objectId: string;
  let tripId: string;

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

  function passengerOf(body: TripTransferDto, legId: string, userId: string) {
    return legOf(body, legId)?.passengers.find((person) => person.userId === userId);
  }

  /** Создать карточку и вернуть ответ целиком. */
  async function createLeg(
    token: string,
    body: Record<string, unknown>,
  ): Promise<TripTransferDto> {
    const response = await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs`)
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(200);

    return response.body as TripTransferDto;
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
              ($1, $5, 'maybe')`,
      [tripId, organizerId, driverId, memberId, maybeId],
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
      await dataSource.query('DELETE FROM trips WHERE id = $1', [tripId]);
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

  it('компенсация: что с чем сочетается', async () => {
    const base = {
      direction: 'back',
      departsAt: DEPARTS,
      fromPlace: 'Витязь',
      toPlace: 'Иркутск',
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

    // «Туда-обратно» — только у общих расходов.
    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        ...base,
        mode: 'bus',
        compensation: 'ticket',
        compensationAmountRub: 500,
        isRoundTrip: true,
      })
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

    // «Туда-обратно» у общих расходов — можно.
    const round = await createLeg(organizerToken, {
      ...base,
      mode: 'boat',
      compensation: 'sharedPerPassenger',
      compensationAmountRub: 1200,
      isRoundTrip: true,
    });

    const boat = round.legs.find((leg) => leg.mode === 'boat')!;
    expect(boat.isRoundTrip).toBe(true);
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
    const onBus = await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${busId}/join`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .expect(200);

    expect(passengerOf(onBus.body, busId, organizerId)?.status).toBe('accepted');

    const onCar = await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${memberCarId}/join`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .expect(200);

    expect(passengerOf(onCar.body, memberCarId, organizerId)?.status).toBe('requested');
    // Заявка место не занимает.
    expect(legOf(onCar.body, memberCarId)?.occupied).toBe(1);

    // Повторно — 409.
    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${memberCarId}/join`)
      .set('Authorization', `Bearer ${organizerToken}`)
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
      .post(`/api/trips/${tripId}/transfer/legs/${memberCarId}/passengers/${organizerId}/accept`)
      .set('Authorization', `Bearer ${maybeToken}`)
      .expect(403);

    const accepted = await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${memberCarId}/passengers/${organizerId}/accept`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);

    expect(passengerOf(accepted.body, memberCarId, organizerId)?.status).toBe(
      'accepted',
    );
    expect(legOf(accepted.body, memberCarId)?.occupied).toBe(2);

    // Владелец ужал места до двух — третьего уже не посадить.
    await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}/transfer/legs/${memberCarId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ seats: 2 })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${memberCarId}/join`)
      .set('Authorization', `Bearer ${driverToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/transfer/legs/${memberCarId}/passengers/${driverId}/accept`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(400);
  });

  it('уйти человек может сам, а владельца убирают с карточкой', async () => {
    const left = await request(app.getHttpServer())
      .delete(`/api/trips/${tripId}/transfer/legs/${memberCarId}/passengers/${organizerId}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .expect(200);

    expect(passengerOf(left.body, memberCarId, organizerId)).toBeUndefined();

    // Владельца своего ТС из пассажиров не убирают — он уходит с карточкой.
    await request(app.getHttpServer())
      .delete(`/api/trips/${tripId}/transfer/legs/${memberCarId}/passengers/${memberId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(400);

    // Чужого человека без права вкладки не убрать (у «водителя» роль есть,
    // поэтому проверяем участником без роли).
    await request(app.getHttpServer())
      .delete(`/api/trips/${tripId}/transfer/legs/${busId}/passengers/${organizerId}`)
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
      .send({ userId: driverId })
      .expect(200);

    expect(passengerOf(seated.body, busId, driverId)?.status).toBe('accepted');
  });

  it('стороны не смешиваются: у «Обратно» свой порядок', async () => {
    const body = await plan(organizerToken);

    const there = body.legs.filter((leg) => leg.direction === 'there');
    const back = body.legs.filter((leg) => leg.direction === 'back');

    expect(there.length).toBeGreaterThan(0);
    expect(back.length).toBeGreaterThan(0);
    // Порядок внутри стороны — свой, начиная с единицы.
    expect(back.map((leg) => leg.position)).toEqual(
      back.map((_, index) => index + 1),
    );
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
