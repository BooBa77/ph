import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Чек-лист покупок похода (`docs/ph/meals.md` §5.5).
 *
 * **Строки чек-листа не хранятся — это живая проекция раскладки.** Продукт
 * появляется в чек-листе потому, что он есть в приёмах; «надо» считается
 * из раскладки (с вегетарианцами). Здесь только то, что живёт отдельно
 * от плана и не сбрасывается при его правке: отметки и купленное.
 *
 * **Домашнее** — отдельная отметка: строка остаётся в плане и в весе
 * пакета, но покупать её не нужно. Домашнее и покупка могут быть в одной
 * строке (часть принесла бабушка, часть купили).
 *
 * **Денег здесь нет** (решение заказчика): расходы — чеками в Бухгалтерии.
 * Чек-лист отвечает только на «что купить и кто купил».
 *
 * **Продукт ушёл из плана, но куплен — строка остаётся** (цветом в
 * интерфейсе): вычеркнуть уже купленное из списка значит потерять его
 * из виду. Не куплен — строка исчезает вместе с продуктом.
 *
 * Ключ `(trip_id, product_id)`: один продукт — одна строка чек-листа.
 * `bought_by` — кто отметил покупку, `updated_by` — кто менял последним;
 * `ON DELETE SET NULL` на пользователя: аккаунт может исчезнуть, а строка
 * чек-листа — нет.
 */
export class TripMealChecks1792247000000 implements MigrationInterface {
  name = 'TripMealChecks1792247000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "trip_meal_checks" (
        "id" BIGSERIAL NOT NULL,
        "trip_id" bigint NOT NULL,
        "product_id" int NOT NULL,
        "is_bought" boolean NOT NULL DEFAULT false,
        "is_home" boolean NOT NULL DEFAULT false,
        "bought_amount" int,
        "bought_by" uuid,
        "bought_at" timestamptz,
        "updated_by" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trip_meal_checks" PRIMARY KEY ("id"),
        CONSTRAINT "FK_trip_meal_checks_trip"
          FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_trip_meal_checks_product"
          FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_trip_meal_checks_bought_by"
          FOREIGN KEY ("bought_by") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_trip_meal_checks_updated_by"
          FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "chk_trip_meal_checks_amount" CHECK (
          "bought_amount" IS NULL OR "bought_amount" >= 0
        )
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_meal_checks_product"
          ON "trip_meal_checks" ("trip_id", "product_id")
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "trip_meal_checks" TO ph_app;
          GRANT USAGE, SELECT ON SEQUENCE "trip_meal_checks_id_seq" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_trip_meal_checks_product"`);
    await queryRunner.query(`DROP TABLE "trip_meal_checks"`);
  }
}
