import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Реквизиты для взаиморасчётов по походу — шаг «Бухгалтерии» (11.11.2026).
 *
 * Заказчик: «добавь в Профиль поля для указания реквизитов при
 * взаиморасчётах по походу — номер телефона/карты, банк». Две колонки,
 * а не три: «номер телефона или карты» — одна строка, человек вводит то,
 * что у него есть; вторая — банк.
 *
 * Обе nullable и без значения по умолчанию: пусто и «не заполнено» здесь
 * одно и то же, а придуманное «не указано» пришлось бы потом отличить
 * от настоящего банка.
 *
 * GRANT-а нет намеренно: новые колонки в существующей `users` наследуют её
 * табличные права (`ph_app` уже может SELECT/UPDATE), отдельный грант
 * нужен только новым таблицам и последовательностям.
 */
export class UserPaymentDetails1792294000000 implements MigrationInterface {
  name = 'UserPaymentDetails1792294000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "payment_details" character varying(40),
        ADD COLUMN "payment_bank" character varying(100)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "payment_bank",
        DROP COLUMN "payment_details"
    `);
  }
}
