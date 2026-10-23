import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Дробные количества в рецепте: 0,33 банки тушёнки на человека.
 *
 * Одна банка на троих — это не «1 банка» в рецепте, а 1/3. При целом
 * количестве пришлось бы хранить 1 и врать про троих; раскладка не смогла
 * бы посчитать «4 едока — 2 банки». Поэтому `dish_ingredients.amount`
 * становится `numeric(10,3)`, а раскладка округляет **вверх** уже
 * результат (0,33 × 4 = 1,32 → 2 банки): в походе не бывает полутора
 * банок, но в рецепте — сколько угодно.
 *
 * Ручные строки приёма остаются целыми: это «купили 2 банки», а не
 * рецепт. Доли пакетов тоже целые — они раскладывают уже округлённое.
 */
export class DishIngredientFractional1792248000000 implements MigrationInterface {
  name = 'DishIngredientFractional1792248000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "dish_ingredients"
        ALTER COLUMN "amount" TYPE numeric(10,3)
        USING "amount"::numeric(10,3)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "dish_ingredients"
        ALTER COLUMN "amount" TYPE int
        USING round("amount")::int
    `);
  }
}
