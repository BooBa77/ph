import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «Туда-обратно» — это пара карточек, а не флаг компенсации (27.10.2026).
 *
 * Заказчик: «флаг „Маршрут туда-обратно“ зеркалит трансфер в обратную
 * секцию, с пассажирами. Если пассажир ушёл из транспорта на маршруте
 * туда, он исключается и из обратного, но изменение состава пассажиров
 * обратного маршрута не влияет на целевой».
 *
 * Отсюда `round_trip_source_id`: у зеркальной карточки он указывает на
 * исходную. Каскад — чтобы убрать «туда» значило убрать и «обратно»;
 * пассажиров синхронизирует сервис, и только в одну сторону (от исходной
 * к зеркалу).
 *
 * Здесь же новые наземные способы доставки: внедорожник, грузовик, трактор,
 * вездеход — и «Авто» переименовано в «Автомобиль» в подписях (код `car`
 * не меняется, поэтому в базе правится только список CHECK).
 */
export class TransferRoundTrip1792264000000 implements MigrationInterface {
  name = 'TransferRoundTrip1792264000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        DROP CONSTRAINT IF EXISTS "chk_trip_transfer_legs_mode"
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        ADD CONSTRAINT "chk_trip_transfer_legs_mode" CHECK ("mode" IN (
          'car', 'suv', 'truck', 'tractor', 'crawler',
          'bus', 'train', 'motorcycle', 'snowmobile', 'bicycle',
          'horses', 'atv', 'boat', 'ship', 'airboat', 'helicopter', 'other'
        ))
    `);

    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        DROP CONSTRAINT IF EXISTS "chk_trip_transfer_legs_own_mode"
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        ADD CONSTRAINT "chk_trip_transfer_legs_own_mode" CHECK (
          "is_own_vehicle" = false OR "mode" IN (
            'car', 'suv', 'truck', 'tractor', 'crawler',
            'motorcycle', 'snowmobile', 'bicycle',
            'horses', 'atv', 'boat', 'airboat', 'other'
          )
        )
    `);

    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs" ADD COLUMN "round_trip_source_id" bigint
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        ADD CONSTRAINT "FK_trip_transfer_legs_round_trip"
          FOREIGN KEY ("round_trip_source_id")
          REFERENCES "trip_transfer_legs"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_trip_transfer_legs_round_trip"
          ON "trip_transfer_legs" ("round_trip_source_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_trip_transfer_legs_round_trip"`);
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        DROP CONSTRAINT IF EXISTS "FK_trip_transfer_legs_round_trip"
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        DROP COLUMN IF EXISTS "round_trip_source_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        DROP CONSTRAINT IF EXISTS "chk_trip_transfer_legs_mode"
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        ADD CONSTRAINT "chk_trip_transfer_legs_mode" CHECK ("mode" IN (
          'car', 'bus', 'train', 'motorcycle', 'snowmobile', 'bicycle',
          'horses', 'atv', 'boat', 'ship', 'airboat', 'helicopter', 'other'
        ))
    `);

    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        DROP CONSTRAINT IF EXISTS "chk_trip_transfer_legs_own_mode"
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        ADD CONSTRAINT "chk_trip_transfer_legs_own_mode" CHECK (
          "is_own_vehicle" = false OR "mode" IN (
            'car', 'motorcycle', 'snowmobile', 'bicycle',
            'horses', 'atv', 'boat', 'airboat', 'other'
          )
        )
    `);
  }
}
