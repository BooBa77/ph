import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Продукт похода: «экзотика» живёт только в рамках своего похода.
 *
 * В справочнике продукты общие (`trip_id` NULL) и заполняет их админ.
 * Но у группы могут быть свои китайские снеки, которых в справочнике
 * не будет никогда. Такой продукт получает `trip_id` и виден только
 * участникам этого похода; при удалении похода уходит вместе с ним.
 *
 * Уникальность имени — раздельная: в справочнике имена общие, внутри
 * похода — свои. Для этого два частичных индекса вместо одного.
 */
export class ProductTripScope1792253000000 implements MigrationInterface {
  name = 'ProductTripScope1792253000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" ADD COLUMN "trip_id" bigint`,
    );

    await queryRunner.query(`
      ALTER TABLE "products" ADD CONSTRAINT "FK_products_trip"
        FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "UQ_products_name"`);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_products_name_global"
          ON "products" ("name") WHERE "trip_id" IS NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_products_trip_name"
          ON "products" ("trip_id", "name") WHERE "trip_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_products_trip_name"`);
    await queryRunner.query(`DROP INDEX "UQ_products_name_global"`);
    await queryRunner.query(
      `DELETE FROM "products" WHERE "trip_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD CONSTRAINT "UQ_products_name" UNIQUE ("name")`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT "FK_products_trip"`,
    );
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "trip_id"`);
  }
}
