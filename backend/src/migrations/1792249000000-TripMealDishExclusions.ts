import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Исключения ингредиентов в приёме: «лук в этом приёме не едим».
 *
 * Рецепт личный и общий для всех походов; в конкретном приёме человек
 * может убрать ингредиент, не меняя рецепт. Исключение привязано к строке
 * приёма (`trip_meal_dishes`), а не к блюду: в другом приёме лук останется.
 *
 * `product_id` — продукт из состава блюда; приложение проверяет, что он
 * там есть. `RESTRICT` на продукт: справочник не удаляют, пока на него
 * ссылаются. `CASCADE` на строку приёма: убрали блюдо — ушли и исключения.
 */
export class TripMealDishExclusions1792249000000 implements MigrationInterface {
  name = 'TripMealDishExclusions1792249000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "trip_meal_dish_exclusions" (
        "id" BIGSERIAL NOT NULL,
        "meal_dish_id" bigint NOT NULL,
        "product_id" int NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trip_meal_dish_exclusions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_trip_meal_dish_exclusions_dish"
          FOREIGN KEY ("meal_dish_id") REFERENCES "trip_meal_dishes"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_trip_meal_dish_exclusions_product"
          FOREIGN KEY ("product_id") REFERENCES "products"("id")
          ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_meal_dish_exclusions"
          ON "trip_meal_dish_exclusions" ("meal_dish_id", "product_id")
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "trip_meal_dish_exclusions" TO ph_app;
          GRANT USAGE, SELECT ON SEQUENCE "trip_meal_dish_exclusions_id_seq" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_trip_meal_dish_exclusions"`);
    await queryRunner.query(`DROP TABLE "trip_meal_dish_exclusions"`);
  }
}
