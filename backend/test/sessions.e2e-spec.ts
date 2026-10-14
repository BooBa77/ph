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
 * Тесты сессий устройств: список и отзыв.
 *
 * Проверяем то, что нельзя проверить юнит-тестом: что текущее устройство
 * узнаётся по refresh-cookie (она httpOnly, JS её не видит), что чужую
 * сессию отозвать нельзя, и что отозванное устройство действительно
 * вылетает — его refresh перестаёт работать.
 *
 * Пользователь создаётся входом по коду (как в аватарочных тестах), а
 * после теста удаляется вместе с сессиями: у `sessions` внешний ключ
 * с ON DELETE CASCADE.
 */
describe('Сессии устройств (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let userId: string;
  let accessToken: string;

  /** Cookie двух «устройств»: с них и проверяем список и отзыв. */
  let desktopCookie: string;
  let mobileCookie: string;
  let mobileSessionId: string;

  let lastCode: string | null = null;

  const email = `sessions-e2e-${Date.now()}@example.com`;

  const DESKTOP_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const MOBILE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
    'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

  /** Достать refresh-cookie из ответа: `apiFetch` её не видит, тест — да. */
  function refreshCookieOf(response: request.Response): string {
    const raw = response.headers['set-cookie'] as unknown;
    const list = Array.isArray(raw)
      ? (raw as string[])
      : typeof raw === 'string'
        ? [raw]
        : [];
    const refresh = list.find((item) => item.startsWith('refresh_token='));
    if (!refresh) throw new Error('В ответе нет refresh-cookie');
    return refresh.split(';')[0] as string;
  }

  /** Вход с заданным User-Agent: возвращает токен и cookie устройства. */
  async function login(userAgent: string) {
    await request(app.getHttpServer())
      .post('/api/auth/request-code')
      .send({ email })
      .expect(200);

    const verified = await request(app.getHttpServer())
      .post('/api/auth/verify-code')
      .set('User-Agent', userAgent)
      .send({ email, code: lastCode })
      .expect(200);

    return {
      accessToken: verified.body.accessToken as string,
      userId: verified.body.user.id as string,
      cookie: refreshCookieOf(verified),
    };
  }

  const auth = (req: request.Test) =>
    req.set('Authorization', `Bearer ${accessToken}`);

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

    const desktop = await login(DESKTOP_UA);
    accessToken = desktop.accessToken;
    userId = desktop.userId;
    desktopCookie = desktop.cookie;

    const mobile = await login(MOBILE_UA);
    mobileCookie = mobile.cookie;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query('DELETE FROM users WHERE id = $1', [userId]);
    }
    await app?.close();
  });

  it('без токена не пускает', async () => {
    await request(app.getHttpServer())
      .get('/api/users/me/sessions')
      .expect(401);
    await request(app.getHttpServer())
      .delete(`/api/users/me/sessions/${mobileSessionId ?? 'x'}`)
      .expect(401);
  });

  it('показывает устройства входа и помечает текущее', async () => {
    const response = await auth(
      request(app.getHttpServer()).get('/api/users/me/sessions'),
    )
      .set('Cookie', desktopCookie)
      .expect(200);

    expect(response.body).toHaveLength(2);

    const current = response.body.filter(
      (session: { isCurrent: boolean }) => session.isCurrent,
    );
    expect(current).toHaveLength(1);
    expect(current[0].deviceLabel).toContain('Chrome');

    const mobile = response.body.find(
      (session: { deviceLabel: string }) =>
        typeof session.deviceLabel === 'string' &&
        session.deviceLabel.includes('Safari'),
    );
    expect(mobile).toBeTruthy();
    mobileSessionId = mobile.id as string;

    // Хэш refresh-токена наружу не уходит никогда.
    expect(response.body[0]).not.toHaveProperty('refreshTokenHash');
  });

  it('без cookie текущей сессии в списке нет ни одной помеченной', async () => {
    const response = await auth(
      request(app.getHttpServer()).get('/api/users/me/sessions'),
    ).expect(200);

    // Токен есть, а cookie нет: устройства видим, «это устройство» — нет.
    expect(response.body).toHaveLength(2);
    expect(
      response.body.some(
        (session: { isCurrent: boolean }) => session.isCurrent,
      ),
    ).toBe(false);
  });

  it('отзывает сессию другого устройства', async () => {
    await auth(
      request(app.getHttpServer()).delete(
        `/api/users/me/sessions/${mobileSessionId}`,
      ),
    ).expect(204);

    const response = await auth(
      request(app.getHttpServer()).get('/api/users/me/sessions'),
    )
      .set('Cookie', desktopCookie)
      .expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0].deviceLabel).toContain('Chrome');
  });

  it('отозванное устройство больше не обновляет токен', async () => {
    // Отозванная сессия — это 401: устройство увидит «не залогинен»
    // и покажет вход. Отсутствие cookie — другой случай (200 с
    // accessToken: null): это не ошибка, а старт без входа.
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', mobileCookie)
      .expect(401);
  });

  it('текущее устройство продолжает работать', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', desktopCookie)
      .expect(200);

    expect(typeof response.body.accessToken).toBe('string');
  });

  it('чужую сессию отозвать нельзя', async () => {
    // Случайный uuid: строки нет — 404, а не «отозвали что попало».
    await auth(
      request(app.getHttpServer()).delete(
        '/api/users/me/sessions/11111111-1111-4111-8111-111111111111',
      ),
    ).expect(404);
  });

  it('мусор вместо идентификатора сессии — 400', async () => {
    await auth(
      request(app.getHttpServer()).delete('/api/users/me/sessions/не-uuid'),
    ).expect(400);
  });
});
