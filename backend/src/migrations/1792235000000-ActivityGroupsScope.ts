import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Назначение группы активностей: календарь, походы или и то и другое.
 *
 * Справочник активностей один на проект, но нужен двум разным местам:
 * календарю (город, спорт, дом, работа) и походу (пеший поход, альпинизм,
 * велосипед). Держать «какие группы календарные» в коде — значит завести
 * список, который однажды забудут пополнить, и «левая» группа молча
 * появится в календаре. Поэтому назначение живёт **в данных**:
 *
 * - `calendar` — только календарь (по умолчанию, чтобы существующие
 *   группы не меняли поведения);
 * - `trips` — только поход;
 * - `both` — и там, и там.
 *
 * Группа «Туризм» заводится здесь же, вместе с тремя типами: «Пеший
 * поход», «Альпинизм», «Велосипед». Коды машинные и с префиксом `trip_`:
 * у типов есть уникальный код, и «велосипед» уже занят календарной
 * активностью. По-русски подписи при этом могут совпадать — группу
 * и подпись человек видит вместе, а фильтр работает по id.
 *
 * Иконки здесь временные (`hike`, `mountain`, `bike`): настоящие появятся
 * вместе с чипсами выбора типа в форме похода, тогда же их и нарисуем.
 */
export class ActivityGroupsScope1792235000000 implements MigrationInterface {
  name = 'ActivityGroupsScope1792235000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "calendar_activity_groups"
        ADD COLUMN "scope" character varying(20) NOT NULL DEFAULT 'calendar',
        ADD CONSTRAINT "chk_activity_groups_scope"
          CHECK ("scope" IN ('calendar', 'trips', 'both'))
    `);

    await queryRunner.query(`
      INSERT INTO "calendar_activity_groups" (code, label, color, scope, is_active)
      VALUES ('tourism', 'Туризм', '#5b7a4a', 'trips', true)
      ON CONFLICT (code) DO UPDATE SET scope = 'trips'
    `);

    await queryRunner.query(`
      INSERT INTO "calendar_activity_types" (code, label, group_id, icon, is_active)
      SELECT 'trip_hiking', 'Пеший поход', g.id, 'hike', true
        FROM "calendar_activity_groups" g WHERE g.code = 'tourism'
      ON CONFLICT (code) DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO "calendar_activity_types" (code, label, group_id, icon, is_active)
      SELECT 'trip_alpinism', 'Альпинизм', g.id, 'mountain', true
        FROM "calendar_activity_groups" g WHERE g.code = 'tourism'
      ON CONFLICT (code) DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO "calendar_activity_types" (code, label, group_id, icon, is_active)
      SELECT 'trip_cycling', 'Велосипед', g.id, 'bike', true
        FROM "calendar_activity_groups" g WHERE g.code = 'tourism'
      ON CONFLICT (code) DO NOTHING
    `);

    // Права приложению на новые строки не нужны: таблицы уже выданы
    // целиком в миграции активностей календаря.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "calendar_activity_types" WHERE code IN ('trip_hiking', 'trip_alpinism', 'trip_cycling')`,
    );
    await queryRunner.query(
      `DELETE FROM "calendar_activity_groups" WHERE code = 'tourism'`,
    );
    await queryRunner.query(`
      ALTER TABLE "calendar_activity_groups"
        DROP CONSTRAINT "chk_activity_groups_scope",
        DROP COLUMN "scope"
    `);
  }
}
