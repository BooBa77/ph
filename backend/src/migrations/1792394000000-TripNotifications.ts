import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Уведомления вместо ленты чатов — таблица `notifications` (24.11.2026).
 *
 * §14 `topics/messages.md`: правая панель показывает два списка карточек
 * (системные и личные), карточка раскрывается в текст и кнопки своего типа.
 * Уведомление — не сообщение: создаёт его только система, у него есть тип,
 * заголовок, текст и ключ дедупликации. Поэтому новая таблица, а `messages`
 * не меняется вовсе.
 *
 * **Ключ дедупликации уникален на получателя** —
 * `UQ_notifications_recipient_dedup (recipient_user_id, dedup_key)`. Один
 * и тот же перевод двум людям — две карточки (у каждого своя), а второе
 * сообщение в том же чате обновляет ту же строку, а не заводит новую.
 *
 * **Архив — только у денег.** `archived_at` + `archived_reason`
 * (`confirmed` / `expired72` / `paid`). Чат и альманах закрываются
 * удалением без архива, поэтому CHECK держит пару «архив и причина» вместе.
 *
 * **Перенос активных денежных действий.** К этому моменту действующие
 * переводы и просьбы о платеже лежат в `message_actions` и в личных
 * диалогах. Панель после выкатки обязана показать их сразу, иначе человек
 * увидит пустой список, а кнопку «Подтверждаю» найдёт только в переписке.
 * Поэтому `up` переносит `pending`-действия в уведомления:
 *
 * - `money_received` → `money_transfer:<компенсация>`, текст берём из
 *   сообщения действия (там уже «Анна перевела тебе … за поход …»);
 * - `payment_request` → `payment_request:<поход>`, текст собираем из
 *   `payload.tripTitle`.
 *
 * Перенос только по существующим компенсациям/походам: битая ссылка в
 * `payload` не должна ронять миграцию, а уведомление без адресата действия
 * бессмысленно. `ON CONFLICT DO NOTHING` — на случай, если строку уже
 * завели повторно.
 *
 * Вниз — таблица целиком. Архив и перенесённые карточки при откате
 * теряются: они выводятся из `message_actions` и `messages`, которые
 * откат не трогает.
 */
export class TripNotifications1792394000000 implements MigrationInterface {
  name = 'TripNotifications1792394000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id" bigserial PRIMARY KEY,
        "recipient_user_id" uuid NOT NULL,
        "kind" varchar(30) NOT NULL,
        "title" varchar(200) NOT NULL,
        "body" text NOT NULL,
        "dedup_key" varchar(120) NOT NULL,
        "conversation_id" bigint,
        "trip_id" bigint,
        "compensation_id" bigint,
        "archived_at" timestamptz,
        "archived_reason" varchar(20),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_notifications_recipient"
          FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_notifications_conversation"
          FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_notifications_trip"
          FOREIGN KEY ("trip_id") REFERENCES "trips"("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_notifications_compensation"
          FOREIGN KEY ("compensation_id") REFERENCES "trip_compensations"("id")
          ON DELETE CASCADE,
        CONSTRAINT "chk_notifications_kind"
          CHECK ("kind" IN ('money_transfer', 'payment_request', 'almanac', 'trip_chat', 'direct_chat')),
        CONSTRAINT "chk_notifications_archive"
          CHECK (("archived_at" IS NULL) = ("archived_reason" IS NULL)
            AND ("archived_reason" IS NULL
              OR "archived_reason" IN ('confirmed', 'expired72', 'paid')))
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_notifications_recipient_dedup"
        ON "notifications" ("recipient_user_id", "dedup_key")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_notifications_recipient_active"
        ON "notifications" ("recipient_user_id", "archived_at")
    `);

    // Активные переводы → денежные уведомления.
    await queryRunner.query(`
      INSERT INTO "notifications" (
        "recipient_user_id", "kind", "title", "body", "dedup_key",
        "conversation_id", "trip_id", "compensation_id"
      )
      SELECT DISTINCT ON (ma."target_user_id", 'money_transfer:' || tc."id")
        ma."target_user_id",
        'money_transfer',
        'Денежный перевод',
        COALESCE(m."body", 'Перевод по походу'),
        'money_transfer:' || tc."id",
        m."conversation_id",
        tc."trip_id",
        tc."id"
      FROM "message_actions" ma
      JOIN "trip_compensations" tc
        ON tc."id" = NULLIF(ma."payload"->>'compensationId', '')::bigint
      LEFT JOIN "messages" m
        ON m."action_id" = ma."id"
      WHERE ma."kind" = 'money_received'
        AND ma."state" = 'pending'
      ORDER BY ma."target_user_id", 'money_transfer:' || tc."id", m."id" DESC NULLS LAST
      ON CONFLICT ("recipient_user_id", "dedup_key") DO NOTHING
    `);

    // Активные просьбы о платеже → уведомления «Запрос платежа».
    await queryRunner.query(`
      INSERT INTO "notifications" (
        "recipient_user_id", "kind", "title", "body", "dedup_key",
        "conversation_id", "trip_id", "compensation_id"
      )
      SELECT DISTINCT ON (ma."target_user_id", t."id")
        ma."target_user_id",
        'payment_request',
        'Запрос платежа',
        'Организатор запросил платёж по походу «'
          || COALESCE(NULLIF(ma."payload"->>'tripTitle', ''), 'поход #' || t."id")
          || '».',
        'payment_request:' || t."id",
        NULL,
        t."id",
        NULL
      FROM "message_actions" ma
      JOIN "trips" t
        ON t."id" = NULLIF(ma."payload"->>'tripId', '')::bigint
      WHERE ma."kind" = 'payment_request'
        AND ma."state" = 'pending'
      ORDER BY ma."target_user_id", t."id", ma."id" DESC
      ON CONFLICT ("recipient_user_id", "dedup_key") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "notifications"`);
  }
}
