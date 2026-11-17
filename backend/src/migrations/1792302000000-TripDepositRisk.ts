import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Залог как риск: удержание становится доходом фонда группы (17.11.2026).
 *
 * Заказчик подтвердил формулу удержания: «A −залог, каждому идущему
 * +залог/число идущих». Значит, удержанный залог — не запись «на память»,
 * а деньги, которые перераспределяются между идущими: у отказавшегося
 * баланс уменьшается на сумму залога, у каждого идущего растёт на её долю.
 * Сумма по всем по-прежнему ноль.
 *
 * **Почему отдельная таблица, а не расход.** Расход — это «кто-то заплатил
 * за кого-то» с положительной суммой (`chk_trip_expenses_amount > 0`),
 * а удержание — перераспределение уже уплаченного залога, и у его источника
 * сумма отрицательная. Провести его двумя расходами или компенсацией
 * значило бы показать в ленте перевод, которого люди не делали.
 *
 * **Строки фиксируются на момент удержания**, как доли расхода: если после
 * удержания из похода выйдет ещё кто-то, уже распределённая сумма не
 * пересчитывается — деньги на тот момент поделены, и переписывать прошлое
 * нельзя. Поэтому же здесь лежит `source_user_id`: по нему удержание
 * отменяется одной пачкой, когда организатор передумал и вернул залог.
 *
 * **`deposit_holder_user_id`** — у кого залог на руках: участник переводит
 * его организатору (прямых переводов между участниками в приложении нет),
 * и в блоке видно, кому именно. На балансы этот перевод не влияет: залог
 * двигает их только в момент удержания.
 */
export class TripDepositRisk1792302000000 implements MigrationInterface {
  name = 'TripDepositRisk1792302000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trip_participants"
        ADD COLUMN "deposit_holder_user_id" uuid NULL,
        ADD CONSTRAINT "FK_trip_participants_deposit_holder"
          FOREIGN KEY ("deposit_holder_user_id") REFERENCES "users"("id")
          ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "trip_deposit_adjustments" (
        "id" bigserial NOT NULL,
        "trip_id" bigint NOT NULL,
        "source_user_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "amount_rub" integer NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trip_deposit_adjustments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_trip_deposit_adjustments_trip"
          FOREIGN KEY ("trip_id") REFERENCES "trips"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_trip_deposit_adjustments_source"
          FOREIGN KEY ("source_user_id") REFERENCES "users"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_trip_deposit_adjustments_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE,
        CONSTRAINT "chk_trip_deposit_adjustments_amount"
          CHECK ("amount_rub" <> 0)
      )
    `);

    // Баланс читает все строки похода; отмена удержания — по источнику.
    await queryRunner.query(`
      CREATE INDEX "IDX_trip_deposit_adjustments_trip"
          ON "trip_deposit_adjustments" ("trip_id", "source_user_id")
    `);

    // В проде приложение ходит ролью `ph_app`; в dev её может не быть.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE
              ON "trip_deposit_adjustments" TO ph_app;
          GRANT USAGE, SELECT
              ON SEQUENCE "trip_deposit_adjustments_id_seq" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "trip_deposit_adjustments"`);

    await queryRunner.query(`
      ALTER TABLE "trip_participants"
        DROP CONSTRAINT "FK_trip_participants_deposit_holder",
        DROP COLUMN "deposit_holder_user_id"
    `);
  }
}
