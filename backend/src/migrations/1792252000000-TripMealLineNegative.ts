import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Строка-убавка: «этого в приёме берём меньше».
 *
 * Рецепт предлагает 50 г, в пакеты положили 30 г — остаток 20 г нужно
 * убрать из плана, не меняя рецепт. Ручная строка приёма становится
 * знаковой: положительное — «добавили», отрицательное — «убрали».
 *
 * Ноль запрещён: строка с нулём — это отсутствие строки, её и удаляют.
 * Раскладка складывает рецепт и убавку, количества остаются целыми.
 */
export class TripMealLineNegative1792252000000 implements MigrationInterface {
  name = 'TripMealLineNegative1792252000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trip_meal_lines" DROP CONSTRAINT "chk_trip_meal_lines_amount"`,
    );
    await queryRunner.query(`
      ALTER TABLE "trip_meal_lines" ADD CONSTRAINT "chk_trip_meal_lines_amount"
        CHECK ("amount" <> 0)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trip_meal_lines" DROP CONSTRAINT "chk_trip_meal_lines_amount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_meal_lines" ADD CONSTRAINT "chk_trip_meal_lines_amount" CHECK ("amount" > 0)`,
    );
  }
}
