import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Чат питания у существующих походов.
 *
 * Новые походы получают третий чат сразу при создании (и «Мечта →
 * Планирую» достраивает его), а у походов, созданных раньше, чата
 * `trip_meals` нет — вкладка «Питание» открывается, а чата в ней нет.
 * Здесь он заводится вместе с составом: чат питания — для участников,
 * как членский.
 *
 * Мечты пропускаем: у них нет ни состава, ни раскладки.
 */
export class TripMealsChat1792250000000 implements MigrationInterface {
  name = 'TripMealsChat1792250000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "conversations" ("kind", "trip_id")
      SELECT 'trip_meals', t."id"
        FROM "trips" t
       WHERE t."status" <> 'idea'
         AND NOT EXISTS (
           SELECT 1 FROM "conversations" c
            WHERE c."trip_id" = t."id" AND c."kind" = 'trip_meals'
         )
    `);

    await queryRunner.query(`
      INSERT INTO "conversation_members" ("conversation_id", "user_id")
      SELECT c."id", p."user_id"
        FROM "conversations" c
        JOIN "trip_participants" p ON p."trip_id" = c."trip_id"
       WHERE c."kind" = 'trip_meals'
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "conversations" WHERE "kind" = 'trip_meals'`,
    );
  }
}
