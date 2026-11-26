import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «Мечту» можно отменить — снят CHECK `chk_trips_idea_not_cancelled`
 * (26.11.2026, миграция 104).
 *
 * Раньше идею отменять запрещали и кодом, и ограничением базы: «у неё нет
 * дат и обязательств, отменять нечего». Заказчик 26.11.2026 решил иначе
 * (`lifecycle.md` §4.6): **отменить можно всё, кроме завершённого** — и
 * «Мечту» тоже. У идеи нет дат, но есть люди, которые её ждут, и «мы туда
 * не идём» должно быть видно им, а не только автору в голове.
 *
 * Пятое состояние интерфейса при этом не хранится отдельной колонкой:
 * в базе по-прежнему три `status` плюс `cancelled_at`/`completed_at`,
 * а «Отменённый» вычисляется. Иначе потерялась бы разница «отменили
 * на этапе планирования» и «отменили решённый поход».
 *
 * Вниз — вернуть ограничение. Перед этим снимаются отметки отмены у идей:
 * CHECK не пропустил бы в таблице ни одной такой строки.
 */
export class TripCancelIdea1792398000000 implements MigrationInterface {
  name = 'TripCancelIdea1792398000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trips" DROP CONSTRAINT IF EXISTS "chk_trips_idea_not_cancelled"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "trips" SET "cancelled_at" = NULL
        WHERE "status" = 'idea' AND "cancelled_at" IS NOT NULL`,
    );

    await queryRunner.query(`
      ALTER TABLE "trips"
        ADD CONSTRAINT "chk_trips_idea_not_cancelled"
        CHECK ("status" <> 'idea' OR "cancelled_at" IS NULL)
    `);
  }
}
