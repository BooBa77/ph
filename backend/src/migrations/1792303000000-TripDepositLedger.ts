import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Залог — явные деньги в «Движении средств» (18.11.2026).
 *
 * Заказчик: «Переданные залоговые средства должны быть в балансе
 * и в движении средств… Перевод организатору — это „залог за участие“
 * в движении, у организатора соответственно уменьшается баланс, теперь
 * он должен. Удержание залога с ушедшего участника также отображается».
 *
 * Поэтому перевод залога перестаёт быть молчаливой отметкой «сдал» и
 * становится **переводом с подтверждением**, как компенсация: ожидающая
 * строка в `trip_compensations` с `kind = 'deposit'`, получатель жмёт
 * «Получено», и только тогда двигаются балансы. Отдельная таблица
 * не нужна: правила те же, что у компенсации, и вторая копия механики
 * подтверждения однажды разошлась бы с первой.
 *
 * **Удержание** — отдельная сущность `trip_deposit_forfeits`, потому что
 * это не перевод человеку: деньги остаются в фонде группы. Строка нужна
 * ленте «Движения денег» и решению «Вернуть» (по ней удержание снимается).
 *
 * **`trip_deposit_adjustments` меняет смысл.** Раньше это были строки
 * удержания «источник −залог, идущим +доля». Теперь удержание балансы
 * не двигает: отказавшийся теряет только свой перевод залога, а доля
 * продуктов остаётся его (залог её и покрывает). Корректировки нужны
 * **возврату**: если организатор вернул залог, доля ушедшего расходится
 * на идущих — «A +1000, B, C, D, E −250» из примера заказчика. Старые
 * строки от удержаний удаляются: их смысл больше не существует, и без
 * очистки балансы dev-базы остались бы посчитанными по прежней формуле.
 */
export class TripDepositLedger1792303000000 implements MigrationInterface {
  name = 'TripDepositLedger1792303000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trip_compensations"
        ADD COLUMN "kind" varchar(20) NOT NULL DEFAULT 'compensation',
        ADD CONSTRAINT "chk_trip_compensations_kind"
          CHECK ("kind" IN ('compensation', 'deposit'))
    `);

    // Лента и баланс фильтруют залоги по виду: переводов может быть много.
    await queryRunner.query(`
      CREATE INDEX "IDX_trip_compensations_trip_kind"
          ON "trip_compensations" ("trip_id", "kind")
    `);

    await queryRunner.query(`
      CREATE TABLE "trip_deposit_forfeits" (
        "id" bigserial NOT NULL,
        "trip_id" bigint NOT NULL,
        "source_user_id" uuid NOT NULL,
        "amount_rub" integer NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trip_deposit_forfeits" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_trip_deposit_forfeits_source"
          UNIQUE ("trip_id", "source_user_id"),
        CONSTRAINT "FK_trip_deposit_forfeits_trip"
          FOREIGN KEY ("trip_id") REFERENCES "trips"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_trip_deposit_forfeits_source"
          FOREIGN KEY ("source_user_id") REFERENCES "users"("id")
          ON DELETE CASCADE,
        CONSTRAINT "chk_trip_deposit_forfeits_amount"
          CHECK ("amount_rub" > 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_trip_deposit_forfeits_trip"
          ON "trip_deposit_forfeits" ("trip_id")
    `);

    // В проде приложение ходит ролью `ph_app`; в dev её может не быть.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE
              ON "trip_deposit_forfeits" TO ph_app;
          GRANT USAGE, SELECT
              ON SEQUENCE "trip_deposit_forfeits_id_seq" TO ph_app;
        END IF;
      END $$;
    `);

    // Смысл корректировок изменился (см. шапку): старые строки удержаний
    // посчитали бы баланс дважды. В проде залог ещё не выкатывался, в dev
    // строки остались от проверок 17.11.2026.
    await queryRunner.query(`DELETE FROM "trip_deposit_adjustments"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "trip_deposit_forfeits"`);
    await queryRunner.query(
      `DROP INDEX "IDX_trip_compensations_trip_kind"`,
    );
    await queryRunner.query(`
      ALTER TABLE "trip_compensations"
        DROP CONSTRAINT "chk_trip_compensations_kind",
        DROP COLUMN "kind"
    `);
  }
}
