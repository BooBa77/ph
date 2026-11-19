import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Офлайн-чеки: `client_id` у расхода (19.11.2026).
 *
 * Заказчик: «создание расходных чеков должно быть доступно оффлайн
 * (за наличку)» ([lifecycle.md](../docs/ph/lifecycle.md) §3). В поле связи
 * нет, чек рождается на телефоне и уезжает на сервер позже — значит ключ
 * идемпотентности должен придумать телефон, а не база. `client_id` —
 * UUID с устройства: повторная отправка после обрыва находит уже созданную
 * строку и ничего не дублирует.
 *
 * **Почему не `id` от устройства, как у дневника.** У расхода `id` —
 * `bigserial`, на него ссылаются доли (`trip_expense_shares.expense_id`)
 * и строки залога; менять ключ после синхронизации пришлось бы вместе
 * с ними. Отдельная колонка дешевле и не трогает существующую схему.
 *
 * **`UNIQUE (trip_id, client_id)`** — ключ уникален в пределах похода,
 * как и решили в `lifecycle.md` §3: два устройства одного человека в двух
 * походах могут выдать один UUID без вреда. `NULL` в Postgres уникальности
 * не мешает, поэтому обычные чеки (онлайн, без `client_id`) живут как
 * жили: у них колонка пустая.
 */
export class TripExpenseClientId1792304000000 implements MigrationInterface {
  name = 'TripExpenseClientId1792304000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trip_expenses"
        ADD COLUMN "client_id" uuid
    `);

    // Ищем по ключу идемпотентности при каждой синхронизации;
    // уникальность не даёт двум отправкам создать два чека.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_expenses_client"
          ON "trip_expenses" ("trip_id", "client_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_trip_expenses_client"`);
    await queryRunner.query(`
      ALTER TABLE "trip_expenses" DROP COLUMN "client_id"
    `);
  }
}
