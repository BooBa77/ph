import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Вкладка «Аптечка»: своя область чек-листов, вес и чат (09.11.2026).
 *
 * ## Что просил заказчик
 *
 * «Открываем закладку Аптечка. Примерно как Снаряжение, две секции —
 * Общественная (если назначен Доктор) и Личная + чат по аптечке. В секциях
 * по одному чек-листу… Итогом каждой секции поле для ввода веса получившейся
 * аптечки. В распределении весов по рюкзакам общественную аптечку назначаем
 * доктору… Личную аптечку как „Мои продукты“ отображаем в Личном рюкзаке.
 * Если вес не известен, то в расчётах считай за 0, и не отображай вес
 * вообще».
 *
 * ## Почему область, а не новый вид списка
 *
 * `checklists` уже умеет четыре области (`scope`): шаблон, общий список
 * похода, личный и рекомендацию. Аптечка — не пятый `scope`: общественная
 * аптечка по устройству тот же «список похода», личная — тот же «личный
 * список». Различие в том, **чьей вкладке** они принадлежат, и это отдельная
 * ось. Поэтому колонка `area` (`gear` | `first_aid`), а правила доступа
 * считаются по паре «область + область списка»: аптечку правит вкладка
 * `firstAid` (доктор, организатор), снаряжение — `gear`.
 *
 * Уникальность списков теперь считается с областью: иначе общественная
 * аптечка заняла бы единственное место общего списка «Снаряжения».
 * Частичные уникальные индексы пересоздаются с `area` в составе.
 *
 * ## Вес
 *
 * `weight_grams` — итог готовой аптечки. `NULL` — «ещё не взвесили»:
 * в раскладке такая аптечка весит 0, а на экране цифры нет. `CHECK`
 * не пропускает 0: ноль и «неизвестно» — разные состояния, и одна колонка
 * не должна означать оба.
 *
 * ## Чат
 *
 * Чат — тема вкладки (`tabs.md` §7). Строка `conversations` создаётся
 * у существующих походов здесь, у новых — `TripsService.create`. Мечты
 * пропускаем: у них нет ни состава, ни подготовки, ни вкладки.
 */
export class FirstAid1792286000000 implements MigrationInterface {
  name = 'FirstAid1792286000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Область и вес аптечки.
    await queryRunner.query(`
      ALTER TABLE "checklists"
        ADD COLUMN "area" varchar(20) NOT NULL DEFAULT 'gear'
    `);
    await queryRunner.query(`
      ALTER TABLE "checklists"
        ADD CONSTRAINT "chk_checklists_area"
        CHECK ("area" IN ('gear', 'first_aid'))
    `);
    await queryRunner.query(`
      ALTER TABLE "checklists"
        ADD COLUMN "weight_grams" integer
    `);
    await queryRunner.query(`
      ALTER TABLE "checklists"
        ADD CONSTRAINT "chk_checklists_weight"
        CHECK ("weight_grams" IS NULL OR "weight_grams" > 0)
    `);

    /**
     * 2. Уникальность — с областью. Индексы пересоздаются, а не
     * добавляются: старого состава уже недостаточно, и лишний индекс
     * запретил бы вторую область.
     */
    await queryRunner.query(`DROP INDEX "UQ_checklists_trip_shared"`);
    await queryRunner.query(`DROP INDEX "UQ_checklists_trip_personal"`);
    await queryRunner.query(`DROP INDEX "UQ_checklists_trip_recommendation"`);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_checklists_trip_shared"
          ON "checklists" ("trip_id", "area")
       WHERE "scope" = 'trip'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_checklists_trip_personal"
          ON "checklists" ("trip_id", "owner_user_id", "area")
       WHERE "scope" = 'personal'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_checklists_trip_recommendation"
          ON "checklists" ("trip_id", "area")
       WHERE "scope" = 'recommendation'
    `);

    // 3. Чат вкладки у уже созданных походов.
    await queryRunner.query(`
      INSERT INTO "conversations" ("kind", "trip_id")
      SELECT 'trip_first_aid', t."id"
        FROM "trips" t
       WHERE t."status" <> 'idea'
         AND NOT EXISTS (
           SELECT 1 FROM "conversations" c
            WHERE c."trip_id" = t."id" AND c."kind" = 'trip_first_aid'
         )
    `);

    await queryRunner.query(`
      INSERT INTO "conversation_members" ("conversation_id", "user_id")
      SELECT c."id", p."user_id"
        FROM "conversations" c
        JOIN "trip_participants" p ON p."trip_id" = c."trip_id"
       WHERE c."kind" = 'trip_first_aid'
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /**
     * Списки аптечки уходят вместе с областью: после отката колонки `area`
     * нет, и оставить их значило бы превратить аптечку в снаряжение.
     * Пункты идут каскадом. Сообщения чата — каскадом от `conversations`.
     */
    await queryRunner.query(`DELETE FROM "checklists" WHERE "area" = 'first_aid'`);
    await queryRunner.query(
      `DELETE FROM "conversations" WHERE "kind" = 'trip_first_aid'`,
    );

    await queryRunner.query(`DROP INDEX "UQ_checklists_trip_shared"`);
    await queryRunner.query(`DROP INDEX "UQ_checklists_trip_personal"`);
    await queryRunner.query(`DROP INDEX "UQ_checklists_trip_recommendation"`);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_checklists_trip_shared"
          ON "checklists" ("trip_id")
       WHERE "scope" = 'trip'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_checklists_trip_personal"
          ON "checklists" ("trip_id", "owner_user_id")
       WHERE "scope" = 'personal'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_checklists_trip_recommendation"
          ON "checklists" ("trip_id")
       WHERE "scope" = 'recommendation'
    `);

    await queryRunner.query(`
      ALTER TABLE "checklists" DROP CONSTRAINT "chk_checklists_weight"
    `);
    await queryRunner.query(`
      ALTER TABLE "checklists" DROP CONSTRAINT "chk_checklists_area"
    `);
    await queryRunner.query(
      `ALTER TABLE "checklists" DROP COLUMN "weight_grams"`,
    );
    await queryRunner.query(`ALTER TABLE "checklists" DROP COLUMN "area"`);
  }
}
