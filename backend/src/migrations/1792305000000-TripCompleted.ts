import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Завершение похода: `trips.completed_at` (20.11.2026).
 *
 * Заказчик: «поход заканчивается решением автора, а не по дате»
 * ([lifecycle.md](../docs/ph/lifecycle.md) §4.4). `NULL` — поход не завершён,
 * отметка времени — завершён, и отменить это нельзя.
 *
 * **Почему отдельная колонка, а не значение `trips.status`.** Статус —
 * стадия *подготовки* (`idea | planning | decided`), и «поход состоялся» —
 * не стадия подготовки, а её итог. Завершённый поход остаётся `decided`:
 * иначе сломались бы все проверки готовности и фильтры ленты, которые
 * читают `status`. Плюс `status` — словарь, а `completed_at` — факт
 * со временем: по нему видно, когда закрыли поход, и его нельзя перепутать
 * с «закончился по датам» (`ends_at`).
 *
 * **`timestamptz`, а не `boolean`.** Решение одно и то же — «завершён/нет»,
 * но время отвечает и на вопрос «когда», не заводя вторую колонку. `NULL`
 * в Postgres — это «не завершён», отдельного `false` не нужно.
 *
 * **CHECK-ов нет.** Признак независим от дат: поход может быть завершён
 * раньше планового конца, если группа вернулась раньше и автор так решил.
 */
export class TripCompleted1792305000000 implements MigrationInterface {
  name = 'TripCompleted1792305000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trips"
        ADD COLUMN "completed_at" timestamptz
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trips" DROP COLUMN "completed_at"
    `);
  }
}
