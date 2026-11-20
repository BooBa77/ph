import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Удаление слоя фактических дат похода: `trips.actual_started_at` и
 * `actual_finished_at` (21.11.2026).
 *
 * План — [trips.md](../docs/ph/trips.md) §1 и [lifecycle.md](../docs/ph/lifecycle.md)
 * §8, п. 8: поля не используются, вместо них отвечают присутствие
 * (`trip_participants.started_at` / `returned_at`, миграция 89) и завершение
 * похода (`trips.completed_at`, миграция 94).
 *
 * **Третья правда оказалась лишней.** «Вышли на маршрут» и «вернулись» — это
 * про конкретного человека, а не про поход: у группы один поход заканчивается
 * в разные дни, и одна дата на всех этот вопрос описывала хуже, чем отметки
 * присутствия. Плюс поход завершается решением автора, а не датой.
 *
 * **Данные не теряются:** на момент удаления слой был пуст и на dev (база
 * собрана заново 20.11.2026), и на проде — 0 походов, 18 миграций
 * (проверено 21.11.2026). Если когда-нибудь понадобится «план против факта»
 * в масштабе похода, это будет решение заказчика и новая колонка, а не
 * возврат этих двух.
 *
 * `down()` возвращает и колонки, и оба CHECK — миграция обратима, даже если
 * откат нужен только чтобы сверить историю.
 */
export class DropActualTripDates1792307000000 implements MigrationInterface {
  name = 'DropActualTripDates1792307000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trips"
        DROP CONSTRAINT IF EXISTS "chk_trips_actual_dates_order",
        DROP CONSTRAINT IF EXISTS "chk_trips_actual_finish_needs_start",
        DROP COLUMN IF EXISTS "actual_started_at",
        DROP COLUMN IF EXISTS "actual_finished_at"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trips"
        ADD COLUMN "actual_started_at" timestamptz,
        ADD COLUMN "actual_finished_at" timestamptz
    `);
    await queryRunner.query(`
      ALTER TABLE "trips"
        ADD CONSTRAINT "chk_trips_actual_dates_order"
          CHECK ("actual_started_at" IS NULL OR "actual_finished_at" IS NULL
                 OR "actual_finished_at" >= "actual_started_at"),
        ADD CONSTRAINT "chk_trips_actual_finish_needs_start"
          CHECK ("actual_finished_at" IS NULL OR "actual_started_at" IS NOT NULL)
    `);
  }
}
