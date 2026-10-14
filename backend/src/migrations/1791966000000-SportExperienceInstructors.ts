import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Инструкторские допущения в спортивном опыте.
 *
 * Пять новых колонок в `user_sport_experience`:
 *   - `alpinism_instructor_methodist` — инструктор-методист по альпинизму
 *     (ФАР): ИНП, 3-я, 2-я или 1-я категория;
 *   - `alpinism_instructor_guide` — инструктор-проводник: без категории
 *     (ИПбк), 1–5 категории или международный класс;
 *   - `alpinism_instructor_guide_license` — публичная ссылка на лицензию
 *     госаттестации; имеет смысл только вместе с предыдущим полем, но
 *     колонка отдельная: у лицензии свой жизненный цикл (реестр knd.gov.ru);
 *   - `alpinism_youth_tourism_organizer` и
 *     `alpinism_youth_tourism_instructor` — галочки про детско-юношеский
 *     туризм: организатор (программа подготовки) и инструктор
 *     (дополнительное образование).
 *
 * Обе строковые колонки получают CHECK по своим словарям — теми же
 * списками, что валидирует DTO (см. `src/users/sport-experience.types.ts`).
 * Булевым CHECK не нужен: у них и так два состояния.
 *
 * Значения по умолчанию: NULL у словарей (варианта «отсутствует» в списках
 * нет — «не заполнено» это и есть NULL) и false у галочек, где «нет»
 * и «не отвечал» — одно состояние.
 */
export class SportExperienceInstructors1791966000000 implements MigrationInterface {
  name = 'SportExperienceInstructors1791966000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_sport_experience"
        ADD "alpinism_instructor_methodist" character varying(30),
        ADD "alpinism_instructor_guide" character varying(40),
        ADD "alpinism_instructor_guide_license" character varying(500),
        ADD "alpinism_youth_tourism_organizer" boolean NOT NULL DEFAULT false,
        ADD "alpinism_youth_tourism_instructor" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "user_sport_experience"
        ADD CONSTRAINT "chk_sport_experience_instructor_methodist"
          CHECK ("alpinism_instructor_methodist" IN ('ИНП', '3 категория', '2 категория', '1 категория')),
        ADD CONSTRAINT "chk_sport_experience_instructor_guide"
          CHECK ("alpinism_instructor_guide" IN ('Без категории (ИПбк)', '1 категория', '2 категория', '3 категория', '4 категория', '5 категория', 'Международного класса'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_sport_experience"
        DROP CONSTRAINT "chk_sport_experience_instructor_guide",
        DROP CONSTRAINT "chk_sport_experience_instructor_methodist",
        DROP COLUMN "alpinism_youth_tourism_instructor",
        DROP COLUMN "alpinism_youth_tourism_organizer",
        DROP COLUMN "alpinism_instructor_guide_license",
        DROP COLUMN "alpinism_instructor_guide",
        DROP COLUMN "alpinism_instructor_methodist"
    `);
  }
}
