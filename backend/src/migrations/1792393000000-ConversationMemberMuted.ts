import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Тишина по диалогу: `conversation_members.muted_at` (23.11.2026).
 *
 * Заказчик: в правой колонке уведомление о новом сообщении чата похода
 * отключается галочкой — и из ленты, и из-под самого чата. Настройка личная,
 * поэтому живёт в строке состава рядом с `last_read_at`: это уже «состояние
 * читателя в диалоге», и отдельная таблица `muted` была бы тем же самым,
 * разъехавшимся при первом же расхождении.
 *
 * `muted_at` — момент, а не флаг. Он отвечает и на «заглушено ли», и на
 * «когда заглушили», если однажды понадобится правило вида «напомнить
 * через неделю». `NULL` — уведомлять: строки состава у чатов похода
 * ленивые, их может не быть вовсе, и «нет строки» обязано означать
 * «уведомления включены».
 *
 * Вниз — колонка; настройки при откате теряются, это ожидаемо.
 */
export class ConversationMemberMuted1792393000000 implements MigrationInterface {
  name = 'ConversationMemberMuted1792393000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "conversation_members"
        ADD COLUMN IF NOT EXISTS "muted_at" timestamptz
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "conversation_members"
        DROP COLUMN IF EXISTS "muted_at"
    `);
  }
}
