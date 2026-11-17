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
 * Присутствие на маршруте (e2e) — 17.11.2026.
 *
 * Заказчик: «В продолжение, запланировано отметки о присутствии на маршруте».
 * Решение 16.11.2026 (`lifecycle.md` §5): присутствие — перекличка, а не
 * «факт похода»; отмечает любой идущий себе и любому другому; отметки
 * работают и без связи.
 *
 * Здесь проверяется API, а не экран:
 *
 * 1. **Отметка ставится и снимается.** `route`/`returned`/`none`, время
 *    ставит сервер, автор и источник (`self`/`other`) сохраняются.
 * 2. **Отмечает любой идущий, но только идущий.** Приглашённый и «пока
 *    не решил» получают 403; посторонний — тоже.
 * 3. **Цель — любой участник, кроме `declined`.** Вышедший — 400,
 *    не участник — 404.
 * 4. **Присутствие видно составу и гостям** в `GET /participants`
 *    и `GET /guest`.
 * 5. **Организатор тоже может быть `declined`** (решение 17.11.2026:
 *    организовывать и не ходить — законно).
 *
 * Поход и состав заводятся напрямую в базе: правила походов проверены
 * в `trips.e2e-spec.ts`, здесь важно поведение присутствия.
 */
describe('Присутствие на маршруте (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  let organizerId: string;
  let organizerToken: string;
  let memberId: string;
  let memberToken: string;
  let maybeToken: string;
  let invitedToken: string;
  let strangerToken: string;
  let virtualId: string;

  let objectId: string;
  let tripId: string;
  let lastCode: string | null = null;

  /** Кого завели — того и убираем: по id надёжнее, чем по шаблону почты. */
  const createdUserIds: string[] = [];

  const stamp = Date.now();
  const organizerEmail = `presence-e2e-org-${stamp}@example.com`;
  const memberEmail = `presence-e2e-member-${stamp}@example.com`;
  const maybeEmail = `presence-e2e-maybe-${stamp}@example.com`;
  const invitedEmail = `presence-e2e-invited-${stamp}@example.com`;
  const declinedEmail = `presence-e2e-declined-${stamp}@example.com`;
  const strangerEmail = `presence-e2e-stranger-${stamp}@example.com`;

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

  function mark(token: string, userId: string, status: string) {
    return request(app.getHttpServer())
      .put(`/api/trips/${tripId}/presence/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status });
  }

  function participants(token: string) {
    return request(app.getHttpServer())
      .get(`/api/trips/${tripId}/participants`)
      .set('Authorization', `Bearer ${token}`);
  }

  /** Строка состава по id: в ответе всегда весь состав похода. */
  function row(body: { participants: { userId: string }[] }, userId: string) {
    return body.participants.find((person) => person.userId === userId) as
      | {
          userId: string;
          status: string;
          startedAt: string | null;
          returnedAt: string | null;
          presenceStatus: string;
          presenceUpdatedByUserId: string | null;
          presenceSource: string | null;
        }
      | undefined;
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
    createdUserIds.push(organizer.id);

    const member = await login(memberEmail);
    memberToken = member.token;
    memberId = member.id;
    createdUserIds.push(member.id);

    const maybe = await login(maybeEmail);
    maybeToken = maybe.token;
    createdUserIds.push(maybe.id);

    const invited = await login(invitedEmail);
    invitedToken = invited.token;
    createdUserIds.push(invited.id);

    const declined = await login(declinedEmail);
    createdUserIds.push(declined.id);

    const stranger = await login(strangerEmail);
    strangerToken = stranger.token;
    createdUserIds.push(stranger.id);

    objectId = (
      await dataSource.query(
        `INSERT INTO objects (name, type) VALUES ('Вершина для присутствия', 'вершина') RETURNING id`,
      )
    )[0].id;

    // Поход уже идёт: старт вчера, конец послезавтра. Присутствие от дат
    // не зависит, но экран задаёт вопрос именно в этом окне.
    tripId = (
      await dataSource.query(
        `INSERT INTO trips (organizer_user_id, goal_object_id, route_text,
                            status, starts_at, ends_at, visibility)
         VALUES ($1, $2, '', 'decided', now() - interval '1 day',
                 now() + interval '2 days', 'public') RETURNING id`,
        [organizerId, objectId],
      )
    )[0].id;

    await dataSource.query(
      `INSERT INTO trip_participants (trip_id, user_id, status)
       VALUES ($1, $2, 'going'), ($1, $3, 'going'), ($1, $4, 'maybe'),
              ($1, $5, 'invited'), ($1, $6, 'declined')`,
      [tripId, organizerId, memberId, maybe.id, invited.id, declined.id],
    );

    /**
     * Человек без аккаунта в составе: за него возвращение ставит группа.
     * Он не может войти и отметиться сам — единственное исключение из
     * правила «возвращение только своё» (17.11.2026).
     */
    virtualId = (
      await dataSource.query(
        `INSERT INTO users (display_name, is_virtual, virtual_owner_user_id)
         VALUES ('Дядя Витя (присутствие)', true, $1) RETURNING id`,
        [memberId],
      )
    )[0].id;
    createdUserIds.push(virtualId);

    await dataSource.query(
      `INSERT INTO trip_participants (trip_id, user_id, status)
       VALUES ($1, $2, 'going')`,
      [tripId, virtualId],
    );

    // Смена статуса пишет системное сообщение в членский чат: поход,
    // заведённый напрямую в базе, должен иметь чаты, как настоящий.
    await dataSource.query(
      `INSERT INTO conversations (trip_id, kind)
       VALUES ($1, 'trip_guest'), ($1, 'trip_members')`,
      [tripId],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query('DELETE FROM trips WHERE id = $1', [tripId]);
      await dataSource.query('DELETE FROM objects WHERE id = $1', [objectId]);
      await dataSource.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        createdUserIds,
      ]);
    }
    await app?.close();
  });

  it('до отметок присутствия ни у кого нет', async () => {
    const response = await participants(memberToken).expect(200);

    expect(row(response.body, organizerId)?.presenceStatus).toBe('none');
    expect(row(response.body, organizerId)?.startedAt).toBeNull();
  });

  it('идущий отмечает себя: «на маршруте», источник self', async () => {
    const response = await mark(memberToken, memberId, 'route').expect(200);

    expect(response.body.presenceStatus).toBe('route');
    expect(response.body.startedAt).not.toBeNull();
    expect(response.body.returnedAt).toBeNull();
    expect(response.body.presenceSource).toBe('self');
    expect(response.body.presenceUpdatedByUserId).toBe(memberId);

    // Своё видно и в составе, и гостю.
    const list = await participants(organizerToken).expect(200);
    expect(row(list.body, memberId)?.presenceStatus).toBe('route');

    const guest = await request(app.getHttpServer())
      .get(`/api/trips/${tripId}/guest`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .expect(200);

    expect(row(guest.body, memberId)?.presenceStatus).toBe('route');
  });

  it('приход другого отмечает любой, возвращение за живого — нет', async () => {
    // Приход за другого — можно: телефон мог остаться дома.
    const route = await mark(memberToken, organizerId, 'route').expect(200);
    expect(route.body.presenceSource).toBe('other');

    // Возвращение за живого участника — 400: он отмечает его сам.
    const returned = await mark(memberToken, organizerId, 'returned').expect(400);
    expect(returned.body.message).toContain('сам');
  });

  it('человеку без аккаунта возвращение ставит группа', async () => {
    // У Дяди Вити нет входа: вернуться за него может любой идущий.
    const response = await mark(memberToken, virtualId, 'returned').expect(200);

    expect(response.body.presenceStatus).toBe('returned');
    expect(response.body.presenceSource).toBe('other');
    expect(response.body.presenceUpdatedByUserId).toBe(memberId);
  });

  it('повторная отметка «на маршруте» не переписывает первый выход', async () => {
    const first = await mark(memberToken, memberId, 'route').expect(200);
    const second = await mark(organizerToken, memberId, 'route').expect(200);

    expect(second.body.startedAt).toBe(first.body.startedAt);
    // Возвращение снимается: человек снова в поле.
    expect(second.body.returnedAt).toBeNull();
    // Отметил другой — источник `other`, а не `self`.
    expect(second.body.presenceSource).toBe('other');
  });

  it('отметку можно снять: `none` убирает оба времени и авторство', async () => {
    const response = await mark(memberToken, organizerId, 'none').expect(200);

    expect(response.body.presenceStatus).toBe('none');
    expect(response.body.startedAt).toBeNull();
    expect(response.body.returnedAt).toBeNull();
    expect(response.body.presenceSource).toBeNull();
    expect(response.body.presenceUpdatedByUserId).toBeNull();
  });

  it('отмечает только идущий: «пока не решил», приглашённый и посторонний — нет', async () => {
    await mark(maybeToken, memberId, 'route').expect(403);
    await mark(invitedToken, memberId, 'route').expect(403);
    await mark(strangerToken, memberId, 'route').expect(403);
  });

  it('цель — любой участник, кроме вышедшего', async () => {
    const declined = await dataSource.query(
      'SELECT user_id FROM trip_participants WHERE trip_id = $1 AND status = $2',
      [tripId, 'declined'],
    );
    const declinedId = declined[0].user_id as string;

    await mark(memberToken, declinedId, 'route').expect(400);
    await mark(memberToken, '00000000-0000-4000-8000-000000000000', 'route').expect(404);
  });

  it('мусор в состоянии отклоняется словами', async () => {
    await mark(memberToken, memberId, 'сдал').expect(400);
  });

  it('организатор тоже может быть «не иду»', async () => {
    // Решение 16.11.2026 отменено заказчиком 17.11.2026: организовывать
    // и не ходить — законно (например, по здоровью).
    const organizer = await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}/participants/me`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'declined' })
      .expect(200);

    expect(organizer.body.status).toBe('declined');

    await request(app.getHttpServer())
      .patch(`/api/trips/${tripId}/participants/me`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ status: 'declined' })
      .expect(200);
  });
});
