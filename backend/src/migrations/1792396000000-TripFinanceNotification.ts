import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Общегрупповое уведомление о деньгах похода — вид `trip_finance`
 * (25.11.2026, миграция 102 после `MessageEditedAt`).
 *
 * §14 `topics/messages.md`, §2.2 и §2.5 `topics/finance.md`: залог и
 * распределение расходов больше не рассылают персональные «запросы
 * платежа» («ты должен»). Участник сам решает в «Бухгалтерии», чем
 * покрыть залог и расходы, поэтому карточка одна на поход и одна на вид
 * события:
 *
 * - `trip_finance:<поход>:deposit` — «Установлен залог»;
 * - `trip_finance:<поход>:expenses` — «Компенсируйте расходы».
 *
 * **Расширяем CHECK, а не заменяем вид.** `payment_request` остаётся
 * в перечне: в базе лежат старые карточки, и после выкатки они должны
 * читаться и закрываться оплатой как раньше. Новые такие строки с этого
 * шага не создаются.
 *
 * Вниз — удалить карточки нового вида и вернуть прежний CHECK на пять
 * видов: ограничение CHECK не позволило бы оставить в таблице строки
 * вида, которого в перечне нет.
 */
export class TripFinanceNotification1792396000000 implements MigrationInterface {
  name = 'TripFinanceNotification1792396000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "chk_notifications_kind"`,
    );

    await queryRunner.query(`
      ALTER TABLE "notifications"
        ADD CONSTRAINT "chk_notifications_kind"
        CHECK ("kind" IN (
          'money_transfer', 'payment_request', 'trip_finance',
          'almanac', 'trip_chat', 'direct_chat'
        ))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "notifications" WHERE "kind" = 'trip_finance'`,
    );

    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "chk_notifications_kind"`,
    );

    await queryRunner.query(`
      ALTER TABLE "notifications"
        ADD CONSTRAINT "chk_notifications_kind"
        CHECK ("kind" IN (
          'money_transfer', 'payment_request', 'almanac',
          'trip_chat', 'direct_chat'
        ))
    `);
  }
}
