import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Уточнение словарей спортивного опыта по итогам просмотра формы.
 *
 * Первая миграция (`ProfileDietAndSportExperience`) уже применена в dev,
 * поэтому словарь правится **второй** миграцией, а не переписыванием
 * первой: переписанная миграция разошлась бы с базой, где она выполнена,
 * а откат первой снёс бы уже заполненные данные профиля.
 *
 * Что изменилось и почему:
 *
 * 1. **Отсутствие убрано из списков.** Варианты «отсутствует» (разряды),
 *    «нет данных» (категории) и «не выполнялся» (нормативы) дублировали
 *    пустую строку формы: сверху «— нет —», снизу «отсутствует». «Ничего
 *    не выполнено» пишется как NULL, и словарь теперь короче на один
 *    вариант в каждом списке.
 *
 * 2. **«Значок» добавлен первым** в альпинизм и спортивный туризм: это
 *    массовый знак («Альпинист России», «Турист России»), он ниже
 *    юношеского разряда. В скайраннинге «Значок» не присваивают, поэтому
 *    у него теперь свой список (МС…юношеский) — раньше он делил список
 *    со спортивным туризмом.
 */
export class SportExperienceDictionaries1791886000000 implements MigrationInterface {
  name = 'SportExperienceDictionaries1791886000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Разряды: «Значок» первым, «отсутствует» больше нет.
    await queryRunner.query(`
      ALTER TABLE "user_sport_experience"
        DROP CONSTRAINT "chk_sport_experience_alpinism_rank",
        ADD CONSTRAINT "chk_sport_experience_alpinism_rank"
          CHECK ("alpinism_rank" IN ('Значок', 'МСМК', 'МС', 'КМС', 'I', 'II', 'III', 'юношеский')),
        DROP CONSTRAINT "chk_sport_experience_skyrunning_rank",
        ADD CONSTRAINT "chk_sport_experience_skyrunning_rank"
          CHECK ("skyrunning_rank" IN ('МС', 'КМС', 'I', 'II', 'III', 'юношеский')),
        DROP CONSTRAINT "chk_sport_experience_tourism_rank",
        ADD CONSTRAINT "chk_sport_experience_tourism_rank"
          CHECK ("tourism_rank" IN ('Значок', 'МС', 'КМС', 'I', 'II', 'III', 'юношеский'))
    `);

    // Категории альпинистских маршрутов: без «нет данных».
    await queryRunner.query(`
      ALTER TABLE "user_sport_experience"
        DROP CONSTRAINT "chk_sport_experience_alpinism_max_participation",
        ADD CONSTRAINT "chk_sport_experience_alpinism_max_participation"
          CHECK ("alpinism_max_participation" IN ('6Б', '6А', '5Б', '5А', '4Б', '4А', '3Б', '3А', '2Б', '2А', '1Б')),
        DROP CONSTRAINT "chk_sport_experience_alpinism_max_leadership",
        ADD CONSTRAINT "chk_sport_experience_alpinism_max_leadership"
          CHECK ("alpinism_max_leadership" IN ('6Б', '6А', '5Б', '5А', '4Б', '4А', '3Б', '3А', '2Б', '2А', '1Б'))
    `);

    // Категории походов по девяти видам туризма: без «нет данных».
    await queryRunner.query(`
      ALTER TABLE "user_sport_experience"
        DROP CONSTRAINT "chk_sport_experience_tourism_max_hiking",
        ADD CONSTRAINT "chk_sport_experience_tourism_max_hiking"
          CHECK ("tourism_max_hiking" IN ('6', '5', '4', '3', '2', '1')),
        DROP CONSTRAINT "chk_sport_experience_tourism_max_mountain",
        ADD CONSTRAINT "chk_sport_experience_tourism_max_mountain"
          CHECK ("tourism_max_mountain" IN ('6', '5', '4', '3', '2', '1')),
        DROP CONSTRAINT "chk_sport_experience_tourism_max_ski",
        ADD CONSTRAINT "chk_sport_experience_tourism_max_ski"
          CHECK ("tourism_max_ski" IN ('6', '5', '4', '3', '2', '1')),
        DROP CONSTRAINT "chk_sport_experience_tourism_max_water",
        ADD CONSTRAINT "chk_sport_experience_tourism_max_water"
          CHECK ("tourism_max_water" IN ('6', '5', '4', '3', '2', '1')),
        DROP CONSTRAINT "chk_sport_experience_tourism_max_caving",
        ADD CONSTRAINT "chk_sport_experience_tourism_max_caving"
          CHECK ("tourism_max_caving" IN ('6', '5', '4', '3', '2', '1')),
        DROP CONSTRAINT "chk_sport_experience_tourism_max_bicycle",
        ADD CONSTRAINT "chk_sport_experience_tourism_max_bicycle"
          CHECK ("tourism_max_bicycle" IN ('6', '5', '4', '3', '2', '1')),
        DROP CONSTRAINT "chk_sport_experience_tourism_max_horse",
        ADD CONSTRAINT "chk_sport_experience_tourism_max_horse"
          CHECK ("tourism_max_horse" IN ('6', '5', '4', '3', '2', '1')),
        DROP CONSTRAINT "chk_sport_experience_tourism_max_sailing",
        ADD CONSTRAINT "chk_sport_experience_tourism_max_sailing"
          CHECK ("tourism_max_sailing" IN ('6', '5', '4', '3', '2', '1')),
        DROP CONSTRAINT "chk_sport_experience_tourism_max_auto_moto",
        ADD CONSTRAINT "chk_sport_experience_tourism_max_auto_moto"
          CHECK ("tourism_max_auto_moto" IN ('6', '5', '4', '3', '2', '1'))
    `);

    // Нормативы в дисциплинах группы «дистанция»: без «не выполнялся».
    await queryRunner.query(`
      ALTER TABLE "user_sport_experience"
        DROP CONSTRAINT "chk_sport_experience_tourism_norm_nordic_walking",
        ADD CONSTRAINT "chk_sport_experience_tourism_norm_nordic_walking"
          CHECK ("tourism_norm_nordic_walking" IN ('I разряд', 'II разряд', 'III разряд', 'юношеский')),
        DROP CONSTRAINT "chk_sport_experience_tourism_norm_distance_hiking",
        ADD CONSTRAINT "chk_sport_experience_tourism_norm_distance_hiking"
          CHECK ("tourism_norm_distance_hiking" IN ('I разряд', 'II разряд', 'III разряд', 'юношеский')),
        DROP CONSTRAINT "chk_sport_experience_tourism_norm_distance_ski",
        ADD CONSTRAINT "chk_sport_experience_tourism_norm_distance_ski"
          CHECK ("tourism_norm_distance_ski" IN ('I разряд', 'II разряд', 'III разряд', 'юношеский')),
        DROP CONSTRAINT "chk_sport_experience_tourism_norm_distance_water",
        ADD CONSTRAINT "chk_sport_experience_tourism_norm_distance_water"
          CHECK ("tourism_norm_distance_water" IN ('I разряд', 'II разряд', 'III разряд', 'юношеский')),
        DROP CONSTRAINT "chk_sport_experience_tourism_norm_distance_caving",
        ADD CONSTRAINT "chk_sport_experience_tourism_norm_distance_caving"
          CHECK ("tourism_norm_distance_caving" IN ('I разряд', 'II разряд', 'III разряд', 'юношеский'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Возврат к прежним спискам: с «отсутствует»/«нет данных»/«не выполнялся»
    // и без «Значок». Нужен для полноты отката, хотя данные этих значений
    // в базе не появлялись.
    await queryRunner.query(`
      ALTER TABLE "user_sport_experience"
        DROP CONSTRAINT "chk_sport_experience_alpinism_rank",
        ADD CONSTRAINT "chk_sport_experience_alpinism_rank"
          CHECK ("alpinism_rank" IN ('МСМК', 'МС', 'КМС', 'I', 'II', 'III', 'юношеский', 'отсутствует')),
        DROP CONSTRAINT "chk_sport_experience_skyrunning_rank",
        ADD CONSTRAINT "chk_sport_experience_skyrunning_rank"
          CHECK ("skyrunning_rank" IN ('МС', 'КМС', 'I', 'II', 'III', 'юношеский', 'отсутствует')),
        DROP CONSTRAINT "chk_sport_experience_tourism_rank",
        ADD CONSTRAINT "chk_sport_experience_tourism_rank"
          CHECK ("tourism_rank" IN ('МС', 'КМС', 'I', 'II', 'III', 'юношеский', 'отсутствует'))
    `);

    await queryRunner.query(`
      ALTER TABLE "user_sport_experience"
        DROP CONSTRAINT "chk_sport_experience_alpinism_max_participation",
        ADD CONSTRAINT "chk_sport_experience_alpinism_max_participation"
          CHECK ("alpinism_max_participation" IN ('6Б', '6А', '5Б', '5А', '4Б', '4А', '3Б', '3А', '2Б', '2А', '1Б', 'нет данных')),
        DROP CONSTRAINT "chk_sport_experience_alpinism_max_leadership",
        ADD CONSTRAINT "chk_sport_experience_alpinism_max_leadership"
          CHECK ("alpinism_max_leadership" IN ('6Б', '6А', '5Б', '5А', '4Б', '4А', '3Б', '3А', '2Б', '2А', '1Б', 'нет данных'))
    `);

    await queryRunner.query(`
      ALTER TABLE "user_sport_experience"
        DROP CONSTRAINT "chk_sport_experience_tourism_max_hiking",
        ADD CONSTRAINT "chk_sport_experience_tourism_max_hiking"
          CHECK ("tourism_max_hiking" IN ('6', '5', '4', '3', '2', '1', 'нет данных')),
        DROP CONSTRAINT "chk_sport_experience_tourism_max_mountain",
        ADD CONSTRAINT "chk_sport_experience_tourism_max_mountain"
          CHECK ("tourism_max_mountain" IN ('6', '5', '4', '3', '2', '1', 'нет данных')),
        DROP CONSTRAINT "chk_sport_experience_tourism_max_ski",
        ADD CONSTRAINT "chk_sport_experience_tourism_max_ski"
          CHECK ("tourism_max_ski" IN ('6', '5', '4', '3', '2', '1', 'нет данных')),
        DROP CONSTRAINT "chk_sport_experience_tourism_max_water",
        ADD CONSTRAINT "chk_sport_experience_tourism_max_water"
          CHECK ("tourism_max_water" IN ('6', '5', '4', '3', '2', '1', 'нет данных')),
        DROP CONSTRAINT "chk_sport_experience_tourism_max_caving",
        ADD CONSTRAINT "chk_sport_experience_tourism_max_caving"
          CHECK ("tourism_max_caving" IN ('6', '5', '4', '3', '2', '1', 'нет данных')),
        DROP CONSTRAINT "chk_sport_experience_tourism_max_bicycle",
        ADD CONSTRAINT "chk_sport_experience_tourism_max_bicycle"
          CHECK ("tourism_max_bicycle" IN ('6', '5', '4', '3', '2', '1', 'нет данных')),
        DROP CONSTRAINT "chk_sport_experience_tourism_max_horse",
        ADD CONSTRAINT "chk_sport_experience_tourism_max_horse"
          CHECK ("tourism_max_horse" IN ('6', '5', '4', '3', '2', '1', 'нет данных')),
        DROP CONSTRAINT "chk_sport_experience_tourism_max_sailing",
        ADD CONSTRAINT "chk_sport_experience_tourism_max_sailing"
          CHECK ("tourism_max_sailing" IN ('6', '5', '4', '3', '2', '1', 'нет данных')),
        DROP CONSTRAINT "chk_sport_experience_tourism_max_auto_moto",
        ADD CONSTRAINT "chk_sport_experience_tourism_max_auto_moto"
          CHECK ("tourism_max_auto_moto" IN ('6', '5', '4', '3', '2', '1', 'нет данных'))
    `);

    await queryRunner.query(`
      ALTER TABLE "user_sport_experience"
        DROP CONSTRAINT "chk_sport_experience_tourism_norm_nordic_walking",
        ADD CONSTRAINT "chk_sport_experience_tourism_norm_nordic_walking"
          CHECK ("tourism_norm_nordic_walking" IN ('I разряд', 'II разряд', 'III разряд', 'юношеский', 'не выполнялся')),
        DROP CONSTRAINT "chk_sport_experience_tourism_norm_distance_hiking",
        ADD CONSTRAINT "chk_sport_experience_tourism_norm_distance_hiking"
          CHECK ("tourism_norm_distance_hiking" IN ('I разряд', 'II разряд', 'III разряд', 'юношеский', 'не выполнялся')),
        DROP CONSTRAINT "chk_sport_experience_tourism_norm_distance_ski",
        ADD CONSTRAINT "chk_sport_experience_tourism_norm_distance_ski"
          CHECK ("tourism_norm_distance_ski" IN ('I разряд', 'II разряд', 'III разряд', 'юношеский', 'не выполнялся')),
        DROP CONSTRAINT "chk_sport_experience_tourism_norm_distance_water",
        ADD CONSTRAINT "chk_sport_experience_tourism_norm_distance_water"
          CHECK ("tourism_norm_distance_water" IN ('I разряд', 'II разряд', 'III разряд', 'юношеский', 'не выполнялся')),
        DROP CONSTRAINT "chk_sport_experience_tourism_norm_distance_caving",
        ADD CONSTRAINT "chk_sport_experience_tourism_norm_distance_caving"
          CHECK ("tourism_norm_distance_caving" IN ('I разряд', 'II разряд', 'III разряд', 'юношеский', 'не выполнялся'))
    `);
  }
}
