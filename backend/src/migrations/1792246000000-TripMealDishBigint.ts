import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Правка типа `trip_meal_dishes.dish_id`: int → bigint.
 *
 * В первой редакции миграции 34 колонка была объявлена `int`, а `dishes.id`
 * — `bigint` (как и все id блюд). PostgreSQL принял внешний ключ между
 * разными целыми типами, поэтому ошибка не всплыла на применении, но
 * `schema:log` показывал расхождение с entity.
 *
 * Миграция 34 уже применена в dev, поэтому исправить невыпущенную 34 одной
 * правкой файла мало: в dev осталась бы колонка `int`. Здесь приводим её
 * к `bigint`; на чистой базе (прод), где 34 сразу с `bigint`, это no-op.
 */
export class TripMealDishBigint1792246000000 implements MigrationInterface {
  name = 'TripMealDishBigint1792246000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trip_meal_dishes"
         ALTER COLUMN "dish_id" TYPE bigint`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trip_meal_dishes"
         ALTER COLUMN "dish_id" TYPE int`,
    );
  }
}
