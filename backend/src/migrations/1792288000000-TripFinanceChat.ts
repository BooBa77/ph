import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Чат «Бухгалтерии» у существующих походов (09.11.2026).
 *
 * Заказчик: «И шаг вперёд — открывай закладку Бухгалтерия. Пока пустую
 * с чатом». Пустая вкладка — это место под расходы, а чат в ней нужен
 * сразу: расходы сначала обсуждают, потом считают, и переписка не должна
 * ждать появления таблицы. Чат — тема вкладки (`docs/ph/tabs.md` §7),
 * поэтому у него свой вид `trip_finance`, а не общий «чат похода».
 *
 * Схему это не меняет: `conversations.kind` — колонка без CHECK, новый вид
 * живёт кодом (`CHAT_KINDS`). Миграция нужна ровно затем, чтобы чат
 * появился у **уже созданных** походов: новые получают восьмой чат сразу
 * в `TripsService.create`.
 *
 * Мечты пропускаем: у них нет ни состава, ни подготовки, ни вкладки —
 * чат вкладки без вкладки был бы перепиской в пустоту. Условие и состав
 * строк повторяют миграции «Питания», «Трансфера», «Ночёвок», «Снаряжения»
 * и «Аптечки»: участники попадают в `conversation_members`, хотя доступ
 * к чатам похода считается и по составу похода — строка состава нужна
 * для «прочитано до».
 *
 * `ON CONFLICT DO NOTHING` в обеих вставках: миграция должна быть
 * безопасной при повторном прогоне после ручного восстановления строки.
 */
export class TripFinanceChat1792288000000 implements MigrationInterface {
  name = 'TripFinanceChat1792288000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "conversations" ("kind", "trip_id")
      SELECT 'trip_finance', t."id"
        FROM "trips" t
       WHERE t."status" <> 'idea'
         AND NOT EXISTS (
           SELECT 1 FROM "conversations" c
            WHERE c."trip_id" = t."id" AND c."kind" = 'trip_finance'
         )
    `);

    await queryRunner.query(`
      INSERT INTO "conversation_members" ("conversation_id", "user_id")
      SELECT c."id", p."user_id"
        FROM "conversations" c
        JOIN "trip_participants" p ON p."trip_id" = c."trip_id"
       WHERE c."kind" = 'trip_finance'
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Сообщения и строки состава уходят каскадом: чат удаляется целиком.
    await queryRunner.query(
      `DELETE FROM "conversations" WHERE "kind" = 'trip_finance'`,
    );
  }
}
