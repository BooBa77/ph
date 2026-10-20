import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Действие в сообщении — кнопки «Да» / «Нет» и их состояние.
 *
 * Заказчику нужны интерактивные сообщения: подтвердить получение денег
 * прямо в переписке. Схема сделана **отдельной от сообщений**, потому что
 * одно действие могут показывать два сообщения сразу — публичное в чате
 * похода и личное получателю. Хранить состояние на каждом из них значило
 * бы получить «нет» в чате и «да» в личке одновременно.
 *
 * Поэтому: `message_actions` — состояние, `messages.action_id` — ссылка
 * на него. Кнопки рисуются там, где есть ссылка, а состояние у них общее.
 *
 * Состояния: `pending` (ждём ответа), `confirmed` (получено),
 * `disputed` (не получено), `cancelled` (перевод отменён отправителем).
 * Деньги двигает только `confirmed`; остальные состояния баланс не меняют,
 * поэтому ошибочно нажатое «нет» ничего не ломает — это сигнал, а не откат.
 *
 * `target_user_id` — кому отвечать; проверка «нажать может только он»
 * на сервере, а не в шаблоне.
 *
 * `payload` — jsonb: у денег это сумма, поход и кто перевёл. Форма
 * полезной нагрузки зависит от `kind`, и это честнее, чем колонка на
 * каждый вид действия: видов будет больше, а колонки пришлось бы
 * добавлять миграцией.
 *
 * `ON DELETE SET NULL` у ссылки из сообщения: удалили действие — сообщение
 * остаётся, просто без кнопок. Обратное (CASCADE) уносило бы переписку
 * вместе со служебной записью.
 */
export class MessageActions1792232000000 implements MigrationInterface {
  name = 'MessageActions1792232000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "message_actions" (
        "id" bigserial NOT NULL,
        "kind" character varying(40) NOT NULL,
        "target_user_id" uuid NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "state" character varying(20) NOT NULL DEFAULT 'pending',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "responded_at" timestamptz,
        CONSTRAINT "PK_message_actions" PRIMARY KEY ("id"),
        CONSTRAINT "chk_message_actions_state" CHECK (
          "state" IN ('pending', 'confirmed', 'disputed', 'cancelled')
        ),
        CONSTRAINT "FK_message_actions_target"
          FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_message_actions_target_state" ON "message_actions" ("target_user_id", "state")`,
    );

    await queryRunner.query(`
      ALTER TABLE "messages"
        ADD COLUMN "action_id" bigint,
        ADD CONSTRAINT "FK_messages_action"
          FOREIGN KEY ("action_id") REFERENCES "message_actions"("id") ON DELETE SET NULL
    `);

    // Миграция даёт приложению то, что ему нужно; в проде default privileges
    // `ph_migrator` это же и выдают, но блок дублирует — как в TripsDomain.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ph_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "message_actions" TO ph_app;
          GRANT USAGE, SELECT ON SEQUENCE "message_actions_id_seq" TO ph_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "messages" DROP CONSTRAINT "FK_messages_action"`,
    );
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "action_id"`);
    await queryRunner.query(`DROP TABLE "message_actions"`);
  }
}
