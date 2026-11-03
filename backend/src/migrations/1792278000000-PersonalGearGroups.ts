import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Личные группы снаряжения и местоположение вещи (02.11.2026).
 *
 * **Группируются типы, а не вещи.** Заказчик: «Типы, по-прежнему, создаёт
 * админ… А группировать их разрешим самостоятельно». Поэтому группа больше
 * не полка конкретной вещи (`gear_items.group_id`): человек раскладывает
 * **типы** по своим группам (`gear_type_groups`), и вещь попадает в группу
 * своего типа. Один тип — ровно одна группа у пользователя (UNIQUE),
 * иначе одна и та же вещь показывалась бы дважды.
 *
 * **Рекомендуемые группы — шаблоны админа.** Старая таблица `gear_groups`
 * была общей: одна и та же строка на всех. Она переименована в
 * `gear_group_templates` и остаётся справочником админа, а `gear_groups`
 * теперь личная: `owner_user_id`, имя и порядок у каждого свои. Админ ведёт
 * шаблоны и рекомендуемую группу у типа (`gear_types.recommended_group_id`);
 * новые пользователи получают копии шаблонов, а новые типы — попадают
 * в группу, которую админ для них указал, если человек эту группу не удалил.
 *
 * **«Прочее» — неудаляемое умолчание и всегда последнее.** У каждого
 * пользователя есть личная группа с `template_code = 'other'`; её нельзя
 * удалить и нельзя переставить выше других (`sort_order` — максимум).
 * В неё же переезжают типы удалённой группы: тип без группы потерял бы вещи.
 *
 * **Старые вещи не теряют полку.** Для каждого пользователя, у которого
 * есть вещи, миграция заводит копии всех шаблонов, а тип получает группу
 * той вещи, которая заведена **последней**: если один и тот же тип лежал
 * в двух полках, свежая правка считается намерением человека. Вещи
 * в архивных полках тоже сохраняют группу — личная группа архивного шаблона
 * заводится наравне с остальными.
 *
 * **Местоположение** — свободный текст (`location`), а не справочник:
 * заказчик описал «балкон», «гараж», «дача», и заводить справочник мест
 * ради подсказок незачем. Подсказки фронт собирает из уже введённых
 * значений. `NULL` — место не указано.
 *
 * **Пять шаблонов.** К прежним четырём добавлена «Посуда» (`dishes`, 40):
 * на неё опираются коды `kettle`, `ladle`, `knife` из секции «Готовка».
 * «Прочее» по-прежнему последнее (100).
 */
export class PersonalGearGroups1792278000000 implements MigrationInterface {
  name = 'PersonalGearGroups1792278000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Общая таблица групп становится справочником шаблонов.
    //    FK от вещей переезжает вместе с таблицей — его снимем отдельно.
    await queryRunner.query(
      `ALTER TABLE "gear_groups" RENAME TO "gear_group_templates"`,
    );
    await queryRunner.query(`
      ALTER TABLE "gear_group_templates"
        RENAME CONSTRAINT "PK_gear_groups" TO "PK_gear_group_templates"
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_group_templates"
        RENAME CONSTRAINT "UQ_gear_groups_code" TO "UQ_gear_group_templates_code"
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_group_templates"
        RENAME CONSTRAINT "chk_gear_groups_code" TO "chk_gear_group_templates_code"
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_group_templates"
        RENAME CONSTRAINT "chk_gear_groups_name" TO "chk_gear_group_templates_name"
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_group_templates"
        RENAME CONSTRAINT "chk_gear_groups_sort" TO "chk_gear_group_templates_sort"
    `);
    // Имя последовательности глобально в схеме: без переименования новая
    // `gear_groups (id serial …)` не смогла бы создать свою `_id_seq`.
    await queryRunner.query(`
      ALTER SEQUENCE "gear_groups_id_seq" RENAME TO "gear_group_templates_id_seq"
    `);

    // «Посуда»: коды kettle/ladle/knife из секции «Готовка» (01.11.2026).
    await queryRunner.query(`
      INSERT INTO "gear_group_templates" ("code", "name", "sort_order")
      VALUES ('dishes', 'Посуда', 40)
      ON CONFLICT ("code") DO NOTHING
    `);

    // 2. Рекомендуемая группа у типа: её ставит админ, новые пользователи
    //    получают тип уже разложенным.
    await queryRunner.query(`
      ALTER TABLE "gear_types" ADD COLUMN "recommended_group_id" integer
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_types"
        ADD CONSTRAINT "FK_gear_types_recommended_group"
        FOREIGN KEY ("recommended_group_id")
        REFERENCES "gear_group_templates"("id")
        ON DELETE SET NULL
    `);
    await queryRunner.query(`
      UPDATE "gear_types" AS t
         SET "recommended_group_id" = g."id"
        FROM "gear_group_templates" AS g
       WHERE t."recommended_group_id" IS NULL
         AND (
           (t."code" IN ('tent', 'shelter', 'sleeping_bag', 'mat') AND g."code" = 'roof')
           OR (t."code" IN ('axe', 'saw', 'firestarter', 'tagan') AND g."code" = 'campfire')
           OR (t."code" IN ('stove', 'gas') AND g."code" = 'kitchen')
           OR (t."code" IN ('kettle', 'ladle', 'knife') AND g."code" = 'dishes')
         )
    `);

    // 3. Личные группы. Имя и порядок — собственность человека; `template_code`
    //    помнит, из какого шаблона пришла группа (по нему находится «Прочее»
    //    и доезжают новые типы). У своей группы (заведённой человеком)
    //    шаблона нет.
    await queryRunner.query(`
      CREATE TABLE "gear_groups" (
        "id"             serial  NOT NULL,
        "owner_user_id"  uuid    NOT NULL,
        "template_code"  text    NULL,
        "name"           text    NOT NULL,
        "sort_order"     integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_gear_groups" PRIMARY KEY ("id"),
        CONSTRAINT "FK_gear_groups_owner"
          FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_gear_groups_name"
          CHECK (char_length(btrim("name")) BETWEEN 1 AND 100),
        CONSTRAINT "chk_gear_groups_sort" CHECK ("sort_order" >= 0),
        CONSTRAINT "chk_gear_groups_template_code"
          CHECK (
            "template_code" IS NULL
            OR ("template_code" ~ '^[a-z][a-z0-9_]*$' AND char_length("template_code") <= 40)
          )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_gear_groups_owner_template"
        ON "gear_groups" ("owner_user_id", "template_code")
        WHERE "template_code" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_gear_groups_owner_order"
        ON "gear_groups" ("owner_user_id", "sort_order", "id")
    `);

    // 4. Раскладка типов: один тип — одна группа у человека.
    await queryRunner.query(`
      CREATE TABLE "gear_type_groups" (
        "id"            serial  NOT NULL,
        "owner_user_id" uuid    NOT NULL,
        "gear_type_id"  integer NOT NULL,
        "group_id"      integer NOT NULL,
        CONSTRAINT "PK_gear_type_groups" PRIMARY KEY ("id"),
        CONSTRAINT "FK_gear_type_groups_owner"
          FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_gear_type_groups_type"
          FOREIGN KEY ("gear_type_id") REFERENCES "gear_types"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_gear_type_groups_group"
          FOREIGN KEY ("group_id") REFERENCES "gear_groups"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_gear_type_groups_type"
          UNIQUE ("owner_user_id", "gear_type_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_gear_type_groups_group"
        ON "gear_type_groups" ("owner_user_id", "group_id")
    `);

    // 5. Копии шаблонов — тем, у кого уже есть вещи. Кому не нужно, заведёт
    //    API при первом открытии каталога (лениво, в одной транзакции).
    await queryRunner.query(`
      INSERT INTO "gear_groups" ("owner_user_id", "template_code", "name", "sort_order")
      SELECT u."id", t."code", t."name", t."sort_order"
        FROM "users" AS u
        CROSS JOIN "gear_group_templates" AS t
       WHERE EXISTS (
         SELECT 1 FROM "gear_items" AS i WHERE i."owner_user_id" = u."id"
       )
    `);

    // 6. Тип получает группу последней заведённой вещи этого типа: если тип
    //    лежал в двух полках, свежая правка — намерение человека.
    await queryRunner.query(`
      INSERT INTO "gear_type_groups" ("owner_user_id", "gear_type_id", "group_id")
      SELECT DISTINCT ON (i."owner_user_id", i."gear_type_id")
             i."owner_user_id",
             i."gear_type_id",
             g."id"
        FROM "gear_items" AS i
        JOIN "gear_group_templates" AS t ON t."id" = i."group_id"
        JOIN "gear_groups" AS g
          ON g."owner_user_id" = i."owner_user_id"
         AND g."template_code" = t."code"
       ORDER BY i."owner_user_id", i."gear_type_id", i."id" DESC
    `);

    // 7. Местоположение: свободный текст, пустое не храним (NULL).
    await queryRunner.query(`
      ALTER TABLE "gear_items" ADD COLUMN "location" varchar(120)
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_items"
        ADD CONSTRAINT "chk_gear_items_location"
        CHECK ("location" IS NULL OR char_length(btrim("location")) BETWEEN 1 AND 120)
    `);

    // 8. Вещь больше не ссылается на группу: группа выводится из типа.
    await queryRunner.query(`
      ALTER TABLE "gear_items" DROP CONSTRAINT "FK_gear_items_group"
    `);
    await queryRunner.query(`DROP INDEX "IDX_gear_items_owner_order"`);
    await queryRunner.query(`ALTER TABLE "gear_items" DROP COLUMN "group_id"`);
    await queryRunner.query(`
      CREATE INDEX "IDX_gear_items_owner_type_sort"
        ON "gear_items" ("owner_user_id", "gear_type_id", "sort_order", "id")
    `);

    // 9. Права приложению — как у остальных таблиц домена.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "gear_group_templates" TO ph_app;
          GRANT USAGE, SELECT ON SEQUENCE "gear_group_templates_id_seq" TO ph_app;
          GRANT SELECT, INSERT, UPDATE, DELETE ON "gear_groups" TO ph_app;
          GRANT USAGE, SELECT ON SEQUENCE "gear_groups_id_seq" TO ph_app;
          GRANT SELECT, INSERT, UPDATE, DELETE ON "gear_type_groups" TO ph_app;
          GRANT USAGE, SELECT ON SEQUENCE "gear_type_groups_id_seq" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_gear_items_owner_type_sort"`);
    await queryRunner.query(`
      ALTER TABLE "gear_items"
        ADD COLUMN "group_id" integer
    `);
    await queryRunner.query(`
      UPDATE "gear_items" AS i
         SET "group_id" = COALESCE(
           (
             SELECT t."id"
               FROM "gear_type_groups" AS m
               JOIN "gear_groups" AS g ON g."id" = m."group_id"
               JOIN "gear_group_templates" AS t ON t."code" = g."template_code"
              WHERE m."owner_user_id" = i."owner_user_id"
                AND m."gear_type_id" = i."gear_type_id"
           ),
           (
             SELECT t."id"
               FROM "gear_groups" AS g
               JOIN "gear_group_templates" AS t ON t."code" = g."template_code"
              WHERE g."owner_user_id" = i."owner_user_id"
                AND g."template_code" = 'other'
           ),
           (SELECT "id" FROM "gear_group_templates" WHERE "code" = 'other')
         )
    `);
    await queryRunner.query(`
      UPDATE "gear_items"
         SET "group_id" = (SELECT "id" FROM "gear_group_templates" WHERE "code" = 'other')
       WHERE "group_id" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_items" ALTER COLUMN "group_id" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_items"
        ADD CONSTRAINT "FK_gear_items_group"
        FOREIGN KEY ("group_id") REFERENCES "gear_group_templates"("id")
        ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_gear_items_owner_order"
        ON "gear_items" ("owner_user_id", "group_id", "sort_order", "id")
    `);

    await queryRunner.query(`
      ALTER TABLE "gear_items" DROP CONSTRAINT "chk_gear_items_location"
    `);
    await queryRunner.query(`ALTER TABLE "gear_items" DROP COLUMN "location"`);

    await queryRunner.query(`DROP TABLE "gear_type_groups"`);
    await queryRunner.query(`DROP TABLE "gear_groups"`);

    await queryRunner.query(`
      ALTER TABLE "gear_types" DROP CONSTRAINT "FK_gear_types_recommended_group"
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_types" DROP COLUMN "recommended_group_id"
    `);
    // «Посуда» появилась этой миграцией; перед удалением уводим её вещи
    // в «Прочее», иначе RESTRICT внешнего ключа не даст удалить шаблон.
    await queryRunner.query(`
      UPDATE "gear_items"
         SET "group_id" = (
           SELECT "id" FROM "gear_group_templates" WHERE "code" = 'other'
         )
       WHERE "group_id" = (
         SELECT "id" FROM "gear_group_templates" WHERE "code" = 'dishes'
       )
    `);
    await queryRunner.query(`DELETE FROM "gear_group_templates" WHERE "code" = 'dishes'`);

    await queryRunner.query(
      `ALTER TABLE "gear_group_templates" RENAME TO "gear_groups"`,
    );
    await queryRunner.query(`
      ALTER SEQUENCE "gear_group_templates_id_seq" RENAME TO "gear_groups_id_seq"
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_groups"
        RENAME CONSTRAINT "PK_gear_group_templates" TO "PK_gear_groups"
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_groups"
        RENAME CONSTRAINT "UQ_gear_group_templates_code" TO "UQ_gear_groups_code"
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_groups"
        RENAME CONSTRAINT "chk_gear_group_templates_code" TO "chk_gear_groups_code"
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_groups"
        RENAME CONSTRAINT "chk_gear_group_templates_name" TO "chk_gear_groups_name"
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_groups"
        RENAME CONSTRAINT "chk_gear_group_templates_sort" TO "chk_gear_groups_sort"
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_items"
        DROP CONSTRAINT "FK_gear_items_group"
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_items"
        ADD CONSTRAINT "FK_gear_items_group"
        FOREIGN KEY ("group_id") REFERENCES "gear_groups"("id")
        ON DELETE RESTRICT
    `);
  }
}
