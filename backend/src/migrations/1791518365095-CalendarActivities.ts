import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Активности, избранное, запросы на иконки и админы.
 *
 * Плюс две заметки дня прямо в `calendar_production`: одна строка на день,
 * и всё про день в одном месте — статус, метка, личная заметка и «поделиться».
 *
 * Заметок о приватности в `calendar_activities` нет: приватность у заметки,
 * а не у отметки, поэтому `note` и `privacy` из исходной схемы сюда не поехали.
 * `commit` и `updated_at` тоже нигде не заводим — по решению проекта.
 *
 * Сгенерирована из entity (`migration:generate`), поэтому имена ключей —
 * те же хэши, что ожидает TypeORM. Руками добавлен только блок с правами.
 */
export class CalendarActivities1791518365095 implements MigrationInterface {
  name = 'CalendarActivities1791518365095';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "calendar_activity_groups" ("id" SERIAL NOT NULL, "code" character varying(50) NOT NULL, "label" character varying(100) NOT NULL, "color" character varying(7) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "UQ_d0901fed96c01670544bb399372" UNIQUE ("code"), CONSTRAINT "PK_02178ceaf176b6b63e89dc61764" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "calendar_activity_types" ("id" SERIAL NOT NULL, "code" character varying(50) NOT NULL, "label" character varying(100) NOT NULL, "group_id" integer NOT NULL, "icon" character varying(50) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "UQ_284e10ec3984fa5151a313c4d91" UNIQUE ("code"), CONSTRAINT "PK_b1748e488745ecc5f827e4ba1c9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "admin_users" ("user_id" uuid NOT NULL, CONSTRAINT "PK_1aa08400548588fd7d6dbfd4b54" PRIMARY KEY ("user_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "calendar_activity_type_requests" ("id" BIGSERIAL NOT NULL, "user_id" uuid NOT NULL, "label" character varying(100) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'pending', "admin_comment" character varying(500), CONSTRAINT "chk_activity_request_status" CHECK ("status" IN ('pending', 'approved', 'rejected', 'revision')), CONSTRAINT "PK_5c96140bb6273fcc71a6263909c" PRIMARY KEY ("id"))`,
    );

    // Отметки: составной ключ — это и уникальность «одна отметка на тип
    // в день», и индекс для выборки активностей за диапазон дат.
    await queryRunner.query(
      `CREATE TABLE "calendar_activities" ("user_id" uuid NOT NULL, "date" date NOT NULL, "activity_type_id" integer NOT NULL, CONSTRAINT "PK_e25fdcd5b712d40d24cc7ada095" PRIMARY KEY ("user_id", "date", "activity_type_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "calendar_activity_favorites" ("user_id" uuid NOT NULL, "activity_type_id" integer NOT NULL, "usage_count" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_66a8bb2f431c20f8b8af9e31035" PRIMARY KEY ("user_id", "activity_type_id"))`,
    );

    await queryRunner.query(`ALTER TABLE "calendar_production" ADD "note_public" text`);
    await queryRunner.query(`ALTER TABLE "calendar_production" ADD "note_personal" text`);

    await queryRunner.query(
      `ALTER TABLE "calendar_activity_types" ADD CONSTRAINT "FK_977703e25aaccba7ec842084e5a" FOREIGN KEY ("group_id") REFERENCES "calendar_activity_groups"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_users" ADD CONSTRAINT "FK_1aa08400548588fd7d6dbfd4b54" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_activity_type_requests" ADD CONSTRAINT "FK_7aa98a326a7573890509fa53c6b" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_activities" ADD CONSTRAINT "FK_21332a69024c52a3b069f57603c" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_activities" ADD CONSTRAINT "FK_80e62b49232c082cf9dff4cf9ec" FOREIGN KEY ("activity_type_id") REFERENCES "calendar_activity_types"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_activity_favorites" ADD CONSTRAINT "FK_04ced2f6305124237154fbec1f9" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_activity_favorites" ADD CONSTRAINT "FK_3b3143d85d668a31cdd7ff1b419" FOREIGN KEY ("activity_type_id") REFERENCES "calendar_activity_types"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    /**
     * Права для роли приложения.
     *
     * Миграции идут под `ph_migrator`, рантайм — под `ph_app`; без явного
     * GRANT новые таблицы для него не существуют. Справочники приложению
     * нужны только на чтение (наполняются сид-скриптом под мигратором),
     * отметки и избранное — на запись, запросы пользователь создаёт, а админ
     * меняет им статус. В dev роли `ph_app` нет, блок пропускается.
     */
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT ON "calendar_activity_groups" TO ph_app;
          GRANT SELECT ON "calendar_activity_types" TO ph_app;
          GRANT SELECT ON "admin_users" TO ph_app;
          GRANT SELECT, INSERT, DELETE ON "calendar_activities" TO ph_app;
          GRANT SELECT, INSERT, UPDATE, DELETE ON "calendar_activity_favorites" TO ph_app;
          GRANT SELECT, INSERT, UPDATE ON "calendar_activity_type_requests" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "calendar_activity_favorites" DROP CONSTRAINT "FK_3b3143d85d668a31cdd7ff1b419"`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_activity_favorites" DROP CONSTRAINT "FK_04ced2f6305124237154fbec1f9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_activities" DROP CONSTRAINT "FK_80e62b49232c082cf9dff4cf9ec"`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_activities" DROP CONSTRAINT "FK_21332a69024c52a3b069f57603c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_activity_type_requests" DROP CONSTRAINT "FK_7aa98a326a7573890509fa53c6b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_users" DROP CONSTRAINT "FK_1aa08400548588fd7d6dbfd4b54"`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_activity_types" DROP CONSTRAINT "FK_977703e25aaccba7ec842084e5a"`,
    );
    await queryRunner.query(`ALTER TABLE "calendar_production" DROP COLUMN "note_personal"`);
    await queryRunner.query(`ALTER TABLE "calendar_production" DROP COLUMN "note_public"`);
    await queryRunner.query(`DROP TABLE "calendar_activity_favorites"`);
    await queryRunner.query(`DROP TABLE "calendar_activities"`);
    await queryRunner.query(`DROP TABLE "calendar_activity_type_requests"`);
    await queryRunner.query(`DROP TABLE "admin_users"`);
    await queryRunner.query(`DROP TABLE "calendar_activity_types"`);
    await queryRunner.query(`DROP TABLE "calendar_activity_groups"`);
  }
}
