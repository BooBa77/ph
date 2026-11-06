import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Чат «Снаряжения» у существующих походов (06.11.2026).
 *
 * Чат — тема вкладки (`docs/ph/tabs.md` §7): у «Питания», «Трансфера»
 * и «Ночёвок» он уже есть, у «Снаряжения» его не было, хотя вкладка
 * открыта с 05.11.2026 и перетасовка вещей — работа на несколько человек.
 * Новые походы получают шестой чат сразу при создании, а у созданных
 * раньше строки `trip_gear` нет: `kind` читается из базы, и новый код сам
 * по себе новых строк не добавляет.
 *
 * Мечты пропускаем: у них нет ни состава, ни подготовки, ни вкладки —
 * чат вкладки без вкладки был бы перепиской в пустоту. Условие и состав
 * строк повторяют миграции «Питания», «Трансфера» и «Ночёвок»: участники
 * попадают в `conversation_members`, хотя доступ к чатам похода считается
 * и по составу похода — строка состава нужна для «прочитано до».
 *
 * `ON CONFLICT DO NOTHING` в обеих вставках: миграция должна быть
 * безопасной при повторном прогоне после ручного восстановления строки.
 */
export class TripGearChat1792282000000 implements MigrationInterface {
  name = 'TripGearChat1792282000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "conversations" ("kind", "trip_id")
      SELECT 'trip_gear', t."id"
        FROM "trips" t
       WHERE t."status" <> 'idea'
         AND NOT EXISTS (
           SELECT 1 FROM "conversations" c
            WHERE c."trip_id" = t."id" AND c."kind" = 'trip_gear'
         )
    `);

    await queryRunner.query(`
      INSERT INTO "conversation_members" ("conversation_id", "user_id")
      SELECT c."id", p."user_id"
        FROM "conversations" c
        JOIN "trip_participants" p ON p."trip_id" = c."trip_id"
       WHERE c."kind" = 'trip_gear'
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Сообщения и строки состава уходят каскадом: чат удаляется целиком.
    await queryRunner.query(
      `DELETE FROM "conversations" WHERE "kind" = 'trip_gear'`,
    );
  }
}
