import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Группы снаряжения на вещах (31.10.2026).
 *
 * **Группа — полка каталога, а не тип.** Одна группа собирает вещи разных
 * типов: «Костровое» — топор, пилу и розжиг, «Кров» — палатку и тент.
 * Поэтому группа отдельной таблицей, а `gear_items.group_id` ссылается
 * на неё: `gear_types.group_id` не делаем (решение заказчика 30.10.2026),
 * иначе топор нельзя было бы положить в «Костровое», не переопределив тип.
 *
 * **Группа у вещи обязательна.** Каталог и снаряжение похода собраны
 * секциями по группам; вещь без полки выпала бы из них. Колонка вводится
 * в три шага — nullable, заполнение, `SET NOT NULL`, — чтобы существующие
 * вещи не остались без значения.
 *
 * **Старые вещи переезжают в «Прочее».** Заказчик разрешил старые dev-вещи
 * просто удалить, но миграция их не трогает: `DELETE` в миграции — это
 * необратимая потеря данных на проде, а «Прочее» ровно для этого и есть.
 * Вещь, которую человек заведёт заново, он разложит сам.
 *
 * **Сортировка — личная, внутри группы.** Порядок групп задаёт админ
 * (`gear_groups.sort_order`), порядок вещей — владелец каталога
 * (`gear_items.sort_order`). Старым вещам вместо нулей раскладывается
 * шаг 10: с одинаковыми нулями первая же перестановка меняла бы местами
 * две равные цифры и ничего не двигала.
 *
 * ## Какие группы заводятся
 *
 * Ровно те, что нужны «Ночёвкам» (слова заказчика 31.10.2026):
 *
 * | `code` | имя | порядок | что лежит |
 * |---|---|---|---|
 * | `roof` | Кров | 10 | палатка, тент |
 * | `campfire` | Костровое | 20 | топор, пила, розжиг |
 * | `kitchen` | Кухня | 30 | газ |
 * | `other` | Прочее | 100 | всё остальное, умолчание API |
 *
 * Это **сид в миграции**, а не справочник с закрытым списком: группы —
 * данные, их правит админ (`/api/gear/admin/groups`), и появление «Рыбалки»
 * не должно требовать миграции. `ON CONFLICT (code) DO NOTHING` оставляет
 * правки админа нетронутыми, если строка уже есть.
 *
 * «Прочее» — умолчание: `POST /api/gear` без `groupId` кладёт вещь туда,
 * поэтому архивировать `other` нельзя (409 в API).
 */
export class GearGroups1792273000000 implements MigrationInterface {
  name = 'GearGroups1792273000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Справочник групп.
    await queryRunner.query(`
      CREATE TABLE "gear_groups" (
        "id"         serial  NOT NULL,
        "code"       text    NOT NULL,
        "name"       text    NOT NULL,
        "is_active"  boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_gear_groups" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_gear_groups_code" UNIQUE ("code"),
        CONSTRAINT "chk_gear_groups_code"
          CHECK ("code" ~ '^[a-z][a-z0-9_]*$' AND char_length("code") <= 40),
        CONSTRAINT "chk_gear_groups_name"
          CHECK (char_length(btrim("name")) BETWEEN 1 AND 100),
        CONSTRAINT "chk_gear_groups_sort" CHECK ("sort_order" >= 0)
      )
    `);

    // 2. Группы для «Ночёвок» и «Прочее» — умолчание. Повторный прогон
    //    на базе, где админ уже завёл такие коды, ничего не затирает.
    await queryRunner.query(`
      INSERT INTO "gear_groups" ("code", "name", "sort_order") VALUES
        ('roof',     'Кров',      10),
        ('campfire', 'Костровое', 20),
        ('kitchen',  'Кухня',     30),
        ('other',    'Прочее',   100)
      ON CONFLICT ("code") DO NOTHING
    `);

    // 3. Полка у вещи: nullable → заполнение → NOT NULL.
    await queryRunner.query(`
      ALTER TABLE "gear_items" ADD COLUMN "group_id" integer
    `);
    await queryRunner.query(`
      UPDATE "gear_items"
         SET "group_id" = (SELECT "id" FROM "gear_groups" WHERE "code" = 'other')
       WHERE "group_id" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_items" ALTER COLUMN "group_id" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_items"
        ADD CONSTRAINT "FK_gear_items_group"
        FOREIGN KEY ("group_id") REFERENCES "gear_groups"("id")
        ON DELETE RESTRICT
    `);

    // 4. Личный порядок внутри группы: шаг 10, чтобы было куда вставлять.
    await queryRunner.query(`
      ALTER TABLE "gear_items"
        ADD COLUMN "sort_order" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      WITH ranked AS (
        SELECT "id",
               row_number() OVER (PARTITION BY "owner_user_id" ORDER BY "id") AS "position"
          FROM "gear_items"
      )
      UPDATE "gear_items" AS i
         SET "sort_order" = ranked."position" * 10
        FROM ranked
       WHERE ranked."id" = i."id"
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_items"
        ADD CONSTRAINT "chk_gear_items_sort" CHECK ("sort_order" >= 0)
    `);

    // 5. Индекс под выборку «вещи владельца в группе по порядку»: каталог
    //    сортируется именно так, и без него это сортировка всей таблицы.
    await queryRunner.query(`
      CREATE INDEX "IDX_gear_items_owner_order"
        ON "gear_items" ("owner_user_id", "group_id", "sort_order", "id")
    `);

    // 6. Права приложению — как у остальных таблиц домена. `DO $$ IF EXISTS`:
    //    в dev роли `ph_app` может не быть.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "gear_groups" TO ph_app;
          GRANT USAGE, SELECT ON SEQUENCE "gear_groups_id_seq" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_gear_items_owner_order"`);
    await queryRunner.query(`
      ALTER TABLE "gear_items" DROP CONSTRAINT "chk_gear_items_sort"
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_items" DROP COLUMN "sort_order"
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_items" DROP CONSTRAINT "FK_gear_items_group"
    `);
    await queryRunner.query(`
      ALTER TABLE "gear_items" DROP COLUMN "group_id"
    `);
    await queryRunner.query(`DROP TABLE "gear_groups"`);
  }
}
