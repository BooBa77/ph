import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  // Использовать Pino как глобальный логгер NestJS
  app.useLogger(app.get(Logger));

  configureApp(app);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
