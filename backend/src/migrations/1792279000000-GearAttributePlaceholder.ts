import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Плейсхолдер характеристики типа (03.11.2026).
 *
 * Заказчик: «в админке редактирование характеристики нужно добавить поле для
 * плейсхолдера». Это подсказка внутри поля значения у вещи — «например, 3»,
 * «Резьбовой / цанговый», — которую админ пишет сам, потому что набор
 * характеристик у каждого типа свой и универсальные подсказки врут.
 *
 * **Отдельная колонка, а не `unit`.** Единица («мест», «см») стоит рядом
 * с названием поля и означает величину; плейсхолдер живёт внутри пустого
 * ввода и показывает пример. Совмещать их значило бы потерять одно из двух:
 * у «Вместимости» нужны и «мест», и «например, 3».
 *
 * **`NULL` — подсказки нет.** Пустая строка не хранится, как у `unit`:
 * `''` неотличима от случайной пробелки. Длина — до 100 знаков, как у имени
 * характеристики: это короткая подсказка, а не описание.
 *
 * Прав наследования не требуется: колонка добавляется в существующую
 * `gear_type_attributes`, на которую у `ph_app` права уже есть.
 */
export class GearAttributePlaceholder1792279000000 implements MigrationInterface {
  name = 'GearAttributePlaceholder1792279000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "gear_type_attributes"
        ADD COLUMN "placeholder" text
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_type_attributes"
        ADD CONSTRAINT "chk_gear_type_attributes_placeholder"
        CHECK (
          "placeholder" IS NULL
          OR (btrim("placeholder") <> '' AND char_length("placeholder") <= 100)
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "gear_type_attributes"
        DROP CONSTRAINT "chk_gear_type_attributes_placeholder"
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_type_attributes"
        DROP COLUMN "placeholder"
    `);
  }
}
