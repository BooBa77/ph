import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `trips.title` → `trips.announcement`.
 *
 * Заказчик уточнил смысл поля: **имя похода — это цель**, а то, что
 * я назвал «Названием», — короткий текст для ленты. Оставить колонку
 * `title` значило бы держать в коде слово, которое означает не то, что
 * лежит внутри, — а такое расхождение через месяц стоит дороже
 * переименования сейчас.
 *
 * Именно `RENAME COLUMN`, а не «удалить и создать»: переименование
 * сохраняет данные, права и ограничения колонки, а `DROP` с `ADD` их
 * теряет. В dev походов пока нет, но миграция пишется для схемы, а не для
 * сегодняшнего содержимого таблицы.
 */
export class TripsAnnouncementRename1792051200000 implements MigrationInterface {
  name = 'TripsAnnouncementRename1792051200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trips" RENAME COLUMN "title" TO "announcement"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trips" RENAME COLUMN "announcement" TO "title"`,
    );
  }
}
