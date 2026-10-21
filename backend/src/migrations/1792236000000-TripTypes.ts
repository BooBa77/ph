import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Типы похода — связкой `trip_types`, а не массивом id в `trips`.
 *
 * Массив `activity_type_ids` был компромиссом: связей одна-две, и отдельная
 * таблица выглядела лишним слоем. Цена компромисса оказалась выше выгоды:
 *
 * 1. **Внешнего ключа у массива нет.** Существование id проверял триггер
 *    (`trg_trips_validate_activity_types`), и проверял только вставляемую
 *    строку похода: удалить тип из справочника, на который уже ссылаются
 *    походы, он не мешал, а ссылка переживала удалённый id. Целостность
 *    держалась на том, что справочник правят аккуратно.
 * 2. **Фильтр по типу — seq scan.** `CAST(:id AS int) = ANY(activity_type_ids)`
 *    не укладывается ни в один индекс: для массива понадобился бы GIN,
 *    а он всё равно не заменяет обычный btree по одной колонке.
 * 3. **Свойствам пары места нет.** «Главный тип похода», порядок выбранных,
 *    роль типа (сам поход / заброска) — любое из этого рядом с числом
 *    в массиве уже не поместится, а в строке появляется даром.
 *
 * Перенос идёт **до** удаления колонки: `unnest` разворачивает массив
 * в строки одним запросом, `ON CONFLICT DO NOTHING` терпит дубликаты —
 * массив их допускал, а составной первичный ключ нет.
 *
 * Архивные типы (`is_active = false`) связка не отвергает: старый поход
 * вправе ссылаться на тип, который больше не предлагается в выборе. Это
 * правило было и остаётся, изменился только способ его держать.
 */
export class TripTypes1792236000000 implements MigrationInterface {
  name = 'TripTypes1792236000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "trip_types" (
        "trip_id" bigint NOT NULL,
        "activity_type_id" int NOT NULL,
        CONSTRAINT "PK_trip_types" PRIMARY KEY ("trip_id", "activity_type_id"),
        CONSTRAINT "FK_trip_types_trip"
          FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_trip_types_activity_type"
          FOREIGN KEY ("activity_type_id")
          REFERENCES "calendar_activity_types"("id") ON DELETE RESTRICT
      )
    `);

    /**
     * Индекс по `activity_type_id` обязателен и основной: обратный запрос
     * «походы этого типа» — то, ради чего таблица и заведена. По префиксу
     * составного ключа он не выполняется: там `trip_id`.
     */
    await queryRunner.query(`
      CREATE INDEX "IDX_trip_types_activity"
          ON "trip_types" ("activity_type_id")
    `);

    await queryRunner.query(`
      INSERT INTO "trip_types" ("trip_id", "activity_type_id")
      SELECT "id", unnest("activity_type_ids")
        FROM "trips"
       WHERE "activity_type_ids" IS NOT NULL
         AND cardinality("activity_type_ids") > 0
      ON CONFLICT DO NOTHING
    `);

    /**
     * Триггер и его функция уходят вместе с колонкой, которую они
     * проверяли. Функцию снимаем явно: без триггера она осталась бы в схеме
     * мусором, который потом ищут по `pg_proc` и боятся тронуть. Она
     * вызывается только триггером на ту же таблицу, поэтому удаление
     * безопасно.
     */
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "trg_trips_validate_activity_types" ON "trips"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS trips_validate_activity_types()`,
    );

    await queryRunner.query(
      `ALTER TABLE "trips" DROP COLUMN "activity_type_ids"`,
    );

    /**
     * Права для роли приложения — как в `TripsDomain` и `Conversations`.
     * Новая таблица требует явного GRANT: в проде default privileges
     * `ph_migrator` его дадут, но блок дублирует и делает миграцию честной
     * без них. `UPDATE` не выдаём: пару не правят, её снимают и ставят
     * заново — как `trip_participant_roles` и `trip_route_elements`.
     */
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, DELETE ON "trip_types" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Колонка возвращается с прежним умолчанием: `NOT NULL DEFAULT '{}'` —
    // ровно та форма, в которой её создавал `TripsDomain`, иначе старый код,
    // не заполняющий её, получил бы нарушение NOT NULL.
    await queryRunner.query(
      `ALTER TABLE "trips" ADD COLUMN "activity_type_ids" int[] NOT NULL DEFAULT '{}'`,
    );

    /**
     * Обратный перенос. `array_agg` по походу без строк даёт NULL, поэтому
     * COALESCE в пустой массив: колонка NOT NULL. Порядок id не сохраняется
     * и не нужен: массив — множество, а не список.
     */
    await queryRunner.query(`
      UPDATE "trips"
         SET "activity_type_ids" = COALESCE(
               (SELECT array_agg(tt."activity_type_id")
                  FROM "trip_types" tt
                 WHERE tt."trip_id" = "trips"."id"),
               '{}'
             )
    `);

    await queryRunner.query(`DROP INDEX "IDX_trip_types_activity"`);
    await queryRunner.query(`DROP TABLE "trip_types"`);

    // Триггер `trg_trips_validate_activity_types` и функцию
    // `trips_validate_activity_types()` не восстанавливаем: их проверка
    // с появлением внешнего ключа стала не нужна, а откат схемы — это
    // возврат к прежним данным, а не к прежним ошибкам в их проверке.
  }
}
