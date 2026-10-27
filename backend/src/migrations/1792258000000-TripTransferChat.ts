import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Чат «Трансфера» у существующих походов.
 *
 * Карта вкладок требует «чат по теме» у каждой вкладки подготовки, и
 * «Питание» такой чат уже получило (миграция `1792250000000`). Новые походы
 * заводят четвертый чат сразу при создании, а у походов, созданных раньше,
 * чата `trip_transfer` нет — вкладка открывается, а чата в ней не будет.
 * Здесь он заводится вместе с составом.
 *
 * Мечты пропускаем: у них нет ни состава, ни заброски.
 */
export class TripTransferChat1792258000000 implements MigrationInterface {
  name = 'TripTransferChat1792258000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "conversations" ("kind", "trip_id")
      SELECT 'trip_transfer', t."id"
        FROM "trips" t
       WHERE t."status" <> 'idea'
         AND NOT EXISTS (
           SELECT 1 FROM "conversations" c
            WHERE c."trip_id" = t."id" AND c."kind" = 'trip_transfer'
         )
    `);

    await queryRunner.query(`
      INSERT INTO "conversation_members" ("conversation_id", "user_id")
      SELECT c."id", p."user_id"
        FROM "conversations" c
        JOIN "trip_participants" p ON p."trip_id" = c."trip_id"
       WHERE c."kind" = 'trip_transfer'
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "conversations" WHERE "kind" = 'trip_transfer'`,
    );
  }
}
