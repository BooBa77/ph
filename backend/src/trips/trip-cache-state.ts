import type { EntityManager } from 'typeorm';

import type { TripCacheStateDto } from './dto/trip-cache-state.dto';

/**
 * Отметка свежести содержимого похода.
 *
 * ## Зачем это здесь, а не в сервисах
 *
 * «Кэш на телефоне устарел или нет» решает одна пара чисел у похода.
 * Поднимать её должен **каждый** запрос, который меняет что-то в походе:
 * шапку, состав, питание, снаряжение, ночерёвки, трансфер, деньги,
 * чек-листы. Таких ручек полсотни, и дисциплина «не забыть строчку
 * в сервисе» проверяется только тестом, который однажды всё равно
 * отстанет от кода.
 *
 * Поэтому `touchTrip` вызывается **из перехватчика** (`TripContentInterceptor`)
 * на любом не-GET запросе `/trips/:id/...`: покрытие задаётся
 * маршрутизацией, а не памятью автора. Личные ветки (дневник, «моё» питание)
 * и чаты из счётчика исключены — у них своя свежесть.
 *
 * ## Почему не в той же транзакции
 *
 * Идеально — в одной транзакции с правкой (`lifecycle.md` §2.2). Практически
 * перехватчик срабатывает после коммита сервиса, и это **безопасное**
 * направление ошибки: если счётчик отстанет от данных, клиент лишний раз
 * перечитает поход; если бы он убежал вперёд, кэш навсегда считал бы себя
 * свежим. Второго не бывает: счётчик пишется после того, как данные уже
 * лежат в базе.
 */
export async function touchTrip(
  manager: EntityManager,
  tripId: string,
): Promise<void> {
  await manager.query(
    `UPDATE "trips"
        SET "content_revision" = "content_revision" + 1,
            "content_updated_at" = now()
      WHERE "id" = $1`,
    [tripId],
  );
}

/**
 * Текущая отметка свежести похода вместе с курсорами чатов.
 *
 * Чаты читаются одним запросом: `MAX(id)` по каждому чату похода. Пустой
 * чат даёт `NULL` — это законное значение «сообщений нет», а не ошибка.
 */
export async function readTripCacheState(
  manager: EntityManager,
  tripId: string,
): Promise<TripCacheStateDto> {
  const [row] = await manager.query(
    `SELECT "content_revision"::text AS "revision",
            "content_updated_at" AS "updatedAt"
       FROM "trips"
      WHERE "id" = $1`,
    [tripId],
  );

  const chatRows: Array<{ kind: string; lastMessageId: string | null }> =
    await manager.query(
      `SELECT c."kind" AS "kind",
              MAX(m."id")::text AS "lastMessageId"
         FROM "conversations" c
         LEFT JOIN "messages" m ON m."conversation_id" = c."id"
        WHERE c."trip_id" = $1
        GROUP BY c."kind"
        ORDER BY c."kind"`,
      [tripId],
    );

  return {
    contentRevision: row?.revision ?? '0',
    contentUpdatedAt: new Date(row?.updatedAt ?? Date.now()).toISOString(),
    chats: chatRows.map((chat) => ({
      kind: chat.kind,
      lastMessageId: chat.lastMessageId,
    })),
  };
}
