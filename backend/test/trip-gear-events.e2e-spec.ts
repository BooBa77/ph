import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { EmailCodeService } from './../src/email/services/email-code.service';
import { SmtpService } from './../src/email/services/smtp.service';
import { TripEventsService } from './../src/trips/trip-events.service';

/**
 * Живые изменения вкладок «Снаряжение» и «Питание» (e2e, 06.11.2026,
 * «Питание» — 12.11.2026).
 *
 * Заказчик: «пришло время SSE. Участники перетасовывают вещи и нужно видеть
 * изменения онлайн», а про закупку: две группы в соседних магазинах должны
 * видеть отметки друг друга. Проверяем то, что нельзя проверить юнитом:
 *
 * 1. **HTTP-поток действительно открывается и отдаёт кадр** — заголовки,
 *    первый `retry:` и `event: trip` после чужого `PATCH`. Supertest
 *    незавершающийся ответ не умеет, поэтому приложение поднимается
 *    на настоящем порту, а поток читается `fetch`-ом.
 * 2. **Посторонний в поток не попадает** — 403 до первого байта: правило
 *    доступа то же, что у `GET /gear` и `GET /meal-plan`.
 * 3. **Чат снаряжения открыт участнику и закрыт постороннему** — новый
 *    вид чата `trip_gear` и его подпись в списке чатов похода.
 *
 * Чек-листы шлют событие в тот же канал; это проверяется подпиской прямо
 * на `TripEventsService` — второй поток ради одного кадра не нужен.
 *
 * Поход и состав заводятся напрямую в базе: правило видимости похода
 * проверено в `trips.e2e-spec.ts`, здесь — транспорт и события.
 */
describe('Живые изменения снаряжения (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let baseUrl: string;

  let organizerId: string;
  let organizerToken: string;
  let memberId: string;
  let memberToken: string;
  let strangerId: string;
  let strangerToken: string;

  let objectId: string;
  let tripId: string;
  let gearRowId: string;
  let typeId: number;

  let lastCode: string | null = null;

  const organizerEmail = `gear-events-org-${Date.now()}@example.com`;
  const memberEmail = `gear-events-member-${Date.now()}@example.com`;
  const strangerEmail = `gear-events-stranger-${Date.now()}@example.com`;

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

    // Поток нельзя прочитать через supertest: ответ не заканчивается.
    // Поэтому настоящее прослушивание на свободном порту.
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    dataSource = moduleFixture.get(DataSource);

    const emailCodeService = moduleFixture.get(EmailCodeService);
    const realCreateCode = emailCodeService.createCode.bind(emailCodeService);
    vi.spyOn(emailCodeService, 'createCode').mockImplementation((mail) => {
      lastCode = realCreateCode(mail);
      return lastCode;
    });

    const organizer = await login(organizerEmail);
    organizerId = organizer.id;
    organizerToken = organizer.token;

    const member = await login(memberEmail);
    memberId = member.id;
    memberToken = member.token;

    const stranger = await login(strangerEmail);
    strangerId = stranger.id;
    strangerToken = stranger.token;

    typeId = (
      await dataSource.query(
        `INSERT INTO gear_types (code, name) VALUES ('e2e_events_plain', 'Вещь для потока')
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
      )
    )[0].id;

    objectId = (
      await dataSource.query(
        `INSERT INTO objects (name, type) VALUES ('Вершина для потока', 'вершина') RETURNING id`,
      )
    )[0].id;

    tripId = (
      await dataSource.query(
        `INSERT INTO trips (organizer_user_id, goal_object_id, visibility)
         VALUES ($1, $2, 'public') RETURNING id`,
        [organizerId, objectId],
      )
    )[0].id;

    await dataSource.query(
      `INSERT INTO trip_participants (trip_id, user_id, status)
       VALUES ($1, $2, 'going'), ($1, $3, 'going')`,
      [tripId, organizerId, memberId],
    );

    // Чат снаряжения у похода, заведённого напрямую: миграция заводит его
    // существующим походам, `POST /trips` — новым, а тест создаёт строку
    // мимо сервиса. Здесь проверяем доступ и подпись, а не засев.
    await dataSource.query(
      `INSERT INTO conversations (kind, trip_id) VALUES ('trip_gear', $1)`,
      [tripId],
    );

    const item = await call('post', '/api/gear', organizerToken, {
      typeId,
      title: 'Верёвка для потока',
      weightGrams: 1200,
    }).expect(201);

    const proposed = await call(
      'post',
      `/api/trips/${tripId}/gear`,
      organizerToken,
      { gearItemId: Number(item.body.id) },
    ).expect(201);

    gearRowId = proposed.body.id as string;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query('DELETE FROM trips WHERE id = $1', [tripId]);
      await dataSource.query(
        'DELETE FROM gear_items WHERE owner_user_id = ANY($1::uuid[])',
        [[organizerId, memberId]],
      );
      await dataSource.query(
        `DELETE FROM gear_types WHERE code = 'e2e_events_plain'`,
      );
      await dataSource.query('DELETE FROM objects WHERE id = $1', [objectId]);
      await dataSource.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        [organizerId, memberId, strangerId],
      ]);
    }

    await app?.close();
  });

  /** Читать поток, пока в накопленном тексте не появится `needle`. */
  async function readUntil(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    needle: string,
  ): Promise<string> {
    const decoder = new TextDecoder();
    let buffer = '';

    while (!buffer.includes(needle)) {
      const chunk = await reader.read();
      if (chunk.done) break;

      buffer += decoder.decode(chunk.value, { stream: true });
    }

    return buffer;
  }

  it(
    'участник получает событие о чужом перетаскивании вещи',
    async () => {
      const controller = new AbortController();
      const response = await fetch(
        `${baseUrl}/api/trips/${tripId}/gear/events`,
        {
          headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${memberToken}`,
          },
          signal: controller.signal,
        },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain(
        'text/event-stream',
      );
      // nginx: без этого заголовка поток копится в буфере и «онлайн» врёт.
      expect(response.headers.get('x-accel-buffering')).toBe('no');

      const reader = response.body!.getReader();

      // Первым кадром сервер просит переподключиться через 3 с.
      const head = await readUntil(reader, 'retry:');
      expect(head).toContain('retry: 3000');

      // Организатор перекладывает вещь участнику — это и есть «онлайн».
      await call(
        'patch',
        `/api/trips/${tripId}/gear/${gearRowId}`,
        organizerToken,
        { assignedUserId: memberId },
      ).expect(200);

      const frame = await readUntil(reader, '"scope":"gear"');
      expect(frame).toContain('event: trip');
      expect(frame).toContain(organizerId);

      controller.abort();
      await reader.cancel().catch(() => undefined);
    },
    15_000,
  );

  it('посторонний в поток не попадает — 403 до первого байта', async () => {
    const response = await fetch(
      `${baseUrl}/api/trips/${tripId}/gear/events`,
      {
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${strangerToken}`,
        },
      },
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toContain('application/json');
    await response.body?.cancel();
  });

  it('чек-лист похода шлёт событие в тот же канал', async () => {
    const events = app.get(TripEventsService);
    const received: string[] = [];
    const subscription = events
      .stream(tripId)
      .subscribe((event) => received.push(event.scope));

    try {
      await call('post', `/api/trips/${tripId}/checklists`, organizerToken, {
        scope: 'trip',
      }).expect(201);

      await vi.waitFor(() => expect(received).toContain('checklist'));
    } finally {
      subscription.unsubscribe();
    }
  });

  it('спальник из «Ночёвок» шлёт то же событие снаряжения (13.11.2026)', async () => {
    const events = app.get(TripEventsService);
    const received: string[] = [];
    const subscription = events
      .stream(tripId)
      .subscribe((event) => received.push(event.scope));

    try {
      // Спальник — личная вещь из собственного каталога организатора.
      const bag = await call('post', '/api/gear', organizerToken, {
        typeId,
        title: 'Спальник для потока',
        weightGrams: 900,
      }).expect(201);

      await call('post', `/api/trips/${tripId}/route/sleeping`, organizerToken, {
        gearItemId: String(bag.body.id),
      }).expect(200);

      // «Снаряжение» показывает спальник в «в палатку» и «Мой рюкзак»,
      // поэтому событие то же, что у вещи похода, а не отдельный scope.
      await vi.waitFor(() => expect(received).toContain('gear'));
    } finally {
      subscription.unsubscribe();
    }
  });

  it(
    'участник получает событие «Питания» о чужой смене диеты',
    async () => {
      const controller = new AbortController();
      const response = await fetch(
        `${baseUrl}/api/trips/${tripId}/meals/events`,
        {
          headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${memberToken}`,
          },
          signal: controller.signal,
        },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain(
        'text/event-stream',
      );
      expect(response.headers.get('x-accel-buffering')).toBe('no');

      const reader = response.body!.getReader();
      const head = await readUntil(reader, 'retry:');
      expect(head).toContain('retry: 3000');

      // Организатор отмечает «питаюсь отдельно» — событие обеим вкладкам.
      await call(
        'patch',
        `/api/trips/${tripId}/participants/me`,
        organizerToken,
        { status: 'going', eatsSeparately: true },
      ).expect(200);

      const frame = await readUntil(reader, '"scope":"meals"');
      expect(frame).toContain('event: trip');
      expect(frame).toContain(organizerId);

      controller.abort();
      await reader.cancel().catch(() => undefined);
    },
    15_000,
  );

  it('посторонний в поток «Питания» не попадает — 403 до первого байта', async () => {
    const response = await fetch(
      `${baseUrl}/api/trips/${tripId}/meals/events`,
      {
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${strangerToken}`,
        },
      },
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('content-type')).toContain('application/json');
    await response.body?.cancel();
  });

  it('чат снаряжения виден участнику, но не постороннему', async () => {
    const mine = await call(
      'get',
      `/api/trips/${tripId}/chats`,
      memberToken,
    ).expect(200);

    const kinds = (mine.body.chats as Array<{ kind: string; title: string }>).map(
      (chat) => chat.kind,
    );
    expect(kinds).toContain('trip_gear');

    const gearChat = (mine.body.chats as Array<{ kind: string; title: string }>).find(
      (chat) => chat.kind === 'trip_gear',
    );
    expect(gearChat?.title).toBe('Чат снаряжения');

    await call(
      'post',
      `/api/trips/${tripId}/messages`,
      memberToken,
      { kind: 'trip_gear', body: 'Палатку беру я' },
    ).expect(201);

    const page = await call(
      'get',
      `/api/trips/${tripId}/messages?kind=trip_gear`,
      organizerToken,
    ).expect(200);
    expect(page.body.messages.at(-1).body).toBe('Палатку беру я');

    // Постороннему чат вкладки не отдаётся: он не участник похода.
    const theirs = await call(
      'get',
      `/api/trips/${tripId}/chats`,
      strangerToken,
    ).expect(200);
    expect(
      (theirs.body.chats as Array<{ kind: string }>).map((chat) => chat.kind),
    ).not.toContain('trip_gear');
  });
});
