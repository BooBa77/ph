import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';

import {
  MessageActionDto,
  PendingActionsDto,
  type ActionAnswer,
} from './dto/message-action.dto';
import { Message } from './entities/message.entity';
import { MessageAction } from './entities/message-action.entity';
import { TripCompensation } from './entities/trip-compensation.entity';
import { ConversationEventsService } from './conversation-events.service';
import { TripEventsService } from './trip-events.service';

/**
 * Действия в сообщениях: «Да» / «Нет» и «посмотри ещё раз».
 *
 * Правила переходов живут здесь, а не в шаблоне, потому что кнопка —
 * это подсказка, а не запрет: запрос можно послать руками.
 *
 * | Было | Нажал кто | Стало |
 * |---|---|---|
 * | `pending` | адресат «Да» | `confirmed` |
 * | `pending` | адресат «Нет» | `disputed` |
 * | `disputed` | адресат «Да» | `confirmed` (передумал) |
 * | `disputed` | отправитель «посмотри ещё раз» | `pending` |
 * | `disputed` | отправитель «мой косяк» | **удаление** |
 *
 * Из `confirmed` выходов нет: подтверждение окончательное, повторное
 * нажатие ничего не меняет (идемпотентность вместо 409 — человек мог
 * просто дважды ткнуть).
 *
 * **Отмена — это удаление.** Строка в чате исчезает, личные сообщения
 * удаляются вместе с действием. Нет записи — нечего подтверждать, и
 * получатель не сможет позже нажать «Да» на отменённом переводе.
 */
@Injectable()
export class MessageActionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: TripEventsService,
    private readonly conversations: ConversationEventsService,
  ) {}

  /**
   * Ответ адресата: «получено» или «не получено».
   *
   * `body` — необязательное сообщение отправителю (24.11.2026). Заказчик:
   * у уведомления о переводе есть поле «сообщение отправителю», и текст
   * уходит обычным сообщением в тот же личный диалог. Отправляем и при
   * «не получено»: причина для отправителя нужна не меньше, чем благодарность.
   */
  async respond(
    userId: string,
    actionId: number,
    result: ActionAnswer,
    body?: string,
  ): Promise<MessageActionDto> {
    let confirmedTripId: string | null = null;
    const sentTo: Array<{ conversationId: string; senderId: string }> = [];

    const dto = await this.dataSource.transaction(async (manager) => {
      // `FOR UPDATE`: два устройства могут нажать «Да» одновременно,
      // и без блокировки оба прочитали бы `pending`.
      const action = await this.lockAction(manager, actionId);
      const senderId = await this.senderOf(manager, action.id);

      if (action.targetUserId !== userId) {
        throw new ForbiddenException('Ответить на действие может только адресат');
      }

      // Подтверждение окончательно: второго перевода быть не может.
      if (action.state === 'confirmed') {
        return MessageActionDto.from(action, userId, senderId);
      }

      if (action.state === 'disputed' && result === 'disputed') {
        // Уже сказал «не получено» — повторный клик ничего не меняет.
        return MessageActionDto.from(action, userId, senderId);
      }

      action.state = result;
      action.respondedAt = new Date();
      await manager.save(action);

      /**
       * Деньги двигает ответ в сообщении (20.11.2026).
       *
       * Компенсация живёт строкой `trip_compensations`, а уведомление —
       * личным сообщением. Поэтому «Да» закрывает связанный перевод по
       * `payload.compensationId` (миграции нет: связь лежит в jsonb).
       * «Нет» ничего не двигает: строка остаётся ожидающей, а автосогласие
       * через 72 часа по ней отменяется — человек сказал, что деньги не дошли.
       */
      if (action.kind === 'money_received' && action.state === 'confirmed') {
        confirmedTripId = await this.confirmLinkedCompensation(manager, action);
      }

      /**
       * Сообщение отправителю — только если оно есть.
       *
       * Пустую строку не пишем: пробельное сообщение в ленте выглядит как
       * сбой вёрстки (то же правило, что у `POST /messages`).
       */
      const text = body?.trim() ?? '';
      if (text.length > 0 && senderId !== null) {
        const source = await manager.findOne(Message, {
          where: { actionId: action.id, senderId },
          order: { id: 'ASC' },
        });

        if (source !== null) {
          await manager.insert(Message, {
            conversationId: source.conversationId,
            senderId: userId,
            body: text,
          });
          sentTo.push({ conversationId: String(source.conversationId), senderId });
        }
      }

      return MessageActionDto.from(action, userId, senderId);
    });

    if (confirmedTripId !== null) {
      this.events.emitFinance(confirmedTripId, userId);
    }

    // Та же схема, что у `ConversationsService.sendMessage`: кадр после
    // коммита, иначе открытый диалог отправителя ждал бы опроса.
    for (const item of sentTo) {
      this.conversations.emitMessage(
        [item.senderId, userId],
        item.conversationId,
        userId,
      );
    }

    return dto;
  }

  /**
   * Отправитель просит посмотреть ещё раз.
   *
   * Действие возвращается в `pending`, и в личный диалог уходит **копия
   * сообщения** с тем же действием: получатель должен увидеть новый вопрос,
   * а не искать старое. Копия делается только если личное сообщение
   * действительно было — иначе копировать нечего (действие стояло только
   * в чате похода).
   */
  async recheck(userId: string, actionId: number): Promise<MessageActionDto> {
    return this.dataSource.transaction(async (manager) => {
      const action = await this.lockAction(manager, actionId);
      const senderId = await this.senderOf(manager, action.id);

      if (senderId !== userId) {
        throw new ForbiddenException('Переспросить может только отправитель');
      }
      if (action.state !== 'disputed') {
        throw new ConflictException(
          'Переспросить можно, только когда получатель сказал «не получено»',
        );
      }

      action.state = 'pending';
      action.respondedAt = null;
      await manager.save(action);

      const direct = await manager.findOne(Message, {
        where: { actionId: action.id, senderId: userId },
        order: { id: 'DESC' },
      });

      if (direct) {
        await manager.insert(Message, {
          conversationId: direct.conversationId,
          senderId: userId,
          body: direct.body,
          actionId: action.id,
        });
      }

      return MessageActionDto.from(action, userId, senderId);
    });
  }

  /**
   * «Мой косяк, отменяем» — удаление.
   *
   * Сообщения удаляются до действия: у ссылки `ON DELETE SET NULL`, и если
   * удалить действие первым, сообщения останутся висеть с пустой ссылкой —
   * текст «перевёл 1000 ₽» без возможности что-то с ним сделать.
   */
  async cancel(userId: string, actionId: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const action = await this.lockAction(manager, actionId);
      const senderId = await this.senderOf(manager, action.id);

      if (senderId !== userId) {
        throw new ForbiddenException('Отменить перевод может только отправитель');
      }
      if (action.state === 'confirmed') {
        throw new ConflictException(
          'Подтверждённый перевод не отменяется: деньги уже считаются полученными',
        );
      }

      await manager.delete(Message, { actionId: action.id });
      await manager.delete(MessageAction, { id: action.id });
    });
  }

  /**
   * Нерешённые действия — для конвертика в шапке.
   *
   * Два списка: «ждут моего ответа» и «я отправил, а получатель говорит,
   * что не дошло». В одной куче человеку пришлось бы соображать, кто он
   * в каждой строке.
   */
  async pending(userId: string): Promise<PendingActionsDto> {
    const toAnswer = await this.dataSource.manager.find(MessageAction, {
      // Только переводы: `payment_request` — уведомление с кнопкой «Перейти»,
      // отвечать на него нечем, и в списке нерешённых ему не место (24.11.2026).
      where: {
        kind: 'money_received',
        targetUserId: userId,
        state: In(['pending', 'disputed']),
      },
      order: { createdAt: 'DESC' },
      take: 50,
    });

    /**
     * «Я отправил, а получатель говорит, что не дошло».
     *
     * Двумя шагами, а не join-ом в query builder: `innerJoin` по классу
     * сущности с явной таблицей внутри TypeORM падает на метаданных
     * (`databaseName` у несуществующего алиаса). Список id — десятки строк,
     * второй запрос дешевле разбирательства.
     */
    const mine = (await this.dataSource.manager.query(
      `SELECT DISTINCT action_id
         FROM messages
        WHERE sender_id = $1 AND action_id IS NOT NULL`,
      [userId],
    )) as Array<{ action_id: string }>;

    const disputedMine =
      mine.length === 0
        ? []
        : await this.dataSource.manager.find(MessageAction, {
            where: {
              id: In(mine.map((row) => row.action_id)),
              kind: 'money_received',
              state: 'disputed',
            },
            order: { createdAt: 'DESC' },
            take: 50,
          });

    const toAnswerDto: MessageActionDto[] = [];
    for (const action of toAnswer) {
      toAnswerDto.push(
        MessageActionDto.from(
          action,
          userId,
          await this.senderOf(this.dataSource.manager, action.id),
        ),
      );
    }

    return {
      toAnswer: toAnswerDto,
      toSettle: disputedMine.map((action) =>
        MessageActionDto.from(action, userId, userId),
      ),
    };
  }

  /**
   * Закрыть компенсацию, которой касается ответ (20.11.2026).
   *
   * Связь лежит в `payload.compensationId`: отдельная колонка потребовала бы
   * миграции, а видов действий со временем станет больше. `null` — действие
   * не про компенсацию или строка уже подтверждена (повторное «Да»).
   */
  private async confirmLinkedCompensation(
    manager: EntityManager,
    action: MessageAction,
  ): Promise<string | null> {
    const raw = (action.payload as { compensationId?: unknown } | null)
      ?.compensationId;
    if (raw === undefined || raw === null) return null;

    const compensation = await manager.findOne(TripCompensation, {
      where: { id: String(raw) },
      lock: { mode: 'pessimistic_write' },
    });

    if (!compensation || compensation.status !== 'pending') return null;

    compensation.status = 'confirmed';
    compensation.confirmedAt = new Date();
    await manager.save(compensation);

    return compensation.tripId;
  }

  /** Заблокировать действие на время перехода. */
  private async lockAction(
    manager: EntityManager,
    actionId: number,
  ): Promise<MessageAction> {
    const action = await manager.findOne(MessageAction, {
      where: { id: String(actionId) },
      lock: { mode: 'pessimistic_write' },
    });

    if (!action) {
      throw new NotFoundException('Действие не найдено');
    }

    return action;
  }

  /**
   * Кто отправитель действия.
   *
   * Отдельного поля «кто создал» у действия нет и не нужно: его создаёт
   * тот, от чьего имени висят сообщения. Системные сообщения (`sender_id
   * IS NULL`) не считаются — иначе автором оказался бы «никто».
   */
  private async senderOf(
    manager: EntityManager,
    actionId: string,
  ): Promise<string | null> {
    const message = await manager.findOne(Message, {
      where: { actionId },
      order: { id: 'ASC' },
    });

    return message?.senderId ?? null;
  }
}
