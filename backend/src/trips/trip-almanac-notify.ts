import { DataSource } from 'typeorm';

import { TripParticipant } from './entities/trip-participant.entity';
import type { Trip } from './entities/trip.entity';
import type { NotificationsService } from './notifications.service';
import { tripNameOf } from './trip-name';

/**
 * «Альманах похода обновлён» — карточка уведомления участникам (22.11.2026;
 * без личного сообщения — 24.11.2026).
 *
 * Заказчик: «При создании/редактировании записи в альманахе всем участникам
 * отправляется уведомление „Альманах похода {имя похода} обновлён“, если
 * у пользователя уже есть такое непрочитанное, новых ему не шлём».
 *
 * **Что изменилось 24.11.2026.** Уведомление переехало из личных диалогов
 * в таблицу `notifications` (§14 `topics/messages.md`), панель больше
 * не читает диалоги, поэтому двойная запись выключена: это место больше
 * **не пишет `messages`**. Старые строки «Альманах похода … обновлён»
 * остаются историей диалога — их не удаляют.
 *
 * Вместе с сообщением ушли и три механизма, которые существовали только
 * ради него:
 *
 * 1. **Проверка «одно непрочитанное на человека на поход».** Её заменил
 *    уникальный индекс `(recipient_user_id, dedup_key)` и
 *    `ON CONFLICT DO UPDATE`: ключ `almanac:<поход>` — ровно одна карточка
 *    на поход, сколько бы раз альманах ни правили.
 * 2. **`pg_advisory_xact_lock` по диалогу.** Он сериализовал «прочитай и
 *    вставь»; у `upsertAlmanac` проверки перед вставкой нет, поэтому и
 *    замка не нужно.
 * 3. **Кадр `message` в поток переписки.** Сообщения нет — нет и кадра.
 *    О том, что карточка изменилась, подписчиков уведомляет
 *    `notifications.emitChanged` в конце этой функции.
 *
 * Автору правки карточка не заводится (он и так знает), отказникам
 * (`declined`) — тоже: они уже не в походе.
 */
export async function notifyAlmanacUpdated(
  dataSource: DataSource,
  notifications: NotificationsService,
  trip: Trip,
  authorId: string,
): Promise<void> {
  const manager = dataSource.manager;

  const participants = await manager.find(TripParticipant, {
    where: { tripId: trip.id },
  });

  const recipients = participants
    .filter((person) => person.userId !== authorId && person.status !== 'declined')
    .map((person) => person.userId);

  if (recipients.length === 0) return;

  const tripName = await tripNameOf(manager, trip);

  await notifications.upsertAlmanac(manager, {
    tripId: String(trip.id),
    tripName,
    recipientIds: recipients,
  });

  /**
   * Сигнал «перечитай уведомления» — после записи, а не из транзакции.
   *
   * Шлём всегда, а не только при создании: `upsertAlmanac` обновляет
   * существующую карточку, и её текст (новое имя похода, время редакции)
   * мог измениться. Клиент перечитывает ответ целиком, лишний кадр ему
   * ничего не стоит.
   */
  notifications.emitChanged(recipients);
}
