import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Автономное питание: у участника с флагом «питаюсь отдельно» появляется
 * своя еда — продукты, раскладка, пакеты и чек-лист.
 *
 * До этой миграции отдельный едок был только флагом: он не попадал в М/Ж,
 * не получал пакетов, и приложение его еду не считало («личное — твоя
 * проблема», `meals.md` §5.6). Заказчик решил считать: человек ведёт свою
 * раскладку по тем же дням и приёмам, но количества считаются на него
 * одного.
 *
 * **Личный слой — это те же таблицы с владельцем.** Новая колонка
 * `eater_user_id` (NULL — общая еда) у приёмов, пакетов и отметок
 * чек-листа; у продуктов — `owner_user_id`. Ссылочные таблицы (строки,
 * блюда, доли, исключения) остаются как были: они висят на приёме или
 * пакете, а те уже знают, чьи они.
 *
 * **Уникальность — внутри слоя.** Индексы стали частичными: имя продукта
 * и пакета, номер приёма и строка чек-листа уникальны отдельно для общей
 * еды и отдельно для каждого едока. Иначе «Пакет 1» участника занимал бы
 * имя общего пакета, а «Гречка» из личного плана ломала бы общий
 * чек-лист. `eater_user_id IS NULL` в частичном индексе — это и есть
 * «общий слой»: NULL в обычном уникальном индексе не сравнивается,
 * и без `WHERE` второй общий приём прошёл бы.
 *
 * **Чьи данные — того и права.** Личный слой не видит завхоз: он правит
 * общую еду, но не читает чужую личную. Приложение проверяет это
 * в сервисе, а не в базе.
 */
export class TripMealAutonomy1792255000000 implements MigrationInterface {
  name = 'TripMealAutonomy1792255000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── приёмы: чья раскладка ──
    await queryRunner.query(
      `ALTER TABLE "trip_meals" ADD COLUMN "eater_user_id" uuid`,
    );
    await queryRunner.query(`
      ALTER TABLE "trip_meals" ADD CONSTRAINT "FK_trip_meals_eater"
        FOREIGN KEY ("eater_user_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`DROP INDEX "UQ_trip_meals_slot"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_meals_slot"
          ON "trip_meals" ("trip_id", "day_index", "kind")
       WHERE "eater_user_id" IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_meals_personal_slot"
          ON "trip_meals" ("trip_id", "eater_user_id", "day_index", "kind")
       WHERE "eater_user_id" IS NOT NULL
    `);

    // ── пакеты: чья тара ──
    await queryRunner.query(
      `ALTER TABLE "trip_meal_packages" ADD COLUMN "eater_user_id" uuid`,
    );
    await queryRunner.query(`
      ALTER TABLE "trip_meal_packages" ADD CONSTRAINT "FK_trip_meal_packages_eater"
        FOREIGN KEY ("eater_user_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`DROP INDEX "UQ_trip_meal_packages_name"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_meal_packages_name"
          ON "trip_meal_packages" ("trip_id", "name")
       WHERE "eater_user_id" IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_meal_packages_personal_name"
          ON "trip_meal_packages" ("trip_id", "eater_user_id", "name")
       WHERE "eater_user_id" IS NOT NULL
    `);

    // ── продукты: свои у едока ──
    await queryRunner.query(
      `ALTER TABLE "trip_products" ADD COLUMN "owner_user_id" uuid`,
    );
    await queryRunner.query(`
      ALTER TABLE "trip_products" ADD CONSTRAINT "FK_trip_products_owner"
        FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`DROP INDEX "UQ_trip_products_name"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_products_name"
          ON "trip_products" ("trip_id", "name")
       WHERE "owner_user_id" IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_products_personal_name"
          ON "trip_products" ("trip_id", "owner_user_id", "name")
       WHERE "owner_user_id" IS NOT NULL
    `);

    // ── чек-лист: общий и свой ──
    await queryRunner.query(
      `ALTER TABLE "trip_meal_checks" ADD COLUMN "eater_user_id" uuid`,
    );
    await queryRunner.query(`
      ALTER TABLE "trip_meal_checks" ADD CONSTRAINT "FK_trip_meal_checks_eater"
        FOREIGN KEY ("eater_user_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`DROP INDEX "UQ_trip_meal_checks_product"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_meal_checks_product"
          ON "trip_meal_checks" ("trip_id", "product_id")
       WHERE "eater_user_id" IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_meal_checks_personal"
          ON "trip_meal_checks" ("trip_id", "eater_user_id", "product_id")
       WHERE "eater_user_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_trip_meal_checks_personal"`);
    await queryRunner.query(`DROP INDEX "UQ_trip_meal_checks_product"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_meal_checks_product"
          ON "trip_meal_checks" ("trip_id", "product_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_meal_checks" DROP CONSTRAINT "FK_trip_meal_checks_eater"
    `);
    await queryRunner.query(
      `ALTER TABLE "trip_meal_checks" DROP COLUMN "eater_user_id"`,
    );

    await queryRunner.query(`DROP INDEX "UQ_trip_products_personal_name"`);
    await queryRunner.query(`DROP INDEX "UQ_trip_products_name"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_products_name"
          ON "trip_products" ("trip_id", "name")
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_products" DROP CONSTRAINT "FK_trip_products_owner"
    `);
    await queryRunner.query(
      `ALTER TABLE "trip_products" DROP COLUMN "owner_user_id"`,
    );

    await queryRunner.query(
      `DROP INDEX "UQ_trip_meal_packages_personal_name"`,
    );
    await queryRunner.query(`DROP INDEX "UQ_trip_meal_packages_name"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_meal_packages_name"
          ON "trip_meal_packages" ("trip_id", "name")
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_meal_packages" DROP CONSTRAINT "FK_trip_meal_packages_eater"
    `);
    await queryRunner.query(
      `ALTER TABLE "trip_meal_packages" DROP COLUMN "eater_user_id"`,
    );

    await queryRunner.query(`DROP INDEX "UQ_trip_meals_personal_slot"`);
    await queryRunner.query(`DROP INDEX "UQ_trip_meals_slot"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_meals_slot"
          ON "trip_meals" ("trip_id", "day_index", "kind")
    `);
    await queryRunner.query(
      `ALTER TABLE "trip_meals" DROP CONSTRAINT "FK_trip_meals_eater"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_meals" DROP COLUMN "eater_user_id"`,
    );
  }
}
