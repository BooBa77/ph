import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Чаты похода и личные сообщения — в одной модели диалогов.
 *
 * Заказчик сформулировал это так: «пусть всё будет в одной куче». По сути
 * он прав, и вот почему это не «куча», а одна сущность: у походного чата
 * и личного различается только привязка — `trip_id` против пары
 * участников. Сообщения, листание курсором, счётчик непрочитанного,
 * будущий realtime — одинаковые. Две таблицы означали бы два кода на одно
 * и то же и дважды чинить каждую ошибку.
 *
 * Переименование, а не «создать новую и перенести»: RENAME сохраняет
 * данные, права `ph_app`, последовательности и внешние ключи. Данные
 * в dev-базе уже есть (чаты и сообщения походов), терять их нечем.
 *
 * Что добавляется:
 *
 * - `direct_a` / `direct_b` — пара участников личного диалога, записанная
 *   **отсортированной** (`direct_a < direct_b`), чтобы `UNIQUE` по обычному
 *   btree не давал двух диалогов с одним собеседником и не требовал
 *   выражения `LEAST/GREATEST` в индексе;
 * - `chk_conversations_scope` — какие комбинации законны: у `direct` нет
 *   `trip_id`, у походных чатов нет пары;
 * - `conversation_members` — состав личного диалога и читательское
 *   состояние для всех: `last_read_at` нужен счётчику непрочитанного.
 *
 * Чего здесь нет намеренно: `last_message_at`. Он был бы денормализацией
 * ради сортировки списка диалогов, но список у одного человека — это
 * единицы строк, а MAX по индексу `(conversation_id, created_at)` считается
 * по нему же. Заводить поле, которое обязано обновляться на каждой
 * вставке (и однажды разойдётся), пока не за что.
 */
export class Conversations1792231000000 implements MigrationInterface {
  name = 'Conversations1792231000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chats" RENAME TO "conversations"`);
    await queryRunner.query(
      `ALTER TABLE "group_messages" RENAME TO "messages"`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" RENAME COLUMN "chat_id" TO "conversation_id"`,
    );

    // Имена индексов, последовательностей и внешних ключей после RENAME
    // остаются прежними и начинают врать: в схеме «chats», а таблица уже
    // «conversations». Переименовываем их **и явно**, а не отдаём на откуп
    // генератору TypeORM: его хеш-имена (`FK_3c61ff0b…`) в схеме невозможно
    // найти глазами, когда разбираешь чужую ошибку.
    await queryRunner.query(
      `ALTER INDEX "UQ_chats_trip_kind" RENAME TO "UQ_conversations_trip_kind"`,
    );
    await queryRunner.query(
      `ALTER INDEX "IDX_group_messages_chat_created" RENAME TO "IDX_messages_conversation_created"`,
    );
    await queryRunner.query(
      `ALTER SEQUENCE "chats_id_seq" RENAME TO "conversations_id_seq"`,
    );
    await queryRunner.query(
      `ALTER SEQUENCE "group_messages_id_seq" RENAME TO "messages_id_seq"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" RENAME CONSTRAINT "FK_e30aacf096339353abd00b72c60" TO "FK_conversations_trip"`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" RENAME CONSTRAINT "FK_bd2fba09cbf551fc641e059500b" TO "FK_messages_conversation"`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" RENAME CONSTRAINT "FK_ada93de56050fe469b3c53fe49f" TO "FK_messages_sender"`,
    );

    await queryRunner.query(`
      ALTER TABLE "conversations"
        ADD COLUMN "direct_a" uuid,
        ADD COLUMN "direct_b" uuid
    `);

    /**
     * Законные комбинации. `kind = 'direct'` — единственный внепоходный
     * вид; когда появится второй, CHECK придётся править вместе с моделью,
     * и это правильно: снаружи похода пока только личные.
     */
    await queryRunner.query(`
      ALTER TABLE "conversations"
        ADD CONSTRAINT "chk_conversations_scope" CHECK (
          ("kind" = 'direct' AND "trip_id" IS NULL
             AND "direct_a" IS NOT NULL AND "direct_b" IS NOT NULL
             AND "direct_a" < "direct_b")
          OR ("kind" <> 'direct' AND "trip_id" IS NOT NULL
             AND "direct_a" IS NULL AND "direct_b" IS NULL)
        )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_conversations_direct_pair"
          ON "conversations" ("direct_a", "direct_b")
       WHERE "kind" = 'direct'
    `);

    await queryRunner.query(`
      CREATE TABLE "conversation_members" (
        "conversation_id" bigint NOT NULL,
        "user_id" uuid NOT NULL,
        "last_read_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_conversation_members" PRIMARY KEY ("conversation_id", "user_id"),
        CONSTRAINT "FK_conversation_members_conversation"
          FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_conversation_members_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_conversation_members_user"
          ON "conversation_members" ("user_id")
    `);

    /**
     * Права для роли приложения.
     *
     * После RENAME права `ph_app` на `conversations` и `messages` уже
     * переехали вместе с таблицами — они выданы на OID, а не на имя.
     * Новая таблица `conversation_members` требует явного GRANT: в проде
     * default privileges `ph_migrator` его дадут, но блок их дублирует —
     * как в `TripsDomain`, чтобы миграция была честной и без них.
     */
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "conversation_members" TO ph_app;
          GRANT SELECT, INSERT, UPDATE, DELETE ON "conversations" TO ph_app;
          GRANT SELECT, INSERT ON "messages" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "conversation_members"`);
    await queryRunner.query(`DROP INDEX "UQ_conversations_direct_pair"`);
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP CONSTRAINT "chk_conversations_scope"`,
    );
    await queryRunner.query(`
      ALTER TABLE "conversations"
        DROP COLUMN "direct_b",
        DROP COLUMN "direct_a"
    `);
    await queryRunner.query(
      `ALTER INDEX "IDX_messages_conversation_created" RENAME TO "IDX_group_messages_chat_created"`,
    );
    await queryRunner.query(
      `ALTER INDEX "UQ_conversations_trip_kind" RENAME TO "UQ_chats_trip_kind"`,
    );
    await queryRunner.query(
      `ALTER SEQUENCE "conversations_id_seq" RENAME TO "chats_id_seq"`,
    );
    await queryRunner.query(
      `ALTER SEQUENCE "messages_id_seq" RENAME TO "group_messages_id_seq"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversations" RENAME CONSTRAINT "FK_conversations_trip" TO "FK_e30aacf096339353abd00b72c60"`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" RENAME CONSTRAINT "FK_messages_conversation" TO "FK_bd2fba09cbf551fc641e059500b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" RENAME CONSTRAINT "FK_messages_sender" TO "FK_ada93de56050fe469b3c53fe49f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" RENAME COLUMN "conversation_id" TO "chat_id"`,
    );
    await queryRunner.query(`ALTER TABLE "messages" RENAME TO "group_messages"`);
    await queryRunner.query(`ALTER TABLE "conversations" RENAME TO "chats"`);
  }
}
