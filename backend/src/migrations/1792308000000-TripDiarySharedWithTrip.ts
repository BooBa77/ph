import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Согласие автора на альманах и вкладка «Альманах» (22.11.2026).
 *
 * Дневник — личный журнал, и в общий текст похода он попадает только
 * с разрешения автора. Заказчик: «в альманах попадают только записи,
 * помеченные автором „можно в альманах“; по умолчанию пометка включена».
 *
 * Отсюда одна колонка и то, что из неё следует:
 *
 * 1. **`shared_with_trip boolean NOT NULL DEFAULT true`.** По умолчанию
 *    согласие **включено** — так решил заказчик 22.11.2026, и это reversal
 *    прежнего предложения «молчание не согласие» из `NEXT.md`. Старые
 *    записи получают `true` тем же `DEFAULT`-ом: у них уже не спросить,
 *    а задним числом включать насильно нельзя — поэтому в первый же день
 *    автор видит пометку и может снять её у любой записи.
 * 2. **`almanac` в CHECK прав ролей.** Вкладка «Альманах» — код вкладки,
 *    как остальные, а коды проверяются CHECK-ом. Список в миграции повторяет
 *    `TRIP_TABS` из кода, иначе `schema:log` показывал бы расхождение
 *    (то же правило, что у `RemoveInfoTab`).
 *
 * **Второй таблицы нет намеренно.** Альманах собирается на чтении из
 * помеченных записей: снимок пришлось бы объяснять («почему моя правка
 * после сборки не видна»), а он ничего не защищает — согласие снимается
 * и после сборки, и это нормально для компиляции, а не документа
 * с соавторами.
 *
 * Вниз — колонка и CHECK без `almanac`; права ролей на неё удаляются
 * вместе с CHECK-ом (это данные сида, их место в `seed-role-tabs.mjs`).
 */
export class TripDiarySharedWithTrip1792308000000
  implements MigrationInterface
{
  name = 'TripDiarySharedWithTrip1792308000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trip_diary_entries"
        ADD COLUMN "shared_with_trip" boolean NOT NULL DEFAULT true
    `);

    await queryRunner.query(`
      ALTER TABLE "role_tab_permissions"
        DROP CONSTRAINT "chk_role_tab_permissions_tab"
    `);

    await queryRunner.query(`
      ALTER TABLE "role_tab_permissions"
        ADD CONSTRAINT "chk_role_tab_permissions_tab" CHECK (
          "tab" IN ('guest', 'members', 'sport', 'transfer', 'route',
                    'meals', 'gear', 'firstAid', 'finance', 'diary',
                    'almanac')
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "role_tab_permissions" WHERE "tab" = 'almanac'`,
    );

    await queryRunner.query(`
      ALTER TABLE "role_tab_permissions"
        DROP CONSTRAINT "chk_role_tab_permissions_tab"
    `);

    await queryRunner.query(`
      ALTER TABLE "role_tab_permissions"
        ADD CONSTRAINT "chk_role_tab_permissions_tab" CHECK (
          "tab" IN ('guest', 'members', 'sport', 'transfer', 'route',
                    'meals', 'gear', 'firstAid', 'finance', 'diary')
        )
    `);

    await queryRunner.query(`
      ALTER TABLE "trip_diary_entries"
        DROP COLUMN "shared_with_trip"
    `);
  }
}
