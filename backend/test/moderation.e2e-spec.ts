import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';

import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { adminUserIds } from './../src/calendar/admin';

/**
 * Тесты модерации иконок.
 *
 * Поводом был 400 на клик по иконке: у `SetTypeActiveDto.isActive` не было
 * валидационного декоратора, а `ValidationPipe` включён с `whitelist` и
 * `forbidNonWhitelisted` — поле считалось лишним, и запрос падал ещё до
 * сервиса. Здесь это проверяется по-настоящему: приложение поднимается
 * в той же конфигурации, что и прод (`configureApp`), и запрос идёт через
 * тот же pipe.
 *
 * Токены подписываются прямо, пользователей в базе не заводим:
 * `JwtStrategy` проверяет только подпись, а `isAdminUser` — только UUID
 * из списка админов. Поэтому тест не трогает живые учётки и убирает
 * за собой ровно одно: возвращает тип активности в исходное состояние.
 */
describe('Модерация иконок (e2e)', () => {
  let app: NestExpressApplication;
  let adminToken: string;
  let strangerToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();

    const jwtService = moduleFixture.get(JwtService);
    const adminId = adminUserIds()[0] as string;

    adminToken = await jwtService.signAsync({ sub: adminId });
    strangerToken = await jwtService.signAsync({ sub: randomUUID() });
  });

  afterAll(async () => {
    await app?.close();
  });

  const asAdmin = (req: request.Test) =>
    req.set('Authorization', `Bearer ${adminToken}`);
  const asStranger = (req: request.Test) =>
    req.set('Authorization', `Bearer ${strangerToken}`);

  it('без токена не пускает', async () => {
    await request(app.getHttpServer())
      .get('/api/calendar/admin/moderation')
      .expect(401);
  });

  it('чужому не отдаёт модерацию', async () => {
    await asStranger(
      request(app.getHttpServer()).get('/api/calendar/admin/moderation'),
    ).expect(403);
  });

  it('админу отдаёт варианты иконок', async () => {
    const response = await asAdmin(
      request(app.getHttpServer()).get('/api/calendar/admin/moderation'),
    ).expect(200);

    expect(Array.isArray(response.body.types)).toBe(true);
    expect(response.body.types.length).toBeGreaterThan(0);
    expect(response.body).toHaveProperty('requests');
  });

  it('переключает вариант иконки — тот самый клик, что падал с 400', async () => {
    const moderation = await asAdmin(
      request(app.getHttpServer()).get('/api/calendar/admin/moderation'),
    ).expect(200);

    const type = moderation.body.types[0] as { id: number; isActive: boolean };

    try {
      // Раньше здесь был 400: поле isActive не проходило whitelist, потому
      // что у DTO не было валидационного декоратора.
      await asAdmin(
        request(app.getHttpServer())
          .patch(`/api/calendar/admin/types/${type.id}`)
          .send({ isActive: !type.isActive }),
      ).expect(200);

      // Новое состояние проверяем по списку модерации: ответ самого PATCH
      // отдаёт `ActivityTypeDto` без флага — админка после переключения
      // всё равно перечитывает список.
      const after = await asAdmin(
        request(app.getHttpServer()).get('/api/calendar/admin/moderation'),
      ).expect(200);

      const updated = (
        after.body.types as { id: number; isActive: boolean }[]
      ).find((item) => item.id === type.id);

      expect(updated?.isActive).toBe(!type.isActive);
    } finally {
      // Возвращаем как было: тест не должен менять справочник в dev-базе.
      await asAdmin(
        request(app.getHttpServer())
          .patch(`/api/calendar/admin/types/${type.id}`)
          .send({ isActive: type.isActive }),
      ).expect(200);
    }
  });

  it('значение не boolean — 400', async () => {
    await asAdmin(
      request(app.getHttpServer())
        .patch('/api/calendar/admin/types/1')
        .send({ isActive: 'да' }),
    ).expect(400);
  });

  it('незнакомое поле в теле — 400', async () => {
    await asAdmin(
      request(app.getHttpServer())
        .patch('/api/calendar/admin/types/1')
        .send({ active: true }),
    ).expect(400);
  });

  it('нечисловой идентификатор типа — 400', async () => {
    await asAdmin(
      request(app.getHttpServer())
        .patch('/api/calendar/admin/types/не-число')
        .send({ isActive: true }),
    ).expect(400);
  });
});
