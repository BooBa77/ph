import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Профиль: пищевые ограничения и спортивный опыт.
 *
 * Две независимые вещи в одной миграции, потому что пришли одной задачей
 * и меняют одно и то же — профиль пользователя.
 *
 * 1. Пищевые ограничения — две колонки в `users`: галочка «вегетарианство»
 *    (NOT NULL DEFAULT false: «нет» и «не отвечал» здесь одно состояние)
 *    и свободный текст про аллергии. Справочника аллергенов нет намеренно:
 *    он у каждого свой и меняется быстрее, чем мы бы его правили.
 *
 * 2. Спортивный опыт — отдельная таблица `user_sport_experience`, строка
 *    на пользователя. Не 19 колонок в `users`: профиль читается на каждом
 *    bootstrap и refresh, а опыт нужен только в личном кабинете. Значения
 *    выпадающих списков проверяются CHECK-ами — теми же списками, что
 *    валидирует DTO (см. `src/users/sport-experience.types.ts`).
 *
 * Сгенерирована из entity (`migration:generate`), поэтому имена ключей —
 * те же хэши, что ожидает TypeORM: `schema:log` не должен показывать дрейф.
 * Руками добавлен только блок с правами для роли приложения.
 */
export class ProfileDietAndSportExperience1791880489858 implements MigrationInterface {
  name = 'ProfileDietAndSportExperience1791880489858';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "user_sport_experience" ("user_id" uuid NOT NULL, "alpinism_rank" character varying(20), "alpinism_max_participation" character varying(10), "alpinism_max_leadership" character varying(10), "skyrunning_rank" character varying(20), "tourism_rank" character varying(20), "tourism_max_hiking" character varying(10), "tourism_max_mountain" character varying(10), "tourism_max_ski" character varying(10), "tourism_max_water" character varying(10), "tourism_max_caving" character varying(10), "tourism_max_bicycle" character varying(10), "tourism_max_horse" character varying(10), "tourism_max_sailing" character varying(10), "tourism_max_auto_moto" character varying(10), "tourism_norm_nordic_walking" character varying(20), "tourism_norm_distance_hiking" character varying(20), "tourism_norm_distance_ski" character varying(20), "tourism_norm_distance_water" character varying(20), "tourism_norm_distance_caving" character varying(20), CONSTRAINT "chk_sport_experience_tourism_norm_distance_caving" CHECK ("tourism_norm_distance_caving" IN ('I разряд', 'II разряд', 'III разряд', 'юношеский', 'не выполнялся')), CONSTRAINT "chk_sport_experience_tourism_norm_distance_water" CHECK ("tourism_norm_distance_water" IN ('I разряд', 'II разряд', 'III разряд', 'юношеский', 'не выполнялся')), CONSTRAINT "chk_sport_experience_tourism_norm_distance_ski" CHECK ("tourism_norm_distance_ski" IN ('I разряд', 'II разряд', 'III разряд', 'юношеский', 'не выполнялся')), CONSTRAINT "chk_sport_experience_tourism_norm_distance_hiking" CHECK ("tourism_norm_distance_hiking" IN ('I разряд', 'II разряд', 'III разряд', 'юношеский', 'не выполнялся')), CONSTRAINT "chk_sport_experience_tourism_norm_nordic_walking" CHECK ("tourism_norm_nordic_walking" IN ('I разряд', 'II разряд', 'III разряд', 'юношеский', 'не выполнялся')), CONSTRAINT "chk_sport_experience_tourism_max_auto_moto" CHECK ("tourism_max_auto_moto" IN ('6', '5', '4', '3', '2', '1', 'нет данных')), CONSTRAINT "chk_sport_experience_tourism_max_sailing" CHECK ("tourism_max_sailing" IN ('6', '5', '4', '3', '2', '1', 'нет данных')), CONSTRAINT "chk_sport_experience_tourism_max_horse" CHECK ("tourism_max_horse" IN ('6', '5', '4', '3', '2', '1', 'нет данных')), CONSTRAINT "chk_sport_experience_tourism_max_bicycle" CHECK ("tourism_max_bicycle" IN ('6', '5', '4', '3', '2', '1', 'нет данных')), CONSTRAINT "chk_sport_experience_tourism_max_caving" CHECK ("tourism_max_caving" IN ('6', '5', '4', '3', '2', '1', 'нет данных')), CONSTRAINT "chk_sport_experience_tourism_max_water" CHECK ("tourism_max_water" IN ('6', '5', '4', '3', '2', '1', 'нет данных')), CONSTRAINT "chk_sport_experience_tourism_max_ski" CHECK ("tourism_max_ski" IN ('6', '5', '4', '3', '2', '1', 'нет данных')), CONSTRAINT "chk_sport_experience_tourism_max_mountain" CHECK ("tourism_max_mountain" IN ('6', '5', '4', '3', '2', '1', 'нет данных')), CONSTRAINT "chk_sport_experience_tourism_max_hiking" CHECK ("tourism_max_hiking" IN ('6', '5', '4', '3', '2', '1', 'нет данных')), CONSTRAINT "chk_sport_experience_tourism_rank" CHECK ("tourism_rank" IN ('МС', 'КМС', 'I', 'II', 'III', 'юношеский', 'отсутствует')), CONSTRAINT "chk_sport_experience_skyrunning_rank" CHECK ("skyrunning_rank" IN ('МС', 'КМС', 'I', 'II', 'III', 'юношеский', 'отсутствует')), CONSTRAINT "chk_sport_experience_alpinism_max_leadership" CHECK ("alpinism_max_leadership" IN ('6Б', '6А', '5Б', '5А', '4Б', '4А', '3Б', '3А', '2Б', '2А', '1Б', 'нет данных')), CONSTRAINT "chk_sport_experience_alpinism_max_participation" CHECK ("alpinism_max_participation" IN ('6Б', '6А', '5Б', '5А', '4Б', '4А', '3Б', '3А', '2Б', '2А', '1Б', 'нет данных')), CONSTRAINT "chk_sport_experience_alpinism_rank" CHECK ("alpinism_rank" IN ('МСМК', 'МС', 'КМС', 'I', 'II', 'III', 'юношеский', 'отсутствует')), CONSTRAINT "PK_25c46f028c5b259686cf2c9c7cf" PRIMARY KEY ("user_id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "is_vegetarian" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "allergies" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_sport_experience" ADD CONSTRAINT "FK_25c46f028c5b259686cf2c9c7cf" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    /**
     * Права для роли приложения.
     *
     * Миграции идут под `ph_migrator`, а рантайм ходит под `ph_app` — без
     * явного GRANT новая таблица для него не существует (в проде это
     * «permission denied», а не тихий отказ). Опыт пользователь правит
     * сам, поэтому нужны и чтение, и запись, и удаление: строка исчезает,
     * когда все выпадающие списки опустели. В dev роли `ph_app` нет,
     * поэтому блок проверяет её наличие и молча пропускается.
     */
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "user_sport_experience" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_sport_experience" DROP CONSTRAINT "FK_25c46f028c5b259686cf2c9c7cf"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "allergies"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "is_vegetarian"`);
    await queryRunner.query(`DROP TABLE "user_sport_experience"`);
  }
}
