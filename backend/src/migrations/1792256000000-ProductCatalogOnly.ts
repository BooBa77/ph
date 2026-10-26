import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Справочник продуктов — снова только справочник.
 *
 * До `trip_products` «своя экзотика» жила в этой же таблице с `trip_id`.
 * Миграция `TripProducts` скопировала нужные строки в `trip_products`, но
 * оригиналы остались: поиск подмешивал их к справочнику, а в подсказках
 * всплывали продукты чужих походов. План работает только с
 * `trip_products`, поэтому старая ветка — тупик.
 *
 * Удаляем строки с `trip_id` (их данные уже в `trip_products`), снимаем
 * частичные индексы и внешний ключ, возвращаем единый `UQ_products_name`
 * и убираем колонку. Если какую-то строку похода успели положить
 * в состав блюда, внешний ключ `dish_ingredients` не даст её удалить —
 * миграция упадёт громко, а не потеряет данные молча.
 */
export class ProductCatalogOnly1792256000000 implements MigrationInterface {
  name = 'ProductCatalogOnly1792256000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_products_trip_name"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_products_name_global"`);

    await queryRunner.query(
      `DELETE FROM "products" WHERE "trip_id" IS NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "FK_products_trip"`,
    );

    await queryRunner.query(
      `ALTER TABLE "products" ADD CONSTRAINT "UQ_products_name" UNIQUE ("name")`,
    );

    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "trip_id"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" ADD COLUMN "trip_id" bigint`,
    );

    await queryRunner.query(`
      ALTER TABLE "products" ADD CONSTRAINT "FK_products_trip"
        FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT "UQ_products_name"`,
    );

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_products_name_global"
          ON "products" ("name") WHERE "trip_id" IS NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_products_trip_name"
          ON "products" ("trip_id", "name") WHERE "trip_id" IS NOT NULL
    `);
  }
}
