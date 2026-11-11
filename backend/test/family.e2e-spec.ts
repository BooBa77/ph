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
 * Родные и «Люди без аккаунта» в «Контактах» (e2e) — 10.11.2026.
 *
 * Заказчик: «Вводим понятие „родные“, это члены семьи, с которыми общий
 * бюджет и снаряжение. В разделе Контакты заводим первые две секции —
 * „Родные“ и „Люди без аккаунта, под моим управлением“». Проверяем то,
 * что нельзя увидеть глазами:
 *
 * 1. **Родство взаимно и по подтверждению.** Запрос живёт до согласия;
 *    после него обе стороны видят друг друга, хотя добавляла только одна.
 * 2. **Одна пара — одна строка.** Встречные заявки не создают две записи,
 *    а вторая заявка считается согласием.
 * 3. **Свой человек без аккаунта — родной сразу:** подтверждать ему
 *    нечем, им управляет тот же человек.
 * 4. **Чужой виртуальный не существует** (404), как и в походах.
 * 5. **Удаление виртуального до начала похода** снимает его из состава
 *    и из родных; **после начала — 409**: он нужен истории похода.
 * 6. **Отменённый поход не блокирует** удаление: человек в него не попал.
 *
 * Походы, чаты и участие тест заводит прямо в базе: правила видимости
 * и состава проверены в `trips.e2e-spec.ts`, а здесь важны «Контакты».
 * Исключение — чат `trip_members`: удаление человека без аккаунта пишет
 * в него системное сообщение, и без чата уборка упала бы по делу.
 */
describe('Родные и люди без аккаунта (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  let annaId: string;
  let annaToken: string;
  /** Имя из профиля: вход заводит человека с именем из адреса почты. */
  let annaName: string;
  let ivanId: string;
  let ivanToken: string;
  let ivanName: string;
  /** Третий настоящий человек: проверка «спрашиваем и свою семью». */
  let peterId: string;
  let peterToken: string;
  let strangerId: string;
  let strangerToken: string;

  let objectId: string;

  const tripIds: string[] = [];
  const virtualIds: string[] = [];
  const realUserIds: string[] = [];

  let lastCode: string | null = null;

  const annaEmail = `family-e2e-anna-${Date.now()}@example.com`;
  const ivanEmail = `family-e2e-ivan-${Date.now()}@example.com`;
  const peterEmail = `family-e2e-peter-${Date.now()}@example.com`;
  const strangerEmail = `family-e2e-stranger-${Date.now()}@example.com`;

  async function login(
    mail: string,
  ): Promise<{ token: string; id: string; displayName: string }> {
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
      displayName: verified.body.user.displayName as string,
    };
  }

  function call(
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
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

  /**
   * Поход с чатом участников и организатором в составе.
   *
   * `decided` требует обеих дат, поэтому для «уже состоявшегося» похода
   * даты в прошлом: именно по ним сервер решает, что человек уже сходил.
   */
  async function makeTrip(
    organizerUserId: string,
    options: {
      status?: 'planning' | 'decided';
      startsAt?: string;
      endsAt?: string;
      cancelled?: boolean;
    } = {},
  ): Promise<string> {
    const id = (
      await dataSource.query(
        `INSERT INTO trips
           (organizer_user_id, goal_object_id, status, starts_at, ends_at, cancelled_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          organizerUserId,
          objectId,
          options.status ?? 'planning',
          options.startsAt ?? null,
          options.endsAt ?? null,
          options.cancelled ? new Date() : null,
        ],
      )
    )[0].id as string;

    await dataSource.query(
      `INSERT INTO conversations (kind, trip_id)
       VALUES ('trip_members', $1), ('trip_guest', $1)`,
      [id],
    );
    await dataSource.query(
      `INSERT INTO trip_participants (trip_id, user_id, status)
       VALUES ($1, $2, 'going')`,
      [id, organizerUserId],
    );

    tripIds.push(id);

    return id;
  }

  async function createVirtual(token: string, name: string): Promise<string> {
    const response = await call('post', '/api/users/me/virtual', token, {
      displayName: name,
    }).expect(201);

    const id = response.body.id as string;
    virtualIds.push(id);

    return id;
  }

  async function familyOf(token: string) {
    return (await call('get', '/api/users/me/family', token).expect(200)).body
      .family as Array<{ userId: string; isVirtual: boolean }>;
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

    const anna = await login(annaEmail);
    annaToken = anna.token;
    annaId = anna.id;
    annaName = anna.displayName;

    const ivan = await login(ivanEmail);
    ivanToken = ivan.token;
    ivanId = ivan.id;
    ivanName = ivan.displayName;

    const stranger = await login(strangerEmail);
    strangerToken = stranger.token;
    strangerId = stranger.id;

    const peter = await login(peterEmail);
    peterToken = peter.token;
    peterId = peter.id;

    realUserIds.push(annaId, ivanId, stranger.id, peter.id);

    objectId = (
      await dataSource.query(
        `INSERT INTO objects (name, type)
         VALUES ('Вершина для родных', 'вершина') RETURNING id`,
      )
    )[0].id;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(
        'DELETE FROM trips WHERE id = ANY($1::bigint[])',
        [tripIds],
      );
      // Виртуальные — первыми: на них ссылается `virtual_owner_user_id`
      // с RESTRICT, и владелец не удалится, пока они есть.
      if (virtualIds.length > 0) {
        await dataSource.query(
          'DELETE FROM users WHERE id = ANY($1::uuid[])',
          [virtualIds],
        );
      }
      await dataSource.query(
        'DELETE FROM users WHERE id = ANY($1::uuid[])',
        [realUserIds],
      );
      await dataSource.query('DELETE FROM objects WHERE id = $1', [objectId]);
    }
    await app?.close();
  });

  // ────────────────── родные: заявка на объединение семей ──────────────────

  /**
   * Заявки из ответа `GET /users/me/family`.
   *
   * Три списка, а не один с полем «статус»: у каждого свои действия
   * («принять», «отменить»), и раскладывать их на клиенте — повторять
   * правило в каждом экране.
   */
  async function unionsOf(token: string): Promise<{
    incoming: Array<{
      id: string;
      initiatorUserId: string;
      initiatorName: string;
      myConsent: string;
      isInitiator: boolean;
      members: Array<{
        userId: string;
        consent: string;
        isInitiator: boolean;
        mine: boolean;
      }>;
    }>;
    outgoing: Array<{
      id: string;
      initiatorUserId: string;
      initiatorName: string;
      myConsent: string;
      isInitiator: boolean;
      members: Array<{
        userId: string;
        consent: string;
        isInitiator: boolean;
        mine: boolean;
      }>;
    }>;
  }> {
    const response = await call('get', '/api/users/me/family', token).expect(200);

    return { incoming: response.body.incoming, outgoing: response.body.outgoing };
  }

  it('сначала родных и заявок нет', async () => {
    const anna = await call('get', '/api/users/me/family', annaToken).expect(200);

    expect(anna.body.family).toEqual([]);
    expect(anna.body.incoming).toEqual([]);
    expect(anna.body.outgoing).toEqual([]);

    // У постороннего свой список: родство не общее на весь сайт.
    const stranger = await call(
      'get',
      '/api/users/me/family',
      strangerToken,
    ).expect(200);
    expect(stranger.body.family).toEqual([]);
    expect(stranger.body.incoming).toEqual([]);
  });

  it('заявка собирает обе семьи, а родства пока нет', async () => {
    const added = await call('post', '/api/users/me/family', annaToken, {
      userId: ivanId,
    }).expect(201);

    expect(added.body.status).toBe('pending');
    expect(typeof added.body.unionId).toBe('string');

    const anna = await call('get', '/api/users/me/family', annaToken).expect(200);
    expect(anna.body.family).toEqual([]);
    expect(anna.body.incoming).toEqual([]);
    expect(anna.body.outgoing).toHaveLength(1);

    const sent = anna.body.outgoing[0];
    expect(sent.initiatorUserId).toBe(annaId);
    expect(sent.initiatorName).toBe(annaName);
    expect(sent.isInitiator).toBe(true);
    expect(sent.myConsent).toBe('accepted');
    // Состав — обе семьи: инициатор уже согласен, второй ждёт ответа.
    expect(
      (sent.members as Array<{ userId: string; consent: string; mine: boolean }>)
        .map((member) => `${member.userId}:${member.consent}:${member.mine}`)
        .sort(),
    ).toEqual(
      [`${annaId}:accepted:true`, `${ivanId}:pending:false`].sort(),
    );

    const ivan = await call('get', '/api/users/me/family', ivanToken).expect(200);
    expect(ivan.body.family).toEqual([]);
    expect(ivan.body.incoming).toHaveLength(1);
    expect(ivan.body.incoming[0].initiatorName).toBe(annaName);
    expect(ivan.body.incoming[0].myConsent).toBe('pending');
    expect(ivan.body.incoming[0].isInitiator).toBe(false);
  });

  it('предпросмотр показывает обе стороны и что заявка уже висит', async () => {
    const preview = await call(
      'get',
      `/api/users/me/family/preview/${ivanId}`,
      annaToken,
    ).expect(200);

    expect(preview.body.targetName).toBe(ivanName);
    expect(preview.body.pending).toBe(true);
    expect(
      (
        preview.body.members as Array<{
          userId: string;
          mine: boolean;
        }>
      )
        .map((member) => `${member.userId}:${member.mine}`)
        .sort(),
    ).toEqual([`${annaId}:true`, `${ivanId}:false`].sort());
  });

  it('повторная заявка того же состава — 409', async () => {
    const response = await call('post', '/api/users/me/family', annaToken, {
      userId: ivanId,
    }).expect(409);
    expect(response.body.message).toContain('уже отправлена');
  });

  it('себя в родные добавить нельзя — 400', async () => {
    await call('post', '/api/users/me/family', annaToken, {
      userId: annaId,
    }).expect(400);
  });

  it('несуществующий человек — 404', async () => {
    await call('post', '/api/users/me/family', annaToken, {
      userId: '11111111-1111-4111-8111-111111111111',
    }).expect(404);
  });

  it('не-uuid — 400, а не 500 от базы', async () => {
    await call('post', '/api/users/me/family', annaToken, {
      userId: 'not-a-uuid',
    }).expect(400);
  });

  it('отказ закрывает заявку: связей не появляется', async () => {
    const ivan = await unionsOf(ivanToken);
    const unionId = ivan.incoming[0].id;

    await call(
      'post',
      `/api/users/me/family/unions/${unionId}/decline`,
      ivanToken,
    ).expect(204);

    expect(await familyOf(annaToken)).toEqual([]);
    expect(await familyOf(ivanToken)).toEqual([]);

    const anna = await unionsOf(annaToken);
    expect(anna.outgoing).toEqual([]);

    // Закрытую заявку нельзя ни принять, ни отклонить второй раз.
    await call(
      'post',
      `/api/users/me/family/unions/${unionId}/decline`,
      ivanToken,
    ).expect(409);
  });

  it('заявку отменяет только автор', async () => {
    const added = await call('post', '/api/users/me/family', annaToken, {
      userId: ivanId,
    }).expect(201);
    const unionId = added.body.unionId as string;

    // Иван — участник, но не автор: отменить чужую заявку нельзя.
    const forbidden = await call(
      'delete',
      `/api/users/me/family/unions/${unionId}`,
      ivanToken,
    ).expect(403);
    expect(forbidden.body.message).toContain('только тот, кто её создал');

    await call(
      'delete',
      `/api/users/me/family/unions/${unionId}`,
      annaToken,
    ).expect(204);

    expect((await unionsOf(ivanToken)).incoming).toEqual([]);
    expect((await unionsOf(annaToken)).outgoing).toEqual([]);
    expect(await familyOf(annaToken)).toEqual([]);
  });

  it('встречная заявка того же состава — это согласие', async () => {
    await call('post', '/api/users/me/family', annaToken, {
      userId: ivanId,
    }).expect(201);

    // Иван в это же время добавляет Анну: состав тот же, поэтому второй
    // заявки не появляется, а его согласие засчитывается, и семьи сливаются.
    const response = await call('post', '/api/users/me/family', ivanToken, {
      userId: annaId,
    }).expect(201);
    expect(response.body.status).toBe('accepted');

    expect((await familyOf(annaToken)).map((row) => row.userId)).toEqual([
      ivanId,
    ]);
    expect((await familyOf(ivanToken)).map((row) => row.userId)).toEqual([
      annaId,
    ]);

    const anna = await unionsOf(annaToken);
    expect(anna.incoming).toEqual([]);
    expect(anna.outgoing).toEqual([]);
  });

  it('повторное добавление уже родного — 409', async () => {
    await call('post', '/api/users/me/family', annaToken, {
      userId: ivanId,
    }).expect(409);
  });

  it('заявка спрашивает и свою семью: третий участник подтверждает', async () => {
    // Анна теперь родная Ивану, поэтому «добавить Петра» = позвать всю
    // компоненту Анны: согласие нужно и Ивану — у него тоже появится
    // доступ к чужому снаряжению.
    const added = await call('post', '/api/users/me/family', annaToken, {
      userId: peterId,
    }).expect(201);
    expect(added.body.status).toBe('pending');
    const unionId = added.body.unionId as string;

    const ivan = await unionsOf(ivanToken);
    expect(ivan.incoming).toHaveLength(1);
    expect(ivan.incoming[0].members).toHaveLength(3);
    expect(
      ivan.incoming[0].members
        .map((member) => `${member.userId}:${member.mine}`)
        .sort(),
    ).toEqual(
      [`${annaId}:true`, `${ivanId}:true`, `${peterId}:false`].sort(),
    );

    await call(
      'post',
      `/api/users/me/family/unions/${unionId}/accept`,
      ivanToken,
    ).expect(200);

    // Ждём Петра: заявка ещё висит, родства с ним нет.
    expect((await familyOf(annaToken)).map((row) => row.userId)).toEqual([
      ivanId,
    ]);

    const accepted = await call(
      'post',
      `/api/users/me/family/unions/${unionId}/accept`,
      peterToken,
    ).expect(200);
    expect(accepted.body.status).toBe('accepted');

    // Полный граф: Иван и Пётр теперь родные напрямую, а не через Анну.
    expect((await familyOf(ivanToken)).map((row) => row.userId).sort()).toEqual(
      [annaId, peterId].sort(),
    );
    expect((await familyOf(peterToken)).map((row) => row.userId).sort()).toEqual(
      [annaId, ivanId].sort(),
    );
  });

  it('отказ одного из трёх закрывает заявку целиком', async () => {
    const added = await call('post', '/api/users/me/family', annaToken, {
      userId: strangerId,
    }).expect(201);
    const unionId = added.body.unionId as string;

    const stranger = await unionsOf(strangerToken);
    expect(stranger.incoming).toHaveLength(1);

    await call(
      'post',
      `/api/users/me/family/unions/${unionId}/decline`,
      strangerToken,
    ).expect(204);

    // Ни одной связи не появилось: даже ivan и пётр, которые согласились
    // бы первыми, остаются при своих семьях.
    expect((await familyOf(strangerToken)).map((row) => row.userId)).toEqual(
      [],
    );
    const peter = await familyOf(peterToken);
    expect(peter.map((row) => row.userId)).not.toContain(strangerId);
  });

  it('выход из семьи рвёт все связи и закрывает висящие заявки', async () => {
    // Пётр заводит заявку со посторонним — она должна закрыться, когда
    // Пётр выйдет из своей семьи.
    await call('post', '/api/users/me/family', peterToken, {
      userId: strangerId,
    }).expect(201);

    await call('delete', '/api/users/me/family', peterToken).expect(204);

    expect(await familyOf(peterToken)).toEqual([]);
    expect((await unionsOf(peterToken)).outgoing).toEqual([]);

    const stranger = await unionsOf(strangerToken);
    expect(stranger.incoming).toEqual([]);

    // Связи Петра ушли у всех: у Анны остался только Иван.
    expect((await familyOf(annaToken)).map((row) => row.userId)).toEqual([
      ivanId,
    ]);
  });

  it('без токена родные закрыты', async () => {
    await request(app.getHttpServer()).get('/api/users/me/family').expect(401);
  });

  // ─────────────────── люди без аккаунта и родство с ними ───────────────────

  it('человека без аккаунта можно завести прямо в Контактах', async () => {
    const response = await call('post', '/api/users/me/virtual', annaToken, {
      displayName: 'Бабушка',
    }).expect(201);

    const id = response.body.id as string;
    virtualIds.push(id);

    expect(response.body.displayName).toBe('Бабушка');
    expect(response.body.gender).toBe('m');
    expect(response.body.tripsCount).toBe(0);
    expect(response.body.canDelete).toBe(true);

    const list = await call('get', '/api/users/me/virtual', annaToken).expect(
      200,
    );
    expect(
      (list.body.users as Array<{ id: string }>).map((user) => user.id),
    ).toContain(id);
  });

  it('имя короче двух символов не принимается — 400', async () => {
    await call('post', '/api/users/me/virtual', annaToken, {
      displayName: 'Б',
    }).expect(400);
  });

  it('свой человек без аккаунта становится родным сразу', async () => {
    const virtualId = await createVirtual(annaToken, 'Дедушка');

    const added = await call('post', '/api/users/me/family', annaToken, {
      userId: virtualId,
    }).expect(201);
    expect(added.body.status).toBe('accepted');

    const family = await familyOf(annaToken);
    const member = family.find((row) => row.userId === virtualId);
    expect(member?.isVirtual).toBe(true);
  });

  it('чужого человека без аккаунта в родные не добавить — 404', async () => {
    const virtualId = await createVirtual(annaToken, 'Сосед');

    await call('post', '/api/users/me/family', ivanToken, {
      userId: virtualId,
    }).expect(404);
  });

  // ─────────────────── удаление людей без аккаунта ───────────────────

  it('на стадии подготовки удаление убирает человека из похода и из списка', async () => {
    const virtualId = await createVirtual(annaToken, 'Петя');
    const tripId = await makeTrip(annaId);

    await call(
      'post',
      `/api/trips/${tripId}/participants/virtual/${virtualId}`,
      annaToken,
    ).expect(201);

    const before = await call(
      'get',
      '/api/users/me/virtual',
      annaToken,
    ).expect(200);
    const rowBefore = (
      before.body.users as Array<{
        id: string;
        tripsCount: number;
        canDelete: boolean;
      }>
    ).find((user) => user.id === virtualId);
    expect(rowBefore?.tripsCount).toBe(1);
    expect(rowBefore?.canDelete).toBe(true);

    await call(
      'delete',
      `/api/users/me/virtual/${virtualId}`,
      annaToken,
    ).expect(204);

    const after = await call(
      'get',
      '/api/users/me/virtual',
      annaToken,
    ).expect(200);
    expect(
      (after.body.users as Array<{ id: string }>).map((user) => user.id),
    ).not.toContain(virtualId);

    const participants = await call(
      'get',
      `/api/trips/${tripId}/participants`,
      annaToken,
    ).expect(200);
    expect(
      (participants.body.participants as Array<{ userId: string }>).map(
        (row) => row.userId,
      ),
    ).not.toContain(virtualId);

    // Уборка пишет в чат участников — значит, прошла общим путём,
    // а не удалением одной строки из списка.
    const messages = (await dataSource.query(
      `SELECT m.body FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE c.trip_id = $1 AND c.kind = 'trip_members'`,
      [tripId],
    )) as Array<{ body: string }>;
    expect(messages.some((row) => row.body.includes('больше не в составе'))).toBe(
      true,
    );
  });

  it('после начала похода удалить нельзя — 409, и он остаётся в составе', async () => {
    const virtualId = await createVirtual(annaToken, 'Витя');
    const tripId = await makeTrip(annaId, {
      status: 'decided',
      startsAt: '2026-01-01T00:00:00Z',
      endsAt: '2026-01-05T00:00:00Z',
    });

    await call(
      'post',
      `/api/trips/${tripId}/participants/virtual/${virtualId}`,
      annaToken,
    ).expect(201);

    const response = await call(
      'delete',
      `/api/users/me/virtual/${virtualId}`,
      annaToken,
    ).expect(409);
    expect(response.body.message).toContain('уже участвовал');

    const list = await call('get', '/api/users/me/virtual', annaToken).expect(
      200,
    );
    const rows = list.body.users as Array<{
      id: string;
      canDelete: boolean;
      blockedByTrip: { title: string; startedAt: string } | null;
    }>;
    expect(rows.map((user) => user.id)).toContain(virtualId);

    /**
     * Причина запрета — словами (10.11.2026, вечер). Заказчик спросил,
     * по каким датам считается подпись «уже был в походе», и она оказалась
     * непонятной: экран получает не только флаг, но и поход с датой.
     */
    const blockedRow = rows.find((user) => user.id === virtualId);
    expect(blockedRow?.canDelete).toBe(false);
    expect(blockedRow?.blockedByTrip?.title).toBe('Вершина для родных');
    expect(blockedRow?.blockedByTrip?.startedAt).toContain('2026-01-01');

    const participants = await call(
      'get',
      `/api/trips/${tripId}/participants`,
      annaToken,
    ).expect(200);
    expect(
      (participants.body.participants as Array<{ userId: string }>).map(
        (row) => row.userId,
      ),
    ).toContain(virtualId);
  });

  it('отменённый поход удаление не блокирует', async () => {
    const virtualId = await createVirtual(annaToken, 'Отменённый');
    const tripId = await makeTrip(annaId, { cancelled: true });

    await call(
      'post',
      `/api/trips/${tripId}/participants/virtual/${virtualId}`,
      annaToken,
    ).expect(201);

    await call(
      'delete',
      `/api/users/me/virtual/${virtualId}`,
      annaToken,
    ).expect(204);
  });

  it('удаление снимает родство с человеком без аккаунта', async () => {
    const virtualId = await createVirtual(annaToken, 'Родной без аккаунта');

    await call('post', '/api/users/me/family', annaToken, {
      userId: virtualId,
    }).expect(201);

    // Возвращаемое значение used: родство есть до удаления.
    expect((await familyOf(annaToken)).map((row) => row.userId)).toContain(
      virtualId,
    );

    await call(
      'delete',
      `/api/users/me/virtual/${virtualId}`,
      annaToken,
    ).expect(204);

    expect((await familyOf(annaToken)).map((row) => row.userId)).not.toContain(
      virtualId,
    );
  });

  it('чужого человека без аккаунта не удалить — 404', async () => {
    const virtualId = await createVirtual(annaToken, 'Чужой для Ивана');

    await call(
      'delete',
      `/api/users/me/virtual/${virtualId}`,
      ivanToken,
    ).expect(404);
  });
});
