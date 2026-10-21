import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Права ролей на вкладки похода: «завхоз ведёт питание и снаряжение».
 *
 * Нужно Ф6 карты вкладок (`docs/ph/trip-tabs.md`): вкладки появляются,
 * и вопрос «кто их правит» перестаёт быть теоретическим. Завхозов может
 * быть несколько, роли назначают организаторы, поэтому матрица
 * «роль → вкладки» — **данные** (сид `seed-role-tabs.mjs`), а не флаг
 * в коде: иначе новая роль или новая вкладка требовали бы деплоя.
 *
 * Право здесь — **право на правку**. Видят вкладки все участники (решение
 * заказчика 21.10.2026): роль отвечает на вопрос «кто ведёт», а не «кому
 * видно», и отдельного уровня «читать» в модели нет. Организатор правит
 * всё независимо от матрицы — это правило кода, а не строка в таблице.
 *
 * Ключ `(role_id, tab)`: одно право на роль один раз. `CASCADE` на роль —
 * права часть роли. Вкладка проверяется CHECK-ом: код вкладки — часть
 * контракта API, и мусорное значение в нём не должно появляться молча.
 */
export class RoleTabPermissions1792241000000 implements MigrationInterface {
  name = 'RoleTabPermissions1792241000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "role_tab_permissions" (
        "role_id" bigint NOT NULL,
        "tab" character varying(20) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_role_tab_permissions" PRIMARY KEY ("role_id", "tab"),
        CONSTRAINT "FK_role_tab_permissions_role"
          FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_role_tab_permissions_tab" CHECK (
          "tab" IN ('general', 'guest', 'members', 'sport', 'transfer',
                    'route', 'meals', 'gear', 'firstAid', 'finance', 'diary')
        )
      )
    `);

    /**
     * Матрица здесь **не засевается**: права — данные, их кладёт
     * `seed-role-tabs.mjs`. Миграция в проде, где роли ещё не залиты
     * (`seed:roles` идёт после миграций), просто создала бы пустую таблицу
     * и упала бы на отсутствующей роли, если бы пыталась вставить.
     */
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, DELETE ON "role_tab_permissions" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "role_tab_permissions"`);
  }
}
