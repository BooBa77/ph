import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «Трансфер» похода: строки заброски, машины и пассажиры.
 *
 * Вкладка Ф7 (`docs/ph/trip-tabs.md`, «Трансфер»): «строки заброски: даты
 * и время выезда, точки отправления и прибытия, вид (авто / ж-д / автобус /
 * кони), участники в вариантах. У машины: своя или наёмная; водитель
 * выбирает пассажиров, пассажир может отказаться от назначенного
 * транспорта. Кнопка „вернуться так же“».
 *
 * **Три таблицы, а не две.** Строка отвечает на «как едем в этот раз»,
 * машина живёт внутри строки, пассажир принадлежит строке и только потом
 * получает место в машине. У поезда машины нет, а пассажиры есть — сложи
 * мы машину и строку в одну сущность, пришлось бы заводить «пустую машину»
 * для поезда.
 *
 * **Составные внешние ключи вместо одиночных.** Все связи идут через пару
 * `(trip_id, …)`: машина не может попасть в строку чужого похода, пассажир —
 * в чужую строку, водитель — быть человеком не из этого похода. Отсюда же
 * бесплатно работают правила ухода участника: его машина уходит каскадом,
 * а пассажиры этой машины остаются в строке нераспределёнными.
 *
 * **`SET NULL` только на `car_id` пассажира.** Составной ключ
 * `(leg_id, car_id)` с `SET NULL` обнулил бы и `leg_id`, а он `NOT NULL`;
 * поэтому ключ на машину одиночный, а «машина из этой же строки» проверяет
 * сервис. Это единственная связь, которую держит не база, и она названа
 * здесь, чтобы не искать её потом.
 *
 * `seats` — всего мест, включая водителя, `NULL` — не знаю. Заполненные
 * места проверяет сервис: правило про количество строк-пассажиров, а CHECK
 * видит одну строку.
 */
export class TripTransfer1792257000000 implements MigrationInterface {
  name = 'TripTransfer1792257000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "trip_transfer_legs" (
        "id" BIGSERIAL NOT NULL,
        "trip_id" bigint NOT NULL,
        "position" integer NOT NULL DEFAULT 1,
        "departs_at" timestamptz,
        "from_place" character varying(200) NOT NULL,
        "to_place" character varying(200) NOT NULL,
        "mode" character varying(20) NOT NULL DEFAULT 'car',
        "note" character varying(500),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trip_transfer_legs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_trip_transfer_legs_trip"
          FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_trip_transfer_legs_mode" CHECK (
          "mode" IN ('car', 'train', 'bus', 'horses', 'foot', 'other')
        ),
        CONSTRAINT "chk_trip_transfer_legs_position" CHECK ("position" >= 1)
      )
    `);

    /**
     * Пара `(trip_id, id)` — не для чтения, а как цель составных ключей
     * машин и пассажиров: по ней база понимает, что строка из этого похода.
     */
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_transfer_legs_trip"
          ON "trip_transfer_legs" ("trip_id", "id")
    `);

    /** Чтение вкладки: все строки похода в порядке, который задал человек. */
    await queryRunner.query(`
      CREATE INDEX "IDX_trip_transfer_legs_order"
          ON "trip_transfer_legs" ("trip_id", "position", "id")
    `);

    await queryRunner.query(`
      CREATE TABLE "trip_transfer_cars" (
        "id" BIGSERIAL NOT NULL,
        "trip_id" bigint NOT NULL,
        "leg_id" bigint NOT NULL,
        "ownership" character varying(10) NOT NULL,
        "driver_user_id" uuid,
        "driver_name" character varying(100),
        "driver_phone" character varying(40),
        "seats" integer,
        "note" character varying(500),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trip_transfer_cars" PRIMARY KEY ("id"),
        CONSTRAINT "FK_trip_transfer_cars_leg"
          FOREIGN KEY ("trip_id", "leg_id")
          REFERENCES "trip_transfer_legs"("trip_id", "id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_trip_transfer_cars_driver"
          FOREIGN KEY ("trip_id", "driver_user_id")
          REFERENCES "trip_participants"("trip_id", "user_id")
          ON DELETE CASCADE,
        CONSTRAINT "chk_trip_transfer_cars_ownership" CHECK (
          "ownership" IN ('own', 'hired')
        ),
        CONSTRAINT "chk_trip_transfer_cars_seats" CHECK (
          "seats" IS NULL OR "seats" > 0
        ),
        CONSTRAINT "chk_trip_transfer_cars_driver" CHECK (
          ("ownership" = 'own') = ("driver_user_id" IS NOT NULL)
        ),
        CONSTRAINT "chk_trip_transfer_cars_hired_name" CHECK (
          "ownership" = 'own' OR "driver_name" IS NOT NULL
        )
      )
    `);

    /** Пара `(leg_id, id)` — цель ссылки пассажира на машину своей строки. */
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_transfer_cars_leg"
          ON "trip_transfer_cars" ("leg_id", "id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_trip_transfer_cars_trip"
          ON "trip_transfer_cars" ("trip_id", "id")
    `);

    await queryRunner.query(`
      CREATE TABLE "trip_transfer_passengers" (
        "id" BIGSERIAL NOT NULL,
        "trip_id" bigint NOT NULL,
        "leg_id" bigint NOT NULL,
        "user_id" uuid NOT NULL,
        "car_id" bigint,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trip_transfer_passengers" PRIMARY KEY ("id"),
        CONSTRAINT "FK_trip_transfer_passengers_leg"
          FOREIGN KEY ("trip_id", "leg_id")
          REFERENCES "trip_transfer_legs"("trip_id", "id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_trip_transfer_passengers_member"
          FOREIGN KEY ("trip_id", "user_id")
          REFERENCES "trip_participants"("trip_id", "user_id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_trip_transfer_passengers_car"
          FOREIGN KEY ("car_id") REFERENCES "trip_transfer_cars"("id")
          ON DELETE SET NULL
      )
    `);

    /** Человек едет строкой один раз; в разных строках — сколько нужно. */
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_transfer_passengers_leg_user"
          ON "trip_transfer_passengers" ("leg_id", "user_id")
    `);

    /** Удаление машины ищет своих пассажиров по этому индексу. */
    await queryRunner.query(`
      CREATE INDEX "IDX_trip_transfer_passengers_car"
          ON "trip_transfer_passengers" ("car_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_trip_transfer_passengers_trip"
          ON "trip_transfer_passengers" ("trip_id", "id")
    `);

    /**
     * Права приложению. Последовательности выдаются явно, а не «как
     * остальным»: на проде их покрывают default privileges `ph_migrator`,
     * но блок обязан быть честным и без них.
     */
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE
            ON "trip_transfer_legs", "trip_transfer_cars",
               "trip_transfer_passengers"
            TO ph_app;
          GRANT USAGE, SELECT ON SEQUENCE
            "trip_transfer_legs_id_seq",
            "trip_transfer_cars_id_seq",
            "trip_transfer_passengers_id_seq"
            TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_trip_transfer_passengers_trip"`);
    await queryRunner.query(`DROP INDEX "IDX_trip_transfer_passengers_car"`);
    await queryRunner.query(`DROP INDEX "UQ_trip_transfer_passengers_leg_user"`);
    await queryRunner.query(`DROP TABLE "trip_transfer_passengers"`);

    await queryRunner.query(`DROP INDEX "IDX_trip_transfer_cars_trip"`);
    await queryRunner.query(`DROP INDEX "UQ_trip_transfer_cars_leg"`);
    await queryRunner.query(`DROP TABLE "trip_transfer_cars"`);

    await queryRunner.query(`DROP INDEX "IDX_trip_transfer_legs_order"`);
    await queryRunner.query(`DROP INDEX "UQ_trip_transfer_legs_trip"`);
    await queryRunner.query(`DROP TABLE "trip_transfer_legs"`);
  }
}
