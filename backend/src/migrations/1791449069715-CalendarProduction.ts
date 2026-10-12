import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Календарь: шаблон государственного производственного календаря,
 * персональный календарь пользователя и режим работы.
 *
 * Зачем две таблицы вместо одной. Шаблон — данные государства: 365 строк
 * на год, заполняются из постановлений Правительства РФ скриптом
 * (`backend/scripts/build-state-calendar.mjs` → `backend/seed/calendar`).
 * Персональный календарь — 365 строк на пользователя: копия шаблона
 * плюс его правки. Держать правки в шаблоне нельзя: «ДР Любы» появится
 * у всех пользователей.
 *
 * Сгенерирована из entity (`migration:generate`), поэтому имена ключей —
 * те же хэши, что ожидает TypeORM: `schema:log` не должен показывать дрейф.
 * Руками добавлен только блок с правами для роли приложения.
 */
export class CalendarProduction1791449069715 implements MigrationInterface {
  name = 'CalendarProduction1791449069715';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "calendar_state_production" ("date" date NOT NULL, "day_type" character varying(20) NOT NULL, "label" character varying(100), CONSTRAINT "chk_state_day_type" CHECK ("day_type" IN ('workday', 'weekend', 'short_workday')), CONSTRAINT "PK_93baac08025de91f1fc620c3983" PRIMARY KEY ("date"))`,
    );

    await queryRunner.query(
      `CREATE TABLE "calendar_production" ("user_id" uuid NOT NULL, "date" date NOT NULL, "day_type" character varying(20) NOT NULL, "label" character varying(100), CONSTRAINT "chk_calendar_day_type" CHECK ("day_type" IN ('workday', 'weekend', 'short_workday')), CONSTRAINT "PK_f1d87b1034a3d83931916610a9b" PRIMARY KEY ("user_id", "date"))`,
    );

    // NULL — пользователя ещё не спрашивали про режим работы.
    await queryRunner.query(`ALTER TABLE "users" ADD "calendar_mode" character varying(20)`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "chk_users_calendar_mode" CHECK ("calendar_mode" IN ('cycle', 'free', 'study', 'parental', 'retired'))`,
    );

    await queryRunner.query(
      `ALTER TABLE "calendar_production" ADD CONSTRAINT "FK_dbb2649dccc39ee69834f2215fd" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    /**
     * Права для роли приложения.
     *
     * Миграции идут под `ph_migrator`, а рантайм ходит под `ph_app` — без
     * явного GRANT новые таблицы для него не существуют (в проде это
     * «permission denied», а не тихий отказ). В dev роли `ph_app` нет,
     * поэтому блок проверяет её наличие и молча пропускается.
     *
     * Шаблон года приложению нужен только на чтение: заполняет его
     * сид-скрипт под ролью мигратора.
     */
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT ON "calendar_state_production" TO ph_app;
          GRANT SELECT, INSERT, UPDATE, DELETE ON "calendar_production" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "calendar_production" DROP CONSTRAINT "FK_dbb2649dccc39ee69834f2215fd"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "chk_users_calendar_mode"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "calendar_mode"`);
    await queryRunner.query(`DROP TABLE "calendar_production"`);
    await queryRunner.query(`DROP TABLE "calendar_state_production"`);
  }
}
