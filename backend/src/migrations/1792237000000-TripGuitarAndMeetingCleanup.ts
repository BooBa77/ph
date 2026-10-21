import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * «Будет гитара» вместо времени сбора и заброски.
 *
 * Каркас страницы похода пересобран под вкладки (`docs/ph/trip-tabs.md`),
 * и два поля, которые заводились месяц назад «для мяса», там не нужны:
 *
 * - **`meeting_at`** уходил во вкладку «Общая» вместе с местом сбора, но
 *   время выезда и точки маршрута — это уже «Трансфер»: там строка заброски
 *   со своими датами, точками отправления и прибытия, а не одна колонка
 *   у похода. Держать время сбора в двух местах значило бы однажды
 *   разойтись: в шапке «8:00», в трансфере «8:30».
 * - **`transfer_text`** заменяется той же вкладкой «Трансфер» (машины,
 *   поезда, распределение участников). Одна строка текста её не описывает,
 *   а как временная мера она уже сделала своё: заказчик ею не пользуется.
 *
 * Место сбора (`meeting_place`) остаётся: «у вокзала, платформа 2» — это
 * короткая строка, которую человек ищет глазами в день выхода, и ей рано
 * в структуру трансфера.
 *
 * **`has_guitar`** — обратная сторона той же перестройки: «Будет гитара»
 * заказчик назвал признаком, который решают в конце формы и хотят видеть
 * в походе. Это `boolean NOT NULL DEFAULT false`, а не трёхзначное поле:
 * «не знаю» здесь не ответ — поход либо с гитарой, либо нет, и по умолчанию
 * её нет (домысливать за организатора нечего).
 *
 * Данные не переносим: время сбора и текст заброски живут только в dev
 * и нужны были двоим-трём тестовым походам. Переносить их в трансфер
 * некуда — вкладки ещё нет, а `transfer_text` в свободном виде там всё
 * равно не поместится.
 */
export class TripGuitarAndMeetingCleanup1792237000000
  implements MigrationInterface
{
  name = 'TripGuitarAndMeetingCleanup1792237000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trips"
        ADD COLUMN "has_guitar" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(
      `ALTER TABLE "trips"
         DROP COLUMN "meeting_at",
         DROP COLUMN "transfer_text"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /**
     * Колонки возвращаются `NULL`-able и без умолчаний — ровно та форма,
     * в которой их создавала `TripsMeetingAndTransfer`: старый код
     * не заполняет их вовсе, и `NOT NULL` без DEFAULT сломал бы вставку.
     * Данные, удалённые `up`, откат не вернёт — их и не было в проде.
     */
    await queryRunner.query(
      `ALTER TABLE "trips"
         ADD COLUMN "meeting_at" timestamptz,
         ADD COLUMN "transfer_text" text`,
    );

    await queryRunner.query(`ALTER TABLE "trips" DROP COLUMN "has_guitar"`);
  }
}
