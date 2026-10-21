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
 * Публичный профиль человека (e2e) — Ф5, «Контакты».
 *
 * Главное здесь — **граница приватного**. Свой профиль отдаёт аллергии
 * и спортивный опыт, а чужой — нет: имя, аватарка, город и «на сайте с».
 * Поэтому тест проверяет не только ответ, но и **отсутствие** лишних
 * полей: утечка одного поля в публичный DTO не видна глазами, а стоит
 * дорого.
 *
 * Гендер, email и id сессий сюда же: `auth_identities` в публичный ответ
 * не попадает вовсе, и это проверяется по списку ключей.
 */
describe('Публичный профиль (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  let ownerId: string;
  let ownerToken: string;
  let otherId: string;
  let otherToken: string;

  let lastCode: string | null = null;

  const ownerEmail = `people-e2e-${Date.now()}@example.com`;
  const otherEmail = `people-e2e-other-${Date.now()}@example.com`;

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

    const owner = await login(ownerEmail);
    ownerToken = owner.token;
    ownerId = owner.id;

    const other = await login(otherEmail);
    otherToken = other.token;
    otherId = other.id;

    // Город — чтобы проверить, что он виден в чужом профиле.
    await dataSource.query(
      `UPDATE users SET location = 'Иркутск' WHERE id = $1`,
      [ownerId],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
        [ownerId, otherId],
      ]);
    }
    await app?.close();
  });

  it('чужой профиль отдаёт имя, аватарку, город и дату регистрации', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/users/${ownerId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);

    expect(response.body.id).toBe(ownerId);
    expect(response.body.displayName).toBeTruthy();
    expect(response.body.location).toBe('Иркутск');
    expect(response.body.avatarUrl).toBeNull();
    expect(response.body.createdAt).toBeTruthy();
    expect(response.body.isSelf).toBe(false);
  });

  it('личного в публичном профиле нет', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/users/${ownerId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);

    // Точечно по ключам: аллергии, диета, спортивный опыт и служебные
    // поля — не для чужих глаз.
    expect(Object.keys(response.body).sort()).toEqual(
      ['avatarUrl', 'createdAt', 'displayName', 'id', 'isSelf', 'location'].sort(),
    );
    expect(response.body).not.toHaveProperty('allergies');
    expect(response.body).not.toHaveProperty('isVegetarian');
    expect(response.body).not.toHaveProperty('sportExperience');
    expect(response.body).not.toHaveProperty('deletedAt');
  });

  it('свой профиль помечен isSelf', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/users/${ownerId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(response.body.isSelf).toBe(true);
  });

  it('несуществующий пользователь — 404', async () => {
    await request(app.getHttpServer())
      .get('/api/users/11111111-1111-4111-8111-111111111111')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);
  });

  it('не-uuid — 400, а не 500 от базы', async () => {
    await request(app.getHttpServer())
      .get('/api/users/not-a-uuid')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(400);
  });

  it('удалённый человек отвечает 404', async () => {
    const deleted = (
      await dataSource.query(
        `INSERT INTO users (display_name, deleted_at) VALUES ('Удалённый e2e', now()) RETURNING id`,
      )
    )[0].id as string;

    try {
      await request(app.getHttpServer())
        .get(`/api/users/${deleted}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    } finally {
      await dataSource.query('DELETE FROM users WHERE id = $1', [deleted]);
    }
  });

  it('без токена профиль закрыт', async () => {
    await request(app.getHttpServer()).get(`/api/users/${ownerId}`).expect(401);
  });
});
