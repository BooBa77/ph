import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «Бухгалтерия» похода: расходы, доли и компенсации (11.11.2026).
 *
 * Заказчик: «таблица движения денег, колонки — дата, кто, сколько, за что,
 * кнопка подтверждения; всем видны все записи; строки с расходами
 * редактируются авторами; итоговый баланс пользователя; кнопки „Добавить
 * расход“ и „Компенсация“».
 *
 * **Три таблицы, а не одна.** Расход и компенсация — разные вещи: расход
 * делится на людей и баланс меняет сразу (деньги уже потрачены),
 * компенсация — это перевод между людьми, и баланс двигает только
 * подтверждение получателя. Свести их в одну таблицу значило бы держать
 * в каждой строке поля, которые относятся только к её виду.
 *
 * **Доли — отдельные строки.** Баланс считается по ним, а не по «поделить
 * на количество» на лету: состав похода меняется, а арифметика прошедшей
 * траты меняться не должна. Остаток от деления раскладывается по рублю
 * первым по порядку (сервис), сумма долей всегда равна расходу.
 *
 * `split` хранит способ деления (`all` / `group` / `commonEaters`):
 * подпись «на всех · по 2 000 ₽» должна пережить изменение состава.
 *
 * Компенсация знает только два состояния: `pending` и `confirmed`.
 * «Не получено» нет — банковские переводы идут с задержкой.
 */
export class TripFinance1792295000000 implements MigrationInterface {
  name = 'TripFinance1792295000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "trip_expenses" (
        "id" bigserial NOT NULL,
        "trip_id" bigint NOT NULL,
        "author_user_id" uuid NOT NULL,
        "amount_rub" integer NOT NULL,
        "description" character varying(200) NOT NULL,
        "split" character varying(20) NOT NULL DEFAULT 'group',
        "spent_at" date NOT NULL DEFAULT CURRENT_DATE,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trip_expenses" PRIMARY KEY ("id"),
        CONSTRAINT "FK_trip_expenses_trip"
          FOREIGN KEY ("trip_id") REFERENCES "trips"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_trip_expenses_author"
          FOREIGN KEY ("author_user_id") REFERENCES "users"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "chk_trip_expenses_amount" CHECK ("amount_rub" > 0),
        CONSTRAINT "chk_trip_expenses_description"
          CHECK (length(btrim("description")) > 0),
        CONSTRAINT "chk_trip_expenses_split"
          CHECK ("split" IN ('all', 'group', 'commonEaters'))
      )
    `);

    // Таблица движения денег сортируется по дате траты и id.
    await queryRunner.query(`
      CREATE INDEX "IDX_trip_expenses_trip_spent"
          ON "trip_expenses" ("trip_id", "spent_at", "id")
    `);

    await queryRunner.query(`
      CREATE TABLE "trip_expense_shares" (
        "expense_id" bigint NOT NULL,
        "user_id" uuid NOT NULL,
        "amount_rub" integer NOT NULL,
        CONSTRAINT "PK_trip_expense_shares"
          PRIMARY KEY ("expense_id", "user_id"),
        CONSTRAINT "FK_trip_expense_shares_expense"
          FOREIGN KEY ("expense_id") REFERENCES "trip_expenses"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_trip_expense_shares_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "chk_trip_expense_shares_amount" CHECK ("amount_rub" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "trip_compensations" (
        "id" bigserial NOT NULL,
        "trip_id" bigint NOT NULL,
        "from_user_id" uuid NOT NULL,
        "to_user_id" uuid NOT NULL,
        "amount_rub" integer NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'pending',
        "confirmed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trip_compensations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_trip_compensations_trip"
          FOREIGN KEY ("trip_id") REFERENCES "trips"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_trip_compensations_from"
          FOREIGN KEY ("from_user_id") REFERENCES "users"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_trip_compensations_to"
          FOREIGN KEY ("to_user_id") REFERENCES "users"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "chk_trip_compensations_amount" CHECK ("amount_rub" > 0),
        CONSTRAINT "chk_trip_compensations_status"
          CHECK ("status" IN ('pending', 'confirmed')),
        CONSTRAINT "chk_trip_compensations_self"
          CHECK ("from_user_id" <> "to_user_id"),
        CONSTRAINT "chk_trip_compensations_confirmed"
          CHECK (("status" = 'confirmed') = ("confirmed_at" IS NOT NULL))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_trip_compensations_trip_created"
          ON "trip_compensations" ("trip_id", "created_at")
    `);
    // «Мне на подтверждение» — выборка по получателю и статусу.
    await queryRunner.query(`
      CREATE INDEX "IDX_trip_compensations_to_status"
          ON "trip_compensations" ("to_user_id", "status")
    `);

    // Миграция даёт приложению то, что ему нужно; в проде default privileges
    // `ph_migrator` это же и выдают, но блок дублирует — как в MessageActions.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "trip_expenses" TO ph_app;
          GRANT SELECT, INSERT, UPDATE, DELETE
              ON "trip_expense_shares" TO ph_app;
          GRANT SELECT, INSERT, UPDATE, DELETE
              ON "trip_compensations" TO ph_app;
          GRANT USAGE, SELECT ON SEQUENCE "trip_expenses_id_seq" TO ph_app;
          GRANT USAGE, SELECT ON SEQUENCE "trip_compensations_id_seq" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Дочерняя таблица уходит первой: внешний ключ ссылается на расходы.
    await queryRunner.query(`DROP TABLE "trip_compensations"`);
    await queryRunner.query(`DROP TABLE "trip_expense_shares"`);
    await queryRunner.query(`DROP TABLE "trip_expenses"`);
  }
}
