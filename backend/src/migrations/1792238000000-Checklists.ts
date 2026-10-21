import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Чек-листы — новая сущность из двух таблиц, с тремя областями жизни.
 *
 * По карте вкладок (`docs/ph/trip-tabs.md`, решение заказчика 20.10.2026)
 * чек-листы нужны трём вкладкам сразу: Снаряжению (что взять), Питанию
 * (список продуктов) и Аптечке (медикаменты). Поэтому это **не** поле
 * в походе и не свойство вкладки, а отдельная подсистема из двух таблиц:
 * `checklists` — сам список, `checklist_items` — его пункты.
 *
 * Три области — это три значения `scope` в одной таблице, и вот почему:
 *
 * - `template` — **шаблон пользователя**, живёт вне похода (`trip_id` NULL,
 *   `owner_user_id` есть). Из него в поход попадает копия, а не ссылка:
 *   правка шаблона не должна переписывать прошедший поход;
 * - `trip` — **общий чек-лист похода** (`trip_id` есть, владельца нет):
 *   он принадлежит походу, а не человеку, — организатор уйдёт, список
 *   останется;
 * - `personal` — **личный чек-лист в походе** (и `trip_id`, и владелец):
 *   у каждого свой, другим не видно.
 *
 * Одна таблица, а не три: у всех трёх одинаковые поля и одинаковые пункты,
 * а различия — в правилах доступа, которые всё равно живут в приложении.
 * Три таблицы дали бы три набора одинаковых CRUD-запросов и три способа
 * ошибиться в них по-разному.
 *
 * **Законные комбинации записаны в CHECK** (`chk_checklists_scope`):
 * «шаблон с походом», «общий список с владельцем», «личный без похода» —
 * это не «странные данные», а сломанная модель, и лучше узнать о ней
 * отказом базы, чем через пустую вкладку.
 *
 * Уникальность: **один общий список на поход** и **один личный на пару
 * (поход, человек)** — частичными уникальными индексами. Второй общий
 * список означал бы два места, где отмечают одно и то же.
 *
 * Пункты: `is_done` и **кто и когда отметил**. «Кто» нужно не для отчёта,
 * а для вопроса «Ваня, ты взял газ?» — в общем списке отметку ставит любой
 * участник, и без автора она обезличена. Целостность пары держит CHECK:
 * отметка без времени и время без отметки — это не состояние, а половина
 * его.
 *
 * `RESTRICT` на пользователя — как везде в проекте: пользователи
 * не удаляются физически (soft delete). Каскады: поход уносит свои списки,
 * список — свои пункты.
 */
export class Checklists1792238000000 implements MigrationInterface {
  name = 'Checklists1792238000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "checklists" (
        "id" BIGSERIAL NOT NULL,
        "scope" character varying(20) NOT NULL,
        "owner_user_id" uuid,
        "trip_id" bigint,
        "title" character varying(120) NOT NULL DEFAULT '',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_checklists" PRIMARY KEY ("id"),
        CONSTRAINT "FK_checklists_owner"
          FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_checklists_trip"
          FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_checklists_scope" CHECK (
          ("scope" = 'template' AND "trip_id" IS NULL AND "owner_user_id" IS NOT NULL)
          OR ("scope" = 'trip' AND "trip_id" IS NOT NULL AND "owner_user_id" IS NULL)
          OR ("scope" = 'personal' AND "trip_id" IS NOT NULL AND "owner_user_id" IS NOT NULL)
        )
      )
    `);

    /**
     * Уникальность общих и личных списков — частичными индексами:
     * шаблонов у человека сколько угодно, и ограничивать их нечем.
     */
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_checklists_trip_shared"
          ON "checklists" ("trip_id")
       WHERE "scope" = 'trip'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_checklists_trip_personal"
          ON "checklists" ("trip_id", "owner_user_id")
       WHERE "scope" = 'personal'
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_checklists_owner"
          ON "checklists" ("owner_user_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "checklist_items" (
        "id" BIGSERIAL NOT NULL,
        "checklist_id" bigint NOT NULL,
        "title" character varying(200) NOT NULL,
        "is_done" boolean NOT NULL DEFAULT false,
        "done_by_user_id" uuid,
        "done_at" timestamptz,
        "created_by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_checklist_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_checklist_items_list"
          FOREIGN KEY ("checklist_id") REFERENCES "checklists"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_checklist_items_done_by"
          FOREIGN KEY ("done_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_checklist_items_created_by"
          FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_checklist_items_title" CHECK (char_length(btrim("title")) > 0),
        CONSTRAINT "chk_checklist_items_done" CHECK (
          ("is_done" = false AND "done_at" IS NULL)
          OR ("is_done" = true AND "done_at" IS NOT NULL)
        )
      )
    `);

    /**
     * Индекс под чтение вкладки: пункты списка подряд, в порядке вставки.
     * Отдельного `position` нет намеренно — порядок пунктов = порядок
     * добавления; перетаскивание появится вместе с интерфейсом, и тогда
     * к нему добавится колонка, а не «на всякий случай» сейчас.
     */
    await queryRunner.query(`
      CREATE INDEX "IDX_checklist_items_list"
          ON "checklist_items" ("checklist_id", "id")
    `);

    /**
     * Права приложению: список и пункты — обычные данные (приложение
     * отмечает и правит их само). Как в `TripsDomain`: блок дублирует
     * default privileges, чтобы миграция была честной и без них.
     */
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "checklists" TO ph_app;
          GRANT SELECT, INSERT, UPDATE, DELETE ON "checklist_items" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Пункты уходят раньше списков: у них внешний ключ на список.
    await queryRunner.query(`DROP TABLE "checklist_items"`);
    await queryRunner.query(`DROP INDEX "IDX_checklists_owner"`);
    await queryRunner.query(`DROP INDEX "UQ_checklists_trip_personal"`);
    await queryRunner.query(`DROP INDEX "UQ_checklists_trip_shared"`);
    await queryRunner.query(`DROP TABLE "checklists"`);
  }
}
