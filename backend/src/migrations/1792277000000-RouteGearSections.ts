import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Секция у снаряжения похода и типы «Посуды» (01.11.2026).
 *
 * ## Что меняет заказчик
 *
 * «Переименуй секцию „Костровое“ в „Готовка“ и расширяем её. Теперь в ней
 * три группы снаряжения „Посуда“, „Костровое“ и „Горелки“, раздели их
 * полосками и в каждой группе свои кнопки и свой список. В новой „Посуда“ —
 * кнопки „Добавить котёл“, „Добавить половник“, „Добавить нож“, это всё
 * забинденные типы снаряжения».
 *
 * И про кнопку «Добавить ещё»: «по этой кнопке выбор из личного снаряжения
 * или добавка вручную незабинденного снаряжения. Например, вкладыш
 * в спальник, грелка, губка для мытья посуды. Предлагать в фильтре выбора
 * сначала соответствующую группу, но вообще, может хоть лодку выбрать».
 *
 * ## Две вещи, которых не было
 *
 * 1. **Три типа посуды** — `kettle`, `ladle`, `knife`. Кнопки в секции
 *    забинденные, как «Добавить топор», поэтому типы обязаны существовать
 *    в справочнике: без строки в `gear_types` кнопке нечего предложить.
 *    Заводит их миграция, а не только сид `seed:gear-types` — по тому же
 *    правилу, по которому миграция `1792276000000` завела «Коврик».
 *    Полка каталога у типов не своя: группа живёт на вещи, а эти вещи
 *    человек складывает в «Кухню» (решение заказчика 01.11.2026).
 *
 * 2. **Пометка секции у строки снаряжения похода** — `route_section`.
 *    До шага секция вещи выводилась из её типа: палатка — в «Палатках»,
 *    топор — в «Костровом». Для «Добавить ещё» этого мало: заказчик просил
 *    показывать вещь **там, где её добавили**, а губка для посуды или лодка
 *    по типу не попадают ни в одну секцию. Пометка `NULL` у обычных вещей —
 *    их секция по-прежнему считается по типу, и старые строки менять
 *    не нужно.
 *
 * Словарь секций — контракт API (`TRIP_GEAR_ROUTE_SECTIONS`): `tent`,
 * `dishes`, `campfire`, `stove`. Секция «Спальник» сюда не входит: она
 * личная и живёт в `trip_route_sleeping` — все её строки и так показываются
 * в одной секции, помечать нечего.
 *
 * `down` удаляет типы только если ими не обзавелись вещи: `gear_items`
 * ссылается на тип `RESTRICT`, и падать на откате из-за реальных данных
 * миграция не должна.
 */
export class RouteGearSections1792277000000 implements MigrationInterface {
  name = 'RouteGearSections1792277000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Типы «Посуды»: забинденные коды трёх новых кнопок.
    for (const [code, name] of [
      ['kettle', 'Котёл'],
      ['ladle', 'Половник'],
      ['knife', 'Нож'],
    ] as const) {
      await queryRunner.query(
        `INSERT INTO "gear_types" ("code", "name", "sort_order")
         VALUES ($1, $2, 0)
         ON CONFLICT ("code") DO NOTHING`,
        [code, name],
      );
    }

    // 2. Пометка секции у вещи похода. `NULL` — секция по типу.
    await queryRunner.query(
      `ALTER TABLE "trip_gear" ADD COLUMN "route_section" varchar(20)`,
    );

    await queryRunner.query(`
      ALTER TABLE "trip_gear"
        ADD CONSTRAINT "chk_trip_gear_route_section"
          CHECK ("route_section" IS NULL
                 OR "route_section" IN ('tent', 'dishes', 'campfire', 'stove'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trip_gear"
        DROP CONSTRAINT "chk_trip_gear_route_section"
    `);
    await queryRunner.query(
      `ALTER TABLE "trip_gear" DROP COLUMN "route_section"`,
    );

    // Типы — данные, и вещи на них уже могут ссылаться (`RESTRICT`).
    // Удаляем только свободные: иначе откат схемы падал бы на реальной базе.
    await queryRunner.query(`
      DELETE FROM "gear_types" t
       WHERE t."code" IN ('kettle', 'ladle', 'knife')
         AND NOT EXISTS (
           SELECT 1 FROM "gear_items" i WHERE i."gear_type_id" = t."id"
         )
    `);
  }
}
