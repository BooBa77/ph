import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Жетон «Спасение в горах» в спортивном опыте.
 *
 * Участие в спасательных работах — это «есть/нет», а не значение словаря,
 * поэтому колонка булева: NOT NULL DEFAULT false, где «нет» и «не отвечал» —
 * одно состояние (как у вегетарианства в `users`).
 *
 * Отдельной миграцией, а не правкой `ProfileDietAndSportExperience`:
 * та уже применена в dev, и переписывать применённую миграцию нельзя.
 *
 * Значения `true` в базе до этой миграции быть не могло, поэтому DEFAULT
 * false и NOT NULL ставятся одним действием — без пересборки таблицы.
 */
export class SportExperienceRescueToken1791887000000 implements MigrationInterface {
  name = 'SportExperienceRescueToken1791887000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_sport_experience" ADD "alpinism_rescue_token" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_sport_experience" DROP COLUMN "alpinism_rescue_token"`,
    );
  }
}
