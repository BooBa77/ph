import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Открытое участие в походе и автор приглашения (13.11.2026).
 *
 * Заказчик: «нужен чек-бокс „Открытое участие. Участники могут приглашать
 * своих“, по умолчанию true. Без этого флага неорганизаторам скрыты секции
 * „Пригласить“ и „Люди без аккаунта“». До этого приглашал только
 * организатор, а людей без аккаунта заводил любой идущий участник.
 *
 * **`trips.open_participation`** — правило самого похода, а не права роли:
 * один и тот же человек в одном походе приглашает, в другом нет. Флаг
 * по умолчанию `true`, потому что прежнее поведение для участников
 * с людьми без аккаунта было именно таким, и «ничего не выключали».
 *
 * **`trip_membership_requests.created_by_user_id`** — кто завёл тикет.
 * Без этой колонки приглашение, созданное участником, было бы видно только
 * организатору: пригласивший не увидел бы ни «ждём ответа», ни кнопки
 * «Отозвать». У заявок автор — сам заявитель, и колонка заполняется им же,
 * чтобы правило было одно: «создатель тикета его и видит».
 *
 * Для старых строк автора восстанавливаем по смыслу: приглашение заводил
 * организатор похода, заявку — заявитель. `NOT NULL` ставится после
 * backfill: тикет без автора показывать некому.
 */
export class OpenParticipation1792297000000 implements MigrationInterface {
  name = 'OpenParticipation1792297000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trips" ADD "open_participation" boolean NOT NULL DEFAULT true`,
    );

    await queryRunner.query(
      `ALTER TABLE "trip_membership_requests" ADD "created_by_user_id" uuid`,
    );

    await queryRunner.query(`
      UPDATE "trip_membership_requests" AS r
         SET "created_by_user_id" = CASE
               WHEN r."direction" = 'invite'
                 THEN (SELECT t."organizer_user_id"
                         FROM "trips" AS t
                        WHERE t."id" = r."trip_id")
               ELSE r."user_id"
             END
    `);

    await queryRunner.query(
      `ALTER TABLE "trip_membership_requests" ALTER COLUMN "created_by_user_id" SET NOT NULL`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_trip_membership_requests_creator" ON "trip_membership_requests" ("created_by_user_id")`,
    );

    await queryRunner.query(`
      ALTER TABLE "trip_membership_requests"
        ADD CONSTRAINT "FK_trip_membership_requests_creator"
        FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trip_membership_requests" DROP CONSTRAINT "FK_trip_membership_requests_creator"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_trip_membership_requests_creator"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip_membership_requests" DROP COLUMN "created_by_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trips" DROP COLUMN "open_participation"`,
    );
  }
}
