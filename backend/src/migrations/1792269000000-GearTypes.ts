import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Справочник типов снаряжения и их характеристик (Stage A, 29.10.2026).
 *
 * Заказчик переписал описание снаряжения: у вещи больше нет «одной основной
 * характеристики» — вместо неё **тип** и набор **характеристик** этого типа.
 * Админ заводит типы и их атрибуты, вещь получает тип и значения. Порядок
 * работ — два шага: сначала справочник (эта миграция), потом экземпляры
 * (`gear_items.gear_type_id`, `gear_item_attributes` — Stage B).
 *
 * **EAV, а не jsonb.** Тип и характеристики — данные, которые правит админ:
 * переименовать характеристику, сделать её обязательной или добавить новую
 * должно быть возможно без миграции. Отдельная строка на характеристику
 * даёт это ценой джойна, а jsonb превратил бы справочник в непроверяемый
 * текст и усложнил бы Stage B, где значения надо типизировать по атрибуту.
 *
 * **`gear_items` не трогаем.** Ни `gear_type_id`, ни `gear_item_attributes`,
 * ни групп: старый каталог (вид `kind`, обязательный `title`, вес) живёт
 * и работает по-старому, пока Stage B не переведёт экземпляры на типы.
 * Поэтому идемпотентность развёртывания не страдает: миграция только
 * добавляет таблицы.
 *
 * **`code` — контракт.** Латиница `^[a-z][a-z0-9_]*$`, до 40 символов,
 * уникален и **не меняется**: в Stage B на него будут опираться фильтры
 * (`COOKING_TYPE_CODES` и подобные) и фронт. Ошибку в коде исправляют
 * архивом строки и новой строкой с новым кодом, поэтому уникальность
 * `(gear_type_id, code)` здесь без `WHERE is_active` — архивный код остаётся
 * занятым, иначе активный и архивный атрибут с одним кодом сосуществовали
 * бы, а `attributes {code: value}` в Stage B стал бы неоднозначным.
 *
 * **`value_kind` не меняется** — по той же причине: `number`/`text`/`bool`
 * задаёт, в какую типизированную колонку ляжет значение в Stage B.
 * CHECK-и ловят мусор из админки и сида дёшево: код по регулярке, имя
 * по `btrim`, `sort_order` не отрицательный.
 *
 * **Удаление — только архив.** `DELETE` в API ставит `is_active = false`,
 * физического удаления нет: в Stage B на тип будут ссылаться вещи, а на
 * атрибут — значения, и `ON DELETE RESTRICT` там всё равно бы помешал.
 * `ON DELETE CASCADE` у атрибутов — запасной путь на случай, если тип
 * когда-нибудь удалят руками.
 *
 * **`created_at`/`updated_at` не заводим** — как у `roles`: справочник
 * маленький, аудит не просили. Понадобится — отдельная миграция.
 */
export class GearTypes1792269000000 implements MigrationInterface {
  name = 'GearTypes1792269000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "gear_types" (
        "id"         serial  NOT NULL,
        "code"       text    NOT NULL,
        "name"       text    NOT NULL,
        "is_active"  boolean NOT NULL DEFAULT true,
        "sort_order" int     NOT NULL DEFAULT 0,
        CONSTRAINT "PK_gear_types" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_gear_types_code" UNIQUE ("code"),
        CONSTRAINT "chk_gear_types_code"
          CHECK ("code" ~ '^[a-z][a-z0-9_]*$' AND char_length("code") <= 40),
        CONSTRAINT "chk_gear_types_name"
          CHECK (char_length(btrim("name")) BETWEEN 1 AND 100),
        CONSTRAINT "chk_gear_types_sort" CHECK ("sort_order" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "gear_type_attributes" (
        "id"           serial  NOT NULL,
        "gear_type_id" int     NOT NULL,
        "code"         text    NOT NULL,
        "name"         text    NOT NULL,
        "value_kind"   text    NOT NULL,
        "unit"         text,
        "is_required"  boolean NOT NULL DEFAULT false,
        "is_active"    boolean NOT NULL DEFAULT true,
        "sort_order"   int     NOT NULL DEFAULT 0,
        CONSTRAINT "PK_gear_type_attributes" PRIMARY KEY ("id"),
        CONSTRAINT "FK_gear_type_attributes_type"
          FOREIGN KEY ("gear_type_id") REFERENCES "gear_types"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_gear_type_attributes_code" UNIQUE ("gear_type_id", "code"),
        CONSTRAINT "chk_gear_type_attributes_value_kind"
          CHECK ("value_kind" IN ('number', 'text', 'bool')),
        CONSTRAINT "chk_gear_type_attributes_code"
          CHECK ("code" ~ '^[a-z][a-z0-9_]*$' AND char_length("code") <= 40),
        CONSTRAINT "chk_gear_type_attributes_name"
          CHECK (char_length(btrim("name")) BETWEEN 1 AND 100),
        CONSTRAINT "chk_gear_type_attributes_unit"
          CHECK ("unit" IS NULL OR (btrim("unit") <> '' AND char_length("unit") <= 20)),
        CONSTRAINT "chk_gear_type_attributes_sort" CHECK ("sort_order" >= 0)
      )
    `);

    // Права приложению — обычные данные, их правит админ через API.
    //
    // `DO $$ IF EXISTS` — в dev роли `ph_app` может не быть, а на проде
    // `ALTER DEFAULT PRIVILEGES` из миграции походов уже выдаёт DML. Блок
    // документирует реальную потребность и страхует хост без default
    // privileges. `DELETE` в API не используется (архив — это `UPDATE`),
    // но оставлен как в остальных таблицах — один стиль на весь проект.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "gear_types" TO ph_app;
          GRANT SELECT, INSERT, UPDATE, DELETE ON "gear_type_attributes" TO ph_app;
          GRANT USAGE, SELECT ON SEQUENCE "gear_types_id_seq" TO ph_app;
          GRANT USAGE, SELECT ON SEQUENCE "gear_type_attributes_id_seq" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Атрибуты первыми: внешний ключ на тип, хоть и CASCADE, порядок должен
    // читаться как обратный к `up`.
    await queryRunner.query(`DROP TABLE "gear_type_attributes"`);
    await queryRunner.query(`DROP TABLE "gear_types"`);
  }
}
