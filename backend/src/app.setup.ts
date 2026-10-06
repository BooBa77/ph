import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { UPLOADS_DIR, UPLOADS_URL_PREFIX } from './config/uploads.config';

/** Сутки в секундах — для заголовков кэширования. */
const DAY = 86_400;

/**
 * Настройка приложения: middleware, глобальные pipes, префикс, Swagger.
 *
 * Вынесено из main.ts, чтобы e2e-тесты поднимали приложение ровно
 * в той же конфигурации, что и прод. Иначе тест проверяет одну машину,
 * а работает другая: пропущенный ValidationPipe не отбросит лишние поля,
 * а незарегистрированный префикс `/api` даст 404 на живом стенде при
 * зелёных тестах.
 */
export function configureApp(app: NestExpressApplication): void {
  app.use(cookieParser());

  serveUploads(app);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('PeakHunter API')
    .setDescription('API социальной сети походников Прибайкалья')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);
}

/**
 * Раздача загруженных файлов по префиксу `/api/uploads/`.
 *
 * Почему express-статика, а не ServeStaticModule с SPA-fallback: нам нужны
 * только файлы из одного каталога по точному префиксу, отдавать index.html
 * на промах не требуется (SPA раздаёт фронтенд-контейнер).
 *
 * Два следствия, которые надо держать в голове:
 *
 *  1. Статика отвечает ДО маршрутизации Nest, а значит и до глобального
 *     JwtAuthGuard. Аватарки публичны: любой, кто знает URL (в нём UUID),
 *     получит картинку без токена. Для аварок это осознанное решение —
 *     они и так видны в шапке, а `<img src>` не умеет слать Bearer-токен.
 *
 *  2. Файлы иммутабельны: имя содержит UUID и при каждой загрузке новое.
 *     Поэтому кэш можно отдавать на год вперёд — пользователь не увидит
 *     старую аватарку из кэша браузера, потому что URL после загрузки
 *     другой.
 */
function serveUploads(app: NestExpressApplication): void {
  app.use(
    `${UPLOADS_URL_PREFIX}/`,
    (req: Request, res: Response, next: NextFunction) => {
      // nosniff — второй рубеж после проверки формата: даже если в
      // хранилище когда-нибудь окажется файл с чужим содержимым, браузер
      // не начнёт угадывать тип и не выполнит его как скрипт. Заголовок
      // ставим до обработчика статики: express-send его не трогает.
      res.setHeader('X-Content-Type-Options', 'nosniff');
      next();
    },
  );

  // maxAge и immutable вместе дают `Cache-Control: public, max-age=31536000,
  // immutable`. Ставить Cache-Control руками в middleware бесполезно:
  // express-send перезаписывает его своими настройками.
  app.useStaticAssets(UPLOADS_DIR, {
    prefix: `${UPLOADS_URL_PREFIX}/`,
    maxAge: DAY * 365,
    immutable: true,
  });
}
