import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Убираем вкладку «Инфо» (`general`) из контракта.
 *
 * Решение заказчика 21.10.2026: информация о походе живёт в «Гостевой»,
 * она одна для участников и гостей, а правка — кнопкой «Редактировать»
 * в шапке. Отдельная вкладка «Инфо» дублировала «Гостевую» и больше
 * не нужна; место сбора уехало в «Трансфер».
 *
 * Что делает миграция:
 * 1. Удаляет права ролей на `general` — они больше ни на что не влияют,
 *    но оставлять их значит врать матрице прав.
 * 2. Сужает CHECK до десяти кодов: старый список с `general` не даст
 *    завести такое право снова и разойдётся с `TRIP_TABS` в коде
 *    (`schema:log` показывал бы расхождение).
 *
 * Вниз — возвращаем CHECK со старым списком; удалённые права не
 * восстанавливаем: это данные сида, их место в `seed-role-tabs.mjs`.
 */
export class RemoveInfoTab1792244000000 implements MigrationInterface {
  name = 'RemoveInfoTab1792244000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "role_tab_permissions" WHERE "tab" = 'general'`,
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
          "tab" IN ('general', 'guest', 'members', 'sport', 'transfer',
                    'route', 'meals', 'gear', 'firstAid', 'finance', 'diary')
        )
    `);
  }
}
