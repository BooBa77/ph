import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Виртуальные участники и снаряжение «вручную» (Stage B, часть 2, шаг 3).
 *
 * Заказчик 30.10.2026 попросил второй путь заполнения каталога снаряжения
 * и управление снарягой людей без аккаунта: «организаторам доступно
 * добавление виртуальных участников — людей, не пользователей нашего сайта,
 * он сам управляет ими»; «при добавлении снаряги нужен пункт „Указать
 * вручную“». Задание — `docs/ph/virtual-participants.md`.
 *
 * ## Что делается
 *
 * 1. `users.is_virtual` + `users.virtual_owner_user_id` — человек без
 *    аккаунта и тот, кто его завёл.
 * 2. `gear_items.is_trip_only` — вещь, заведённая в походе и личному
 *    каталогу не принадлежащая.
 *
 * ## Почему флагом в `users`, а не отдельной таблицей
 *
 * Виртуальный участник — это человек, который **не может войти**: логин
 * живёт в `auth_identities`, и у виртуального её просто нет. Всё остальное
 * (состав похода, палатки, трансфер, питание, чат, владение вещами) уже
 * ссылается на `users(id)`, поэтому флаг не меняет ни одного внешнего ключа.
 * Отдельная таблица `virtual_participants` заставила бы сделать полиморфными
 * десяток ссылок и все проверки состава ради той же информации.
 *
 * ## CHECK «одно без другого нельзя»
 *
 * `is_virtual = (virtual_owner_user_id IS NOT NULL)` — жёсткое равенство,
 * а не два отдельных условия. Виртуальный без создателя не нашёлся бы
 * в списке «мои люди без аккаунта», а создатель у настоящего пользователя
 * означал бы, что кто-то управляет чужим профилем. Равенство (а не `IS NOT
 * DISTINCT`) выбрано потому, что обе колонки `NOT NULL`/`boolean`: NULL
 * в левой части невозможен, и NULL-семантика CHECK здесь не кусается.
 *
 * `virtual_owner_user_id` — `ON DELETE RESTRICT`: создатель не удаляется
 * физически (у пользователей мягкое удаление), но правило в базе должно
 * запрещать «потерять» виртуальных молча.
 *
 * Индекс **частичный** (`WHERE is_virtual`): список «мои виртуальные»
 * читается по создателю, а настоящих пользователей в этом индексе нет —
 * их подавляющее большинство, и общий индекс по nullable-колонке был бы
 * почти пустым балластом.
 *
 * ## Почему `is_trip_only`, а не ссылка на поход
 *
 * Вещь «вручную» (бутылка бензина на розжиг, кусок целлофана на тент)
 * живёт только в том походе, где её завели, и в личный каталог не попадает.
 * Ссылку на поход в `gear_items` не ставим: вещь и так попадает в поход
 * строкой `trip_gear`, а вторая ссылка на тот же поход разошлась бы
 * с первой после любого переноса. Флаг говорит ровно одно: **эта вещь
 * каталогу не принадлежит** — и `GET /api/gear` её не отдаёт.
 *
 * Индекс `(owner_user_id, is_trip_only)` — два разных запроса: каталог
 * (`is_trip_only = false`) и одноразовые вещи владельца. Существующий
 * `IDX_gear_items_owner_type` под это не годится: тип в фильтре не участвует.
 *
 * Уборка одноразовых вещей — дело кода, а не каскадов: строка `gear_items`
 * удаляется вместе со строкой `trip_gear` (её уносит каскад от участника
 * или ручка удаления вещи из похода). Здесь только схема.
 */
export class VirtualParticipants1792272000000 implements MigrationInterface {
  name = 'VirtualParticipants1792272000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Человек без аккаунта.
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "is_virtual" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "virtual_owner_user_id" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD CONSTRAINT "chk_users_virtual_owner"
        CHECK ("is_virtual" = ("virtual_owner_user_id" IS NOT NULL))
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD CONSTRAINT "FK_users_virtual_owner"
        FOREIGN KEY ("virtual_owner_user_id") REFERENCES "users"("id")
        ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_users_virtual_owner"
        ON "users" ("virtual_owner_user_id")
        WHERE "is_virtual"
    `);

    // 2. Вещь, заведённая в походе.
    await queryRunner.query(`
      ALTER TABLE "gear_items"
        ADD COLUMN "is_trip_only" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_gear_items_owner_trip_only"
        ON "gear_items" ("owner_user_id", "is_trip_only")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_gear_items_owner_trip_only"`);
    await queryRunner.query(`
      ALTER TABLE "gear_items" DROP COLUMN "is_trip_only"
    `);

    await queryRunner.query(`DROP INDEX "IDX_users_virtual_owner"`);
    await queryRunner.query(`
      ALTER TABLE "users" DROP CONSTRAINT "FK_users_virtual_owner"
    `);
    await queryRunner.query(`
      ALTER TABLE "users" DROP CONSTRAINT "chk_users_virtual_owner"
    `);
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN "virtual_owner_user_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN "is_virtual"
    `);
  }
}
