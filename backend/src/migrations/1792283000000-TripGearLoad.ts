import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Пакеты еды в рюкзаках и тип «Аптечка» (06.11.2026).
 *
 * ## Что просил заказчик
 *
 * «Эта закладка также связующая для Питание, Ночёвки. Пакеты с едой
 * переносятся в рюкзаки… И автоматическое распределение между рюкзаками,
 * есть кнопочка, которая автоматически распределит груз, учитывая
 * владельцев вещей и пол участников».
 *
 * Правила были закрыты ещё 21.10.2026 (`docs/ph/gear-distribution.md` §4–§5),
 * в том числе: продукты формируются пакетами в «Питании», а распределяются
 * вместе со снарягой. Не хватало одного поля — **кому едет пакет**:
 * `trip_meal_packages` знала владельца тары (`eater_user_id` — личная еда),
 * но не несущего.
 *
 * ## Модель
 *
 * - **`assigned_user_id` — несущий пакета**, `NULL` — не распределён.
 *   Отдельное поле, а не `eater_user_id`: личный пакет автономного питания
 *   всегда едет у своего едока (он его и ест), а общий пакет похода
 *   раскладывается по людям и может достаться кому угодно. Смешивать эти
 *   два смысла в одной колонке значило бы потерять, чья это еда.
 * - **Внешний ключ на `users`, а не на `trip_participants`.** Пакет живёт
 *   в походе и переживает смену состава: еда — общак (`gear-distribution.md`
 *   §6), ушедший участник её не забирает, назначение просто снимается.
 *   `ON DELETE SET NULL` делает это при удалении человека из базы; уход
 *   из похода (`declined`) строку участия не удаляет, и назначение на него
 *   раскладка считает нераспределённым — это правило ответа `GET /gear/load`,
 *   а не каскада.
 *
 * ## «Аптечка»
 *
 * Единственное закрепление автораспределения — аптечка у медика
 * (`gear-distribution.md` §4). Закреплять нечего, пока аптечку нечем
 * опознать: заказчик выбрал отдельный тип справочника. Строку заводим
 * здесь и в сиде `seed:gear-types`: на свежей базе без сида тип нужен
 * миграции, на живой — сиду. `ON CONFLICT DO NOTHING` не затирает правки
 * админа (переименовать «Аптечку» можно, код остаётся контрактом).
 * Код — `first_aid`: шаблон `chk_gear_types_code` не пропускает camelCase.
 */
export class TripGearLoad1792283000000 implements MigrationInterface {
  name = 'TripGearLoad1792283000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trip_meal_packages"
        ADD COLUMN "assigned_user_id" uuid NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "trip_meal_packages"
        ADD CONSTRAINT "FK_trip_meal_packages_assigned"
        FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id")
        ON DELETE SET NULL
    `);

    // Раскладка читает все пакеты похода сразу: индекс по походу нужен,
    // чтобы «Рюкзаки» не перебирали таблицу на каждом открытии вкладки.
    await queryRunner.query(`
      CREATE INDEX "IDX_trip_meal_packages_assigned"
        ON "trip_meal_packages" ("trip_id", "assigned_user_id")
    `);

    await queryRunner.query(`
      INSERT INTO "gear_types" ("code", "name")
      VALUES ('first_aid', 'Аптечка')
      ON CONFLICT ("code") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Тип убираем только если им не пользуются: удалить используемую
    // строку справочника не даст внешний ключ вещей, и падать на откате
    // из-за чужой вещи неправильно.
    await queryRunner.query(`
      DELETE FROM "gear_types" g
       WHERE g."code" = 'first_aid'
         AND NOT EXISTS (
           SELECT 1 FROM "gear_items" i WHERE i."gear_type_id" = g."id"
         )
    `);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_trip_meal_packages_assigned"`,
    );
    await queryRunner.query(`
      ALTER TABLE "trip_meal_packages"
        DROP CONSTRAINT IF EXISTS "FK_trip_meal_packages_assigned"
    `);
    await queryRunner.query(`
      ALTER TABLE "trip_meal_packages"
        DROP COLUMN IF EXISTS "assigned_user_id"
    `);
  }
}
