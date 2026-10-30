import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Вещь каталога получает тип и значения характеристик (Stage B, часть 1).
 *
 * До этого шага вещь знала только **вид** (`kind`) — короткий список
 * в коде из восьми категорий. Вид отвечал на вопрос «к какой полке
 * относится», но не на «сколько у палатки мест», и завести «топор»
 * или «тент» без миграции было нельзя. Stage A завёл справочник
 * `gear_types` + `gear_type_attributes` и админку к нему; этот шаг
 * связывает вещь с типом и даёт место для значений.
 *
 * ## Что делается
 *
 * 1. `gear_items.gear_type_id` — **обязательный** внешний ключ на тип.
 * 2. `gear_item_attributes` — значения характеристик вещи.
 * 3. Старый `kind` **удаляется**: его роль целиком играет тип.
 *
 * ## Почему типы для старых видов вставляет миграция
 *
 * `gear_type_id` не может быть `NULL`, а у существующих вещей тип надо
 * откуда-то взять: каталог жил на `kind` с 21.10.2026. Поэтому миграция
 * переводит старые виды в типы **один в один** и заводит недостающие типы
 * (`ON CONFLICT (code) DO NOTHING` — если сид уже положил «Палатку», она
 * не перезаписывается). Это не «данные вместо схемы»: тип, заведённый
 * миграцией, дальше живёт как обычная строка справочника — админ его
 * переименует, переставит или погасит в архив.
 *
 * Соответствие видов и кодов типов:
 *
 * | `kind` | код типа | имя |
 * |---|---|---|
 * | `tent` | `tent` | Палатка (уже в сиде) |
 * | `sleeping` | `sleeping_bag` | Спальник |
 * | `backpack` | `backpack` | Рюкзак |
 * | `kitchen` | `kitchen` | Кухня и посуда |
 * | `clothing` | `clothing` | Одежда |
 * | `footwear` | `footwear` | Обувь |
 * | `technical` | `technical` | Техническое снаряжение |
 * | `other` | `other` | Прочее |
 *
 * **Новые типы из сида** (`axe`, `saw`, `firestarter`, `gas`, `shelter`,
 * `stove`, `tagan`) к старым видам отношения не имеют: под них попадают
 * вещи, заведённые уже с типом.
 *
 * ## Порядок DDL
 *
 * Сначала данные, потом обязательность, и только затем удаление `kind`.
 * `DROP COLUMN` сам уносит зависимые объекты (CHECK на виде и индекс
 * `IDX_gear_items_owner`), поэтому их убираем **явно и раньше**: иначе
 * следующий `DROP CONSTRAINT` упал бы на уже несуществующем ограничении.
 * Индекс под новый тип заводится до `DROP` старого, чтобы у таблицы
 * не было окна без индекса по владельцу.
 *
 * ## Значения
 *
 * `gear_item_attributes` — типизированные колонки, а не jsonb: вид
 * характеристики говорит, в какую колонку ляжет значение, и `num_nonnulls`
 * в базе требует **ровно одно** из трёх. Значение у вещи по каждой
 * характеристике одно (`UNIQUE (gear_item_id, gear_type_attribute_id)`):
 * «две вместимости у одной палатки» — это не две палатки, а ошибка.
 *
 * Соответствие вида значения колонке (число → `number_value`, строка
 * и список → `text_value`, галочка → `bool_value`) проверяет API: колонка
 * под вид выбирается там же, где читается вид характеристики. База держит
 * более слабое, но необходимое правило — «значение есть и оно одно».
 *
 * `ON DELETE CASCADE` с обеих сторон: вещь удаляется — её значения уходят
 * вместе с ней (иначе осиротевшие строки); характеристика физически
 * удаляется (в API это архив, но `CASCADE` есть и у вариантов) — значения
 * уходят тоже, потому что без характеристики они нечитаемы.
 */
export class GearItemTypes1792271000000 implements MigrationInterface {
  name = 'GearItemTypes1792271000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Типы для старых видов каталога. `tent` уже лежит из сида обычно,
    // но полагаться на это нельзя: сид мог не прогоняться, а тип нужен.
    await queryRunner.query(`
      INSERT INTO "gear_types" ("code", "name", "sort_order") VALUES
        ('tent',         'Палатка',               0),
        ('sleeping_bag', 'Спальник',              0),
        ('backpack',     'Рюкзак',                0),
        ('kitchen',      'Кухня и посуда',        0),
        ('clothing',     'Одежда',                0),
        ('footwear',     'Обувь',                 0),
        ('technical',    'Техническое снаряжение', 0),
        ('other',        'Прочее',                0)
      ON CONFLICT ("code") DO NOTHING
    `);

    // 2. Колонка и перенос вида в тип.
    await queryRunner.query(`
      ALTER TABLE "gear_items" ADD COLUMN "gear_type_id" integer
    `);
    await queryRunner.query(`
      UPDATE "gear_items" AS i
         SET "gear_type_id" = t."id"
        FROM "gear_types" AS t
       WHERE t."code" = CASE i."kind"
                          WHEN 'tent'      THEN 'tent'
                          WHEN 'sleeping'  THEN 'sleeping_bag'
                          WHEN 'backpack'  THEN 'backpack'
                          WHEN 'kitchen'   THEN 'kitchen'
                          WHEN 'clothing'  THEN 'clothing'
                          WHEN 'footwear'  THEN 'footwear'
                          WHEN 'technical' THEN 'technical'
                          ELSE 'other'
                        END
    `);
    // Страховка: вид вне списка (его быть не может — CHECK) или тип
    // с нужным кодом, погашенный в архив, не должны оставить `NULL`.
    await queryRunner.query(`
      UPDATE "gear_items" AS i
         SET "gear_type_id" = t."id"
        FROM "gear_types" AS t
       WHERE i."gear_type_id" IS NULL AND t."code" = 'other'
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_items" ALTER COLUMN "gear_type_id" SET NOT NULL
    `);

    // 3. Внешний ключ и новый индекс — до удаления старого.
    await queryRunner.query(`
      ALTER TABLE "gear_items"
        ADD CONSTRAINT "FK_gear_items_type"
        FOREIGN KEY ("gear_type_id") REFERENCES "gear_types"("id")
        ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_gear_items_owner_type"
        ON "gear_items" ("owner_user_id", "gear_type_id", "id")
    `);

    // 4. Вид уходит: его роль играет тип. Ограничение и индекс снимаем явно.
    await queryRunner.query(`
      ALTER TABLE "gear_items" DROP CONSTRAINT "chk_gear_items_kind"
    `);
    await queryRunner.query(`DROP INDEX "IDX_gear_items_owner"`);
    await queryRunner.query(`ALTER TABLE "gear_items" DROP COLUMN "kind"`);

    // 5. Значения характеристик.
    await queryRunner.query(`
      CREATE TABLE "gear_item_attributes" (
        "id"                     serial  NOT NULL,
        "gear_item_id"           bigint  NOT NULL,
        "gear_type_attribute_id" integer NOT NULL,
        "number_value"           numeric,
        "text_value"             text,
        "bool_value"             boolean,
        CONSTRAINT "PK_gear_item_attributes" PRIMARY KEY ("id"),
        CONSTRAINT "FK_gear_item_attributes_item"
          FOREIGN KEY ("gear_item_id")
          REFERENCES "gear_items"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_gear_item_attributes_attribute"
          FOREIGN KEY ("gear_type_attribute_id")
          REFERENCES "gear_type_attributes"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_gear_item_attributes"
          UNIQUE ("gear_item_id", "gear_type_attribute_id"),
        CONSTRAINT "chk_gear_item_attributes_one_value"
          CHECK (num_nonnulls("number_value", "text_value", "bool_value") = 1),
        CONSTRAINT "chk_gear_item_attributes_text"
          CHECK ("text_value" IS NULL OR btrim("text_value") <> '')
      )
    `);

    // Права приложению — как у остальных таблиц домена. `DO $$ IF EXISTS`:
    // в dev роли `ph_app` может не быть.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "gear_item_attributes" TO ph_app;
          GRANT USAGE, SELECT ON SEQUENCE "gear_item_attributes_id_seq" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "gear_item_attributes"`);

    // Вид возвращается: тип → вид по обратному соответствию. `tent`
    // и `shelter` в старом каталоге — один вид («палатка»): тент был
    // отдельной вещью без вида.
    await queryRunner.query(`
      ALTER TABLE "gear_items"
        ADD COLUMN "kind" varchar(20) NOT NULL DEFAULT 'other'
    `);
    await queryRunner.query(`
      UPDATE "gear_items" AS i
         SET "kind" = CASE t."code"
                        WHEN 'tent'         THEN 'tent'
                        WHEN 'shelter'      THEN 'tent'
                        WHEN 'sleeping_bag' THEN 'sleeping'
                        WHEN 'backpack'     THEN 'backpack'
                        WHEN 'kitchen'      THEN 'kitchen'
                        WHEN 'clothing'     THEN 'clothing'
                        WHEN 'footwear'     THEN 'footwear'
                        WHEN 'technical'    THEN 'technical'
                        ELSE 'other'
                      END
        FROM "gear_types" AS t
       WHERE t."id" = i."gear_type_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_items" ALTER COLUMN "kind" DROP DEFAULT
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_items"
        ADD CONSTRAINT "chk_gear_items_kind"
        CHECK ("kind" IN ('tent', 'sleeping', 'backpack', 'kitchen',
                          'clothing', 'footwear', 'technical', 'other'))
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_gear_items_owner"
        ON "gear_items" ("owner_user_id", "kind", "id")
    `);
    await queryRunner.query(`DROP INDEX "IDX_gear_items_owner_type"`);
    await queryRunner.query(`
      ALTER TABLE "gear_items" DROP CONSTRAINT "FK_gear_items_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_items" DROP COLUMN "gear_type_id"
    `);
  }
}
