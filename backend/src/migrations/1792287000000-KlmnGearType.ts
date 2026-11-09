import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Тип «КЛМН» — личная посуда участника (09.11.2026).
 *
 * Заказчик: «добавь в секции Готовка/Посуда синюю кнопку „Взять личную
 * посуду“. По кнопке выбор снаряжения типа „КЛМН“ (это аббревиатура от
 * кружка-ложка-миска-нож)». Тип нужен кнопке и фильтру выбора, а не
 * автораспределению: вещь личная, в общий груз не едет.
 *
 * Строку заводим и здесь, и в сиде `seed:gear-types`: на свежей базе без
 * сида тип нужен миграции, на живой — сиду. `ON CONFLICT DO NOTHING`
 * не затирает правки админа: переименовать «КЛМН» можно, код остаётся
 * контрактом (`GEAR_TYPE_CODES.klmn` на фронте и в бэкенде).
 *
 * Код — `klmn`, а не `KLMN`: `chk_gear_types_code` держит шаблон
 * `^[a-z][a-z0-9_]*$`, и заглавные не пройдут.
 */
export class KlmnGearType1792287000000 implements MigrationInterface {
  name = 'KlmnGearType1792287000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "gear_types" ("code", "name")
      VALUES ('klmn', 'КЛМН')
      ON CONFLICT ("code") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Тип убираем только если им не пользуются: вещь с этим типом держит
    // строка справочника внешним ключом, и падать на откате из-за чужой
    // вещи неправильно.
    await queryRunner.query(`
      DELETE FROM "gear_types" g
       WHERE g."code" = 'klmn'
         AND NOT EXISTS (
           SELECT 1 FROM "gear_items" i WHERE i."gear_type_id" = g."id"
         )
    `);
  }
}
