import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Питание: справочник продуктов и кулинарная книга пользователя.
 *
 * Нужно Ф4 карты вкладок (`docs/ph/trip-tabs.md`): вкладка «Питание»
 * собирает раскладку по дням, а раскладка — это блюда из продуктов.
 * Значит, нужны две вещи: **общесистемный справочник продуктов** (название,
 * единица, вес единицы) и **блюда пользователя** (название и состав).
 *
 * Почему справочник общий, а не личный: «гречка», «тушёнка», «сгущёнка» —
 * одни и те же у всех, и личный справочник означал бы, что каждый заводит
 * свою гречку с своим весом, а раскладка не умеет их сложить. Пополнение
 * справочника — отдельная задача (решено: будущий функционал), поэтому
 * приложению здесь выдаётся **только чтение**: `SELECT`.
 *
 * Единицы: `g` — граммы, `piece` — штука, `can` — банка, `pack` — упаковка.
 * Вес единицы в граммах обязателен: без него нельзя посчитать вес
 * раскладки, а именно он и нужен в походе. Для `g` вес единицы — 1.
 *
 * Блюда личные: у каждого своя кулинарная книга. Состав — **связка**
 * «блюдо — продукт — количество», а не текст: так вес блюда считается,
 * а список продуктов для магазина собирается запросом.
 *
 * Количество в блюде — в единицах продукта (граммы, штуки, банки),
 * целым числом: полбанки тушёнки в раскладке не бывает, а «0.5 упаковки»
 * в базе превратилось бы в дробь, которую потом не сложить.
 */
export class MealsAndProducts1792240000000 implements MigrationInterface {
  name = 'MealsAndProducts1792240000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "products" (
        "id" SERIAL NOT NULL,
        "name" character varying(120) NOT NULL,
        "unit" character varying(10) NOT NULL,
        "weight_per_unit_grams" integer NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_products" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_products_name" UNIQUE ("name"),
        CONSTRAINT "chk_products_unit" CHECK (
          "unit" IN ('g', 'piece', 'can', 'pack')
        ),
        CONSTRAINT "chk_products_weight" CHECK ("weight_per_unit_grams" > 0),
        CONSTRAINT "chk_products_name" CHECK (char_length(btrim("name")) > 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "dishes" (
        "id" BIGSERIAL NOT NULL,
        "owner_user_id" uuid NOT NULL,
        "title" character varying(120) NOT NULL,
        "note" character varying(500),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_dishes" PRIMARY KEY ("id"),
        CONSTRAINT "FK_dishes_owner"
          FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_dishes_title" CHECK (char_length(btrim("title")) > 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_dishes_owner"
          ON "dishes" ("owner_user_id", "id")
    `);

    await queryRunner.query(`
      CREATE TABLE "dish_ingredients" (
        "id" BIGSERIAL NOT NULL,
        "dish_id" bigint NOT NULL,
        "product_id" integer NOT NULL,
        "amount" integer NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_dish_ingredients" PRIMARY KEY ("id"),
        CONSTRAINT "FK_dish_ingredients_dish"
          FOREIGN KEY ("dish_id") REFERENCES "dishes"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_dish_ingredients_product"
          FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_dish_ingredients_amount" CHECK ("amount" > 0)
      )
    `);

    /**
     * Продукт в блюде один раз: повтор означал бы два количества одного
     * и того же, и «сколько сахара в каше» стало бы вопросом без ответа.
     */
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_dish_ingredients_product"
          ON "dish_ingredients" ("dish_id", "product_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_dish_ingredients_dish"
          ON "dish_ingredients" ("dish_id", "id")
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT ON "products" TO ph_app;
          GRANT SELECT, INSERT, UPDATE, DELETE ON "dishes" TO ph_app;
          GRANT SELECT, INSERT, UPDATE, DELETE ON "dish_ingredients" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_dish_ingredients_dish"`);
    await queryRunner.query(`DROP INDEX "UQ_dish_ingredients_product"`);
    await queryRunner.query(`DROP TABLE "dish_ingredients"`);
    await queryRunner.query(`DROP INDEX "IDX_dishes_owner"`);
    await queryRunner.query(`DROP TABLE "dishes"`);
    await queryRunner.query(`DROP TABLE "products"`);
  }
}
