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
 * Тесты календаря — по живому приложению с живой БД.
 *
 * Проверяем то, что нельзя проверить юнит-тестом: заполнение года целиком
 * (365 строк одним запросом), чтение диапазона, правку дня и пачки дней,
 * повторное создание года и отказ работать с несозданным календарём.
 *
 * Годы выбраны так, чтобы не зависеть от залитых шаблонов: для 2029–2031
 * тест сам кладёт в `calendar_state_production` пару строк и сам их убирает.
 * Для режима «учусь» используется 2026 год, но проверяются только каникулы
 * из кода — они одинаковы в любой базе.
 *
 * Тест убирает за собой: удаляет созданного пользователя (вместе с его
 * календарём по ON DELETE CASCADE) и свои строки шаблона. Аватарочные тесты
 * так не делают, и в dev-базе от них осталось девять мусорных аккаунтов.
 */
describe('Календарь (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let accessToken: string;
  let userId: string;
  let lastCode: string | null = null;

  const email = `calendar-e2e-${Date.now()}@example.com`;

  /** Годы, шаблоны которых тест создаёт сам и потом удаляет. */
  const OWN_YEARS = [2029, 2030, 2031];

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

    // Свой шаблон: 2030 — праздник 1 января и перенос на 9 января;
    // 2031 — праздник среди недели, чтобы проверить метку в режиме
    // «весь год выходными».
    await dataSource.query(
      `INSERT INTO calendar_state_production (date, day_type, label) VALUES
         ('2030-01-01', 'weekend', 'Новый год'),
         ('2030-01-09', 'weekend', 'перенос за 3 января'),
         ('2031-03-08', 'weekend', 'Международный женский день')`,
    );

    const emailCodeService = moduleFixture.get(EmailCodeService);
    const realCreateCode = emailCodeService.createCode.bind(emailCodeService);
    vi.spyOn(emailCodeService, 'createCode').mockImplementation((mail) => {
      lastCode = realCreateCode(mail);
      return lastCode;
    });

    await request(app.getHttpServer())
      .post('/api/auth/request-code')
      .send({ email })
      .expect(200);

    const verified = await request(app.getHttpServer())
      .post('/api/auth/verify-code')
      .send({ email, code: lastCode })
      .expect(200);

    accessToken = verified.body.accessToken as string;
    userId = verified.body.user.id as string;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      const from = `${Math.min(...OWN_YEARS)}-01-01`;
      const to = `${Math.max(...OWN_YEARS)}-12-31`;
      await dataSource.query(
        'DELETE FROM calendar_state_production WHERE date BETWEEN $1 AND $2',
        [from, to],
      );
      // Календарь уезжает вместе с пользователем: ON DELETE CASCADE.
      await dataSource.query('DELETE FROM users WHERE id = $1', [userId]);
    }
    await app?.close();
  });

  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${accessToken}`);

  it('без токена не пускает', async () => {
    await request(app.getHttpServer())
      .get('/api/calendar/days?from=2030-01-01&to=2030-01-31')
      .expect(401);
  });

  it('до создания календаря год пустой, а шаблон известен', async () => {
    const response = await auth(
      request(app.getHttpServer()).get('/api/calendar/years/2030'),
    ).expect(200);

    expect(response.body).toMatchObject({
      year: 2030,
      filled: false,
      mode: null,
      filledDays: 0,
      stateAvailable: true,
    });
  });

  it('создаёт год по шаблону: 365 дней, праздники и переносы', async () => {
    const created = await auth(
      request(app.getHttpServer()).post('/api/calendar/years/2030/init'),
    )
      .send({ mode: 'cycle' })
      .expect(201);

    expect(created.body).toMatchObject({
      filled: true,
      mode: 'cycle',
      filledDays: 365,
    });

    const days = await auth(
      request(app.getHttpServer()).get(
        '/api/calendar/days?from=2030-01-01&to=2030-01-31',
      ),
    ).expect(200);

    const byDate = new Map(
      (days.body.days as { date: string }[]).map((day) => [day.date, day]),
    );

    expect(byDate.get('2030-01-01')).toMatchObject({
      dayType: 'weekend',
      label: 'Новый год',
    });
    expect(byDate.get('2030-01-09')).toMatchObject({
      dayType: 'weekend',
      label: 'перенос за 3 января',
    });
    // 7 января 2030 — понедельник: рабочий день с меткой дня недели.
    expect(byDate.get('2030-01-07')).toMatchObject({
      dayType: 'workday',
      label: 'Понедельник',
    });
  });

  it('режим «весь год выходными» заполняет год без рабочих дней', async () => {
    await auth(request(app.getHttpServer()).post('/api/calendar/years/2031/init'))
      .send({ mode: 'retired' })
      .expect(201);

    const days = await auth(
      request(app.getHttpServer()).get(
        '/api/calendar/days?from=2031-01-01&to=2031-12-31',
      ),
    ).expect(200);

    const list = days.body.days as { dayType: string; date: string; label: string }[];
    expect(list).toHaveLength(365);
    expect(list.every((day) => day.dayType === 'weekend')).toBe(true);
    // Праздник из шаблона всё равно подписан: 8 марта 2031 — суббота.
    expect(list.find((day) => day.date === '2031-03-08')?.label).toBe(
      'Международный женский день',
    );
  });

  it('режим «учусь» перекрывает рабочие дни каникулами', async () => {
    await auth(request(app.getHttpServer()).post('/api/calendar/years/2026/init'))
      .send({ mode: 'study' })
      .expect(201);

    const days = await auth(
      request(app.getHttpServer()).get(
        '/api/calendar/days?from=2026-10-26&to=2026-11-03',
      ),
    ).expect(200);

    const list = days.body.days as { date: string; dayType: string; label: string }[];
    // 27 октября 2026 — вторник: по производственному календарю рабочий,
    // но идут осенние каникулы.
    expect(list.find((day) => day.date === '2026-10-27')).toMatchObject({
      dayType: 'weekend',
      label: 'Осенние каникулы',
    });
    expect(list).toHaveLength(9);
  });

  it('повторное создание года — 409, год не перезаписывается', async () => {
    const before = await auth(
      request(app.getHttpServer()).get('/api/calendar/years/2030'),
    ).expect(200);

    await auth(request(app.getHttpServer()).post('/api/calendar/years/2030/init'))
      .send({ mode: 'free' })
      .expect(409);

    const after = await auth(
      request(app.getHttpServer()).get('/api/calendar/years/2030'),
    ).expect(200);

    // Ничего не изменилось: ни число дней, ни режим.
    expect(after.body).toEqual(before.body);
  });

  it('заполнение прошлого года не перебивает текущий режим', async () => {
    // К этому моменту заполнены 2026 (учусь), 2030 (пятидневка) и 2031
    // (пенсия). Заполнение 2029 — это шаг назад по времени.
    await auth(request(app.getHttpServer()).post('/api/calendar/years/2029/init'))
      .send({ mode: 'cycle' })
      .expect(201);

    const state = await auth(
      request(app.getHttpServer()).get('/api/calendar/years/2029'),
    ).expect(200);

    // Режим остался от самого позднего года (2031 — пенсия), а не от 2029.
    expect(state.body.mode).toBe('retired');
    expect(state.body.filledDays).toBe(365);
  });

  it('правит один день: и статус, и метку', async () => {
    const patched = await auth(request(app.getHttpServer()).patch('/api/calendar/days'))
      .send({ date: '2030-01-07', dayType: 'weekend', label: 'ДР Любы' })
      .expect(200);

    expect(patched.body).toMatchObject({
      date: '2030-01-07',
      dayType: 'weekend',
      label: 'ДР Любы',
    });

    // И обратно: только метка, статус не трогаем.
    const relabeled = await auth(
      request(app.getHttpServer()).patch('/api/calendar/days'),
    )
      .send({ date: '2030-01-07', label: 'Понедельник' })
      .expect(200);

    expect(relabeled.body).toMatchObject({
      dayType: 'weekend',
      label: 'Понедельник',
    });
  });

  it('правит пачку дней, последняя запись по дате выигрывает', async () => {
    const updated = await auth(request(app.getHttpServer()).put('/api/calendar/days'))
      .send({
        days: [
          { date: '2030-06-03', dayType: 'weekend', label: 'Отпуск' },
          { date: '2030-06-04', dayType: 'weekend', label: 'Отпуск' },
          { date: '2030-06-04', dayType: 'workday', label: 'Передумал' },
        ],
      })
      .expect(200);

    expect(updated.body).toEqual({ updated: 2 });

    const days = await auth(
      request(app.getHttpServer()).get(
        '/api/calendar/days?from=2030-06-03&to=2030-06-04',
      ),
    ).expect(200);

    const list = days.body.days as { date: string; dayType: string; label: string }[];
    expect(list.find((day) => day.date === '2030-06-03')).toMatchObject({
      dayType: 'weekend',
      label: 'Отпуск',
    });
    expect(list.find((day) => day.date === '2030-06-04')).toMatchObject({
      dayType: 'workday',
      label: 'Передумал',
    });
  });

  it('не трогает день в несозданном году', async () => {
    const response = await auth(
      request(app.getHttpServer()).patch('/api/calendar/days'),
    )
      .send({ date: '2032-05-05', label: 'Ничего не выйдет' })
      .expect(409);

    expect(response.body.message).toContain('не создан');
  });

  it('пачка дней вне созданных годов откатывается целиком', async () => {
    await auth(request(app.getHttpServer()).put('/api/calendar/days'))
      .send({
        days: [
          { date: '2030-07-01', dayType: 'weekend', label: 'Отпуск' },
          { date: '2032-07-02', dayType: 'weekend', label: 'Отпуск' },
        ],
      })
      .expect(409);

    // Ни один день пачки не применился.
    const days = await auth(
      request(app.getHttpServer()).get(
        '/api/calendar/days?from=2030-07-01&to=2030-07-01',
      ),
    ).expect(200);

    const list = days.body.days as { date: string; dayType: string; label: string }[];
    expect(list[0]).toMatchObject({ dayType: 'workday', label: 'Понедельник' });
  });

  it('отсекает мусор в параметрах', async () => {
    await auth(
      request(app.getHttpServer()).get('/api/calendar/days?from=2030-02-30&to=2030-03-01'),
    ).expect(400);

    await auth(
      request(app.getHttpServer()).get(
        '/api/calendar/days?from=2030-03-10&to=2030-03-01',
      ),
    ).expect(400);

    await auth(request(app.getHttpServer()).get('/api/calendar/years/1800')).expect(
      400,
    );

    await auth(request(app.getHttpServer()).post('/api/calendar/years/2029/init'))
      .send({ mode: 'вахта' })
      .expect(400);
  });
});
