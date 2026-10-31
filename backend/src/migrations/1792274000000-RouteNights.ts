import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Таблица ночёвок (31.10.2026) — модель вкладки «Ночёвки».
 *
 * До этого шага экран жил в памяти: варианты ночи, место и готовка были
 * черновиком компонента, а распределение по палаткам никуда не уходило.
 * Теперь три таблицы.
 *
 * ## `trip_route_nights` — ночи
 *
 * Одна строка = одна ночь похода: `position` (с 1), `place` (район словами)
 * и необязательная `night_date`. **Место — на ночь, а не на вариант**
 * (ответ заказчика 31.10.2026: палатка и изба стоят в одном районе),
 * **дата — подпись, а не порядок**: дат у похода может не быть, а таблица
 * уже расписана.
 *
 * ## `trip_route_options` — варианты ночи
 *
 * «Спим в палатке Васи и в избе» — две строки. Палатка и машина — **ссылки**
 * (`trip_gear`, `trip_transfer_legs`), остальные варианты ссылок не имеют;
 * CHECK `chk_trip_route_options_source` следит, чтобы ссылка была ровно
 * у того варианта, которому она нужна. Способ готовки (`fire|stove|both`)
 * живёт у варианта: вопрос зависит от варианта, а не от места, и «гостинице»
 * готовку база не разрешает.
 *
 * ## `trip_route_lodgers` — кто где живёт
 *
 * **Распределение одно на весь поход**, не по ночам (ответ заказчика
 * 31.10.2026: «палатка у человека одна на весь поход»). Поэтому строка —
 * «человек живёт в палатке X», без ссылки на ночь, и `UNIQUE (trip_id,
 * user_id)` держит правило «одно место на поход»: переезд — правка строки,
 * а не вторая запись. `status` — заявка (`requested`) или согласие
 * (`accepted`), как у посадки в чужое ТС.
 *
 * ## Кнопки «Аналогично» нет
 *
 * Заказчик 31.10.2026 отказался от неё: «от „аналогично“ отказываемся».
 * Копировать нечего — ни людей (они живут по всему походу), ни вариантов
 * (их правят руками).
 *
 * ## Составные внешние ключи
 *
 * `trip_id` денормализован в дочерних таблицах, и все ссылки составные —
 * `(trip_id, night_id)`, `(trip_id, tent_gear_id)`, `(trip_id, car_leg_id)`,
 * `(trip_id, user_id)`. Это то же правило, что у «Трансфера»: строка
 * из чужого похода не может приехать даже при ошибке в сервисе. Ради
 * него у `trip_gear` появляется уникальный ключ `(trip_id, id)` — Postgres
 * требует уникальности ровно по ссылаемым колонкам.
 *
 * `CASCADE` везде: убрали ночь — ушли её варианты; убрали палатку из похода —
 * ушёл вариант и место живущего в ней; ушёл человек из состава — ушло
 * его место в палатке.
 */
export class RouteNights1792274000000 implements MigrationInterface {
  name = 'RouteNights1792274000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Уникальный ключ, на который ссылаются составные внешние ключи ниже.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_gear_trip_id" ON "trip_gear" ("trip_id", "id")
    `);

    // 2. Ночи.
    await queryRunner.query(`
      CREATE TABLE "trip_route_nights" (
        "id" BIGSERIAL NOT NULL,
        "trip_id" bigint NOT NULL,
        "position" integer NOT NULL,
        "place" varchar(120),
        "night_date" date,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trip_route_nights" PRIMARY KEY ("id"),
        CONSTRAINT "chk_trip_route_nights_position" CHECK ("position" >= 1),
        CONSTRAINT "chk_trip_route_nights_place"
          CHECK ("place" IS NULL
                 OR char_length(btrim("place")) BETWEEN 1 AND 120),
        CONSTRAINT "FK_trip_route_nights_trip"
          FOREIGN KEY ("trip_id") REFERENCES "trips"("id")
          ON DELETE CASCADE
      )
    `);

    // Уникальность — индексами, а не CONSTRAINT: так же объявлено в entity
    // (`@Index(..., { unique: true })`), и `schema:log` остаётся пустым.
    // `(trip_id, position)` — две «ночи 2» в походе невозможны;
    // `(trip_id, id)` — на неё ссылаются варианты составным ключом.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_route_nights_position"
        ON "trip_route_nights" ("trip_id", "position")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_route_nights_trip_id"
        ON "trip_route_nights" ("trip_id", "id")
    `);

    // 3. Варианты ночи: палатка и машина — ссылками, остальное — словами.
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
        CONSTRAINT "chk_trip_route_options_source"
          CHECK (("kind" = 'tent' AND "tent_gear_id" IS NOT NULL
                  AND "car_leg_id" IS NULL)
              OR ("kind" = 'car' AND "car_leg_id" IS NOT NULL
                  AND "tent_gear_id" IS NULL)
              OR ("kind" NOT IN ('tent', 'car')
                  AND "tent_gear_id" IS NULL AND "car_leg_id" IS NULL)),
        CONSTRAINT "chk_trip_route_options_cooking"
          CHECK ("cooking" IS NULL
                 OR ("kind" IN ('tent', 'hut', 'car')
                     AND "cooking" IN ('fire', 'stove', 'both'))),
        CONSTRAINT "FK_trip_route_options_night"
          FOREIGN KEY ("trip_id", "night_id")
          REFERENCES "trip_route_nights"("trip_id", "id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_trip_route_options_tent"
          FOREIGN KEY ("trip_id", "tent_gear_id")
          REFERENCES "trip_gear"("trip_id", "id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_trip_route_options_car"
          FOREIGN KEY ("trip_id", "car_leg_id")
          REFERENCES "trip_transfer_legs"("trip_id", "id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_trip_route_options_night"
        ON "trip_route_options" ("trip_id", "night_id", "id")
    `);

    // Одна и та же палатка (машина) в одну ночь — одна строка. `NULL`-ы
    // в Postgres различны, поэтому строкам «гостиница» и «изба» эти
    // ограничения не мешают: их дубли держит сервис.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_route_options_tent"
        ON "trip_route_options" ("trip_id", "night_id", "tent_gear_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_route_options_car"
        ON "trip_route_options" ("trip_id", "night_id", "car_leg_id")
    `);

    // 4. Кто где живёт — одно место на поход.
    await queryRunner.query(`
      CREATE TABLE "trip_route_lodgers" (
        "id" BIGSERIAL NOT NULL,
        "trip_id" bigint NOT NULL,
        "user_id" uuid NOT NULL,
        "tent_gear_id" bigint NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'accepted',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trip_route_lodgers" PRIMARY KEY ("id"),
        CONSTRAINT "chk_trip_route_lodgers_status"
          CHECK ("status" IN ('requested', 'accepted')),
        CONSTRAINT "FK_trip_route_lodgers_member"
          FOREIGN KEY ("trip_id", "user_id")
          REFERENCES "trip_participants"("trip_id", "user_id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_trip_route_lodgers_tent"
          FOREIGN KEY ("trip_id", "tent_gear_id")
          REFERENCES "trip_gear"("trip_id", "id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_trip_route_lodgers_tent"
        ON "trip_route_lodgers" ("trip_id", "tent_gear_id")
    `);

    // Одно место на поход — ключом, а не проверкой в сервисе.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_route_lodgers_person"
        ON "trip_route_lodgers" ("trip_id", "user_id")
    `);

    // 5. Права приложению — как у остальных таблиц домена. `DO $$ IF EXISTS`:
    //    в dev роли `ph_app` может не быть.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "trip_route_nights" TO ph_app;
          GRANT SELECT, INSERT, UPDATE, DELETE ON "trip_route_options" TO ph_app;
          GRANT SELECT, INSERT, UPDATE, DELETE ON "trip_route_lodgers" TO ph_app;
          GRANT USAGE, SELECT ON SEQUENCE "trip_route_nights_id_seq" TO ph_app;
          GRANT USAGE, SELECT ON SEQUENCE "trip_route_options_id_seq" TO ph_app;
          GRANT USAGE, SELECT ON SEQUENCE "trip_route_lodgers_id_seq" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_trip_route_lodgers_person"`);
    await queryRunner.query(`DROP INDEX "IDX_trip_route_lodgers_tent"`);
    await queryRunner.query(`DROP TABLE "trip_route_lodgers"`);
    await queryRunner.query(`DROP INDEX "UQ_trip_route_options_car"`);
    await queryRunner.query(`DROP INDEX "UQ_trip_route_options_tent"`);
    await queryRunner.query(`DROP INDEX "IDX_trip_route_options_night"`);
    await queryRunner.query(`DROP TABLE "trip_route_options"`);
    await queryRunner.query(`DROP INDEX "UQ_trip_route_nights_trip_id"`);
    await queryRunner.query(`DROP INDEX "UQ_trip_route_nights_position"`);
    await queryRunner.query(`DROP TABLE "trip_route_nights"`);
    await queryRunner.query(`DROP INDEX "UQ_trip_gear_trip_id"`);
  }
}
