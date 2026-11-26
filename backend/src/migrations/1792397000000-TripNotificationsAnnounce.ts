import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Уведомления по походам — анонс, двадцать видов и перевод легаси
 * (26.11.2026, часть 1 шага; §2 `topics/notifications.md`).
 *
 * Что меняется:
 *
 * 1. **`announce`** — отдельный текст свёрнутой карточки. Сейчас превью —
 *    это `body`, обрезанное на клиенте, и для новых видов («Увы и ах (((»
 *    против «По объективным причинам…») так нельзя. Старые строки
 *    заполняются `body`: там, где тексты совпадают, это нормально.
 * 2. **CHECK `kind` — двадцать видов походов плюс `direct_chat`.** CHECK
 *    снимается до перевода легаси: иначе `UPDATE` на новый вид упёрся бы
 *    в старое ограничение.
 * 3. **Перевод легаси.** `almanac` → `almanac_changed`, `trip_finance`
 *    о залоге → `trip_deposit`; ключи дедупликации переписываются вместе
 *    с видом, иначе повторное событие завело бы вторую карточку.
 *    Старые групповые `trip_finance` о расходах удаляются: их заменяет
 *    персональный `payment_request` должнику (на проде походов нет,
 *    риск нулевой).
 *
 * **`payment_request` не переименовывается.** Вид остаётся тем же кодом,
 * меняется смысл и получатели: карточка снова адресная (должникам).
 * Старые строки читаются и закрываются.
 *
 * Вниз — обратный перевод видов, удаление видов, которых не было в прежнем
 * CHECK, и удаление `announce`. Удалённые групповые «расходы» не
 * восстанавливаются: их текст и получатели нигде не хранятся отдельно.
 */
export class TripNotificationsAnnounce1792397000000
  implements MigrationInterface
{
  name = 'TripNotificationsAnnounce1792397000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD COLUMN "announce" text NOT NULL DEFAULT ''`,
    );

    await queryRunner.query(`UPDATE "notifications" SET "announce" = "body"`);

    // Старый CHECK не пропустит новые виды — снимаем до перевода строк.
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "chk_notifications_kind"`,
    );

    await queryRunner.query(`
      UPDATE "notifications"
         SET "kind" = 'almanac_changed',
             "dedup_key" = 'almanac_changed:' || "trip_id"
       WHERE "kind" = 'almanac'
         AND "trip_id" IS NOT NULL
    `);

    await queryRunner.query(`
      UPDATE "notifications"
         SET "kind" = 'trip_deposit',
             "dedup_key" = 'trip_deposit:' || "trip_id"
       WHERE "kind" = 'trip_finance'
         AND "dedup_key" LIKE 'trip_finance:%:deposit'
         AND "trip_id" IS NOT NULL
    `);

    // Всё, что осталось от `trip_finance`, — групповые «распределены
    // расходы»: их заменяет персональный запрос платежа должнику.
    await queryRunner.query(
      `DELETE FROM "notifications" WHERE "kind" = 'trip_finance'`,
    );

    /**
     * Ключ старого запроса платежа был один на поход
     * (`payment_request:<поход>`), новый — на пару «поход + человек»
     * (§2.3). Переписываем ключ, иначе после первого нажатия кнопки
     * у должника оказались бы две карточки: старая и новая.
     */
    await queryRunner.query(`
      UPDATE "notifications"
         SET "dedup_key" = 'payment_request:' || "trip_id" || ':' || "recipient_user_id"
       WHERE "kind" = 'payment_request'
         AND "trip_id" IS NOT NULL
         AND "dedup_key" = 'payment_request:' || "trip_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "notifications"
        ADD CONSTRAINT "chk_notifications_kind"
        CHECK ("kind" IN (
          'money_transfer', 'trip_dates', 'trip_cancelled', 'trip_goal',
          'trip_route', 'payment_request', 'trip_deposit',
          'participant_joined', 'participant_left', 'transfer_seat',
          'transfer_lost', 'tent_lost', 'meals_layout', 'meals_purchase',
          'role_assigned', 'role_removed', 'trip_expense',
          'almanac_created', 'almanac_changed', 'trip_chat', 'direct_chat'
        ))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "chk_notifications_kind"`,
    );

    await queryRunner.query(`
      UPDATE "notifications"
         SET "kind" = 'almanac',
             "dedup_key" = 'almanac:' || "trip_id"
       WHERE "kind" = 'almanac_changed'
         AND "trip_id" IS NOT NULL
    `);

    await queryRunner.query(`
      UPDATE "notifications"
         SET "kind" = 'trip_finance',
             "dedup_key" = 'trip_finance:' || "trip_id" || ':deposit'
       WHERE "kind" = 'trip_deposit'
         AND "trip_id" IS NOT NULL
    `);

    // Обратно к прежнему ключу «один на поход»: уникальность держит пара
    // `(получатель, ключ)`, поэтому у разных людей коллизии нет.
    await queryRunner.query(`
      UPDATE "notifications"
         SET "dedup_key" = 'payment_request:' || "trip_id"
       WHERE "kind" = 'payment_request'
         AND "trip_id" IS NOT NULL
         AND "dedup_key" LIKE 'payment_request:%:%'
    `);

    // Видов, которых не было в прежнем CHECK, остаться не должно: часть 2+
    // шага их ещё не создаёт, но откат обязан быть безопасным.
    await queryRunner.query(`
      DELETE FROM "notifications"
       WHERE "kind" NOT IN (
         'money_transfer', 'payment_request', 'trip_finance',
         'almanac', 'trip_chat', 'direct_chat'
       )
    `);

    await queryRunner.query(`
      ALTER TABLE "notifications"
        ADD CONSTRAINT "chk_notifications_kind"
        CHECK ("kind" IN (
          'money_transfer', 'payment_request', 'trip_finance',
          'almanac', 'trip_chat', 'direct_chat'
        ))
    `);

    await queryRunner.query(
      `ALTER TABLE "notifications" DROP COLUMN "announce"`,
    );
  }
}
