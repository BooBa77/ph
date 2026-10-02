import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropUnusedUserFieldsAndAddDisplayNameHistory1790844913946
  implements MigrationInterface
{
  name = 'DropUnusedUserFieldsAndAddDisplayNameHistory1790844913946';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth_identities" DROP CONSTRAINT "FK_auth_identities_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sessions" DROP CONSTRAINT "FK_sessions_user"`,
    );
    await queryRunner.query(
      `CREATE TABLE "display_name_history" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "old_name" character varying(50) NOT NULL, "new_name" character varying(50) NOT NULL, "changed_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_09b4c924b241aeeae57c7bf1017" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_display_name_history_user_id" ON "display_name_history" ("user_id") `,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "nickname"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "first_name"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "last_name"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "birth_date"`);
    await queryRunner.query(
      `ALTER TABLE "auth_identities" ADD CONSTRAINT "FK_c06a980d83c42611d27a294e55c" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sessions" ADD CONSTRAINT "FK_085d540d9f418cfbdc7bd55bb19" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "display_name_history" ADD CONSTRAINT "FK_e5bc1d8aee87790dd6ab8328fef" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "display_name_history" DROP CONSTRAINT "FK_e5bc1d8aee87790dd6ab8328fef"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sessions" DROP CONSTRAINT "FK_085d540d9f418cfbdc7bd55bb19"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_identities" DROP CONSTRAINT "FK_c06a980d83c42611d27a294e55c"`,
    );
    await queryRunner.query(`ALTER TABLE "users" ADD "birth_date" date`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "last_name" character varying(50)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "first_name" character varying(50)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "nickname" character varying(30)`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_display_name_history_user_id"`,
    );
    await queryRunner.query(`DROP TABLE "display_name_history"`);
    await queryRunner.query(
      `ALTER TABLE "sessions" ADD CONSTRAINT "FK_sessions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_identities" ADD CONSTRAINT "FK_auth_identities_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}