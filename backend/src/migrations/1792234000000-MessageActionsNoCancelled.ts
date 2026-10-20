import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Состояния действия: убираем `cancelled`.
 *
 * Заказчик решил, что «отменено» — это не состояние, а **удаление**:
 * отправитель нажал «мой косяк, отменяем» — строка в чате исчезает, личные
 * сообщения обезвреживаются (вместе с самим действием). Иначе получатель
 * мог бы позже нажать «Да» на уже отменённом переводе и сломать баланс.
 *
 * Удаление вместо состояния — это и есть защита: нет записи, нечего
 * подтверждать. Поэтому CHECK сужается до трёх состояний, а не остаётся
 * с неиспользуемым `cancelled`, который однажды кто-нибудь начнёт писать.
 *
 * Отдельной миграцией, а не правкой предыдущей: применённая — только вперёд.
 */
export class MessageActionsNoCancelled1792234000000
  implements MigrationInterface
{
  name = 'MessageActionsNoCancelled1792234000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "message_actions" DROP CONSTRAINT "chk_message_actions_state"`,
    );
    await queryRunner.query(`
      ALTER TABLE "message_actions"
        ADD CONSTRAINT "chk_message_actions_state"
        CHECK ("state" IN ('pending', 'confirmed', 'disputed'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "message_actions" DROP CONSTRAINT "chk_message_actions_state"`,
    );
    await queryRunner.query(`
      ALTER TABLE "message_actions"
        ADD CONSTRAINT "chk_message_actions_state"
        CHECK ("state" IN ('pending', 'confirmed', 'disputed', 'cancelled'))
    `);
  }
}
