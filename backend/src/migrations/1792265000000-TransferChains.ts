import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «Заброски» — цепочки этапов, и три уточнения заказчика (28.10.2026).
 *
 * 1. **Этапы — те же карточки.** Отдельной таблицы у заброски нет: у карточки
 *    появляются `chain_id` и `stage`, и цепочка «авто → кони → лодка»
 *    собирается из обычных строк. Права, пассажиры, места и деньги у этапа
 *    остаются прежними — новых правил не возникает. Номер этапа —
 *    производное от `departs_at`, поэтому вместе с колонкой стоит CHECK:
 *    либо оба поля заполнены, либо оба пусты.
 * 2. **«Туда-обратно» больше не привязан к компенсации.** Флаг — про
 *    трансфер и про деньги одновременно, а не про вид оплаты, поэтому
 *    `chk_trip_transfer_legs_round_trip` снимается совсем.
 * 3. **Велосипед уходит из типов транспорта.** В «Снаряжении» он остаётся
 *    (там каталог личной техники), а этапом заброски быть перестаёт:
 *    группу с вещами он не возит. Существующие строки не удаляем —
 *    переводим в «Другое», чтобы не потерять пассажиров: поездку,
 *    однажды записанную, нельзя стирать из-за правки словаря.
 */
export class TransferChains1792265000000 implements MigrationInterface {
  name = 'TransferChains1792265000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── цепочка этапов ───
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs" ADD COLUMN "chain_id" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs" ADD COLUMN "stage" int
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        ADD CONSTRAINT "chk_trip_transfer_legs_stage"
        CHECK ("stage" IS NULL OR "stage" >= 1)
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        ADD CONSTRAINT "chk_trip_transfer_legs_chain"
        CHECK (("chain_id" IS NULL) = ("stage" IS NULL))
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_trip_transfer_legs_chain"
          ON "trip_transfer_legs" ("trip_id", "chain_id", "stage")
    `);

    // ─── «туда-обратно» больше не про деньги ───
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        DROP CONSTRAINT IF EXISTS "chk_trip_transfer_legs_round_trip"
    `);

    // ─── велосипед: данные переводим до смены CHECK ───
    await queryRunner.query(`
      UPDATE "trip_transfer_legs" SET "mode" = 'other' WHERE "mode" = 'bicycle'
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        DROP CONSTRAINT IF EXISTS "chk_trip_transfer_legs_mode"
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        ADD CONSTRAINT "chk_trip_transfer_legs_mode" CHECK ("mode" IN (
          'car', 'suv', 'truck', 'tractor', 'crawler',
          'bus', 'train', 'motorcycle', 'snowmobile',
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
            'motorcycle', 'snowmobile',
            'horses', 'atv', 'boat', 'airboat', 'other'
          )
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
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

    // Прежде чем вернуть старый CHECK, приводим данные к нему.
    await queryRunner.query(`
      UPDATE "trip_transfer_legs"
         SET "is_round_trip" = false
       WHERE "compensation" NOT IN ('shared', 'sharedPerPassenger')
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        ADD CONSTRAINT "chk_trip_transfer_legs_round_trip"
        CHECK ("is_round_trip" = false
               OR "compensation" IN ('shared', 'sharedPerPassenger'))
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_trip_transfer_legs_chain"`);
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        DROP CONSTRAINT IF EXISTS "chk_trip_transfer_legs_chain"
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        DROP CONSTRAINT IF EXISTS "chk_trip_transfer_legs_stage"
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs" DROP COLUMN IF EXISTS "stage"
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs" DROP COLUMN IF EXISTS "chain_id"
    `);
  }
}
