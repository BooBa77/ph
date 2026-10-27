import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Способы доставки второй редакции (27.10.2026).
 *
 * Миграция первой редакции завела CHECK со старым списком
 * (`car`, `train`, `bus`, `horses`, `foot`, `other`). Вторая редакция
 * заменила список — «пешком» убрано, добавлены квадроцикл, лодка, корабль,
 * аэролодка и вертолёт, — но сам CHECK остался прежним, и вставка нового
 * способа падала нарушением ограничения (500 вместо понятного ответа).
 *
 * Здесь же убраны DEFAULT у `direction` и `mode`: в модели значения по
 * умолчанию нет, способ и сторону человек выбирает всегда, а «тихий»
 * дефолт в базе расходился бы с entity и с `schema:log`.
 */
export class TripTransferModes1792261000000 implements MigrationInterface {
  name = 'TripTransferModes1792261000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        DROP CONSTRAINT IF EXISTS "chk_trip_transfer_legs_mode"
    `);

    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        ADD CONSTRAINT "chk_trip_transfer_legs_mode"
          CHECK ("mode" IN (
            'car', 'bus', 'train', 'horses', 'atv',
            'boat', 'ship', 'airboat', 'helicopter', 'other'
          ))
    `);

    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        ALTER COLUMN "direction" DROP DEFAULT,
        ALTER COLUMN "mode" DROP DEFAULT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        ALTER COLUMN "direction" SET DEFAULT 'there',
        ALTER COLUMN "mode" SET DEFAULT 'car'
    `);

    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        DROP CONSTRAINT IF EXISTS "chk_trip_transfer_legs_mode"
    `);

    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        ADD CONSTRAINT "chk_trip_transfer_legs_mode"
          CHECK ("mode" IN ('car', 'train', 'bus', 'horses', 'foot', 'other'))
    `);
  }
}
