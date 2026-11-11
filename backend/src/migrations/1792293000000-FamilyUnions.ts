import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Заявка на объединение семьи и парные связи без статусов (11.11.2026).
 *
 * Заказчик: «строгие пары, без сущности „семья“… семья — это компонента
 * связей. Новый родственник тянет всю свою компоненту: заявка на
 * объединение собирает обе стороны, и семья создаётся только после
 * согласия всех». До этого шага заявка была парой со статусом `pending`,
 * и «добавить родного» означало «подтверди меня лично».
 *
 * ## Что здесь появляется
 *
 * `family_unions` — сама заявка: инициатор, статус, дата закрытия.
 * `family_union_members` — согласие каждого участника. Участников не двое,
 * а все живые люди обеих компонент: одна семья втягивается в другую
 * целиком, и решать за родственника нельзя — у него тоже появится доступ
 * к чужому снаряжению.
 *
 * ## Что здесь исчезает
 *
 * Из `family_links` уходят `status`, `requested_by_user_id` и
 * `responded_at`: строка теперь значит «родные», а не «кто-то кого-то
 * позвал». Одно и то же «ждём ответа» больше не живёт в двух таблицах.
 *
 * `responded_at` переименовывается в `accepted_at` (`NOT NULL DEFAULT
 * now()`): дата родства нужна экрану («родные с 11 ноября»), а «согласие,
 * которого не было» после переезда заявок в другую таблицу невозможно.
 *
 * ## Старые заявки
 *
 * Висящие пары `pending` не выбрасываются: каждая становится заявкой
 * с двумя участниками — инициатор уже согласен, второй ждёт. Полный состав
 * компонент у старых заявок неизвестен (их никто не собирал), и терять
 * договорённость хуже, чем собрать по ней две стороны, которые уже
 * договаривались. Прод этой миграцией ещё не выкачен, поэтому на проде
 * переезжать нечему: родных там нет.
 */
export class FamilyUnions1792293000000 implements MigrationInterface {
  name = 'FamilyUnions1792293000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "family_unions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "initiator_user_id" uuid NOT NULL,
        "status" character varying(10) NOT NULL DEFAULT 'pending',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "closed_at" timestamptz,
        CONSTRAINT "FK_family_unions_initiator"
          FOREIGN KEY ("initiator_user_id") REFERENCES "users"("id")
          ON DELETE CASCADE,
        CONSTRAINT "chk_family_unions_status"
          CHECK ("status" IN ('pending', 'accepted', 'declined', 'cancelled')),
        CONSTRAINT "chk_family_unions_closed"
          CHECK (("status" = 'pending') = ("closed_at" IS NULL))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_family_unions_initiator"
          ON "family_unions" ("initiator_user_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "family_union_members" (
        "union_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "consent" character varying(10) NOT NULL DEFAULT 'pending',
        "responded_at" timestamptz,
        CONSTRAINT "PK_family_union_members" PRIMARY KEY ("union_id", "user_id"),
        CONSTRAINT "FK_family_union_members_union"
          FOREIGN KEY ("union_id") REFERENCES "family_unions"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_family_union_members_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE,
        CONSTRAINT "chk_family_union_members_consent"
          CHECK ("consent" IN ('pending', 'accepted', 'declined')),
        CONSTRAINT "chk_family_union_members_responded"
          CHECK (("consent" = 'pending') = ("responded_at" IS NULL))
      )
    `);

    // «Мои заявки» строятся по участнику, а не по заявке.
    await queryRunner.query(`
      CREATE INDEX "IDX_family_union_members_user"
          ON "family_union_members" ("user_id")
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "family_unions" TO ph_app;
          GRANT SELECT, INSERT, UPDATE, DELETE
              ON "family_union_members" TO ph_app;
        END IF;
      END $$;
    `);

    await this.movePendingLinks(queryRunner);
    await this.simplifyLinks(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Возвращаем паре прежнюю форму: статус по умолчанию `accepted` —
    // других строк после этой миграции не бывает, а `pending` вернётся
    // заявками, если их снова начнут создавать кодом прошлой версии.
    await queryRunner.query(`
      ALTER TABLE "family_links"
        ADD COLUMN "requested_by_user_id" uuid,
        ADD COLUMN "status" character varying(10) NOT NULL DEFAULT 'accepted',
        ADD COLUMN "responded_at" timestamptz
    `);
    await queryRunner.query(`
      UPDATE "family_links" SET "requested_by_user_id" = "user_a_id"
    `);
    await queryRunner.query(`
      UPDATE "family_links" SET "responded_at" = "accepted_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "family_links"
        ALTER COLUMN "requested_by_user_id" SET NOT NULL,
        ALTER COLUMN "responded_at" SET NOT NULL,
        ADD CONSTRAINT "FK_family_links_requested_by"
          FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id")
          ON DELETE CASCADE,
        ADD CONSTRAINT "chk_family_links_requester"
          CHECK ("requested_by_user_id" IN ("user_a_id", "user_b_id")),
        ADD CONSTRAINT "chk_family_links_status"
          CHECK ("status" IN ('pending', 'accepted')),
        ADD CONSTRAINT "chk_family_links_responded"
          CHECK (("status" = 'accepted') = ("responded_at" IS NOT NULL)),
        DROP COLUMN "accepted_at"
    `);

    await queryRunner.query(`DROP TABLE "family_union_members"`);
    await queryRunner.query(`DROP TABLE "family_unions"`);
  }

  /**
   * Старые висящие заявки — в новые заявки с двумя участниками.
   *
   * Состав компонент у них неизвестен, поэтому переезжает ровно то, о чём
   * люди договорились: инициатор (он уже согласен) и тот, кого он позвал.
   * Имена в новых заявках берутся из `users`, а дата создания — из пары.
   */
  private async movePendingLinks(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE
        link RECORD;
        new_union uuid;
        other_user uuid;
      BEGIN
        FOR link IN
          SELECT * FROM "family_links" WHERE "status" = 'pending'
        LOOP
          other_user := CASE
                          WHEN link."user_a_id" = link."requested_by_user_id"
                            THEN link."user_b_id"
                          ELSE link."user_a_id"
                        END;

          INSERT INTO "family_unions"
            ("initiator_user_id", "status", "created_at")
          VALUES (link."requested_by_user_id", 'pending', link."created_at")
          RETURNING "id" INTO new_union;

          INSERT INTO "family_union_members"
            ("union_id", "user_id", "consent", "responded_at")
          VALUES
            (new_union, link."requested_by_user_id", 'accepted',
             link."created_at"),
            (new_union, other_user, 'pending', NULL);
        END LOOP;
      END $$;
    `);

    // Пары без родства больше не нужны: их заявка теперь выше.
    await queryRunner.query(`
      DELETE FROM "family_links" WHERE "status" = 'pending'
    `);
  }

  /** `family_links`: строка = родство, без статусов и «кто позвал». */
  private async simplifyLinks(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "family_links"
        DROP CONSTRAINT "chk_family_links_requester",
        DROP CONSTRAINT "chk_family_links_status",
        DROP CONSTRAINT "chk_family_links_responded",
        DROP CONSTRAINT "FK_family_links_requested_by",
        DROP COLUMN "requested_by_user_id",
        DROP COLUMN "status"
    `);

    await queryRunner.query(`
      ALTER TABLE "family_links"
        RENAME COLUMN "responded_at" TO "accepted_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "family_links"
        ALTER COLUMN "accepted_at" SET DEFAULT now(),
        ALTER COLUMN "accepted_at" SET NOT NULL
    `);
  }
}
