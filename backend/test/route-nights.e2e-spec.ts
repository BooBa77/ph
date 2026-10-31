import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { EmailCodeService } from './../src/email/services/email-code.service';
import { SmtpService } from './../src/email/services/smtp.service';
import type { TripRouteDto } from './../src/trips/dto/trip-route.dto';

/**
 * «Ночёвки» похода (e2e) — 31.10.2026.
 *
 * Проверяем решения заказчика и правила модели:
 *
 * 1. **Таблица правится целиком.** `PUT .../route/nights` присылает все ночи
 *    по номерам, ответ — вкладка; старые варианты заменяются, а не копятся.
 * 2. **Место — одно на ночь** и только у ночи с ночлегом: у «в пути»
 *    и «идём всю ночь» района нет.
 * 3. **Варианты не смешиваются с ночным переходом**, «гостиница» и «изба» —
 *    по одной строке, одна палатка в ночи — одна строка.
 * 4. **«Палатка» и «машина» — ссылки:** палатка только из снаряжения этого
 *    похода и только типа `tent`; машина — только своё ТС из «Трансфера».
 * 5. **Готовка** — только у палатки, избы и машины.
 * 6. **Кто где живёт — одно место на весь поход** (ответ 31.10.2026):
 *    у человека одна строка, «переезд» — правка её же, а пересохранение
 *    ночей распределение не сбрасывает.
 * 7. **Заявка и согласие:** в чужую палатку — заявкой, принимает хозяин
 *    палатки или тот, кто ведёт вкладку.
 * 8. **Права:** видят участники (403 посторонним), правят те, у кого право
 *    вкладки `route`.
 * 9. **Видимость вкладки:** записанные ночи держат её открытой, пустая
 *    таблица у короткого прогноза — закрывает.
 * 10. **Уборка каскадом:** палатку убрали из похода — ушёл вариант ночи
 *     и место живущего в ней.
 *
 * Поход, состав, снаряжение и карточки «Трансфера» тест заводит напрямую
 * в базе: ручки снаряжения и трансфера проверены своими спеками.
 */
describe('Ночёвки похода (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  let organizerId: string;
  let organizerToken: string;
  let memberId: string;
  let memberToken: string;
  let annaId: string;
  let annaToken: string;
  let petrId: string;
  let petrToken: string;
  let moderatorId: string;
  let moderatorToken: string;
  let maybeId: string;
  let strangerToken: string;

  let objectId: string;
  let tripId: string;

  /** Снаряжение: палатка Анны, палатка Петра и топор (не палатка). */
  let annaTentId: string;
  let petrTentId: string;
  let axeGearId: string;

  /** «Трансфер»: своя машина и автобус — машиной ночует только своя. */
  let ownCarId: string;
  let busId: string;

  let tentTypeId: number;
  let axeTypeId: number;
  let groupId: number;

  const routeRoleCode = `routeE2e${Date.now()}`;

  let lastCode: string | null = null;

  const stamp = Date.now();
  const organizerEmail = `route-e2e-org-${stamp}@example.com`;
  const memberEmail = `route-e2e-member-${stamp}@example.com`;
  const annaEmail = `route-e2e-anna-${stamp}@example.com`;
  const petrEmail = `route-e2e-petr-${stamp}@example.com`;
  const moderatorEmail = `route-e2e-mod-${stamp}@example.com`;
  const maybeEmail = `route-e2e-maybe-${stamp}@example.com`;
  const strangerEmail = `route-e2e-stranger-${stamp}@example.com`;

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

  function planOf(trip: string, token: string): Promise<TripRouteDto> {
    return request(app.getHttpServer())
      .get(`/api/trips/${trip}/route`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .then((response) => response.body as TripRouteDto);
  }

  function plan(token: string): Promise<TripRouteDto> {
    return planOf(tripId, token);
  }

  /** Сохранить таблицу ночей и вернуть вкладку целиком. */
  async function saveNights(
    token: string,
    nights: unknown[],
  ): Promise<TripRouteDto> {
    const response = await request(app.getHttpServer())
      .put(`/api/trips/${tripId}/route/nights`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nights })
      .expect(200);

    return response.body as TripRouteDto;
  }

  /** Сохранить таблицу ночей без ожидания успеха. */
  function saveNightsRaw(token: string, nights: unknown[]) {
    return request(app.getHttpServer())
      .put(`/api/trips/${tripId}/route/nights`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nights });
  }

  function night(position: number, options: unknown[], place?: string) {
    return { position, date: '2026-11-07', ...(place ? { place } : {}), options };
  }

  /** Тип по коду: контракт экранов задаёт код, а не имя. */
  async function typeIdOf(code: string, name: string): Promise<number> {
    const existing = await dataSource.query(
      'SELECT id FROM gear_types WHERE code = $1',
      [code],
    );

    if (existing.length > 0) return existing[0].id as number;

    return (
      await dataSource.query(
        `INSERT INTO gear_types (code, name) VALUES ($1, $2) RETURNING id`,
        [code, name],
      )
    )[0].id as number;
  }

  async function addGear(
    ownerId: string,
    typeId: number,
    title: string,
    weightGrams: number,
  ): Promise<string> {
    const itemId = (
      await dataSource.query(
        `INSERT INTO gear_items
           (owner_user_id, gear_type_id, group_id, title, weight_grams)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [ownerId, typeId, groupId, title, weightGrams],
      )
    )[0].id;

    return (
      await dataSource.query(
        `INSERT INTO trip_gear (trip_id, gear_item_id, owner_user_id, status)
         VALUES ($1, $2, $3, 'approved') RETURNING id`,
        [tripId, itemId, ownerId],
      )
    )[0].id;
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

    const anna = await login(annaEmail);
    annaToken = anna.token;
    annaId = anna.id;

    const petr = await login(petrEmail);
    petrToken = petr.token;
    petrId = petr.id;

    const moderator = await login(moderatorEmail);
    moderatorToken = moderator.token;
    moderatorId = moderator.id;

    const maybe = await login(maybeEmail);
    maybeId = maybe.id;

    const stranger = await login(strangerEmail);
    strangerToken = stranger.token;

    objectId = (
      await dataSource.query(
        `INSERT INTO objects (name, type) VALUES ('Перевал для ночёвок', 'перевал') RETURNING id`,
      )
    )[0].id;

    tripId = (
      await dataSource.query(
        `INSERT INTO trips (organizer_user_id, goal_object_id, status)
         VALUES ($1, $2, 'planning') RETURNING id`,
        [organizerId, objectId],
      )
    )[0].id;

    await dataSource.query(
      `INSERT INTO trip_participants (trip_id, user_id, status)
       VALUES ($1, $2, 'going'), ($1, $3, 'going'), ($1, $4, 'going'),
              ($1, $5, 'going'), ($1, $6, 'going'), ($1, $7, 'maybe')`,
      [tripId, organizerId, memberId, annaId, petrId, moderatorId, maybeId],
    );

    /**
     * Прогноз на один день: «конкретное число» есть (вкладки открыты),
     * а ночей нет — как раз случай «дата названа, табор ещё не расписан».
     */
    await dataSource.query(
      `INSERT INTO trip_date_variants (trip_id, day, month, duration_days)
       VALUES ($1, 5, 11, 1)`,
      [tripId],
    );

    // Роль «завхоз» с правом только на «Ночёвки»: проверка «роль даёт
    // вкладку» не должна зависеть от сида.
    await dataSource.query(
      `INSERT INTO roles (code, name) VALUES ($1, 'Завхоз (тест)')`,
      [routeRoleCode],
    );
    const roleId = (
      await dataSource.query(`SELECT id FROM roles WHERE code = $1`, [
        routeRoleCode,
      ])
    )[0].id;
    await dataSource.query(
      `INSERT INTO role_tab_permissions (role_id, tab) VALUES ($1, 'route')`,
      [roleId],
    );
    await dataSource.query(
      `INSERT INTO trip_participant_roles (trip_id, user_id, role_id)
       VALUES ($1, $2, $3)`,
      [tripId, moderatorId, roleId],
    );

    // Снаряжение: полка, два типа и три вещи в походе.
    groupId = (
      await dataSource.query(
        `INSERT INTO gear_groups (code, name) VALUES ($1, 'Кров (тест)') RETURNING id`,
        [`roof_e2e_${stamp}`],
      )
    )[0].id;

    // Коды типов — контракт экранов: палатка ровно `tent`, топор — `axe`.
    // Тип мог остаться от сида, поэтому сначала ищем, потом заводим.
    tentTypeId = await typeIdOf('tent', 'Палатка');
    axeTypeId = await typeIdOf('axe', 'Топор');

    annaTentId = await addGear(annaId, tentTypeId, 'Палатка Анны', 2400);
    petrTentId = await addGear(petrId, tentTypeId, 'Палатка Петра', 3100);
    axeGearId = await addGear(petrId, axeTypeId, 'Топор Петра', 900);

    // «Трансфер»: своё ТС организатора и автобус — ночуют только в своём.
    ownCarId = (
      await dataSource.query(
        `INSERT INTO trip_transfer_legs
           (trip_id, direction, departs_at, from_place, to_place, mode,
            is_own_vehicle, owner_user_id, seats)
         VALUES ($1, 'there', now(), 'Иркутск', 'Ольхон', 'car', true, $2, 4)
         RETURNING id`,
        [tripId, organizerId],
      )
    )[0].id;

    busId = (
      await dataSource.query(
        `INSERT INTO trip_transfer_legs
           (trip_id, direction, departs_at, from_place, to_place, mode,
            is_own_vehicle, seats)
         VALUES ($1, 'there', now(), 'Иркутск', 'Ольхон', 'bus', false, 40)
         RETURNING id`,
        [tripId],
      )
    )[0].id;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query('DELETE FROM trips WHERE id = $1', [tripId]);
      await dataSource.query(
        `DELETE FROM gear_items WHERE owner_user_id = ANY($1::uuid[])`,
        [[organizerId, memberId, annaId, petrId, moderatorId]],
      );
      // Типы `tent` и `axe` — канонические коды проекта: их не удаляем,
      // вдруг они заведены сидом и нужны другим спекам.
      await dataSource.query('DELETE FROM gear_groups WHERE id = $1', [groupId]);
      await dataSource.query('DELETE FROM objects WHERE id = $1', [objectId]);
      await dataSource.query('DELETE FROM roles WHERE code = $1', [
        routeRoleCode,
      ]);
    }

    await app?.close();
  });

  it('участник видит пустую таблицу, посторонний — 403', async () => {
    const organizer = await plan(organizerToken);

    expect(organizer.nights).toEqual([]);
    expect(organizer.lodgers).toEqual([]);
    expect(organizer.canEdit).toBe(true);

    const travelerIds = organizer.travelers.map((person) => person.userId);
    expect(travelerIds).toContain(organizerId);
    expect(travelerIds).toContain(annaId);
    // «Пока не решил» жить в палатке не может: место он не занимает.
    expect(travelerIds).not.toContain(maybeId);

    expect((await plan(memberToken)).canEdit).toBe(false);

    await request(app.getHttpServer())
      .get(`/api/trips/${tripId}/route`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .expect(403);
  });

  it('ночь сохраняется целиком: номер, дата, место и палатка', async () => {
    const body = await saveNights(organizerToken, [
      night(
        1,
        [{ kind: 'tent', tentGearId: annaTentId, cooking: 'fire' }],
        '  Ольхон, у скалы  ',
      ),
    ]);

    expect(body.nights).toHaveLength(1);

    const saved = body.nights[0];
    expect(saved.position).toBe(1);
    expect(saved.date).toBe('2026-11-07');
    // Место обрезается по краям.
    expect(saved.place).toBe('Ольхон, у скалы');
    expect(saved.options).toHaveLength(1);
    expect(saved.options[0].kind).toBe('tent');
    expect(saved.options[0].tentGearId).toBe(annaTentId);
    expect(saved.options[0].tentTitle).toBe('Палатка Анны');
    expect(saved.options[0].cooking).toBe('fire');
  });

  it('таблица заменяется, а не копится', async () => {
    let body = await saveNights(organizerToken, [
      night(1, [{ kind: 'tent', tentGearId: annaTentId }]),
      night(2, [{ kind: 'hotel' }], 'Листвянка'),
    ]);

    expect(body.nights.map((item) => item.position)).toEqual([1, 2]);

    body = await saveNights(organizerToken, [night(1, [{ kind: 'transit' }])]);

    expect(body.nights).toHaveLength(1);
    expect(body.nights[0].options.map((option) => option.kind)).toEqual([
      'transit',
    ]);
  });

  it('место без ночлега — 400: у «в пути» и «идём всю ночь» района нет', async () => {
    await saveNightsRaw(organizerToken, [
      { position: 1, place: 'Байкал', options: [{ kind: 'transit' }] },
    ]).expect(400);

    await saveNightsRaw(organizerToken, [
      { position: 1, place: 'Байкал', options: [] },
    ]).expect(400);
  });

  it('ночной переход не смешивается с ночлегом', async () => {
    await saveNightsRaw(organizerToken, [
      {
        position: 1,
        options: [
          { kind: 'allnight' },
          { kind: 'tent', tentGearId: annaTentId },
        ],
      },
    ]).expect(400);
  });

  it('дубли внутри ночи: палатка, гостиница, изба', async () => {
    const send = (options: unknown[]) =>
      saveNightsRaw(organizerToken, [{ position: 1, options }]);

    await send([
      { kind: 'tent', tentGearId: annaTentId },
      { kind: 'tent', tentGearId: annaTentId },
    ]).expect(400);

    await send([{ kind: 'hotel' }, { kind: 'hotel' }]).expect(400);
    await send([{ kind: 'hut' }, { kind: 'hut' }]).expect(400);
  });

  it('палатка — только палатка из снаряжения этого похода', async () => {
    // Топор ночлегом не бывает.
    await saveNightsRaw(organizerToken, [
      { position: 1, options: [{ kind: 'tent', tentGearId: axeGearId }] },
    ]).expect(400);

    // Палатка не из этого похода — тоже 400, а не «какая-то палатка».
    await saveNightsRaw(organizerToken, [
      { position: 1, options: [{ kind: 'tent', tentGearId: '999999' }] },
    ]).expect(400);

    // Без палатки вариант невозможен.
    await saveNightsRaw(organizerToken, [
      { position: 1, options: [{ kind: 'tent' }] },
    ]).expect(400);
  });

  it('машина — только своё ТС из «Трансфера»', async () => {
    await saveNightsRaw(organizerToken, [
      { position: 1, options: [{ kind: 'car', carLegId: busId }] },
    ]).expect(400);

    await saveNightsRaw(organizerToken, [
      { position: 1, options: [{ kind: 'car' }] },
    ]).expect(400);

    const body = await saveNights(organizerToken, [
      night(1, [{ kind: 'car', carLegId: ownCarId }]),
    ]);

    expect(body.nights[0].options[0].carTitle).toBe('Иркутск → Ольхон');
  });

  it('готовка — только у палатки, избы и машины', async () => {
    await saveNightsRaw(organizerToken, [
      { position: 1, options: [{ kind: 'hotel', cooking: 'fire' }] },
    ]).expect(400);

    await saveNightsRaw(organizerToken, [
      { position: 1, options: [{ kind: 'transit', cooking: 'fire' }] },
    ]).expect(400);

    // У избы готовка законна.
    const body = await saveNights(organizerToken, [
      night(1, [{ kind: 'hut', cooking: 'both' }], 'Изба у реки'),
    ]);

    expect(body.nights[0].options[0].cooking).toBe('both');
  });

  it('правка таблицы — только с правом вкладки', async () => {
    await saveNightsRaw(memberToken, [
      { position: 1, options: [] },
    ]).expect(403);

    // Роль с вкладкой `route` право даёт.
    const body = await saveNights(moderatorToken, [
      night(1, [{ kind: 'tent', tentGearId: petrTentId }]),
    ]);

    expect(body.nights).toHaveLength(1);
  });

  it('себя в свою палатку — живёшь сразу, в чужую — заявкой', async () => {
    let body = await request(app.getHttpServer())
      .put(`/api/trips/${tripId}/route/lodgers/${annaId}`)
      .set('Authorization', `Bearer ${annaToken}`)
      .send({ tentGearId: annaTentId })
      .expect(200);

    let lodger = (body.body as TripRouteDto).lodgers.find(
      (person) => person.userId === annaId,
    );
    expect(lodger?.status).toBe('accepted');
    expect(lodger?.tentGearId).toBe(annaTentId);

    body = await request(app.getHttpServer())
      .put(`/api/trips/${tripId}/route/lodgers/${memberId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ tentGearId: annaTentId })
      .expect(200);

    lodger = (body.body as TripRouteDto).lodgers.find(
      (person) => person.userId === memberId,
    );
    expect(lodger?.status).toBe('requested');
  });

  it('заявку принимает хозяин палатки, посторонний — 403', async () => {
    await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/route/lodgers/${memberId}/accept`)
      .set('Authorization', `Bearer ${petrToken}`)
      .expect(403);

    const body = await request(app.getHttpServer())
      .post(`/api/trips/${tripId}/route/lodgers/${memberId}/accept`)
      .set('Authorization', `Bearer ${annaToken}`)
      .expect(200);

    const lodger = (body.body as TripRouteDto).lodgers.find(
      (person) => person.userId === memberId,
    );
    expect(lodger?.status).toBe('accepted');
  });

  it('чужого в чужую палатку сажает только хозяин или ведущий вкладку', async () => {
    // Не хозяин палатки и не ведущий вкладку — 403.
    await request(app.getHttpServer())
      .put(`/api/trips/${tripId}/route/lodgers/${petrId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ tentGearId: annaTentId })
      .expect(403);

    const body = await request(app.getHttpServer())
      .put(`/api/trips/${tripId}/route/lodgers/${petrId}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ tentGearId: annaTentId })
      .expect(200);

    const lodger = (body.body as TripRouteDto).lodgers.find(
      (person) => person.userId === petrId,
    );
    expect(lodger?.status).toBe('accepted');
  });

  it('одно место на поход: переезд правит ту же строку', async () => {
    const body = await request(app.getHttpServer())
      .put(`/api/trips/${tripId}/route/lodgers/${petrId}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ tentGearId: petrTentId })
      .expect(200);

    const rows = (body.body as TripRouteDto).lodgers.filter(
      (person) => person.userId === petrId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].tentGearId).toBe(petrTentId);
  });

  it('распределение переживает пересохранение ночей', async () => {
    const body = await saveNights(organizerToken, [
      night(1, [{ kind: 'tent', tentGearId: annaTentId }]),
      night(2, [{ kind: 'tent', tentGearId: petrTentId }]),
    ]);

    const ids = body.lodgers.map((person) => person.userId);
    expect(ids).toContain(annaId);
    expect(ids).toContain(memberId);
    expect(ids).toContain(petrId);
  });

  it('«пока не решил» жить не может — 400', async () => {
    await request(app.getHttpServer())
      .put(`/api/trips/${tripId}/route/lodgers/${maybeId}`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ tentGearId: annaTentId })
      .expect(400);
  });

  it('освободить место: сам и ведущий вкладку могут, чужой — нет', async () => {
    await request(app.getHttpServer())
      .delete(`/api/trips/${tripId}/route/lodgers/${annaId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(403);

    const body = await request(app.getHttpServer())
      .delete(`/api/trips/${tripId}/route/lodgers/${memberId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);

    expect(
      (body.body as TripRouteDto).lodgers.some(
        (person) => person.userId === memberId,
      ),
    ).toBe(false);

    // Повторное освобождение ничего не ломает.
    await request(app.getHttpServer())
      .delete(`/api/trips/${tripId}/route/lodgers/${memberId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);
  });

  it('палатку убрали из похода — ушёл вариант и место живущего', async () => {
    await dataSource.query('DELETE FROM trip_gear WHERE id = $1', [petrTentId]);

    const body = await plan(organizerToken);
    const tentIds = body.nights.flatMap((item) =>
      item.options.map((option) => option.tentGearId),
    );

    expect(tentIds).not.toContain(petrTentId);
    expect(
      body.lodgers.some((person) => person.tentGearId === petrTentId),
    ).toBe(false);
  });

  it('вкладка «Ночёвки» видна по записанным ночам и скрыта при пустой таблице', async () => {
    const withNights = await request(app.getHttpServer())
      .get(`/api/trips/${tripId}/tabs`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .expect(200);

    expect(
      withNights.body.tabs.some((tab: { code: string }) => tab.code === 'route'),
    ).toBe(true);

    // Прогноз на один день — ночей нет: пустая таблица вкладку не открывает.
    await saveNights(organizerToken, []);

    const withoutNights = await request(app.getHttpServer())
      .get(`/api/trips/${tripId}/tabs`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .expect(200);

    expect(
      withoutNights.body.tabs.some(
        (tab: { code: string }) => tab.code === 'route',
      ),
    ).toBe(false);
  });
});
