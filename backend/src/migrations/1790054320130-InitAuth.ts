import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitAuth1727000000000 implements MigrationInterface {
  name = 'InitAuth1727000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // users
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "display_name" varchar(50) NOT NULL,
        "nickname" varchar(30),
        "first_name" varchar(50),
        "last_name" varchar(50),
        "location" varchar(100),
        "birth_date" date,
        "avatar_url" varchar(255),
        "deleted_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    // auth_identities
    await queryRunner.query(`
      CREATE TABLE "auth_identities" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "provider" varchar(20) NOT NULL,
        "provider_user_id" varchar(255) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_auth_identities_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_auth_identities_provider_user"
          UNIQUE ("provider", "provider_user_id"),
        CONSTRAINT "UQ_auth_identities_user_provider"
          UNIQUE ("user_id", "provider")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_auth_identities_user_id"
        ON "auth_identities" ("user_id")
    `);

    // sessions
    await queryRunner.query(`
      CREATE TABLE "sessions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "device_label" varchar(100),
        "refresh_token_hash" varchar(255) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "revoked_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_sessions_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_sessions_user_id"
        ON "sessions" ("user_id")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_sessions_refresh_token_hash"
        ON "sessions" ("refresh_token_hash")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "sessions"`);
    await queryRunner.query(`DROP TABLE "auth_identities"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}