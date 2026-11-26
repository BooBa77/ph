import { DataSource, type EntityManager } from 'typeorm';

import type { Trip } from './entities/trip.entity';
import type { NotificationsService } from './notifications.service';

/**
 * «Альманах похода обновлён» — карточка уведомления участникам (22.11.2026;
 * без личного сообщения — 24.11.2026).
 *
 * Заказчик: «При создании/редактировании записи в альманахе всем участникам
 * отправляется уведомление „Альманах похода {имя похода} обновлён“, если
 * у пользователя уже есть такое непрочитанное, новых ему не шлём».
 *
 * **Что изменилось 26.11.2026.** Появился вид `almanac_created` (§3.18):
 * первое содержимое, добавленное организатором, — это «создан альманах»,
 * а всё последующее — «изменён». Различить их можно только по состоянию
 * альманаха целиком: вызывающий говорит, что это **создание** (`created`),
 * а здесь проверяется, что содержимое действительно первое и автор —
 * организатор. Если первым добавил участник, «создан» не появляется:
 * сразу идёт «изменён».
 *
 * Вместе с сообщением ушли три механизма, которые существовали только
 * ради него: проверка «одно непрочитанное на человека на поход» (её
 * заменил уникальный индекс `(recipient_user_id, dedup_key)`),
 * `pg_advisory_xact_lock` по диалогу (у `upsertAlmanac` проверки перед
 * вставкой нет) и кадр `message` в поток переписки (сообщения нет).
 *
 * Автору правки карточка не заводится (он и так знает), отказникам
 * (`declined`) — тоже: они уже не в походе.
 */
export async function notifyAlmanacUpdated(
  dataSource: DataSource,
  notifications: NotificationsService,
  trip: Trip,
  authorId: string,
  options: { created?: boolean } = {},
): Promise<void> {
  const manager = dataSource.manager;

  /**
   * Получатели — активный состав (§4.1): `going`, `maybe`, `helping`,
   * без автора правки и людей без аккаунта. До 26.11.2026 здесь брали
   * всех, кроме `declined`, — приглашённый и виртуальный получали
   * карточку, хотя первый ещё не участник, а второй не может войти.
   */
  const candidates = await notifications.tripAudience(
    manager,
    String(trip.id),
    { actorUserId: authorId },
  );

  if (candidates.length === 0) return;

  const created =
    options.created === true &&
    String(trip.organizerUserId) === String(authorId) &&
    (await almanacContentCount(manager, String(trip.id))) === 1;

  const recipients = created
    ? await notifications.upsertAlmanacCreated(manager, {
        tripId: String(trip.id),
        recipientIds: candidates,
      })
    : await notifications.upsertAlmanac(manager, {
        tripId: String(trip.id),
        authorUserId: authorId,
        recipientIds: candidates,
      });

  /**
   * Сигнал «перечитай уведомления» — после записи, а не из транзакции.
   *
   * Шлём по фактическим получателям: при `almanac_changed` часть состава
   * пропускается, если у неё ещё висит активное «создан альманах».
   */
  if (recipients.length > 0) notifications.emitChanged(recipients);
}

/**
 * Сколько содержимого уже лежит в альманахе похода.
 *
 * Считаются обе половины: помеченные дневниковые записи и воспоминания.
 * Вызывается **после** вставки, поэтому «1» и значит «это содержимое
 * первое». Удалённая дневниковая строка не в счёт — она не показывается
 * в альманахе (`deleted_at IS NULL`).
 */
async function almanacContentCount(
  manager: EntityManager,
  tripId: string,
): Promise<number> {
  const rows = (await manager.query(
    `SELECT (
       (SELECT count(*) FROM "trip_almanac_entries" WHERE "trip_id" = $1) +
       (SELECT count(*) FROM "trip_diary_entries"
         WHERE "trip_id" = $1 AND "shared_with_trip" AND "deleted_at" IS NULL)
     )::int AS "count"`,
    [tripId],
  )) as Array<{ count: number }>;

  return Number(rows[0]?.count ?? 0);
}
