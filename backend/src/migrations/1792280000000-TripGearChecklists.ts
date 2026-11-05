import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «Список» вкладки «Снаряжение»: рекомендация личных вещей и отметки
 * участников (05.11.2026).
 *
 * Заказчик описал логику «Списка»: в общественной секции два чек-листа —
 * общественное снаряжение и **шаблон личных вещей участникам**; в личной
 * секции — свой список, где рекомендация стоит отдельно над личными
 * позициями, выделена цветом, удалить её нельзя, а отметки организатору
 * не возвращаются.
 *
 * **Рекомендация — четвёртая область `checklists`.** Поля те же, что
 * у общего списка: поход есть, владельца нет (она принадлежит походу,
 * а не человеку). Поэтому вместо новой таблицы расширяется CHECK
 * `chk_checklists_scope`; уникальность — частичный индекс, как у общего
 * и личного списка: рекомендация одна на поход.
 *
 * **Отметки — отдельная таблица.** Пункт рекомендации один на всех,
 * а «взял» у каждого своё; запись отметки в `checklist_items.is_done`
 * означала бы, что первый отметивший сделал это за всех. Строка
 * «пункт + человек» и есть отметка: есть строка — отмечено, сняли —
 * удалили. Половину состояния (`is_done = false`, но `done_at` есть),
 * которую пришлось бы ловить CHECK-ом, так получить невозможно.
 *
 * `ON DELETE CASCADE` на пункт: совет убрали — галочкам на него не место.
 * На пользователя — `RESTRICT`, как у всех ссылок на человека в проекте
 * (пользователи удаляются только мягко).
 */
export class TripGearChecklists1792280000000 implements MigrationInterface {
  name = 'TripGearChecklists1792280000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Новая область в CHECK: рекомендация принадлежит походу.
    await queryRunner.query(`
      ALTER TABLE "checklists" DROP CONSTRAINT "chk_checklists_scope"
    `);
    await queryRunner.query(`
      ALTER TABLE "checklists"
        ADD CONSTRAINT "chk_checklists_scope" CHECK (
          ("scope" = 'template' AND "trip_id" IS NULL AND "owner_user_id" IS NOT NULL)
          OR ("scope" = 'trip' AND "trip_id" IS NOT NULL AND "owner_user_id" IS NULL)
          OR ("scope" = 'personal' AND "trip_id" IS NOT NULL AND "owner_user_id" IS NOT NULL)
          OR ("scope" = 'recommendation' AND "trip_id" IS NOT NULL AND "owner_user_id" IS NULL)
        )
    `);

    // 2. Одна рекомендация на поход — частичный уникальный индекс.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_checklists_trip_recommendation"
          ON "checklists" ("trip_id")
       WHERE "scope" = 'recommendation'
    `);

    // 3. Личные отметки на общих пунктах рекомендации.
    await queryRunner.query(`
      CREATE TABLE "checklist_recommendation_marks" (
        "id" BIGSERIAL NOT NULL,
        "item_id" bigint NOT NULL,
        "user_id" uuid NOT NULL,
        "done_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_checklist_recommendation_marks" PRIMARY KEY ("id"),
        CONSTRAINT "FK_checklist_recommendation_marks_item"
          FOREIGN KEY ("item_id") REFERENCES "checklist_items"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_checklist_recommendation_marks_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_checklist_recommendation_marks"
          ON "checklist_recommendation_marks" ("item_id", "user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_checklist_recommendation_marks_user"
          ON "checklist_recommendation_marks" ("user_id")
    `);

    /**
     * Права приложению — как у остальных таблиц чек-листов. Блок дублирует
     * default privileges, чтобы миграция была честной и без них.
     */
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "checklist_recommendation_marks" TO ph_app;
          GRANT USAGE, SELECT ON SEQUENCE "checklist_recommendation_marks_id_seq" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "checklist_recommendation_marks"`);
    await queryRunner.query(
      `DROP INDEX "UQ_checklists_trip_recommendation"`,
    );

    await queryRunner.query(`
      ALTER TABLE "checklists" DROP CONSTRAINT "chk_checklists_scope"
    `);
    await queryRunner.query(`
      ALTER TABLE "checklists"
        ADD CONSTRAINT "chk_checklists_scope" CHECK (
          ("scope" = 'template' AND "trip_id" IS NULL AND "owner_user_id" IS NOT NULL)
          OR ("scope" = 'trip' AND "trip_id" IS NOT NULL AND "owner_user_id" IS NULL)
          OR ("scope" = 'personal' AND "trip_id" IS NOT NULL AND "owner_user_id" IS NOT NULL)
        )
    `);
  }
}
