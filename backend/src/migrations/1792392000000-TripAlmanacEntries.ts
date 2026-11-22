import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Воспоминания в альманахе и отмена отдельной вкладки «Альманах»
 * (22.11.2026).
 *
 * Прежний альманах собирался на чтении из помеченных записей дневника
 * и жил отдельной вкладкой. Заказчик решил иначе: **альманах — секция
 * «Гостевой»**, а участник может дописать к нему собственное воспоминание
 * с местом вставки (до похода, конкретный день, самый конец). Дневник
 * остаётся личным полевым журналом.
 *
 * Отсюда две независимые части миграции:
 *
 * 1. **Новая таблица `trip_almanac_entries`.** Одна строка — одно
 *    воспоминание участника: место вставки (`placement`), номер дня
 *    (`day_index`, 0 — «не привязано к дню») и текст. Уникальный индекс
 *    `(trip_id, user_id, placement, day_index)` держит правило заказчика
 *    «на каждый день — одна запись участнику»: повторная вставка в тот же
 *    слот упирается в базу, а не в проверку в коде, которую можно обойти
 *    двумя одновременными запросами.
 * 2. **`almanac` уходит из кодов вкладок.** CHECK прав ролей повторяет
 *    `TRIP_TABS` из кода (то же правило, что у `TripDiarySharedWithTrip`
 *    и `RemoveInfoTab`), поэтому список здесь без `almanac`; права ролей
 *    на несуществующую вкладку удаляются — это данные сида, их место
 *    в `seed-role-tabs.mjs`.
 *
 * **Почему у дня `0`, а не `NULL`.** `UNIQUE` в Postgres не считает NULL-ы
 * равными: две строки с `day_index = NULL` прошли бы проверку на «одно
 * воспоминание на день». `0` — честный «слот без дня», и уникальность
 * работает обычным btree, без выражения `COALESCE` в индексе.
 *
 * Вниз — таблица и CHECK с `almanac`; данные воспоминаний при откате
 * теряются, и это ожидаемо: шаг отменяет саму возможность их писать.
 */
export class TripAlmanacEntries1792392000000 implements MigrationInterface {
  name = 'TripAlmanacEntries1792392000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "trip_almanac_entries" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "trip_id" bigint NOT NULL,
        "user_id" uuid NOT NULL,
        "placement" character varying(10) NOT NULL,
        "day_index" smallint NOT NULL DEFAULT 0,
        "body" text NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "chk_trip_almanac_entries_placement"
          CHECK ("placement" IN ('before', 'day', 'after')),
        CONSTRAINT "chk_trip_almanac_entries_day"
          CHECK (
            ("placement" = 'day' AND "day_index" >= 1)
            OR ("placement" <> 'day' AND "day_index" = 0)
          ),
        CONSTRAINT "chk_trip_almanac_entries_body"
          CHECK (char_length(btrim("body")) BETWEEN 1 AND 20000),
        CONSTRAINT "FK_trip_almanac_entries_trip"
          FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_trip_almanac_entries_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_trip_almanac_entries_trip"
        ON "trip_almanac_entries" ("trip_id", "created_at")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_almanac_entries_slot"
        ON "trip_almanac_entries"
          ("trip_id", "user_id", "placement", "day_index")
    `);

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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
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

    await queryRunner.query(`DROP TABLE "trip_almanac_entries"`);
  }
}
