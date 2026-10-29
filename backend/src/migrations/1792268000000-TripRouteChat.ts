import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Чат «Ночёвок» (табора) у существующих походов.
 *
 * Карта вкладок требует «чат по теме» у каждой вкладки подготовки, и чаты
 * «Питания» (`1792250000000`) и «Трансфера» (`1792258000000`) заводились
 * так же. Новые походы получают пятый чат сразу при создании, а у походов,
 * созданных раньше, строки `trip_route` нет — вкладка открывается, а чата
 * в ней не будет: `kind` читается из базы, и новый код сам по себе новых
 * строк не добавляет.
 *
 * Мечты пропускаем: у них нет ни состава, ни подготовки, и чат вкладки
 * без вкладки — переписка в пустоту. Составленные строки повторяют
 * миграцию «Трансфера»: участники попадают в `conversation_members`, хотя
 * для чатов похода доступ считается и по составу похода — строка состава
 * нужна для «прочитано до».
 */
export class TripRouteChat1792268000000 implements MigrationInterface {
  name = 'TripRouteChat1792268000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "conversations" ("kind", "trip_id")
      SELECT 'trip_route', t."id"
        FROM "trips" t
       WHERE t."status" <> 'idea'
         AND NOT EXISTS (
           SELECT 1 FROM "conversations" c
            WHERE c."trip_id" = t."id" AND c."kind" = 'trip_route'
         )
    `);

    await queryRunner.query(`
      INSERT INTO "conversation_members" ("conversation_id", "user_id")
      SELECT c."id", p."user_id"
        FROM "conversations" c
        JOIN "trip_participants" p ON p."trip_id" = c."trip_id"
       WHERE c."kind" = 'trip_route'
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "conversations" WHERE "kind" = 'trip_route'`,
    );
  }
}
