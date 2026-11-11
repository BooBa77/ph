import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Мягкое удаление вещи отвязывает её от чек-листов (11.11.2026).
 *
 * Триггер `trg_gear_items_unlink_checklists` (миграция
 * `1792275000000-ChecklistGearRefs`) ловит только `DELETE`: пункт списка
 * не исчезает, а становится текстом имени типа. С 11.11.2026 вещь больше
 * не удаляется физически — она получает `deleted_at`, — и без этого триггера
 * пункт чек-листа продолжал бы ссылаться на вещь, которой в каталоге нет:
 * список показал бы «Палатка · 2,4 кг · из снаряжения» с пустым названием.
 *
 * Правило остаётся **в базе**, как и было решено 31.10.2026: вещь уходит
 * и каскадом (удаление человека, физическая уборка), и мягко — сервисом.
 * Второй такой же код в `FamilyGearService` однажды разошёлся бы с первым.
 *
 * `AFTER UPDATE OF deleted_at` с условием «было NULL, стало не NULL»:
 * обратное «оживление» (шаг объединения семьи) пункты не восстанавливает —
 * это отдельное решение того шага, а не молчаливая отмена удаления.
 */
export class GearSoftDeleteChecklists1792292000000
  implements MigrationInterface
{
  name = 'GearSoftDeleteChecklists1792292000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TRIGGER "trg_gear_items_unlink_checklists_soft"
        AFTER UPDATE OF "deleted_at" ON "gear_items"
        FOR EACH ROW
        WHEN (OLD."deleted_at" IS NULL AND NEW."deleted_at" IS NOT NULL)
        EXECUTE FUNCTION checklist_items_unlink_gear()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "trg_gear_items_unlink_checklists_soft"
        ON "gear_items"
    `);
  }
}
