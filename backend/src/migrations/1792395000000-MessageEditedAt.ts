import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Метка правки сообщения — `messages.edited_at` (25.11.2026).
 *
 * Правка и удаление своего сообщения появились 25.11.2026 (коммит `8ddfaeb`),
 * но контракт остался неполным: переписка не могла показать «изменено»,
 * потому что в базе не было времени правки. `created_at` для этого не
 * годится: он отвечает за порядок в переписке и за курсор `before`, и
 * трогать его при правке значило бы переставлять сообщение на новое место.
 *
 * Поэтому отдельная nullable-колонка:
 *
 * - `NULL` — сообщение не правили (в том числе только что созданное);
 * - `timestamptz` — момент последней правки автором. Обновляется при каждой
 *   правке: «изменено» показывает свежее время, а не первое.
 *
 * Миграция только добавляет колонку: существующие строки остаются на месте,
 * данные не переписываются, индекс не нужен — `edited_at` нигде не
 * фильтруется и не сортирует, только отдаётся в DTO.
 *
 * Системные сообщения и текст уведомлений о переводе, который переписывает
 * автосогласие через 72 часа, значение не получают: это не правка автора,
 * а действие системы.
 */
export class MessageEditedAt1792395000000 implements MigrationInterface {
  name = 'MessageEditedAt1792395000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "messages" ADD "edited_at" timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "edited_at"`);
  }
}
