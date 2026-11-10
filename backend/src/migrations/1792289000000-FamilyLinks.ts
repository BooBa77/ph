import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Родные — члены семьи с общим бюджетом и снаряжением (10.11.2026).
 *
 * Заказчик: «Вводим понятие „родные“, это члены семьи, с которыми общий
 * бюджет и снаряжение. В разделе Контакты заводим первые две секции —
 * „Родные“ и „Люди без аккаунта, под моим управлением“». Бюджет и общее
 * снаряжение появятся позже; здесь — сама связь между людьми, без которой
 * им не на что опереться.
 *
 * ## Почему одна таблица и канонический порядок пары
 *
 * Родство взаимно: подтвердил — значит, и у тебя в родных. Поэтому пара
 * хранится один раз, `user_a_id < user_b_id`, а направление запроса —
 * отдельная колонка `requested_by_user_id`. Уникальный индекс по паре
 * делает невозможными две встречные строки; подробности — в
 * `users/entities/family-link.entity.ts`.
 *
 * ## Статусы и подтверждение
 *
 * `pending` — запрос отправлен и ждёт ответа. `accepted` — родство
 * действует, дата согласия обязательна (CHECK). Отказ удаляет строку:
 * отдельного `declined` нет, «отклонил» и «не было» для человека одно
 * и то же.
 *
 * **Виртуальный человек** подтвердить не может — им управляет создатель,
 * поэтому такая связь создаётся сразу `accepted`. Проверка «это мой
 * виртуальный» живёт в сервисе, а не в базе: она требует взгляда на
 * `users.is_virtual` и `users.virtual_owner_user_id`.
 *
 * ## Каскады
 *
 * `ON DELETE CASCADE` от `users`: родство не имеет исторической ценности,
 * и уход человека не должен оставлять запись о нём. Обычные пользователи
 * удаляются мягко, поэтому на практике строка просто перестаёт
 * показываться; каскад нужен для физического удаления тестовых строк и
 * будущей чистки.
 *
 * `ph_app` получает права на таблицу: у неё нет последовательности (PK —
 * `gen_random_uuid()`), поэтому только четыре глагола.
 */
export class FamilyLinks1792289000000 implements MigrationInterface {
  name = 'FamilyLinks1792289000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "family_links" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_a_id" uuid NOT NULL,
        "user_b_id" uuid NOT NULL,
        "requested_by_user_id" uuid NOT NULL,
        "status" character varying(10) NOT NULL DEFAULT 'pending',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "responded_at" timestamptz,
        CONSTRAINT "FK_family_links_user_a"
          FOREIGN KEY ("user_a_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_family_links_user_b"
          FOREIGN KEY ("user_b_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_family_links_requested_by"
          FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_family_links_pair" CHECK ("user_a_id" < "user_b_id"),
        CONSTRAINT "chk_family_links_requester"
          CHECK ("requested_by_user_id" IN ("user_a_id", "user_b_id")),
        CONSTRAINT "chk_family_links_status"
          CHECK ("status" IN ('pending', 'accepted')),
        CONSTRAINT "chk_family_links_responded"
          CHECK (("status" = 'accepted') = ("responded_at" IS NOT NULL))
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_family_links_pair"
          ON "family_links" ("user_a_id", "user_b_id")
    `);
    // Поиск «мои родные» идёт по обеим сторонам пары, и по `user_a_id`
    // работает ведущая колонка того же уникального индекса.
    await queryRunner.query(`
      CREATE INDEX "IDX_family_links_user_b"
          ON "family_links" ("user_b_id")
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "family_links" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "family_links"`);
  }
}
