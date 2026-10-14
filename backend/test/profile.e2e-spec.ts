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
 * Тесты профиля: пищевые ограничения и спортивный опыт.
 *
 * Проверяем то, что нельзя проверить юнит-тестом: как вложенный
 * `sportExperience` проходит ValidationPipe (`whitelist` +
 * `forbidNonWhitelisted` + вложенная валидация), как PATCH сохраняет
 * только присланное поле и не затирает остальные, что пустая строка
 * в базе не остаётся, и что словарь вариантов держит CHECK, а не только
 * DTO — то есть значение нельзя протащить запросом в обход приложения.
 *
 * Тест убирает за собой: удаляет созданного пользователя вместе со
 * строкой опыта (ON DELETE CASCADE). Аватарочные тесты так не делают,
 * и в dev-базе от них остались мусорные аккаунты.
 */
describe('Профиль: диета и спортивный опыт (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let accessToken: string;
  let userId: string;
  let lastCode: string | null = null;

  const email = `profile-e2e-${Date.now()}@example.com`;

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
      // Опыт уезжает вместе с пользователем: ON DELETE CASCADE.
      await dataSource.query('DELETE FROM users WHERE id = $1', [userId]);
    }
    await app?.close();
  });

  const auth = (req: request.Test) =>
    req.set('Authorization', `Bearer ${accessToken}`);

  const patchMe = (body: Record<string, unknown>) =>
    auth(request(app.getHttpServer()).patch('/api/users/me').send(body));

  /** Сколько строк опыта у пользователя: 0 или 1. */
  async function experienceRows(): Promise<number> {
    const rows = (await dataSource.query(
      'SELECT count(*)::int AS count FROM user_sport_experience WHERE user_id = $1',
      [userId],
    )) as { count: number }[];

    return rows[0].count;
  }

  it('без токена не пускает', async () => {
    await request(app.getHttpServer()).get('/api/users/me').expect(401);
    await request(app.getHttpServer())
      .patch('/api/users/me')
      .send({ isVegetarian: true })
      .expect(401);
  });

  it('у нового пользователя диета пустая, а опыт не заполнен', async () => {
    const response = await auth(
      request(app.getHttpServer()).get('/api/users/me'),
    ).expect(200);

    expect(response.body.isVegetarian).toBe(false);
    expect(response.body.allergies).toBeNull();
    expect(response.body.sportExperience).toBeNull();
  });

  it('ответ авторизации отдаёт профиль той же формы', async () => {
    // Проверка eager-связи: если её не подтянуть в авторизационных
    // запросах, форма ответа разъедется с GET /users/me и фронт получит
    // undefined вместо опыта.
    await request(app.getHttpServer())
      .post('/api/auth/request-code')
      .send({ email })
      .expect(200);

    const verified = await request(app.getHttpServer())
      .post('/api/auth/verify-code')
      .send({ email, code: lastCode })
      .expect(200);

    expect(verified.body.user).toHaveProperty('isVegetarian', false);
    expect(verified.body.user).toHaveProperty('allergies', null);
    expect(verified.body.user).toHaveProperty('sportExperience', null);
  });

  it('сохраняет галочку вегетарианства и аллергии', async () => {
    const response = await patchMe({
      isVegetarian: true,
      allergies: 'Орехи, цитрусовые',
    }).expect(200);

    expect(response.body.isVegetarian).toBe(true);
    expect(response.body.allergies).toBe('Орехи, цитрусовые');

    const reread = await auth(
      request(app.getHttpServer()).get('/api/users/me'),
    ).expect(200);

    expect(reread.body.isVegetarian).toBe(true);
    expect(reread.body.allergies).toBe('Орехи, цитрусовые');
  });

  it('не создаёт строку спортивного опыта, пока его не заполняли', async () => {
    expect(await experienceRows()).toBe(0);
  });

  it('CHECK в базе отвергает значение вне словаря', async () => {
    // Обход приложения: даже прямая вставка не должна пройти —
    // иначе словарь держится только на DTO.
    await expect(
      dataSource.query(
        'INSERT INTO user_sport_experience (user_id, alpinism_rank) VALUES ($1, $2)',
        [userId, 'мастер спорта'],
      ),
    ).rejects.toThrow(/chk_sport_experience_alpinism_rank/);

    expect(await experienceRows()).toBe(0);
  });

  it('сохраняет спортивный опыт вложенной структурой', async () => {
    const response = await patchMe({
      sportExperience: {
        alpinism: {
          rank: 'КМС',
          maxParticipation: '4Б',
          maxLeadership: '3А',
        },
        skyrunning: { rank: 'I' },
        sportTourism: {
          rank: 'МС',
          maxCategories: { hiking: '5', water: '3' },
          disciplines: { distanceSki: 'II разряд' },
        },
      },
    }).expect(200);

    expect(response.body.sportExperience).toEqual({
      alpinism: {
        rank: 'КМС',
        maxParticipation: '4Б',
        maxLeadership: '3А',
        // Жетон и инструкторские галочки не присылали — значит, сняты:
        // «нет» и «не отвечал» здесь одно состояние.
        rescueToken: false,
        instructorMethodist: null,
        instructorGuide: null,
        instructorGuideLicense: null,
        youthTourismOrganizer: false,
        youthTourismInstructor: false,
      },
      skyrunning: { rank: 'I' },
      sportTourism: {
        rank: 'МС',
        maxCategories: {
          hiking: '5',
          mountain: null,
          ski: null,
          water: '3',
          caving: null,
          bicycle: null,
          horse: null,
          sailing: null,
          autoMoto: null,
        },
        disciplines: {
          nordicWalking: null,
          distanceHiking: null,
          distanceSki: 'II разряд',
          distanceWater: null,
          distanceCaving: null,
        },
      },
    });

    expect(await experienceRows()).toBe(1);
  });

  it('частичная правка не затирает остальной опыт', async () => {
    const response = await patchMe({
      sportExperience: { alpinism: { maxLeadership: '5А' } },
    }).expect(200);

    expect(response.body.sportExperience.alpinism).toEqual({
      rank: 'КМС',
      maxParticipation: '4Б',
      maxLeadership: '5А',
      rescueToken: false,
      instructorMethodist: null,
      instructorGuide: null,
      instructorGuideLicense: null,
      youthTourismOrganizer: false,
      youthTourismInstructor: false,
    });
    expect(
      response.body.sportExperience.sportTourism.maxCategories.hiking,
    ).toBe('5');
    expect(response.body.sportExperience.sportTourism.rank).toBe('МС');
  });

  it('null в поле очищает одно значение, а не весь опыт', async () => {
    const response = await patchMe({
      sportExperience: { sportTourism: { rank: null } },
    }).expect(200);

    expect(response.body.sportExperience.sportTourism.rank).toBeNull();
    expect(response.body.sportExperience.alpinism.rank).toBe('КМС');
  });

  it('незнакомое поле в теле — 400 (forbidNonWhitelisted)', async () => {
    await patchMe({
      sportExperience: { alpinism: { rank: 'КМС', category: '6Б' } },
    }).expect(400);

    await patchMe({ sportExperience: { board: { rank: 'МС' } } }).expect(400);
  });

  it('значение вне словаря — 400 (валидация DTO)', async () => {
    await patchMe({
      sportExperience: { alpinism: { rank: 'мастер спорта' } },
    }).expect(400);

    await patchMe({
      sportExperience: { sportTourism: { maxCategories: { hiking: '7' } } },
    }).expect(400);

    await patchMe({ sportExperience: 'КМС' }).expect(400);
    await patchMe({ isVegetarian: 'да' }).expect(400);
  });

  it('«Значок» — допустимое звание в альпинизме и спортивном туризме', async () => {
    const response = await patchMe({
      sportExperience: {
        alpinism: { rank: 'Значок' },
        sportTourism: { rank: 'Значок' },
      },
    }).expect(200);

    expect(response.body.sportExperience.alpinism.rank).toBe('Значок');
    expect(response.body.sportExperience.sportTourism.rank).toBe('Значок');
  });

  it('в скайраннинге «Значок» не принимается: у него свой список', async () => {
    await patchMe({
      sportExperience: { skyrunning: { rank: 'Значок' } },
    }).expect(400);
  });

  it('отсутствие значением не пишется — для этого есть null', async () => {
    // Варианты «отсутствует», «нет данных» и «не выполнялся» убраны
    // из словарей 13.10.2026: в форме они дублировали пустую строку.
    await patchMe({
      sportExperience: { alpinism: { rank: 'отсутствует' } },
    }).expect(400);
    await patchMe({
      sportExperience: { sportTourism: { rank: 'отсутствует' } },
    }).expect(400);
    await patchMe({
      sportExperience: {
        sportTourism: { maxCategories: { hiking: 'нет данных' } },
      },
    }).expect(400);
    await patchMe({
      sportExperience: {
        sportTourism: { disciplines: { distanceSki: 'не выполнялся' } },
      },
    }).expect(400);

    // А null принимается и означает «ничего не выполнено».
    const response = await patchMe({
      sportExperience: { alpinism: { rank: null } },
    }).expect(200);

    expect(response.body.sportExperience.alpinism.rank).toBeNull();
  });

  it('sportExperience: null очищает опыт целиком', async () => {
    const response = await patchMe({ sportExperience: null }).expect(200);

    expect(response.body.sportExperience).toBeNull();
    expect(await experienceRows()).toBe(0);
  });

  it('опустевшие списки удаляют строку опыта, а не держат пустышку', async () => {
    await patchMe({
      sportExperience: {
        alpinism: { rank: 'II', maxParticipation: '2А', maxLeadership: '1Б' },
        sportTourism: { maxCategories: { sailing: '1' } },
      },
    }).expect(200);
    expect(await experienceRows()).toBe(1);

    // «Очистить всё» руками: пользователь снял все выпадающие списки.
    const response = await patchMe({
      sportExperience: {
        alpinism: { rank: null, maxParticipation: null, maxLeadership: null },
        skyrunning: { rank: null },
        sportTourism: {
          rank: null,
          maxCategories: { sailing: null },
        },
      },
    }).expect(200);

    expect(response.body.sportExperience).toBeNull();
    expect(await experienceRows()).toBe(0);
  });

  it('жетон «Спасение в горах» сохраняется отдельным полем', async () => {
    const response = await patchMe({
      sportExperience: { alpinism: { rescueToken: true } },
    }).expect(200);

    expect(response.body.sportExperience.alpinism.rescueToken).toBe(true);
    // Остальные поля жетон не трогает: строка появилась только из-за него.
    expect(response.body.sportExperience.alpinism.rank).toBeNull();
    expect(await experienceRows()).toBe(1);
  });

  it('снятый жетон без остальных значений не оставляет строку', async () => {
    const response = await patchMe({
      sportExperience: { alpinism: { rescueToken: false } },
    }).expect(200);

    // Пустая строка (все NULL и снятая галочка) удаляется: «опыт не
    // заполнен» и «заполнен пустым» — одно состояние.
    expect(response.body.sportExperience).toBeNull();
    expect(await experienceRows()).toBe(0);
  });

  it('сохраняет инструкторские допущения и ссылку на лицензию', async () => {
    const license =
      'https://knd.gov.ru/license?id=6683a3cad2b513840f64a890&registryType=ATTIncructorProvodnik';

    const response = await patchMe({
      sportExperience: {
        alpinism: {
          instructorMethodist: '2 категория',
          instructorGuide: 'Без категории (ИПбк)',
          instructorGuideLicense: license,
          youthTourismOrganizer: true,
          youthTourismInstructor: true,
        },
      },
    }).expect(200);

    expect(response.body.sportExperience.alpinism).toMatchObject({
      instructorMethodist: '2 категория',
      instructorGuide: 'Без категории (ИПбк)',
      instructorGuideLicense: license,
      youthTourismOrganizer: true,
      youthTourismInstructor: true,
    });
    expect(await experienceRows()).toBe(1);
  });

  it('категории инструкторов проверяются по словарю', async () => {
    await patchMe({
      sportExperience: { alpinism: { instructorMethodist: 'инструктор' } },
    }).expect(400);

    await patchMe({
      sportExperience: { alpinism: { instructorGuide: '6 категория' } },
    }).expect(400);
  });

  it('ссылка на лицензию обязана быть ссылкой', async () => {
    await patchMe({
      sportExperience: { alpinism: { instructorGuideLicense: 'knd.gov.ru' } },
    }).expect(400);

    await patchMe({
      sportExperience: { alpinism: { instructorGuideLicense: 'javascript:alert(1)' } },
    }).expect(400);

    // null принимается: поле очищается, категория остаётся.
    const response = await patchMe({
      sportExperience: { alpinism: { instructorGuideLicense: null } },
    }).expect(200);

    expect(response.body.sportExperience.alpinism.instructorGuideLicense).toBeNull();
    expect(response.body.sportExperience.alpinism.instructorGuide).toBe(
      'Без категории (ИПбк)',
    );
  });

  it('чужие поля профиля остались нетронутыми', async () => {
    const response = await auth(
      request(app.getHttpServer()).get('/api/users/me'),
    ).expect(200);

    expect(response.body.displayName).toBeTruthy();
    expect(response.body.isVegetarian).toBe(true);
    expect(response.body.allergies).toBe('Орехи, цитрусовые');
  });
});
