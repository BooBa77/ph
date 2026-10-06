import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import sharp from 'sharp';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { EmailCodeService } from './../src/email/services/email-code.service';
import { SmtpService } from './../src/email/services/smtp.service';

/**
 * Тесты эндпоинтов аватарки.
 *
 * Идут по живому приложению с живой БД — то есть проверяют то же, что
 * происходит в проде: глобальный префикс, ValidationPipe, guard, multer,
 * sharp, запись файла на диск и раздачу статики. Юнит-тесты здесь мало
 * что дали бы: почти вся логика аватарки — это как раз взаимодействие
 * частей.
 *
 * Письма не отправляются: SmtpService подменён заглушкой. Код
 * подтверждения берём из подменённого EmailCodeService — так же, как
 * его получил бы пользователь из письма.
 */
describe('Аватарка (e2e)', () => {
  let app: NestExpressApplication;
  let accessToken: string;
  let userId: string;

  /** Последний созданный код подтверждения — перехватывается у сервиса. */
  let lastCode: string | null = null;

  const email = `avatar-e2e-${Date.now()}@example.com`;

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

    const emailCodeService = moduleFixture.get(EmailCodeService);
    // spy, а не mock: настоящий код должен быть создан и сохранён в Map,
    // иначе verify-code его не найдёт. Мы лишь запоминаем, что он вернул —
    // ровно так же код узнаёт пользователь из письма.
    const realCreateCode = emailCodeService.createCode.bind(emailCodeService);
    vi.spyOn(emailCodeService, 'createCode').mockImplementation((mail) => {
      lastCode = realCreateCode(mail);
      return lastCode;
    });

    // Вход: запрашиваем код, затем подтверждаем его. Пользователь
    // создаётся автоматически — так же, как при первом входе живого
    // человека. Прямая вставка в БД не подошла бы: аватарочные
    // эндпоинты ходят через JWT, а его выписывает именно этот поток.
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
    await app.close();
  });

  /** Квадратная картинка заданного размера — «фотография пользователя». */
  async function makeJpeg(size = 200): Promise<Buffer> {
    return sharp({
      create: {
        width: size,
        height: size,
        channels: 3,
        background: { r: 200, g: 60, b: 30 },
      },
    })
      .jpeg()
      .toBuffer();
  }

  it('без токена не пускает', async () => {
    await request(app.getHttpServer()).post('/api/users/me/avatar').expect(401);
    await request(app.getHttpServer()).delete('/api/users/me/avatar').expect(401);
  });

  it('загружает аватарку, отдаёт её по URL и убирает прежний файл', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/users/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', await makeJpeg(), {
        // Оригинальное имя не используется: файл на диске называется
        // по UUID. Проверяем в том числе, что странное имя не мешает.
        filename: 'IMG_2026.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);

    const firstUrl = first.body.avatarUrl as string;
    expect(first.body.id).toBe(userId);
    // Путь прямого вида и с нашим префиксом: фронт подставляет его в <img>
    // без обработки, а nginx и Vite проксируют этот префикс на бэкенд.
    expect(firstUrl).toMatch(
      new RegExp(
        `^/api/uploads/avatars/${userId}/[0-9a-f-]{36}\\.webp$`,
      ),
    );

    const file = await request(app.getHttpServer()).get(firstUrl).expect(200);
    expect(file.headers['content-type']).toBe('image/webp');
    expect(file.headers['cache-control']).toContain('immutable');
    // nosniff обязателен: контент отдают пользователи, а браузер не должен
    // угадывать тип по содержимому.
    expect(file.headers['x-content-type-options']).toBe('nosniff');

    // Файл действительно приведён к 150×150 и перекодирован в WebP,
    // а не просто переложен на диск.
    const meta = await sharp(file.body as Buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(150);
    expect(meta.height).toBe(150);

    // Вторая загрузка должна убрать первый файл — иначе том растёт
    // с каждой сменой аватарки.
    const second = await request(app.getHttpServer())
      .post('/api/users/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', await makeJpeg(120), {
        filename: 'second.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);

    expect(second.body.avatarUrl).not.toBe(firstUrl);
    await request(app.getHttpServer()).get(firstUrl).expect(404);

    // Новый файл на месте.
    await request(app.getHttpServer()).get(second.body.avatarUrl).expect(200);
  });

  it('принимает PNG и WebP', async () => {
    const png = await sharp({
      create: {
        width: 300,
        height: 200,
        channels: 3,
        background: { r: 10, g: 120, b: 200 },
      },
    })
      .png()
      .toBuffer();

    await request(app.getHttpServer())
      .post('/api/users/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', png, { filename: 'a.png', contentType: 'image/png' })
      .expect(201);

    const webp = await sharp({
      create: {
        width: 80,
        height: 80,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .webp()
      .toBuffer();

    await request(app.getHttpServer())
      .post('/api/users/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', webp, { filename: 'a.webp', contentType: 'image/webp' })
      .expect(201);
  });

  it('отказывает без файла', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/users/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);

    expect(res.body.message).toContain('Файл не передан');
  });

  it('не принимает SVG', async () => {
    // SVG — это XML, который умеет носить скрипты. Отдаём мы файлы
    // с того же origin, что и приложение, поэтому приём SVG — XSS.
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
        '<script>alert(1)</script></svg>',
    );

    const res = await request(app.getHttpServer())
      .post('/api/users/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', svg, {
        filename: 'evil.svg',
        contentType: 'image/svg+xml',
      })
      .expect(400);

    expect(res.body.message).toContain('SVG');
  });

  it('не принимает не-картинку с картинным Content-Type', async () => {
    // Content-Type в multipart подделывается тривиально, поэтому мало
    // проверить его — sharp должен не суметь декодировать содержимое.
    const res = await request(app.getHttpServer())
      .post('/api/users/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', Buffer.from('это не картинка, а текст'), {
        filename: 'fake.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);

    expect(res.body.message).toContain('Не удалось прочитать изображение');
  });

  it('не принимает файл больше 10 МБ', async () => {
    const tooBig = Buffer.alloc(10 * 1024 * 1024 + 1, 0);
    const res = await request(app.getHttpServer())
      .post('/api/users/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', tooBig, {
        filename: 'big.jpg',
        contentType: 'image/jpeg',
      });

    // multer обрывает приём раньше нашего кода и отдаёт 413 (Payload Too
    // Large); если по какой-то причине файл всё-таки дошёл — наша
    // проверка в AvatarService вернёт 400. Оба исхода корректны,
    // 2xx — нет.
    expect([400, 413]).toContain(res.status);
  });

  it('не даёт записать avatarUrl через PATCH /users/me', async () => {
    // Раньше это поле было в UpdateUserDto, то есть в базу можно было
    // записать произвольную строку — например, чужой URL. Теперь
    // forbidNonWhitelisted отвечает 400.
    const res = await request(app.getHttpServer())
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ avatarUrl: 'https://example.com/чужое.jpg' })
      .expect(400);

    expect(res.body.message).toBeDefined();
  });

  it('сбрасывает аватарку: null в профиле и файла больше нет', async () => {
    const uploaded = await request(app.getHttpServer())
      .post('/api/users/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', await makeJpeg(), {
        filename: 'to-remove.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);

    const url = uploaded.body.avatarUrl as string;
    await request(app.getHttpServer()).get(url).expect(200);

    const reset = await request(app.getHttpServer())
      .delete('/api/users/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(reset.body.avatarUrl).toBeNull();
    await request(app.getHttpServer()).get(url).expect(404);

    // Идемпотентность: повторный сброс не должен падать — файла-то уже нет.
    const again = await request(app.getHttpServer())
      .delete('/api/users/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(again.body.avatarUrl).toBeNull();
  });
});
