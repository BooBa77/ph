import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Пол пользователя — для распределения веса рюкзака.
 *
 * Нужен Ф7 карты вкладок (`docs/ph/gear-distribution.md`, решение
 * заказчика 21.10.2026): доля женщины в общественном грузе — 0,8 от
 * мужской. Пол живёт в профиле, потому что это свойство человека, а не
 * похода: тот же человек идёт в десять походов с одним и тем же полом.
 *
 * **`DEFAULT 'm'` и `NOT NULL`.** Существующие пользователи получают
 * мужской пол автоматически, и распределение работает сразу после
 * деплоя: «ещё не заполнил» и «мужчина» здесь не различить, а пустая
 * строка в коэффициенте опаснее неверной — расчёт пришлось бы
 * останавливать. Кто не мужчина — меняет в профиле.
 *
 * `CHECK` на два значения, а не отдельный справочник: значений ровно два,
 * они не меняются и заводить таблицу ради двух строк — лишняя миграция
 * на каждое «а давайте ещё».
 *
 * Пол **не публичный**: в гостевой профиль и в выдачу поиска людей он
 * не попадает (см. `UserPublicProfileDto`).
 */
export class UserGender1792242000000 implements MigrationInterface {
  name = 'UserGender1792242000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "gender" character varying(1) NOT NULL DEFAULT 'm'
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        ADD CONSTRAINT "chk_users_gender" CHECK ("gender" IN ('m', 'f'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Сначала ограничение, потом колонка: CHECK ссылается на неё.
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "chk_users_gender"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "gender"`);
  }
}
