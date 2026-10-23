import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Раскладка и фасовка похода (`docs/ph/meals.md` §5).
 *
 * **Дни не храним.** День — это свойство похода: у решённого похода даты,
 * у «Планирую» базовый срок прогноза. Копия дней в таблице разошлась бы
 * с походом после первой правки дат. Храним приёмы: `(trip_id, day_index,
 * kind)` — «третий день, завтрак». `day_index` — номер дня от начала,
 * `kind` — завтрак/обед/ужин. Приём появляется вместе с данными (блюдо,
 * ручная строка, кулёк) и исчезает вместе с ними.
 *
 * **Строка раскладки — не таблица.** Строка «крупа, 600 г» на приём —
 * это сумма рецептов (блюдо на человека × едоков) и ручных строк. Поэтому
 * в базе только источники: блюда приёма (`trip_meal_dishes`) и ручные
 * строки (`trip_meal_lines` — абсолютные, мясного флага у них нет).
 * Строка по продукту собирается на чтении — иначе после смены состава
 * пришлось бы пересчитывать и хранить копию.
 *
 * **Фасовка — доли.** `trip_meal_allocations`: строка (приём + продукт) →
 * `(пакет, количество)`. Фиксированных долей сколько угодно, эластичная
 * «всё» — не больше одной (частичный уникальный индекс): она забирает
 * остаток и следует за изменением количества. «Не расфасовано» — не
 * строка таблицы, а остаток.
 *
 * **Кулёк — пакет приёма.** Приём можно целиком упаковать в пакет
 * (`trip_meal_packages.kind = 'kulek'`, `meal_id` заполнен): все продукты
 * приёма, включая соль, уходят в него, а списки долей других приёмов его
 * не видят. Обычный пакет — `kind = 'normal'`, `meal_id` пустой.
 *
 * **Мясное — флаг ингредиента блюда.** `dish_ingredients.is_meat`:
 * количество мясного считается на «едоков минус вегетарианцы», остального —
 * на всех. Флаг у ингредиента, а не у блюда: в одном блюде крупа и мясо
 * живут рядом.
 *
 * **Отдельное питание — флаг участия.** `trip_participants.eats_separately`:
 * человек не едок, пакеты еды ему не назначаются, в пищевых долях
 * Бухгалтерии он не участвует. Ставит сам участник.
 *
 * Вес: расчётный — произведение количества на вес единицы продукта;
 * фактический — после контрольного взвешивания, с меткой «перевесить»,
 * если содержимое менялось после.
 */
export class TripMealPlan1792245000000 implements MigrationInterface {
  name = 'TripMealPlan1792245000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Мясной флаг рецепта: «крупа на всех, мясо — на всех, кроме вегетарианцев».
    await queryRunner.query(
      `ALTER TABLE "dish_ingredients"
         ADD COLUMN "is_meat" boolean NOT NULL DEFAULT false`,
    );

    // Отдельное питание — свойство участия, а не профиля.
    await queryRunner.query(
      `ALTER TABLE "trip_participants"
         ADD COLUMN "eats_separately" boolean NOT NULL DEFAULT false`,
    );

    await queryRunner.query(`
      CREATE TABLE "trip_meals" (
        "id" BIGSERIAL NOT NULL,
        "trip_id" bigint NOT NULL,
        "day_index" int NOT NULL,
        "kind" character varying(10) NOT NULL,
        "form" character varying(10) NOT NULL DEFAULT 'cook',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trip_meals" PRIMARY KEY ("id"),
        CONSTRAINT "FK_trip_meals_trip"
          FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_trip_meals_day" CHECK ("day_index" >= 1),
        CONSTRAINT "chk_trip_meals_kind" CHECK (
          "kind" IN ('breakfast', 'lunch', 'dinner')
        ),
        CONSTRAINT "chk_trip_meals_form" CHECK ("form" IN ('cook', 'snack'))
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_meals_slot"
          ON "trip_meals" ("trip_id", "day_index", "kind")
    `);

    await queryRunner.query(`
      CREATE TABLE "trip_meal_dishes" (
        "id" BIGSERIAL NOT NULL,
        "meal_id" bigint NOT NULL,
        "dish_id" bigint NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trip_meal_dishes" PRIMARY KEY ("id"),
        CONSTRAINT "FK_trip_meal_dishes_meal"
          FOREIGN KEY ("meal_id") REFERENCES "trip_meals"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_trip_meal_dishes_dish"
          FOREIGN KEY ("dish_id") REFERENCES "dishes"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_meal_dishes"
          ON "trip_meal_dishes" ("meal_id", "dish_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "trip_meal_lines" (
        "id" BIGSERIAL NOT NULL,
        "meal_id" bigint NOT NULL,
        "product_id" int NOT NULL,
        "amount" int NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trip_meal_lines" PRIMARY KEY ("id"),
        CONSTRAINT "FK_trip_meal_lines_meal"
          FOREIGN KEY ("meal_id") REFERENCES "trip_meals"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_trip_meal_lines_product"
          FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_trip_meal_lines_amount" CHECK ("amount" > 0)
      )
    `);

    /** Одна ручная строка на продукт в приёме: количества складываются. */
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_meal_lines"
          ON "trip_meal_lines" ("meal_id", "product_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "trip_meal_packages" (
        "id" BIGSERIAL NOT NULL,
        "trip_id" bigint NOT NULL,
        "name" character varying(60) NOT NULL,
        "kind" character varying(10) NOT NULL DEFAULT 'normal',
        "meal_id" bigint,
        "weight_actual_grams" int,
        "weight_actual_stale" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trip_meal_packages" PRIMARY KEY ("id"),
        CONSTRAINT "FK_trip_meal_packages_trip"
          FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_trip_meal_packages_meal"
          FOREIGN KEY ("meal_id") REFERENCES "trip_meals"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_trip_meal_packages_kind" CHECK (
          "kind" IN ('normal', 'kulek')
        ),
        CONSTRAINT "chk_trip_meal_packages_name" CHECK (char_length(btrim("name")) > 0),
        CONSTRAINT "chk_trip_meal_packages_weight" CHECK (
          "weight_actual_grams" IS NULL OR "weight_actual_grams" > 0
        )
      )
    `);

    /** Имя пакета в походе уникально: «Пакет 2» не должно быть дважды. */
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_meal_packages_name"
          ON "trip_meal_packages" ("trip_id", "name")
    `);

    await queryRunner.query(`
      CREATE TABLE "trip_meal_allocations" (
        "id" BIGSERIAL NOT NULL,
        "meal_id" bigint NOT NULL,
        "product_id" int NOT NULL,
        "package_id" bigint NOT NULL,
        "amount" int NOT NULL DEFAULT 0,
        "is_elastic" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trip_meal_allocations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_trip_meal_allocations_meal"
          FOREIGN KEY ("meal_id") REFERENCES "trip_meals"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_trip_meal_allocations_product"
          FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_trip_meal_allocations_package"
          FOREIGN KEY ("package_id") REFERENCES "trip_meal_packages"("id")
          ON DELETE CASCADE,
        CONSTRAINT "chk_trip_meal_allocations_amount" CHECK ("amount" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_meal_allocations"
          ON "trip_meal_allocations" ("meal_id", "product_id", "package_id")
    `);

    /** Эластичная «всё» — не больше одной на строку (приём + продукт). */
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_meal_allocations_elastic"
          ON "trip_meal_allocations" ("meal_id", "product_id")
          WHERE "is_elastic"
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_trip_meal_packages_trip"
          ON "trip_meal_packages" ("trip_id", "id")
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "trip_meals" TO ph_app;
          GRANT SELECT, INSERT, UPDATE, DELETE ON "trip_meal_dishes" TO ph_app;
          GRANT SELECT, INSERT, UPDATE, DELETE ON "trip_meal_lines" TO ph_app;
          GRANT SELECT, INSERT, UPDATE, DELETE ON "trip_meal_packages" TO ph_app;
          GRANT SELECT, INSERT, UPDATE, DELETE ON "trip_meal_allocations" TO ph_app;
          GRANT USAGE, SELECT ON SEQUENCE "trip_meals_id_seq" TO ph_app;
          GRANT USAGE, SELECT ON SEQUENCE "trip_meal_dishes_id_seq" TO ph_app;
          GRANT USAGE, SELECT ON SEQUENCE "trip_meal_lines_id_seq" TO ph_app;
          GRANT USAGE, SELECT ON SEQUENCE "trip_meal_packages_id_seq" TO ph_app;
          GRANT USAGE, SELECT ON SEQUENCE "trip_meal_allocations_id_seq" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_trip_meal_packages_trip"`);
    await queryRunner.query(`DROP INDEX "UQ_trip_meal_allocations_elastic"`);
    await queryRunner.query(`DROP INDEX "UQ_trip_meal_allocations"`);
    await queryRunner.query(`DROP TABLE "trip_meal_allocations"`);
    await queryRunner.query(`DROP INDEX "UQ_trip_meal_packages_name"`);
    await queryRunner.query(`DROP TABLE "trip_meal_packages"`);
    await queryRunner.query(`DROP INDEX "UQ_trip_meal_lines"`);
    await queryRunner.query(`DROP TABLE "trip_meal_lines"`);
    await queryRunner.query(`DROP INDEX "UQ_trip_meal_dishes"`);
    await queryRunner.query(`DROP TABLE "trip_meal_dishes"`);
    await queryRunner.query(`DROP INDEX "UQ_trip_meals_slot"`);
    await queryRunner.query(`DROP TABLE "trip_meals"`);

    await queryRunner.query(
      `ALTER TABLE "trip_participants" DROP COLUMN "eats_separately"`,
    );
    await queryRunner.query(
      `ALTER TABLE "dish_ingredients" DROP COLUMN "is_meat"`,
    );
  }
}
