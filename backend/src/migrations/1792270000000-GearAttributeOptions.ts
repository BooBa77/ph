import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Список вариантов у характеристики типа (30.10.2026).
 *
 * Заказчик посмотрел на готовую админку Stage A и попросил **четвёртый вид
 * значения**: не число, не строку и не галочку, а короткий выбор из
 * предложенных вариантов. Пример — у типа «Горелка» характеристика
 * «Соединение» с вариантами «резьбовой», «цанговый»; своё значение вроде
 * «гравитационный» тоже допустимо, но не всегда: свободное поле для многих
 * характеристик хуже короткого выбора, а запрещать человеку вписать то,
 * чего в списке нет, тоже не хочется. Отсюда две вещи:
 *
 * 1. `gear_type_attributes.value_kind` получает значение `'select'`;
 * 2. у характеристики появляется флаг `allow_custom_value` — «разрешить
 *    своё значение». Он осмыслен только у списка, поэтому запрещён CHECK-ом
 *    у числа, строки и галочки: иначе флаг существовал бы и ничего не менял.
 *
 * **Варианты — отдельная таблица, а не массив.** Они будут перекручиваться:
 * админ переименовывает, добавляет и архивирует. Массив этого не переживает —
 * нет стабильного кода, нет архива, нет порядка, а переименование пришлось бы
 * руками размазывать по всем сохранённым значениям. Отдельная строка даёт то
 * же, что уже дали типы: код латиницей как контракт, имя для человека,
 * порядок, архив вместо удаления.
 *
 * **`text_value` в Stage B.** Значение такого вида будет храниться текстом —
 * одинаково для выбранного варианта и для своего. Поэтому **имя варианта
 * попадает в данные**: переименование варианта в админке обязано одной
 * транзакцией обновить и старые значения, иначе вещи разойдутся с новыми
 * именами и фильтр по варианту начнёт врать. Таблицы значений ещё нет, так
 * что правило записано в документации (`docs/ph/gear-types.md`), а здесь
 * только схема, которая его не ломает.
 *
 * **`UNIQUE (gear_type_attribute_id, code)` без `WHERE is_active`** — как
 * у характеристик и типов: архивный код остаётся занятым, иначе активный
 * и архивный вариант с одним кодом сосуществовали бы, и ссылка «по коду»
 * стала бы неоднозначной.
 *
 * **`ON DELETE CASCADE`** на вариантах — запасной путь, если характеристику
 * когда-нибудь физически удалят; в API удаления нет, есть архив. Удаление
 * типа каскадом уносит характеристики, а те — варианты; это проверяется
 * в `check:trips-schema`.
 */
export class GearAttributeOptions1792270000000 implements MigrationInterface {
  name = 'GearAttributeOptions1792270000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Вид значения: 'select' четвёртым. CHECK пересоздаём, а не добавляем
    // второй: два CHECK-а на одно поле путали бы чтение схемы.
    await queryRunner.query(`
      ALTER TABLE "gear_type_attributes"
        DROP CONSTRAINT "chk_gear_type_attributes_value_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_type_attributes"
        ADD CONSTRAINT "chk_gear_type_attributes_value_kind"
        CHECK ("value_kind" IN ('number', 'text', 'bool', 'select'))
    `);

    // «Разрешить своё значение»: умолчание false, чтобы существующие строки
    // остались прежними, а флаг нельзя было включить числу или галочке.
    await queryRunner.query(`
      ALTER TABLE "gear_type_attributes"
        ADD COLUMN "allow_custom_value" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_type_attributes"
        ADD CONSTRAINT "chk_gear_type_attributes_allow_custom"
        CHECK ("allow_custom_value" = false OR "value_kind" = 'select')
    `);

    await queryRunner.query(`
      CREATE TABLE "gear_attribute_options" (
        "id"                      serial  NOT NULL,
        "gear_type_attribute_id"  int     NOT NULL,
        "code"                    text    NOT NULL,
        "name"                    text    NOT NULL,
        "is_active"               boolean NOT NULL DEFAULT true,
        "sort_order"              int     NOT NULL DEFAULT 0,
        CONSTRAINT "PK_gear_attribute_options" PRIMARY KEY ("id"),
        CONSTRAINT "FK_gear_attribute_options_attribute"
          FOREIGN KEY ("gear_type_attribute_id")
          REFERENCES "gear_type_attributes"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_gear_attribute_options_code"
          UNIQUE ("gear_type_attribute_id", "code"),
        CONSTRAINT "chk_gear_attribute_options_code"
          CHECK ("code" ~ '^[a-z][a-z0-9_]*$' AND char_length("code") <= 40),
        CONSTRAINT "chk_gear_attribute_options_name"
          CHECK (char_length(btrim("name")) BETWEEN 1 AND 100),
        CONSTRAINT "chk_gear_attribute_options_sort" CHECK ("sort_order" >= 0)
      )
    `);

    // Права приложению — обычные данные, их правит админ через API.
    // `DO $$ IF EXISTS` — в dev роли `ph_app` может не быть; на проде
    // `ALTER DEFAULT PRIVILEGES` уже выдаёт DML (см. `GearTypes`).
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "gear_attribute_options" TO ph_app;
          GRANT USAGE, SELECT ON SEQUENCE "gear_attribute_options_id_seq" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Варианты первыми: внешний ключ на характеристику, хоть и CASCADE,
    // порядок должен читаться как обратный к `up`.
    await queryRunner.query(`DROP TABLE "gear_attribute_options"`);

    await queryRunner.query(`
      ALTER TABLE "gear_type_attributes"
        DROP CONSTRAINT "chk_gear_type_attributes_allow_custom"
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_type_attributes"
        DROP COLUMN "allow_custom_value"
    `);

    await queryRunner.query(`
      ALTER TABLE "gear_type_attributes"
        DROP CONSTRAINT "chk_gear_type_attributes_value_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_type_attributes"
        ADD CONSTRAINT "chk_gear_type_attributes_value_kind"
        CHECK ("value_kind" IN ('number', 'text', 'bool'))
    `);
  }
}
