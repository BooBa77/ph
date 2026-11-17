import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Присутствие на маршруте (17.11.2026).
 *
 * Заказчик: «В продолжение, запланировано отметки о присутствии на маршруте».
 * Решение 16.11.2026 (`lifecycle.md` §5, §6): присутствие — **перекличка**,
 * а не «факт похода». Даты похода не меняются; первая отметка не делает
 * поход начавшимся, последняя не закрывает. Отдельный слой `actual_*`
 * (у `trips`) не используем — это наследие, его уберёт отдельная миграция.
 *
 * Почему на `trip_participants`, а не отдельной таблицей событий: нужен
 * **текущий** статус человека, а история переходов пока не требуется —
 * `presence_updated_by` и время отметки отвечают на вопрос «кто и когда».
 * Понадобится «кто когда нажал» — появится таблица событий, и это будет
 * дополнение, а не переделка: текущее состояние всё равно нужно отдельно.
 *
 * `presence_source` (`self`/`other`) — не «кто это», а «сам или за него»:
 * заказчик разрешил любому идущему отмечать любого, включая людей без
 * аккаунта, и при подписи «отметил Сергей» важно не потерять, кто нажал.
 * `ON DELETE SET NULL` — удаление аккаунта не стирает отметку о человеке.
 *
 * CHECK `returned_at` без `started_at` запрещает «вернулся, не выходя»:
 * сервис ставит начало и при отметке возвращения, а база не даст сохранить
 * противоречие мимо API.
 */
export class TripPresence1792301000000 implements MigrationInterface {
  name = 'TripPresence1792301000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trip_participants"
        ADD COLUMN "started_at" timestamptz NULL,
        ADD COLUMN "returned_at" timestamptz NULL,
        ADD COLUMN "presence_updated_by" uuid NULL,
        ADD COLUMN "presence_source" varchar(10) NULL,
        ADD CONSTRAINT "chk_trip_participants_presence_source"
          CHECK ("presence_source" IS NULL OR "presence_source" IN ('self', 'other')),
        ADD CONSTRAINT "chk_trip_participants_presence_order"
          CHECK ("returned_at" IS NULL OR "started_at" IS NOT NULL),
        ADD CONSTRAINT "FK_trip_participants_presence_updated_by"
          FOREIGN KEY ("presence_updated_by") REFERENCES "users"("id")
          ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trip_participants"
        DROP CONSTRAINT "FK_trip_participants_presence_updated_by",
        DROP CONSTRAINT "chk_trip_participants_presence_order",
        DROP CONSTRAINT "chk_trip_participants_presence_source",
        DROP COLUMN "presence_source",
        DROP COLUMN "presence_updated_by",
        DROP COLUMN "returned_at",
        DROP COLUMN "started_at"
    `);
  }
}
