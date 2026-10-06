import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Приводит имена внешних ключей к пользователю к тем, что генерирует TypeORM.
 *
 * Зачем это нужно. `InitAuth` создаёт ключи с явными именами
 * (`FK_sessions_user`, `FK_auth_identities_user`), а entity описывают
 * связи через `@ManyToOne` — TypeORM ожидает имена-хэши
 * (`FK_085d540d…`, `FK_c06a980d…`). Миграция устраняет расхождение,
 * чтобы `schema:log` не показывал дрейф и `migration:generate` не
 * пытался переименовать ключи заново.
 *
 * Почему с проверками на существование. У баз разная история: в dev на
 * момент выполнения были оба старых имени, а в проде одного из них уже
 * не было — исходный вариант падал с ошибкой PostgreSQL 42704
 * (`constraint does not exist`). Опаснее другое: TypeORM останавливается
 * на первой упавшей миграции, поэтому этот сбой блокировал все
 * последующие обновления схемы. Теперь каждая пара «удалить старое,
 * добавить новое» выполняется независимо и только если это нужно.
 *
 * Повторный запуск безопасен — миграция идемпотентна.
 */
export class FixUserForeignKeyNames1790848192252 implements MigrationInterface {
  name = 'FixUserForeignKeyNames1790848192252';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_sessions_user' AND conrelid = 'sessions'::regclass
        ) THEN
          ALTER TABLE "sessions" DROP CONSTRAINT "FK_sessions_user";
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_085d540d9f418cfbdc7bd55bb19' AND conrelid = 'sessions'::regclass
        ) THEN
          ALTER TABLE "sessions"
            ADD CONSTRAINT "FK_085d540d9f418cfbdc7bd55bb19"
            FOREIGN KEY ("user_id") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION;
        END IF;

        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_auth_identities_user' AND conrelid = 'auth_identities'::regclass
        ) THEN
          ALTER TABLE "auth_identities" DROP CONSTRAINT "FK_auth_identities_user";
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_c06a980d83c42611d27a294e55c' AND conrelid = 'auth_identities'::regclass
        ) THEN
          ALTER TABLE "auth_identities"
            ADD CONSTRAINT "FK_c06a980d83c42611d27a294e55c"
            FOREIGN KEY ("user_id") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_c06a980d83c42611d27a294e55c' AND conrelid = 'auth_identities'::regclass
        ) THEN
          ALTER TABLE "auth_identities" DROP CONSTRAINT "FK_c06a980d83c42611d27a294e55c";
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_auth_identities_user' AND conrelid = 'auth_identities'::regclass
        ) THEN
          ALTER TABLE "auth_identities"
            ADD CONSTRAINT "FK_auth_identities_user"
            FOREIGN KEY ("user_id") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION;
        END IF;

        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_085d540d9f418cfbdc7bd55bb19' AND conrelid = 'sessions'::regclass
        ) THEN
          ALTER TABLE "sessions" DROP CONSTRAINT "FK_085d540d9f418cfbdc7bd55bb19";
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_sessions_user' AND conrelid = 'sessions'::regclass
        ) THEN
          ALTER TABLE "sessions"
            ADD CONSTRAINT "FK_sessions_user"
            FOREIGN KEY ("user_id") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);
  }
}
