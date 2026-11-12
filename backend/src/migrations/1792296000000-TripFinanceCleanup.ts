import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Чистая схема расходов: без default у даты и с простым индексом.
 *
 * Первая миграция `TripFinance` создала `spent_at` с `DEFAULT CURRENT_DATE`
 * и индекс `(trip_id, spent_at, id)`. `schema:log` показал дрейф:
 *
 * 1. TypeORM нормализует `CURRENT_DATE` в `('now'::text)::date` и каждый
 *    раз хочет переписать default. Дату всё равно всегда ставит сервис
 *    («не передали — сегодня»), поэтому default не нужен ни в базе,
 *    ни в entity.
 * 2. Индекс с первичным ключом в хвосте TypeORM считает «другим» и
 *    пересоздаёт при каждой сверке. Для выборки расходов похода хватает
 *    индекса по `trip_id`: строк на поход немного, сортировка по дате
 *    идёт уже по отфильтрованному набору.
 *
 * Отдельная миграция, а не правка применённой: `TripFinance` уже в dev,
 * а применённая миграция — только вперёд.
 */
export class TripFinanceCleanup1792296000000 implements MigrationInterface {
  name = 'TripFinanceCleanup1792296000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_trip_expenses_trip_spent"`,
    );
    await queryRunner.query(`
      CREATE INDEX "IDX_trip_expenses_trip"
          ON "trip_expenses" ("trip_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_expenses"
        ALTER COLUMN "spent_at" DROP DEFAULT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trip_expenses"
        ALTER COLUMN "spent_at" SET DEFAULT CURRENT_DATE
    `);
    await queryRunner.query(`DROP INDEX "public"."IDX_trip_expenses_trip"`);
    await queryRunner.query(`
      CREATE INDEX "IDX_trip_expenses_trip_spent"
          ON "trip_expenses" ("trip_id", "spent_at", "id")
    `);
  }
}
