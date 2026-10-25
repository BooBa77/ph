import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Продукты похода — своя таблица, справочник только для подсказок.
 *
 * Раньше план ссылался на `products`: одна и та же строка служила и
 * подсказкой, и продуктом похода. Из-за этого «тушёнка» попадала в план
 * ссылкой на справочник, а не своей копией, и правка справочника меняла
 * раскладку прошедших походов.
 *
 * Теперь `products` — только справочник (заполняет админ), а план живёт
 * в `trip_products`. Продукт попадает туда копией: имя, единица и вес
 * переписываются, дальше поход от справочника не зависит.
 *
 * Все четыре плановые таблицы переключаются на новую: строки приёма,
 * фасовка, чек-лист покупок и исключения ингредиентов. Состав рецептов
 * (`dish_ingredients`) остаётся на справочнике: рецепт личный и живёт вне
 * походов, а в план его ингредиенты попадают уже как продукты похода.
 */
export class TripProducts1792254000000 implements MigrationInterface {
  name = 'TripProducts1792254000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "trip_products" (
        "id" SERIAL NOT NULL,
        "trip_id" bigint NOT NULL,
        "name" character varying(120) NOT NULL,
        "unit" character varying(10) NOT NULL,
        "weight_per_unit_grams" int NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trip_products" PRIMARY KEY ("id"),
        CONSTRAINT "FK_trip_products_trip"
          FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_trip_products_unit" CHECK (
          "unit" IN ('g', 'piece', 'can', 'pack')
        ),
        CONSTRAINT "chk_trip_products_weight" CHECK ("weight_per_unit_grams" >= 0),
        CONSTRAINT "chk_trip_products_name" CHECK (char_length(btrim("name")) > 0)
      )
    `);

    /** Имя внутри похода уникально: двух «Гречек» в одном походе не бывает. */
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_products_name"
          ON "trip_products" ("trip_id", "name")
    `);

    /**
     * Переносим всё, на что уже ссылается план: строки приёмов, фасовку,
     * чек-лист, исключения и состав блюд, стоящих в приёмах. Продукты
     * копируются, а не переиспользуются: у похода теперь своя строка.
     */
    await queryRunner.query(`
      INSERT INTO "trip_products" ("trip_id", "name", "unit", "weight_per_unit_grams")
      SELECT DISTINCT source."trip_id", product."name", product."unit",
                      product."weight_per_unit_grams"
        FROM (
              SELECT meal."trip_id", line."product_id"
                FROM "trip_meal_lines" line
                JOIN "trip_meals" meal ON meal."id" = line."meal_id"
              UNION
              SELECT meal."trip_id", allocation."product_id"
                FROM "trip_meal_allocations" allocation
                JOIN "trip_meals" meal ON meal."id" = allocation."meal_id"
              UNION
              SELECT check_row."trip_id", check_row."product_id"
                FROM "trip_meal_checks" check_row
              UNION
              SELECT meal."trip_id", exclusion."product_id"
                FROM "trip_meal_dish_exclusions" exclusion
                JOIN "trip_meal_dishes" meal_dish ON meal_dish."id" = exclusion."meal_dish_id"
                JOIN "trip_meals" meal ON meal."id" = meal_dish."meal_id"
              UNION
              SELECT meal."trip_id", ingredient."product_id"
                FROM "trip_meal_dishes" meal_dish
                JOIN "trip_meals" meal ON meal."id" = meal_dish."meal_id"
                JOIN "dish_ingredients" ingredient ON ingredient."dish_id" = meal_dish."dish_id"
        ) source
        JOIN "products" product ON product."id" = source."product_id"
    `);

    await this.switchLines(queryRunner);
    await this.switchAllocations(queryRunner);
    await this.switchChecks(queryRunner);
    await this.switchExclusions(queryRunner);
  }

  /** Строки приёма: поход берётся через сам приём. */
  private async switchLines(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trip_meal_lines" ADD COLUMN "trip_product_id" int`,
    );

    // Запятая в FROM, а не JOIN: в ON нельзя ссылаться на обновляемую
    // таблицу — Postgres ответит «missing FROM-clause entry».
    await queryRunner.query(`
      UPDATE "trip_meal_lines" line
         SET "trip_product_id" = trip_product."id"
        FROM "trip_meals" meal, "products" product, "trip_products" trip_product
       WHERE meal."id" = line."meal_id"
         AND product."id" = line."product_id"
         AND trip_product."trip_id" = meal."trip_id"
         AND trip_product."name" = product."name"
    `);

    await queryRunner.query(
      `ALTER TABLE "trip_meal_lines" ALTER COLUMN "trip_product_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_meal_lines" DROP CONSTRAINT "FK_trip_meal_lines_product"`,
    );
    await queryRunner.query(`DROP INDEX "UQ_trip_meal_lines"`);
    await queryRunner.query(
      `ALTER TABLE "trip_meal_lines" DROP COLUMN "product_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_meal_lines" RENAME COLUMN "trip_product_id" TO "product_id"`,
    );
    await queryRunner.query(`
      ALTER TABLE "trip_meal_lines" ADD CONSTRAINT "FK_trip_meal_lines_product"
        FOREIGN KEY ("product_id") REFERENCES "trip_products"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_meal_lines"
          ON "trip_meal_lines" ("meal_id", "product_id")
    `);
  }

  /** Фасовка: тоже через приём. */
  private async switchAllocations(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trip_meal_allocations" ADD COLUMN "trip_product_id" int`,
    );

    await queryRunner.query(`
      UPDATE "trip_meal_allocations" allocation
         SET "trip_product_id" = trip_product."id"
        FROM "trip_meals" meal, "products" product, "trip_products" trip_product
       WHERE meal."id" = allocation."meal_id"
         AND product."id" = allocation."product_id"
         AND trip_product."trip_id" = meal."trip_id"
         AND trip_product."name" = product."name"
    `);

    await queryRunner.query(
      `ALTER TABLE "trip_meal_allocations" ALTER COLUMN "trip_product_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_meal_allocations" DROP CONSTRAINT "FK_trip_meal_allocations_product"`,
    );
    await queryRunner.query(`DROP INDEX "UQ_trip_meal_allocations"`);
    await queryRunner.query(`DROP INDEX "UQ_trip_meal_allocations_elastic"`);
    await queryRunner.query(
      `ALTER TABLE "trip_meal_allocations" DROP COLUMN "product_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_meal_allocations" RENAME COLUMN "trip_product_id" TO "product_id"`,
    );
    await queryRunner.query(`
      ALTER TABLE "trip_meal_allocations" ADD CONSTRAINT "FK_trip_meal_allocations_product"
        FOREIGN KEY ("product_id") REFERENCES "trip_products"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_meal_allocations"
          ON "trip_meal_allocations" ("meal_id", "product_id", "package_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_meal_allocations_elastic"
          ON "trip_meal_allocations" ("meal_id", "product_id")
       WHERE "is_elastic"
    `);
  }

  /** Чек-лист: поход у него свой, колонка есть. */
  private async switchChecks(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trip_meal_checks" ADD COLUMN "trip_product_id" int`,
    );

    await queryRunner.query(`
      UPDATE "trip_meal_checks" check_row
         SET "trip_product_id" = trip_product."id"
        FROM "products" product, "trip_products" trip_product
       WHERE product."id" = check_row."product_id"
         AND trip_product."trip_id" = check_row."trip_id"
         AND trip_product."name" = product."name"
    `);

    await queryRunner.query(
      `ALTER TABLE "trip_meal_checks" ALTER COLUMN "trip_product_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_meal_checks" DROP CONSTRAINT "FK_trip_meal_checks_product"`,
    );
    await queryRunner.query(`DROP INDEX "UQ_trip_meal_checks_product"`);
    await queryRunner.query(
      `ALTER TABLE "trip_meal_checks" DROP COLUMN "product_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_meal_checks" RENAME COLUMN "trip_product_id" TO "product_id"`,
    );
    await queryRunner.query(`
      ALTER TABLE "trip_meal_checks" ADD CONSTRAINT "FK_trip_meal_checks_product"
        FOREIGN KEY ("product_id") REFERENCES "trip_products"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_meal_checks_product"
          ON "trip_meal_checks" ("trip_id", "product_id")
    `);
  }

  /** Исключения ингредиентов: поход через блюдо приёма. */
  private async switchExclusions(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trip_meal_dish_exclusions" ADD COLUMN "trip_product_id" int`,
    );

    await queryRunner.query(`
      UPDATE "trip_meal_dish_exclusions" exclusion
         SET "trip_product_id" = trip_product."id"
        FROM "trip_meal_dishes" meal_dish, "trip_meals" meal,
             "products" product, "trip_products" trip_product
       WHERE meal_dish."id" = exclusion."meal_dish_id"
         AND meal."id" = meal_dish."meal_id"
         AND product."id" = exclusion."product_id"
         AND trip_product."trip_id" = meal."trip_id"
         AND trip_product."name" = product."name"
    `);

    await queryRunner.query(
      `ALTER TABLE "trip_meal_dish_exclusions" ALTER COLUMN "trip_product_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_meal_dish_exclusions" DROP CONSTRAINT "FK_trip_meal_dish_exclusions_product"`,
    );
    await queryRunner.query(`DROP INDEX "UQ_trip_meal_dish_exclusions"`);
    await queryRunner.query(
      `ALTER TABLE "trip_meal_dish_exclusions" DROP COLUMN "product_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_meal_dish_exclusions" RENAME COLUMN "trip_product_id" TO "product_id"`,
    );
    await queryRunner.query(`
      ALTER TABLE "trip_meal_dish_exclusions" ADD CONSTRAINT "FK_trip_meal_dish_exclusions_product"
        FOREIGN KEY ("product_id") REFERENCES "trip_products"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_meal_dish_exclusions"
          ON "trip_meal_dish_exclusions" ("meal_dish_id", "product_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Обратно — только структура: копии продуктов не удаляем, иначе план
    // потеряет строки. Плановые таблицы снова смотрят в справочник по имени.
    const tables: Array<[string, string, string]> = [
      ['trip_meal_lines', 'FK_trip_meal_lines_product', 'UQ_trip_meal_lines'],
      [
        'trip_meal_allocations',
        'FK_trip_meal_allocations_product',
        'UQ_trip_meal_allocations',
      ],
      [
        'trip_meal_checks',
        'FK_trip_meal_checks_product',
        'UQ_trip_meal_checks_product',
      ],
      [
        'trip_meal_dish_exclusions',
        'FK_trip_meal_dish_exclusions_product',
        'UQ_trip_meal_dish_exclusions',
      ],
    ];

    for (const [table, fk, index] of tables) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN "catalog_product_id" int`,
      );
      await queryRunner.query(`
        UPDATE "${table}" target
           SET "catalog_product_id" = product."id"
          FROM "trip_products" trip_product, "products" product
         WHERE trip_product."id" = target."product_id"
           AND product."name" = trip_product."name"
      `);
      await queryRunner.query(`ALTER TABLE "${table}" DROP CONSTRAINT "${fk}"`);
      await queryRunner.query(`DROP INDEX "${index}"`);
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN "product_id"`);
      await queryRunner.query(
        `ALTER TABLE "${table}" RENAME COLUMN "catalog_product_id" TO "product_id"`,
      );
      await queryRunner.query(`
        ALTER TABLE "${table}" ADD CONSTRAINT "${fk}"
          FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT
      `);
    }

    await queryRunner.query(`DROP TABLE "trip_products"`);
  }
}
