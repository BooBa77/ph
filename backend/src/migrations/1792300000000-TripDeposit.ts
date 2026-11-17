import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Залог участия в походе (17.11.2026).
 *
 * Заказчик: «Добавь по этому поводу доработку в Бухгалтерию — залог.
 * Организатор может установить залог на участие, размести это над секцией
 * Движение денег. Если участник отваливается и уже понёс расходы, залог ему
 * не возвращается, при выходе ему стоит выдать уведомление о залоге».
 *
 * Почему это **две колонки в разных таблицах**, а не новая сущность:
 *
 * - `trips.deposit_rub` — сумма залога одна на поход (`finance.md` §2.5):
 *   разные суммы превращали бы равных участников в «близких» и «дальних»;
 * - `trip_participants.deposit_status` — состояние конкретного человека:
 *   надо сдать, сдан, возвращён, удержан. Отметку ставит организатор, и
 *   рядом лежит, кто и когда её поставил: залог держится на прозрачности,
 *   а не на удержаниях.
 *
 * **Залог не пишется в «Движение денег» и в балансы.** Заказчик назвал его
 * «вопросом совести»: взысканий из будущих расчётов нет. Деньги уходят
 * организатору или в общий расход (тогда организатор заводит обычный чек
 * руками), а обеспечительный платёж, проведённый ещё и по балансу, посчитал
 * бы одну сумму дважды.
 *
 * `deposit_updated_by` — `SET NULL`: удаление аккаунта не должно стирать
 * историю залога и само участие; авторство отметки просто станет пустым.
 * Отдельного `none` в статусе нет: «залога нет» — это `deposit_rub = NULL`.
 */
export class TripDeposit1792300000000 implements MigrationInterface {
  name = 'TripDeposit1792300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trips"
        ADD COLUMN "deposit_rub" integer NULL,
        ADD CONSTRAINT "chk_trips_deposit_positive"
          CHECK ("deposit_rub" IS NULL OR "deposit_rub" > 0)
    `);

    await queryRunner.query(`
      ALTER TABLE "trip_participants"
        ADD COLUMN "deposit_status" varchar(20) NOT NULL DEFAULT 'pending',
        ADD COLUMN "deposit_updated_by" uuid NULL,
        ADD COLUMN "deposit_updated_at" timestamptz NULL,
        ADD CONSTRAINT "chk_trip_participants_deposit_status"
          CHECK ("deposit_status" IN ('pending', 'held', 'returned', 'forfeited')),
        ADD CONSTRAINT "FK_trip_participants_deposit_updated_by"
          FOREIGN KEY ("deposit_updated_by") REFERENCES "users"("id")
          ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trip_participants"
        DROP CONSTRAINT "FK_trip_participants_deposit_updated_by",
        DROP CONSTRAINT "chk_trip_participants_deposit_status",
        DROP COLUMN "deposit_updated_at",
        DROP COLUMN "deposit_updated_by",
        DROP COLUMN "deposit_status"
    `);

    await queryRunner.query(`
      ALTER TABLE "trips"
        DROP CONSTRAINT "chk_trips_deposit_positive",
        DROP COLUMN "deposit_rub"
    `);
  }
}
