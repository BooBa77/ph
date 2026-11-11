import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Семейный каталог: у физической вещи неизменный ключ `gear_uid` (11.11.2026).
 *
 * Заказчик: «у родных снаряжение общее». В прошлом шаге это дало только
 * доступ к чужой вещи в походе (`familyItems`), а сам каталог остался личным:
 * вещь родного не появлялась у меня, правки к ней не доезжали, а «общая»
 * она была ровно до тех пор, пока родство не разорвано.
 *
 * Теперь модель другая: **один физический предмет — один ключ `gear_uid`**,
 * и в каталоге каждого родного лежит **свой клон** с тем же ключом. Ключ
 * не меняется никогда: ни при объединении семьи, ни при выходе из неё.
 * Поэтому здесь три колонки:
 *
 * - `gear_uid` — ключ вещи, общий для всех клонов. Новым вещам его выдаёт
 *   сервис, в миграции каждая существующая вещь получает свой;
 * - `origin_user_id` — кто вещь завёл. По нему видно, чей это клон и кто
 *   автор, даже когда вещь уже разошлась по семье;
 * - `deleted_at` — **мягкое** удаление: удалённая вещь остаётся в походах
 *   прошлого (история не ломается), но исчезает из каталога и выбора.
 *
 * `UNIQUE (gear_uid, owner_user_id)` — один клон на человека. Без него
 * повторная «добавка в родню» плодила бы дубли одной палатки в каталоге.
 * `INDEX (gear_uid)` — по нему ищутся все клоны вещи: правка, удаление,
 * «есть у …» в архиве похода.
 *
 * ## Backfill
 *
 * Каждой существующей строке — свой `gear_uid` (`gen_random_uuid()`),
 * `origin_user_id = owner_user_id`: до этой миграции клонов не было, значит
 * автор и владелец совпадали. Затем для уже действующих пар родных
 * создаются недостающие клоны — иначе после выкатки у родных оказались бы
 * пустые каталоги, а их вещи существовали бы только у них самих.
 *
 * **Одноразовые вещи похода (`is_trip_only`) не клонируются** — это строка
 * конкретного похода, а не каталог. `sort_order` клона — в конец группы
 * владельца: чужой личный порядок не переносим.
 *
 * Клон копирует характеристики (`gear_item_attributes`): без них вещь
 * в чужом каталоге была бы без вместимости и модели, а правка после
 * объединения чинила бы это «первым касанием».
 */
export class FamilyGearUid1792291000000 implements MigrationInterface {
  name = 'FamilyGearUid1792291000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "gear_items"
        ADD COLUMN "gear_uid" uuid NOT NULL DEFAULT gen_random_uuid(),
        ADD COLUMN "origin_user_id" uuid,
        ADD COLUMN "deleted_at" timestamptz
    `);

    // Существующая вещь — сама себе автор: клонов до этой миграции не было.
    await queryRunner.query(`
      UPDATE "gear_items"
         SET "origin_user_id" = "owner_user_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "gear_items"
        ALTER COLUMN "origin_user_id" SET NOT NULL
    `);

    // Сырые вставки в тестах и `check-trips-schema.mjs` знают только
    // владельца: ключ выдаёт DEFAULT, автора — триггер. Сервис заполняет
    // оба поля явно; это страховка, а не второй источник правды.
    await queryRunner.query(`
      CREATE FUNCTION "set_gear_items_origin"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."origin_user_id" IS NULL THEN
          NEW."origin_user_id" := NEW."owner_user_id";
        END IF;
        RETURN NEW;
      END
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_gear_items_origin"
        BEFORE INSERT ON "gear_items"
        FOR EACH ROW EXECUTE FUNCTION "set_gear_items_origin"()
    `);

    await queryRunner.query(`
      ALTER TABLE "gear_items"
        ADD CONSTRAINT "FK_gear_items_origin"
        FOREIGN KEY ("origin_user_id") REFERENCES "users"("id")
        ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_gear_items_uid_owner"
          ON "gear_items" ("gear_uid", "owner_user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_gear_items_gear_uid"
          ON "gear_items" ("gear_uid")
    `);

    await this.syncExistingFamilies(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Клоны этой миграции отдельными строками не удаляем: после `DROP
    // COLUMN` они станут обычными вещами в каталогах, и удалять чужие
    // данные на откате миграции — хуже, чем оставить. Снимаем только
    // схему.
    await queryRunner.query(
      `DROP TRIGGER "trg_gear_items_origin" ON "gear_items"`,
    );
    await queryRunner.query(`DROP FUNCTION "set_gear_items_origin"()`);
    await queryRunner.query(`DROP INDEX "IDX_gear_items_gear_uid"`);
    await queryRunner.query(`DROP INDEX "UQ_gear_items_uid_owner"`);
    await queryRunner.query(
      `ALTER TABLE "gear_items" DROP CONSTRAINT "FK_gear_items_origin"`,
    );
    await queryRunner.query(`
      ALTER TABLE "gear_items"
        DROP COLUMN "deleted_at",
        DROP COLUMN "origin_user_id",
        DROP COLUMN "gear_uid"
    `);
  }

  /**
   * Клоны для действующих пар родных.
   *
   * Идём по каждой паре `accepted` в обе стороны и заводим недостающие
   * клоны. `NOT EXISTS` по `(gear_uid, owner_user_id)` делает шаг
   * идемпотентным — повторный запуск ничего не задваивает.
   *
   * `sort_order` считается «в конец группы владельца» одним запросом
   * на клон; при нескольких новых вещах одного типа они получат одинаковый
   * номер и встанут по `id` — это допустимо: каталог всё равно сортирует
   * стрелками, а первый же `move` перенумерует группу целиком.
   */
  private async syncExistingFamilies(queryRunner: QueryRunner): Promise<void> {
    const pairs = `
      SELECT fl."user_a_id" AS owner_id, fl."user_b_id" AS other_id
        FROM "family_links" fl
       WHERE fl."status" = 'accepted'
      UNION ALL
      SELECT fl."user_b_id" AS owner_id, fl."user_a_id" AS other_id
        FROM "family_links" fl
       WHERE fl."status" = 'accepted'
    `;

    await queryRunner.query(`
      INSERT INTO "gear_items" (
        "owner_user_id", "gear_type_id", "sort_order", "title",
        "weight_grams", "location", "note", "is_trip_only",
        "gear_uid", "origin_user_id"
      )
      SELECT pair.other_id,
             item."gear_type_id",
             COALESCE((
               SELECT MAX(sibling."sort_order")
                 FROM "gear_items" sibling
                WHERE sibling."owner_user_id" = pair.other_id
             ), 0) + 10,
             item."title",
             item."weight_grams",
             item."location",
             item."note",
             false,
             item."gear_uid",
             item."origin_user_id"
        FROM (${pairs}) pair
        JOIN "gear_items" item
          ON item."owner_user_id" = pair.owner_id
         AND item."is_trip_only" = false
        JOIN "users" owner
          ON owner."id" = pair.other_id
         AND owner."deleted_at" IS NULL
       WHERE NOT EXISTS (
         SELECT 1
           FROM "gear_items" clone
          WHERE clone."gear_uid" = item."gear_uid"
            AND clone."owner_user_id" = pair.other_id
       )
    `);

    // Характеристики клона: копия значений исходной вещи. `ON CONFLICT`
    // прикрывает расхождение, если у кого-то уже была строка значения.
    await queryRunner.query(`
      INSERT INTO "gear_item_attributes" (
        "gear_item_id", "gear_type_attribute_id",
        "number_value", "text_value", "bool_value"
      )
      SELECT clone."id",
             source_value."gear_type_attribute_id",
             source_value."number_value",
             source_value."text_value",
             source_value."bool_value"
        FROM "gear_items" clone
        JOIN "gear_items" source
          ON source."gear_uid" = clone."gear_uid"
         AND source."id" <> clone."id"
        JOIN "gear_item_attributes" source_value
          ON source_value."gear_item_id" = source."id"
       WHERE NOT EXISTS (
         SELECT 1
           FROM "gear_item_attributes" own_value
          WHERE own_value."gear_item_id" = clone."id"
            AND own_value."gear_type_attribute_id" =
                source_value."gear_type_attribute_id"
       )
      ON CONFLICT ("gear_item_id", "gear_type_attribute_id") DO NOTHING
    `);
  }
}
