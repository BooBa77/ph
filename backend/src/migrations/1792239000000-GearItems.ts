import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Личное снаряжение: каталог предметов с весом.
 *
 * Нужно Ф3 карты вкладок (`docs/ph/trip-tabs.md`): вкладка «Снаряжение»
 * похода собирается из того, что участники **предлагают**, а предлагать
 * они должны из своего списка — иначе каждый поход начинается с переписи
 * рюкзака заново.
 *
 * Одна таблица, потому что снаряжение человека — это плоский список
 * предметов: вид (палатка, спальник, котелок), название, вес. Категории
 * живут в коде (`gear.types.ts`), а не в таблице: их десяток, и они
 * не меняются от похода к походу. Появится нужда в своих категориях —
 * это будет отдельная миграция и отдельное решение.
 *
 * **Вес в граммах и nullable.** Граммы — чтобы не тащить `numeric`
 * (в Node он приезжает строкой). `NULL` — «вес не знаю», и такой предмет
 * не попадает в сумму рюкзака: ноль означал бы «невесомый», а это ложь.
 *
 * Индекс `(owner_user_id, kind, id)` — под единственное чтение: «мой
 * список, сгруппированный по виду». Отдельный индекс по владельцу был бы
 * его префиксом и лишней строкой в схеме.
 */
export class GearItems1792239000000 implements MigrationInterface {
  name = 'GearItems1792239000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "gear_items" (
        "id" BIGSERIAL NOT NULL,
        "owner_user_id" uuid NOT NULL,
        "kind" character varying(20) NOT NULL,
        "title" character varying(120) NOT NULL,
        "weight_grams" integer,
        "note" character varying(500),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_gear_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_gear_items_owner"
          FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_gear_items_kind" CHECK (
          "kind" IN ('tent', 'sleeping', 'backpack', 'kitchen',
                     'clothing', 'footwear', 'technical', 'other')
        ),
        CONSTRAINT "chk_gear_items_weight" CHECK (
          "weight_grams" IS NULL OR "weight_grams" > 0
        ),
        CONSTRAINT "chk_gear_items_title" CHECK (
          char_length(btrim("title")) > 0
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_gear_items_owner"
          ON "gear_items" ("owner_user_id", "kind", "id")
    `);

    // Права приложению: снаряжение — обычные данные, правит их сам человек.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "gear_items" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_gear_items_owner"`);
    await queryRunner.query(`DROP TABLE "gear_items"`);
  }
}
