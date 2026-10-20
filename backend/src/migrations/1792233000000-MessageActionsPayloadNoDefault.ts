import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * У `message_actions.payload` не должно быть DEFAULT.
 *
 * Мелочь, но она держала `schema:log` в дрейфе: TypeORM сравнивает
 * выражение по умолчанию побайтово, и `'{}'::jsonb` из миграции не
 * совпадало с тем, что он генерирует из entity. Вместо того чтобы
 * подгонять кавычки, убрал умолчание совсем: полезную нагрузку всегда
 * присылает сервис — пустое действие без данных не имеет смысла.
 *
 * Отдельной миграцией, а не правкой предыдущей: применённая миграция —
 * только вперёд. Этому уже был урок 20.10.2026.
 */
export class MessageActionsPayloadNoDefault1792233000000
  implements MigrationInterface
{
  name = 'MessageActionsPayloadNoDefault1792233000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "message_actions" ALTER COLUMN "payload" DROP DEFAULT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "message_actions" ALTER COLUMN "payload" SET DEFAULT '{}'::jsonb`,
    );
  }
}
