import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Снаряжение родных: одна вещь — одно использование в походе (10.11.2026).
 *
 * Заказчик: «у родных снаряжение общее… В походе родные равноправно могут
 * использовать снаряжение, но если один задействовал что-то, то второму
 * нельзя, нельзя один спальник обоим взять. Кто выставил снарягу для
 * общественных нужд, тот считается и владельцем».
 *
 * ## Что здесь меняется и почему только индексы
 *
 * Отдельной таблицы «общего снаряжения» нет и не нужно: родство уже
 * хранится в `family_links`, а вещь по-прежнему принадлежит одному
 * человеку в каталоге (`gear_items.owner_user_id`). Общим становится
 * **доступ**: вещь родного можно предложить в поход и взять себе, а
 * «владельцем» строки похода остаётся тот, кто её выставил
 * (`trip_gear.owner_user_id` — offerer, а не каталог).
 *
 * Единственное, чего раньше не требовалось, — **запрет взять одну вещь
 * дважды**. Пока каждый видел только свой каталог, две строки на одну
 * вещь были невозможны по построению. С общим снаряжением они стали
 * возможны, и правило заказчика («нельзя один спальник обоим») должно
 * жить в базе, а не в надежде на аккуратность сервиса.
 *
 * ## Какие индексы меняются
 *
 * Было «одна вещь на человека в походе», стало «одна вещь на поход»:
 *
 * - `trip_personal_gear` — «Взял»: одежда, каска, палки, личная посуда;
 * - `trip_route_sleeping` — «Спальник» в «Ночёвках»: ровно тот случай,
 *   про который заказчик и сказал.
 *
 * В `trip_gear` (общественное снаряжение) такой индекс уже есть
 * (`UQ_trip_gear_item`): вещь, предложенная в поход, одна и та же для всех.
 * Поэтому здесь его не трогаем.
 *
 * **Существующие данные менять не нужно.** До этой миграции вещь могла
 * попасть в поход только из каталога её владельца, а строку добавлял он же:
 * две строки на один предмет были невозможны. Проверка ниже это
 * подтверждает и падает с понятным текстом, если в базе всё-таки есть
 * дубли, — молча удалять чужие строки миграция не станет.
 *
 * **Разные таблицы.** Запрет «одна вещь — одно использование» охватывает
 * ещё и пару «общественное ↔ личное», но она живёт в разных таблицах,
 * и обычным уникальным индексом её не выразить: это проверяет сервис
 * (409 с человеческим текстом), а не база.
 */
export class FamilyGear1792290000000 implements MigrationInterface {
  name = 'FamilyGear1792290000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.assertNoDuplicates(queryRunner, 'trip_personal_gear');
    await this.assertNoDuplicates(queryRunner, 'trip_route_sleeping');

    await queryRunner.query(
      `DROP INDEX "UQ_trip_personal_gear_item"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_personal_gear_trip_item"
          ON "trip_personal_gear" ("trip_id", "gear_item_id")
    `);

    await queryRunner.query(
      `DROP INDEX "UQ_trip_route_sleeping_item"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_route_sleeping_trip_item"
          ON "trip_route_sleeping" ("trip_id", "gear_item_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "UQ_trip_route_sleeping_trip_item"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_route_sleeping_item"
          ON "trip_route_sleeping" ("trip_id", "user_id", "gear_item_id")
    `);

    await queryRunner.query(
      `DROP INDEX "UQ_trip_personal_gear_trip_item"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_personal_gear_item"
          ON "trip_personal_gear" ("trip_id", "user_id", "gear_item_id")
    `);
  }

  /**
   * Две строки на одну вещь в одном походе — повод остановиться.
   *
   * Это не защита от ошибки в самой миграции, а защита от «сюрприза»:
   * если в dev-базе кто-то уже завёл дубль руками, уникальный индекс
   * упадёт с невнятным `could not create unique index`. Пусть падает
   * с числами и id — так понятно, что именно разбирать.
   */
  private async assertNoDuplicates(
    queryRunner: QueryRunner,
    table: string,
  ): Promise<void> {
    const rows = (await queryRunner.query(`
      SELECT trip_id::text AS "tripId",
             gear_item_id::text AS "gearItemId",
             count(*)::int AS "count"
        FROM "${table}"
       GROUP BY trip_id, gear_item_id
      HAVING count(*) > 1
       LIMIT 5
    `)) as Array<{ tripId: string; gearItemId: string; count: number }>;

    if (rows.length === 0) return;

    const list = rows
      .map((row) => `поход ${row.tripId}, вещь ${row.gearItemId} — ${row.count}`)
      .join('; ');

    throw new Error(
      `Нельзя включить «одна вещь — один поход»: в "${table}" уже есть дубли (${list}). ` +
        'Разберите их руками: автоматически удалять чужую строку миграция не будет.',
    );
  }
}
