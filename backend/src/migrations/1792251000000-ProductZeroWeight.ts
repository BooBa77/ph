import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Свои продукты с нулевым весом.
 *
 * «Всё невозможно учесть в БД»: шоколад, бабушкино варенье, чей-то
 * самодельный сухарь. Такой продукт заводят из поиска, вес единицы — 0:
 * граммы по нему не считаются, но в раскладке и чек-листе он живёт как
 * обычный. Поэтому ограничение «вес больше нуля» ослаблено до «не меньше».
 */
export class ProductZeroWeight1792251000000 implements MigrationInterface {
  name = 'ProductZeroWeight1792251000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT "chk_products_weight"`,
    );
    await queryRunner.query(`
      ALTER TABLE "products" ADD CONSTRAINT "chk_products_weight"
        CHECK ("weight_per_unit_grams" >= 0)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT "chk_products_weight"`,
    );
    await queryRunner.query(`
      ALTER TABLE "products" ADD CONSTRAINT "chk_products_weight"
        CHECK ("weight_per_unit_grams" > 0)
    `);
  }
}
