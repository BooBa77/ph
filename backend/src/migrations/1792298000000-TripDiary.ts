import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Дневник похода: личные записи участника (16.11.2026).
 *
 * Заказчик: «Дневник — это личная закладка… ведётся онлайн и оффлайн
 * (синхронизация при возвращении связи)». Отсюда три необычных для проекта
 * решения:
 *
 * - **PK — `uuid` без значения по умолчанию.** Идентификатор придумывает
 *   устройство: запись рождается в поле без сети, и после синхронизации
 *   её ключ не должен меняться, иначе правки, сделанные в том же офлайне,
 *   потерялись бы. `gen_random_uuid()` здесь не нужен — база id не выдумывает.
 * - **`created_at` и `updated_at` без `DEFAULT now()`.** Время ставит
 *   клиент: в поле часы телефона и есть настоящий момент записи, а время
 *   доставки на сервер может отличаться на сутки.
 * - **`deleted_at` вместо `DELETE`.** Мягкое удаление не даёт старой копии
 *   на втором устройстве «воскресить» запись повторной синхронизацией.
 *
 * `ON DELETE CASCADE` от похода: дневник без похода бессмыслен. От
 * пользователя тоже CASCADE: личный журнал — его собственный текст, и
 * удаление аккаунта не должно упираться в него.
 *
 * `ph_app` получает четыре глагола; последовательности нет — PK не serial.
 */
export class TripDiary1792298000000 implements MigrationInterface {
  name = 'TripDiary1792298000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "trip_diary_entries" (
        "id" uuid NOT NULL,
        "trip_id" bigint NOT NULL,
        "user_id" uuid NOT NULL,
        "body" text NOT NULL,
        "created_at" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL,
        "deleted_at" timestamptz,
        CONSTRAINT "PK_trip_diary_entries" PRIMARY KEY ("id"),
        CONSTRAINT "FK_trip_diary_entries_trip"
          FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_trip_diary_entries_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_trip_diary_entries_body"
          CHECK (char_length(btrim("body")) BETWEEN 1 AND 20000),
        CONSTRAINT "chk_trip_diary_entries_dates"
          CHECK ("updated_at" >= "created_at"
             AND ("deleted_at" IS NULL OR "deleted_at" >= "created_at"))
      )
    `);

    // Чтение всегда одно: «мои записи этого похода, старые сверху».
    // Третья колонка индекса даёт порядок без отдельной сортировки.
    await queryRunner.query(`
      CREATE INDEX "IDX_trip_diary_entries_trip_user"
          ON "trip_diary_entries" ("trip_id", "user_id", "created_at")
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "trip_diary_entries" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "trip_diary_entries"`);
  }
}
