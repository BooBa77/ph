import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «Трансфер», вторая редакция (27.10.2026): карточка перемещения вместо
 * строки с машинами.
 *
 * Разбор заказчика: «каждое перемещение каждой части группы оформляем
 * отдельной плашкой», «нужно чётко разделить области „Туда“ и „Обратно“»,
 * «вид изменяем на „Способ доставки“», «добавляем флаг „наше ТС“»,
 * «секция компенсации расходов».
 *
 * **Машины как отдельная сущность убраны.** В первой редакции под строкой
 * жили машины с водителями и местами, и выходило, что строка и машина —
 * почти одно и то же, только у поезда машины нет. Теперь карточка сама
 * знает способ доставки, места и владельца, а пять человек в одной машине
 * и трое в другой — это две карточки.
 *
 * **Данные первой редакции не переносятся**: в проде этих таблиц ещё нет
 * (там 18 миграций), а в dev лежали только демонстрационные строки для
 * снимков экрана. Машины удаляются вместе с назначениями (пассажиры
 * остаются в карточках, просто без мест), время проставляется текущим,
 * чтобы `departs_at` стал обязательным без пустых значений.
 *
 * CHECK-и держат правила, которые иначе пришлось бы помнить сервису:
 * «наше ТС» бывает только с владельцем, личным транспортом не могут быть
 * автобус, поезд, корабль и вертолёт, цена билета — только у них же,
 * общие расходы — только у своего транспорта, «туда-обратно» — только
 * у общих расходов.
 */
export class TripTransferV21792259000000 implements MigrationInterface {
  name = 'TripTransferV21792259000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── Убираем машины: их роль играет сама карточка ───
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_passengers"
        DROP CONSTRAINT IF EXISTS "FK_trip_transfer_passengers_car"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_trip_transfer_passengers_car"
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_passengers"
        DROP COLUMN IF EXISTS "car_id"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "trip_transfer_cars"`);

    // ─── Карточка: сторона, способ, владелец, места, компенсация ───
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        ADD COLUMN "direction" character varying(10) NOT NULL DEFAULT 'there',
        ADD COLUMN "is_own_vehicle" boolean NOT NULL DEFAULT false,
        ADD COLUMN "owner_user_id" uuid,
        ADD COLUMN "seats" integer,
        ADD COLUMN "compensation" character varying(20) NOT NULL DEFAULT 'free',
        ADD COLUMN "compensation_amount_rub" integer,
        ADD COLUMN "is_round_trip" boolean NOT NULL DEFAULT false
    `);

    /** Время отправления стало обязательным: пустые строки получают «сейчас». */
    await queryRunner.query(`
      UPDATE "trip_transfer_legs" SET "departs_at" = now()
       WHERE "departs_at" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        ALTER COLUMN "departs_at" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        ADD CONSTRAINT "chk_trip_transfer_legs_direction"
          CHECK ("direction" IN ('there', 'back')),
        ADD CONSTRAINT "chk_trip_transfer_legs_compensation"
          CHECK ("compensation" IN (
            'free', 'ticket', 'shared', 'sharedPerPassenger'
          )),
        ADD CONSTRAINT "chk_trip_transfer_legs_seats"
          CHECK ("seats" IS NULL OR "seats" > 0),
        ADD CONSTRAINT "chk_trip_transfer_legs_amount"
          CHECK ("compensation_amount_rub" IS NULL
                 OR "compensation_amount_rub" >= 0)
    `);

    /** «Наше ТС» бывает только с владельцем, и наоборот. */
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        ADD CONSTRAINT "chk_trip_transfer_legs_own"
          CHECK ("is_own_vehicle" = ("owner_user_id" IS NOT NULL))
    `);

    /** Личным транспортом не могут быть рейсы: автобус, ж/д, корабль, вертолёт. */
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        ADD CONSTRAINT "chk_trip_transfer_legs_own_mode"
          CHECK ("is_own_vehicle" = false
                 OR "mode" IN (
                   'car', 'horses', 'atv', 'boat', 'airboat', 'other'
                 ))
    `);

    /** Цена билета — только у рейсов. */
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        ADD CONSTRAINT "chk_trip_transfer_legs_ticket"
          CHECK ("compensation" <> 'ticket'
                 OR "mode" IN ('bus', 'train', 'ship', 'helicopter'))
    `);

    /** Общий расход — только у своего транспорта. */
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        ADD CONSTRAINT "chk_trip_transfer_legs_shared"
          CHECK ("compensation" NOT IN ('shared', 'sharedPerPassenger')
                 OR "mode" NOT IN ('bus', 'train', 'ship', 'helicopter'))
    `);

    /** «Туда-обратно» — только у общих расходов. */
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        ADD CONSTRAINT "chk_trip_transfer_legs_round_trip"
          CHECK ("is_round_trip" = false
                 OR "compensation" IN ('shared', 'sharedPerPassenger'))
    `);

    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        ADD CONSTRAINT "FK_trip_transfer_legs_owner"
          FOREIGN KEY ("trip_id", "owner_user_id")
          REFERENCES "trip_participants"("trip_id", "user_id")
          ON DELETE CASCADE
    `);

    /** Порядок внутри стороны: список «туда» и список «обратно» отдельные. */
    await queryRunner.query(`DROP INDEX "IDX_trip_transfer_legs_order"`);
    await queryRunner.query(`
      CREATE INDEX "IDX_trip_transfer_legs_order"
          ON "trip_transfer_legs" ("trip_id", "direction", "position", "id")
    `);

    // ─── Пассажир: заявка и въезд ───
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_passengers"
        ADD COLUMN "status" character varying(20) NOT NULL DEFAULT 'accepted'
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_passengers"
        ADD CONSTRAINT "chk_trip_transfer_passengers_status"
          CHECK ("status" IN ('requested', 'accepted'))
    `);

    /** Новые столбцы — те же права, что у таблиц: DML на всю таблицу. */
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE
            ON "trip_transfer_legs", "trip_transfer_passengers"
            TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_passengers"
        DROP CONSTRAINT IF EXISTS "chk_trip_transfer_passengers_status"
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_passengers"
        DROP COLUMN IF EXISTS "status"
    `);

    await queryRunner.query(`DROP INDEX "IDX_trip_transfer_legs_order"`);
    await queryRunner.query(`
      CREATE INDEX "IDX_trip_transfer_legs_order"
          ON "trip_transfer_legs" ("trip_id", "position", "id")
    `);

    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        DROP CONSTRAINT IF EXISTS "FK_trip_transfer_legs_owner",
        DROP CONSTRAINT IF EXISTS "chk_trip_transfer_legs_round_trip",
        DROP CONSTRAINT IF EXISTS "chk_trip_transfer_legs_shared",
        DROP CONSTRAINT IF EXISTS "chk_trip_transfer_legs_ticket",
        DROP CONSTRAINT IF EXISTS "chk_trip_transfer_legs_own_mode",
        DROP CONSTRAINT IF EXISTS "chk_trip_transfer_legs_own",
        DROP CONSTRAINT IF EXISTS "chk_trip_transfer_legs_amount",
        DROP CONSTRAINT IF EXISTS "chk_trip_transfer_legs_seats",
        DROP CONSTRAINT IF EXISTS "chk_trip_transfer_legs_compensation",
        DROP CONSTRAINT IF EXISTS "chk_trip_transfer_legs_direction"
    `);

    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        ALTER COLUMN "departs_at" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        DROP COLUMN IF EXISTS "is_round_trip",
        DROP COLUMN IF EXISTS "compensation_amount_rub",
        DROP COLUMN IF EXISTS "compensation",
        DROP COLUMN IF EXISTS "seats",
        DROP COLUMN IF EXISTS "owner_user_id",
        DROP COLUMN IF EXISTS "is_own_vehicle",
        DROP COLUMN IF EXISTS "direction"
    `);

    // ─── Возвращаем машины первой редакции ───
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
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_transfer_cars_leg"
          ON "trip_transfer_cars" ("leg_id", "id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_trip_transfer_cars_trip"
          ON "trip_transfer_cars" ("trip_id", "id")
    `);

    await queryRunner.query(`
      ALTER TABLE "trip_transfer_passengers"
        ADD COLUMN "car_id" bigint
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_trip_transfer_passengers_car"
          ON "trip_transfer_passengers" ("car_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_passengers"
        ADD CONSTRAINT "FK_trip_transfer_passengers_car"
          FOREIGN KEY ("car_id") REFERENCES "trip_transfer_cars"("id")
          ON DELETE SET NULL
    `);
  }
}
