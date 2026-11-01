import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Один вариант ночёвки на ночь и личная секция «Спальник» (01.11.2026).
 *
 * ## Что меняет заказчик
 *
 * «сколько не объяснял, ты всё равно по своему сделал… Меняем! На одну ночь
 * один вариант ночёвки»; «в секции Ночёвки уходит выбор палатки,
 * распределение по палаткам действует на весь поход»; «не связываем машины
 * из Трансфера и ночёвки в машинах»; «добавляем личную секцию „Спальник“».
 *
 * ## Один вариант — колонки ночи
 *
 * До шага варианты жили таблицей `trip_route_options` и комбинировались:
 * часть группы в палатке, часть в гостинице. Комбинированных ночей больше
 * нет, поэтому `kind` и `cooking` переезжают в `trip_route_nights`,
 * а таблица вариантов удаляется вместе со ссылками на палатку
 * (`tent_gear_id`) и машину (`car_leg_id`): палатка — дело распределения
 * на весь поход (`trip_route_lodgers`), а машины с «Трансфером» заказчик
 * связать не просил.
 *
 * **Что делать с уже записанными комбинированными ночами.** У ночи остаётся
 * **первый по id вариант** — тот, который человек выбрал раньше остальных,
 * и обычно главный («ночуем в палатке, часть уходит в гостиницу»).
 * Остальные строки уходят вместе с таблицей: восстановить их некуда, а
 * оставлять «полуночь» в новой модели нельзя. Миграция необратима по этим
 * данным, и это осознанно: таблица вариантов ни разу не выкатывалась
 * на прод (там 18 миграций из 64), а dev-стенд — не источник истины.
 *
 * ## Пустые значения
 *
 * `kind IS NULL` — вариант ещё не выбрали; на экране это «идём всю ночь».
 * `place` и `cooking` при таком виде недопустимы, поэтому миграция их
 * обнуляет **до** включения CHECK-ов: старые правила сервиса такого
 * не пропускали, но схема должна быть честной даже на кривой строке.
 *
 * ## «Спальник» — своя таблица
 *
 * `trip_route_sleeping` ссылается на **предмет каталога** человека
 * (`gear_items`), а не на снаряжение похода: секция личная, название и вес
 * пилюля берёт из каталога. `(trip_id, user_id)` составной ключ на состав:
 * ушёл человек — ушли его вещи. Вещь удалили из каталога — строка исчезает
 * каскадом, а не остаётся ссылкой в никуда. `UNIQUE (trip_id, user_id,
 * gear_item_id)` запрещает добавить одну вещь дважды, но количество вещей
 * не ограничено: «можно добавлять сколько угодно спальников и ковриков».
 *
 * **Тип «Коврик» (`mat`)** заводится здесь, а не только сидом: без него
 * кнопке «Добавить коврик» нечего предложить, а `seed:gear-types` мог
 * не прогоняться. Сид тоже знает про `mat` — повторная вставка безопасна
 * (`ON CONFLICT DO NOTHING`).
 */
export class RouteNightSingleSleeping1792276000000
  implements MigrationInterface
{
  name = 'RouteNightSingleSleeping1792276000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Вариант ночи становится её колонками.
    await queryRunner.query(
      `ALTER TABLE "trip_route_nights" ADD COLUMN "kind" varchar(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_route_nights" ADD COLUMN "cooking" varchar(10)`,
    );

    // 2. Перенос: у ночи остаётся первый по id вариант.
    await queryRunner.query(`
      UPDATE "trip_route_nights" AS n
         SET "kind" = o."kind",
             "cooking" = o."cooking"
        FROM (
          SELECT DISTINCT ON ("night_id")
                 "night_id", "kind", "cooking"
            FROM "trip_route_options"
           ORDER BY "night_id", "id"
        ) AS o
       WHERE o."night_id" = n."id"
    `);

    // 3. Пустое место и пустая готовка не должны ронять новые CHECK-и.
    //    Старый сервис такого не пропускал, но миграция обязана быть
    //    безопасной и на кривой строке.
    await queryRunner.query(`
      UPDATE "trip_route_nights"
         SET "place" = NULL
       WHERE "place" IS NOT NULL
         AND ("kind" IS NULL
              OR "kind" NOT IN ('tent', 'hotel', 'hut', 'car'))
    `);
    await queryRunner.query(`
      UPDATE "trip_route_nights"
         SET "cooking" = NULL
       WHERE "cooking" IS NOT NULL
         AND ("kind" IS NULL OR "kind" NOT IN ('tent', 'hut', 'car'))
    `);

    // 4. Правила ночи — в базе, а не только в сервисе.
    await queryRunner.query(`
      ALTER TABLE "trip_route_nights"
        ADD CONSTRAINT "chk_trip_route_nights_kind"
          CHECK ("kind" IS NULL
                 OR "kind" IN ('tent', 'hotel', 'hut', 'car',
                               'allnight', 'transit'))
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_route_nights"
        ADD CONSTRAINT "chk_trip_route_nights_cooking"
          CHECK ("cooking" IS NULL
                 OR ("kind" IS NOT NULL
                     AND "kind" IN ('tent', 'hut', 'car')
                     AND "cooking" IN ('fire', 'stove', 'both')))
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_route_nights"
        ADD CONSTRAINT "chk_trip_route_nights_place_kind"
          CHECK ("place" IS NULL
                 OR ("kind" IS NOT NULL
                     AND "kind" IN ('tent', 'hotel', 'hut', 'car')))
    `);

    // 5. Таблица вариантов больше не нужна: индексы и внешние ключи уходят
    //    вместе с ней. `UQ_trip_route_nights_trip_id` держал составной ключ
    //    вариантов на ночь — теперь на ночь никто не ссылается.
    await queryRunner.query(`DROP TABLE "trip_route_options"`);
    await queryRunner.query(`DROP INDEX "UQ_trip_route_nights_trip_id"`);

    // 6. Личные спальник и коврик.
    await queryRunner.query(`
      CREATE TABLE "trip_route_sleeping" (
        "id" BIGSERIAL NOT NULL,
        "trip_id" bigint NOT NULL,
        "user_id" uuid NOT NULL,
        "gear_item_id" bigint NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trip_route_sleeping" PRIMARY KEY ("id"),
        CONSTRAINT "FK_trip_route_sleeping_trip"
          FOREIGN KEY ("trip_id") REFERENCES "trips"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_trip_route_sleeping_member"
          FOREIGN KEY ("trip_id", "user_id")
          REFERENCES "trip_participants"("trip_id", "user_id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_trip_route_sleeping_gear"
          FOREIGN KEY ("gear_item_id") REFERENCES "gear_items"("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_route_sleeping_item"
        ON "trip_route_sleeping" ("trip_id", "user_id", "gear_item_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_trip_route_sleeping_person"
        ON "trip_route_sleeping" ("trip_id", "user_id")
    `);

    // 7. Тип «Коврик»: без него кнопке нечего предложить.
    await queryRunner.query(`
      INSERT INTO "gear_types" ("code", "name", "sort_order")
      VALUES ('mat', 'Коврик', 0)
      ON CONFLICT ("code") DO NOTHING
    `);

    // 8. Права приложению — как у остальных таблиц домена.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "trip_route_sleeping" TO ph_app;
          GRANT USAGE, SELECT ON SEQUENCE "trip_route_sleeping_id_seq" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Обратно — схема вариантов, но без ссылок на палатку и машину: вверх
    // они осознанно потеряны, и выдумывать их вниз нельзя. Ночные переходы
    // и гостиницы/избы восстанавливаются, «палатка» и «машина» — без
    // ссылок, то есть старый код на них ответил бы 400.
    await queryRunner.query(`DROP INDEX "IDX_trip_route_sleeping_person"`);
    await queryRunner.query(`DROP INDEX "UQ_trip_route_sleeping_item"`);
    await queryRunner.query(`DROP TABLE "trip_route_sleeping"`);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_route_nights_trip_id"
        ON "trip_route_nights" ("trip_id", "id")
    `);

    await queryRunner.query(`
      CREATE TABLE "trip_route_options" (
        "id" BIGSERIAL NOT NULL,
        "trip_id" bigint NOT NULL,
        "night_id" bigint NOT NULL,
        "kind" varchar(20) NOT NULL,
        "tent_gear_id" bigint,
        "car_leg_id" bigint,
        "cooking" varchar(10),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trip_route_options" PRIMARY KEY ("id"),
        CONSTRAINT "chk_trip_route_options_kind"
          CHECK ("kind" IN ('tent', 'hotel', 'hut', 'car',
                            'allnight', 'transit')),
        CONSTRAINT "chk_trip_route_options_cooking"
          CHECK ("cooking" IS NULL
                 OR ("kind" IN ('tent', 'hut', 'car')
                     AND "cooking" IN ('fire', 'stove', 'both'))),
        CONSTRAINT "FK_trip_route_options_night"
          FOREIGN KEY ("trip_id", "night_id")
          REFERENCES "trip_route_nights"("trip_id", "id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      INSERT INTO "trip_route_options" ("trip_id", "night_id", "kind", "cooking")
      SELECT "trip_id", "id", "kind", "cooking"
        FROM "trip_route_nights"
       WHERE "kind" IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "trip_route_nights"
        DROP CONSTRAINT "chk_trip_route_nights_place_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_route_nights"
        DROP CONSTRAINT "chk_trip_route_nights_cooking"
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_route_nights"
        DROP CONSTRAINT "chk_trip_route_nights_kind"
    `);
    await queryRunner.query(
      `ALTER TABLE "trip_route_nights" DROP COLUMN "cooking"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_route_nights" DROP COLUMN "kind"`,
    );
  }
}
