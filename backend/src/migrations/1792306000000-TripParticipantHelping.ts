import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Статус `helping` — «помогаю, но не иду» (20.11.2026).
 *
 * Заказчик: «соорганизатор может быть `helping` и `maybe` — роль не зависит
 * от того, идёт он сам или помогает»
 * ([lifecycle.md](../docs/ph/lifecycle.md) §4.5). 17.11.2026 значение
 * убрали из словаря как «роль, а не участие»; решение отменено, и слово
 * возвращается в CHECK `chk_trip_participants_status`.
 *
 * **Почему миграцией, а не только правкой словаря.** Ограничение живёт
 * в базе: без него `INSERT`/`UPDATE` со `helping` упал бы в 500 на CHECK-е,
 * а приложение выглядело бы сломанным. CHECK в entity собирается из
 * `PARTICIPANT_STATUSES`, поэтому список значений здесь повторён явно —
 * миграция не импортирует прикладной код (иначе она читала бы `dist`,
 * которого в момент выкатки может не быть).
 *
 * `down` возвращает прежний CHECK без `helping`. Строки со `helping`
 * в этот момент упадут — это нормально для откатa схемы, который делают
 * руками и осознанно: сначала статусы правят, потом откатывают миграцию.
 */
export class TripParticipantHelping1792306000000
  implements MigrationInterface
{
  name = 'TripParticipantHelping1792306000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trip_participants"
        DROP CONSTRAINT "chk_trip_participants_status"
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_participants"
        ADD CONSTRAINT "chk_trip_participants_status"
        CHECK ("status" IN ('invited', 'going', 'maybe', 'helping', 'declined'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trip_participants"
        DROP CONSTRAINT "chk_trip_participants_status"
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_participants"
        ADD CONSTRAINT "chk_trip_participants_status"
        CHECK ("status" IN ('invited', 'going', 'maybe', 'declined'))
    `);
  }
}
