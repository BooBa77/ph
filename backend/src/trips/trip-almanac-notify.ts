import { DataSource, type EntityManager } from 'typeorm';

import { Conversation } from './entities/conversation.entity';
import { ConversationMember } from './entities/conversation-member.entity';
import { Message } from './entities/message.entity';
import { TripParticipant } from './entities/trip-participant.entity';
import type { Trip } from './entities/trip.entity';
import type { NotificationsService } from './notifications.service';
import { tripNameOf } from './trip-name';

/**
 * «Альманах похода обновлён» — личное сообщение участникам (22.11.2026).
 *
 * Заказчик: «При создании/редактировании записи в альманахе всем участникам
 * отправляется личное сообщение „Альманах похода {имя похода} обновлён
 * {ссылка}“, если у пользователя уже есть такое непрочитанное сообщение,
 * новых ему не шлём. Работа с личными сообщениями у нас впереди».
 *
 * Отсюда три правила, и все три — про шум:
 *
 * 1. **Автору — не отправляем.** Он и так знает, что написал.
 * 2. **Отказникам (`declined`) — не отправляем**: они уже не в походе.
 * 3. **Одно непрочитанное на человека на поход.** Если такое же сообщение
 *    лежит непрочитанным, новое не нужно: в списке диалогов оно всё равно
 *    одно, а счётчик станет врать. Проверка — по `last_read_at`, того же
 *    поля, что считает непрочитанное в `ConversationsService`.
 *
 * Сообщение пишет **сам автор правки**, а не системный отправитель: личный
 * диалог в проекте — это пара людей, и системные сообщения (`sender_id IS
 * NULL`) в непрочитанные не попадают вовсе (`ConversationsService`
 * их не считает). Иначе уведомление было бы невидимым.
 *
 * Ссылка — относительный адрес страницы похода: экран личных диалогов
 * ещё не сделан, и когда он появится, адрес надо будет сделать кликабельным
 * там, а не хранить абсолютный URL в базе (у dev и прода он разный).
 *
 * ## Почему 23.11.2026 приходило по три одинаковых (бэклог §53)
 *
 * Дедупликация в этом файле была, но с двумя дефектами — оба воспроизведены
 * на dev 24.11.2026 (`.tmp-verify/almanac-notify-probe.mjs` и
 * `.tmp-verify/almanac-notify-race.mjs`):
 *
 * 1. **Проверка смотрела только на сообщения того же автора.** В SQL было
 *    `m.sender_id = $автор`, а правило заказчика — «одно непрочитанное
 *    на человека на поход», без деления по авторам. Двое правят альманах
 *    по очереди, у читателя лежит непрочитанное от первого — второй пишет
 *    ещё одно: проверка его не увидела. Именно так и выглядели три строки
 *    в диалоге 23.11.2026: одна от Анны и две от Бориса. Теперь ищем
 *    непрочитанное с тем же текстом **от любого автора** (поход закодирован
 *    в тексте, поэтому отдельного поля не нужно), а адресат указан явно —
 *    `conversation_members.user_id = получатель`, как в счётчике.
 * 2. **Проверка и вставка были не атомарны.** Обе шли в транзакции, но под
 *    READ COMMITTED параллельный запрос не видит ещё не закоммиченную вставку
 *    соседа: 40 одновременных `PUT` оставили 8 уведомлений (замер 24.11.2026).
 *    Уникального индекса по тексту нет и заводить его нельзя: `messages.body`
 *    правится (автосогласие переписывает текст), а миграций в этом шаге нет.
 *    Поэтому перед проверкой берём **транзакционный advisory-lock по диалогу**
 *    (`pg_advisory_xact_lock`): он сериализует только уведомления одного
 *    диалога, снимается сам на COMMIT/ROLLBACK и не требует схемы.
 *
 * Порядок в транзакции поэтому такой: найти/открыть диалог → взять замок →
 * проверить непрочитанное → вставить. Замок берётся после `directConversation`
 * (ключ — id диалога) и отпускается вместе с транзакцией.
 *
 * ## Кадр в поток переписки (24.11.2026)
 *
 * Вставка идёт напрямую в `messages`, мимо `ConversationsService.sendMessage`,
 * поэтому кадр `message` в `GET /api/conversations/events` сам не уходил:
 * лента узнавала об уведомлении только перечитыванием по фокусу (до минуты),
 * и на устройстве это выглядело как «пришло, когда вернулся на вкладку».
 * Теперь каждая **реально вставленная** строка отдаётся наружу через
 * `onCreated`, а вызывающий сервис шлёт по ней событие.
 *
 * Три ограничения, которые отсюда следуют:
 *
 * 1. **Кадр — после COMMIT, а не из транзакции.** Подписчик по событию
 *    перечитывает строку диалога; если отправить кадр до коммита, запрос
 *    может не увидеть ещё не сохранённое сообщение и лента останется пустой.
 *    Поэтому вставки копятся в массиве, а `onCreated` зовётся после
 *    `dataSource.transaction`.
 * 2. **Только по вставленным.** Когда непрочитанное уже лежало, новой строки
 *    нет — событие не шлём: строка в ленте и так одна, а лишний кадр заставил
 *    бы клиента перечитать её впустую.
 * 3. **Оба человека диалога.** `participantIds` — автор и адресат: у автора
 *    может быть вторая вкладка, а «своё действие не перечитываем» клиент
 *    решает по `actorId` (тот же порядок, что у `ConversationsService`).
 */
export interface AlmanacNotification {
  /** Диалог, в который легло уведомление (id `bigint` строкой). */
  conversationId: string;
  /** Кому доступен диалог: автор правки и адресат. */
  participantIds: string[];
}

export type AlmanacNotifyListener = (notification: AlmanacNotification) => void;

export async function notifyAlmanacUpdated(
  dataSource: DataSource,
  notifications: NotificationsService,
  trip: Trip,
  authorId: string,
  onCreated?: AlmanacNotifyListener,
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
  const body = `Альманах похода «${tripName}» обновлён: /trips/${trip.id}?tab=guest`;

  const created: AlmanacNotification[] = [];

  await dataSource.transaction(async (transaction) => {
    for (const recipientId of recipients) {
      const conversation = await directConversation(transaction, authorId, recipientId);

      // Замок — до проверки: иначе параллельная правка проходит проверку
      // вместе с этой и обе вставляют уведомление.
      await lockConversation(transaction, conversation.id);

      if (await hasUnread(transaction, conversation.id, recipientId, body)) {
        continue;
      }

      await transaction.insert(Message, {
        conversationId: conversation.id,
        senderId: authorId,
        body,
      });

      created.push({
        conversationId: conversation.id,
        participantIds: [authorId, recipientId],
      });
    }

    /**
     * Карточка «Альманах» — каждому получателю (24.11.2026, §14).
     *
     * Не привязана к тому, легло ли новое сообщение: уведомление живёт
     * своей жизнью, а сообщение-история дедуплицируется отдельно. Ключ
     * `almanac:<поход>` — одна карточка на поход; новая редакция обновляет
     * её, «ОК» удаляет, следующая редакция создаёт заново.
     */
    await notifications.upsertAlmanac(transaction, {
      tripId: String(trip.id),
      tripName,
      recipientIds: recipients,
    });
  });

  // Кадры — только после COMMIT: подписчик перечитывает строку сразу
  // и должен увидеть уже сохранённое сообщение. Вставок не было — молчим.
  for (const notification of created) {
    onCreated?.(notification);
  }

  // Сигнал «перечитай уведомления» — тоже после COMMIT и тоже по факту:
  // карточка обновилась у всех получателей, даже если сообщение не вставилось.
  notifications.emitChanged(recipients);
}

/**
 * Личный диалог пары — найти или открыть.
 *
 * Повторяет `ConversationsService.openDirect` намеренно: здесь нужен
 * `EntityManager` транзакции уведомлений, а не отдельная транзакция сервиса.
 * Пара хранится отсортированной (`direct_a < direct_b`), поэтому диалог
 * находится в любую сторону.
 */
async function directConversation(
  manager: EntityManager,
  authorId: string,
  recipientId: string,
): Promise<Conversation> {
  const [a, b] = [authorId, recipientId].sort();

  const existing = await manager.findOne(Conversation, {
    where: { kind: 'direct', directA: a, directB: b },
  });

  if (existing) {
    // Диалог мог быть создан раньше без строк состава — чиним, как
    // в `openDirect`: доступ к личному диалогу — это и есть состав.
    for (const memberId of [a, b]) {
      await manager
        .createQueryBuilder()
        .insert()
        .into(ConversationMember)
        .values({ conversationId: existing.id, userId: memberId })
        .orIgnore()
        .execute();
    }

    return existing;
  }

  const conversation = await manager.save(
    manager.create(Conversation, { kind: 'direct', directA: a, directB: b }),
  );

  await manager.insert(ConversationMember, [
    { conversationId: conversation.id, userId: a },
    { conversationId: conversation.id, userId: b },
  ]);

  return conversation;
}

/**
 * Транзакционный замок уведомлений одного диалога.
 *
 * `pg_advisory_xact_lock` живёт до конца транзакции: второй запрос с тем же
 * ключом ждёт COMMIT первого, а не спит в коде. Ключ — текст с id диалога,
 * чтобы один и тот же приём нельзя было спутать с другими замками приложения;
 * `hashtextextended` сводит его к bigint.
 */
async function lockConversation(
  manager: EntityManager,
  conversationId: string,
): Promise<void> {
  await manager.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
    [`almanac-notify:${conversationId}`],
  );
}

/**
 * Лежит ли у получателя непрочитанное уведомление ровно с таким текстом.
 *
 * - **Без фильтра по отправителю:** правило — одно непрочитанное на человека
 *   на поход. Текст содержит имя похода и ссылку, поэтому «то же сообщение»
 *   и «тот же поход» — одно и то же.
 * - **Адресат указан явно** (`conversation_members.user_id = $2`), как
 *   в `ConversationsService.countUnread`: проверка и счётчик считают
 *   по одному правилу.
 * - `last_read_at IS NULL` — диалог ещё не открывали, значит всё в нём
 *   непрочитано. Свои сообщения не считаются.
 */
async function hasUnread(
  manager: EntityManager,
  conversationId: string,
  recipientId: string,
  body: string,
): Promise<boolean> {
  const rows = await manager.query(
    `SELECT 1
       FROM messages m
       JOIN conversation_members cm
         ON cm.conversation_id = m.conversation_id
        AND cm.user_id = $2
      WHERE m.conversation_id = $1
        AND m.sender_id IS NOT NULL
        AND m.sender_id <> $2
        AND m.body = $3
        AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)
      LIMIT 1`,
    [conversationId, recipientId, body],
  );

  return (rows as unknown[]).length > 0;
}
