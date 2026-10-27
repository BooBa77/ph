import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Каталог транспорта участника (27.10.2026).
 *
 * Заказчик: «по машинам, они как сущность будут, на уровне Снаряжение,
 * и участник может применить её на Трансфере выбором из имеющихся, а не
 * заполнением каждый раз каких-то инфополей».
 *
 * Устроено как каталог снаряжения (`gear_items`): у человека свой список
 * транспорта, а карточка похода ссылается на него (`vehicle_id`), а не
 * копирует данные. Поменял места в каталоге — поменялось во всех поездках,
 * где этот транспорт ещё не уехал.
 *
 * `RESTRICT` со стороны карточки: транспорт, который уже едет в походе,
 * нельзя удалить из каталога молча — приложение отвечает 409.
 */
export class Vehicles1792262000000 implements MigrationInterface {
  name = 'Vehicles1792262000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "vehicles" (
        "id" BIGSERIAL NOT NULL,
        "owner_user_id" uuid NOT NULL,
        "mode" character varying(20) NOT NULL,
        "title" character varying(100) NOT NULL,
        "seats" integer,
        "plate" character varying(20),
        "note" character varying(500),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_vehicles" PRIMARY KEY ("id"),
        CONSTRAINT "FK_vehicles_owner"
          FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "chk_vehicles_mode" CHECK (
          "mode" IN ('car', 'horses', 'atv', 'boat', 'airboat', 'other')
        ),
        CONSTRAINT "chk_vehicles_seats" CHECK (
          "seats" IS NULL OR "seats" > 0
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_vehicles_owner" ON "vehicles" ("owner_user_id", "id")
    `);

    /** Ссылка карточки на транспорт каталога. */
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs" ADD COLUMN "vehicle_id" bigint
    `);

    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        ADD CONSTRAINT "FK_trip_transfer_legs_vehicle"
          FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id")
          ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_trip_transfer_legs_vehicle"
          ON "trip_transfer_legs" ("vehicle_id")
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "vehicles" TO ph_app;
          GRANT USAGE, SELECT ON SEQUENCE "vehicles_id_seq" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_trip_transfer_legs_vehicle"`);
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        DROP CONSTRAINT IF EXISTS "FK_trip_transfer_legs_vehicle"
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs" DROP COLUMN IF EXISTS "vehicle_id"
    `);
    await queryRunner.query(`DROP INDEX "IDX_vehicles_owner"`);
    await queryRunner.query(`DROP TABLE "vehicles"`);
  }
}
