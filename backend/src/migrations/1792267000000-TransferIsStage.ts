import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Этап — это рейс, а не группа рейсов (28.10.2026).
 *
 * Заказчик: «Этап — это трансфер, рейс, заброска, одна карточка, а не
 * группа. Упрощай». Цепочки `chain_id` + `stage`, которые я завёл утром,
 * оказались лишней сущностью: на экране нужны три простых списка — рейсы
 * туда, заброски, рейсы обратно, — и строка попадает в «Заброску» по
 * одному флагу.
 *
 * Здесь же снят `chk_trip_transfer_legs_round_trip`: «туда-обратно» —
 * это планирование («вернёмся тем же способом»), а не вид оплаты,
 * и общественному транспорту он тоже нужен: билеты будут на обеих
 * карточках и могут отличаться по цене.
 */
export class TransferIsStage1792267000000 implements MigrationInterface {
  name = 'TransferIsStage1792267000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs"
        ADD COLUMN "is_stage" boolean NOT NULL DEFAULT false
    `);

    // Всё, что было этапом цепочки, остаётся этапом — просто без цепочки.
    await queryRunner.query(`
      UPDATE "trip_transfer_legs" SET "is_stage" = true
       WHERE "chain_id" IS NOT NULL
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
      ALTER TABLE "trip_transfer_legs"
        DROP CONSTRAINT IF EXISTS "chk_trip_transfer_legs_round_trip"
    `);

    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs" DROP COLUMN IF EXISTS "stage"
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs" DROP COLUMN IF EXISTS "chain_id"
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_trip_transfer_legs_stage"
          ON "trip_transfer_legs" ("trip_id", "is_stage")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_trip_transfer_legs_stage"`);

    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs" ADD COLUMN "chain_id" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs" ADD COLUMN "stage" int
    `);

    // Обратно в цепочки: каждый этап становится цепочкой из одного звена.
    await queryRunner.query(`
      UPDATE "trip_transfer_legs"
         SET "chain_id" = gen_random_uuid(), "stage" = 1
       WHERE "is_stage" = true
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_trip_transfer_legs_chain"
          ON "trip_transfer_legs" ("trip_id", "chain_id", "stage")
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
      ALTER TABLE "trip_transfer_legs"
        ADD CONSTRAINT "chk_trip_transfer_legs_round_trip"
        CHECK (
          "is_round_trip" = false
          OR "mode" NOT IN ('bus', 'train', 'ship', 'helicopter')
        )
    `);

    await queryRunner.query(`
      ALTER TABLE "trip_transfer_legs" DROP COLUMN IF EXISTS "is_stage"
    `);
  }
}
