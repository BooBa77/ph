import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Пункт чек-листа может указывать на конкретную вещь снаряжения
 * (31.10.2026).
 *
 * Заказчик: «В списки можно добавлять свободный текст и, что усложняет,
 * указание конкретного экземпляра снаряжения. Если экземпляр удаляется, то
 * ссылка становится текстом = тип снаряжения».
 *
 * **Текст остаётся у каждого пункта.** У пункта со ссылкой `title` — снимок
 * названия вещи на момент привязки. Поэтому колонка не заменяет текст,
 * а дополняет его: ссылка исчезла — пункт остался читаемым.
 *
 * **Удаление вещи — не удаление пункта.** Это отдельный сценарий, и решён он
 * в базе, а не в сервисе каталога: вещь уходит не только ручкой
 * `DELETE /api/gear/:id`, но и каскадом (одноразовая вещь похода уходит
 * вместе со строкой `trip_gear`, вещи уходят вместе с каскадом похода).
 * Сервисная уборка прошла бы мимо каскадов, и в списке осталась бы ссылка
 * в никуда. Триггер `trg_gear_items_unlink_checklists` — единственное место,
 * через которое проходят **все** удаления вещей.
 *
 * Что делает триггер, прежде чем строка `gear_items` исчезнет:
 *
 * - `gear_item_id` у пунктов обнуляется (`SET NULL` — тот же результат,
 *   но триггер успевает раньше и работает даже там, где FK не сработал бы);
 * - `title` становится **именем типа** вещи: «Палатка», «Топор». Это ровно
 *   то, что просил заказчик: ссылка превращается в текст типа.
 *
 * `left(name, 200)` — не косметика: `checklist_items.title` объявлен
 * `varchar(200)`, и длинное имя типа не должно ронять удаление вещи
 * ошибкой длины. Имя типа непустое по CHECK в `gear_types`, поэтому
 * `chk_checklist_items_title` после обновления тоже проходит.
 *
 * `ON DELETE SET NULL` у внешнего ключа оставлен как страховка уровня FK:
 * если триггер когда-нибудь снимут, пункт всё равно не унесёт с собой
 * ссылку на несуществующую строку.
 */
export class ChecklistGearRefs1792275000000 implements MigrationInterface {
  name = 'ChecklistGearRefs1792275000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Ссылка на вещь. NULL — обычный текстовый пункт.
    await queryRunner.query(`
      ALTER TABLE "checklist_items" ADD COLUMN "gear_item_id" bigint
    `);

    await queryRunner.query(`
      ALTER TABLE "checklist_items"
        ADD CONSTRAINT "FK_checklist_items_gear_item"
        FOREIGN KEY ("gear_item_id") REFERENCES "gear_items"("id")
        ON DELETE SET NULL
    `);

    /**
     * Индекс под два вопроса: «на какие списки ссылается эта вещь» задаёт
     * триггер при каждом удалении вещи, а «что за вещь у этого пункта» —
     * чтение любого списка. Без индекса оба — последовательный скан.
     */
    await queryRunner.query(`
      CREATE INDEX "IDX_checklist_items_gear"
          ON "checklist_items" ("gear_item_id")
    `);

    /**
     * Триггер на удаление вещи: пункт не исчезает, а становится текстом
     * имени своего типа. См. комментарий к миграции — почему в базе,
     * а не в сервисе.
     */
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION checklist_items_unlink_gear()
      RETURNS TRIGGER AS $$
      BEGIN
        UPDATE "checklist_items"
           SET "gear_item_id" = NULL,
               "title" = (
                 SELECT left("name", 200)
                   FROM "gear_types"
                  WHERE "id" = OLD."gear_type_id"
               )
         WHERE "gear_item_id" = OLD."id";

        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      CREATE TRIGGER "trg_gear_items_unlink_checklists"
        BEFORE DELETE ON "gear_items"
        FOR EACH ROW
        EXECUTE FUNCTION checklist_items_unlink_gear()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "trg_gear_items_unlink_checklists" ON "gear_items"
    `);
    await queryRunner.query(`
      DROP FUNCTION IF EXISTS checklist_items_unlink_gear()
    `);
    await queryRunner.query(`DROP INDEX "IDX_checklist_items_gear"`);
    await queryRunner.query(`
      ALTER TABLE "checklist_items"
        DROP CONSTRAINT "FK_checklist_items_gear_item"
    `);
    await queryRunner.query(`
      ALTER TABLE "checklist_items" DROP COLUMN "gear_item_id"
    `);
  }
}
