import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Общественное снаряжение похода: «берём эту палатку, едет у Васи».
 *
 * Нужно вкладке «Снаряжение» (Ф7, `docs/ph/gear-distribution.md`). Личный
 * каталог (`gear_items`, Ф3) отвечает на вопрос «что у меня есть»; эта
 * таблица — «что из этого берём в поход и кто понесёт».
 *
 * **Ссылка на предмет каталога, а не копия.** Вес и название берутся
 * из `gear_items`: человек взвесил палатку один раз, и в походе она весит
 * ровно столько же. Копия веса в походе разошлась бы с каталогом после
 * первой правки — а нам нужна не история, а «сколько нести сейчас».
 * `RESTRICT` на предмет: удалить из каталога вещь, которая уже едет
 * в походе, нельзя — приложение отвечает понятным 409, а не теряет
 * снаряжение из подготовки молча.
 *
 * **Два человека — владелец и назначенный.** Правило заказчика: сначала
 * вещь едет в рюкзаке владельца, в чужой попадает только если владелец
 * не тянет. Поэтому «владелец» — это владелец предмета в каталоге
 * (и в походе его не меняют), а «назначенный» — тот, кто понесёт.
 * `NULL` в назначенном — «нераспределённый», а не «нет вещи».
 *
 * **Внешние ключи ведут на пару `(trip_id, user_id)` из `trip_participants`,
 * а не на `users`.** Это то же решение, что у `trip_participant_roles`:
 * вещь в походе принадлежит участнику похода, и снаряжение «человека,
 * которого в походе нет» — это сломанные данные, а не редкий случай.
 * Отсюда же автоматически выполняются правила ухода участника
 * (`gear-distribution.md` §6):
 *
 * - убрали человека из состава — его вещи уходят из похода каскадом
 *   (и предложенные, и утверждённые);
 * - убрали назначенного — вещь остаётся в походе, но становится
 *   нераспределённой (`SET NULL` **только на `assigned_user_id`**:
 *   `trip_id` не обнуляется, вещь по-прежнему в этом походе).
 *
 * `status`: `proposed` — предложена, `approved` — «берём» (участвует
 * в распределении и в весе), `declined` — «не берём». Отказ — это решение,
 * а не удаление: в таблице видно, что вещь обсуждали и почему её нет
 * в рюкзаке.
 *
 * Уникальность `(trip_id, gear_item_id)`: один предмет каталога — одна
 * строка в походе. Два предложения одной палатки — это не «две палатки»,
 * а непонимание, что её уже взяли.
 */
export class TripGear1792243000000 implements MigrationInterface {
  name = 'TripGear1792243000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "trip_gear" (
        "id" BIGSERIAL NOT NULL,
        "trip_id" bigint NOT NULL,
        "gear_item_id" bigint NOT NULL,
        "owner_user_id" uuid NOT NULL,
        "assigned_user_id" uuid,
        "status" character varying(20) NOT NULL DEFAULT 'proposed',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trip_gear" PRIMARY KEY ("id"),
        CONSTRAINT "FK_trip_gear_item"
          FOREIGN KEY ("gear_item_id") REFERENCES "gear_items"("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_trip_gear_owner"
          FOREIGN KEY ("trip_id", "owner_user_id")
          REFERENCES "trip_participants"("trip_id", "user_id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_trip_gear_assignee"
          FOREIGN KEY ("trip_id", "assigned_user_id")
          REFERENCES "trip_participants"("trip_id", "user_id")
          ON DELETE SET NULL ("assigned_user_id"),
        CONSTRAINT "chk_trip_gear_status" CHECK (
          "status" IN ('proposed', 'approved', 'declined')
        )
      )
    `);

    /** Один предмет каталога — одна строка в походе. */
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_trip_gear_item"
          ON "trip_gear" ("trip_id", "gear_item_id")
    `);

    /** Чтение вкладки: все вещи похода подряд, в порядке добавления. */
    await queryRunner.query(`
      CREATE INDEX "IDX_trip_gear_trip"
          ON "trip_gear" ("trip_id", "id")
    `);

    /**
     * Права приложению. Последовательность выдаётся явно, а не «как
     * остальным»: на проде её покрывают default privileges `ph_migrator`,
     * но блок обязан быть честным и без них.
     */
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "trip_gear" TO ph_app;
          GRANT USAGE, SELECT ON SEQUENCE "trip_gear_id_seq" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_trip_gear_trip"`);
    await queryRunner.query(`DROP INDEX "UQ_trip_gear_item"`);
    await queryRunner.query(`DROP TABLE "trip_gear"`);
  }
}
