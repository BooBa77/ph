import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In, Not, QueryFailedError } from 'typeorm';

import {
  CompensationOptionDto,
  CompensationSenderDto,
  DepositParticipantDto,
  DepositRecipientDto,
  DepositSenderDto,
  FinanceFamilyDto,
  FinanceMemberDto,
  MyDepositDto,
  MyFinanceDto,
  SaveTripExpenseDto,
  SyncTripExpensesDto,
  TripCompensationDto,
  TripDepartureDto,
  TripDepositDto,
  TripDepositForfeitDto,
  TripDepositReturnDto,
  TripExpenseDto,
  TripExpenseSyncResultDto,
  TripFinanceDto,
  TripFinanceNotifyDto,
  TripFinanceSyncDto,
} from './dto/trip-finance.dto';
import { Conversation } from './entities/conversation.entity';
import { ConversationMember } from './entities/conversation-member.entity';
import { Message } from './entities/message.entity';
import { MessageAction } from './entities/message-action.entity';
import { TripCompensation } from './entities/trip-compensation.entity';
import { TripDepositAdjustment } from './entities/trip-deposit-adjustment.entity';
import { TripDepositForfeit } from './entities/trip-deposit-forfeit.entity';
import { TripExpense } from './entities/trip-expense.entity';
import { TripExpenseShare } from './entities/trip-expense-share.entity';
import { TripParticipant } from './entities/trip-participant.entity';
import { TripParticipantRole } from './entities/trip-participant-role.entity';
import { Trip } from './entities/trip.entity';
import { Role } from './entities/role.entity';
import { COORGANIZER_ROLE_CODE } from './trip-tabs';
import {
  type DepositDecision,
  type DepositStatus,
} from './trip.types';
import {
  balancesFromEntities,
  compensationOptions,
  depositCoverage,
  familyBalance,
  familyCredit,
  familyDebt,
  joinNames,
  remainingFromEntities,
  splitAmount,
  splitDepositExcess,
  type BalanceAdjustment,
  type DepositCoverage,
  type ShareAmount,
} from './finance';
import { TripEventsService } from './trip-events.service';
import { ConversationEventsService } from './conversation-events.service';
import { TripsService } from './trips.service';
import { UsersService } from '../users/users.service';

/** Сегодняшняя дата строкой `ГГГГ-ММ-ДД` (сервер живёт в UTC). */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Срок автосогласия компенсации (20.11.2026; для всех получателей — 24.11.2026).
 *
 * Заказчик: «три дня без ответа считаются согласием» — деньги в кругу
 * друзей, а не в банке, и висящий перевод не должен держать расчёт
 * месяцами. С 24.11.2026 срок один для всех: сценарий «Борис ушёл в другой
 * поход, был оффлайн и не подтвердил перевод — транзакция завершается
 * успешно» ничем не отличается от молчания идущего. Срок живёт в одном
 * месте: он же двигает `confirmed_at`.
 */
const AUTO_CONFIRM_MS = 72 * 60 * 60 * 1000;

/** Имя похода для текста уведомления: анонс, иначе номер. */
function tripNameOf(trip: Trip): string {
  const announcement = trip.announcement?.trim();

  return announcement || `поход #${trip.id}`;
}

/**
 * Текст уведомления о переводе получателю (24.11.2026).
 *
 * Заказчик задал формулировку дословно: «Алиса перевела тебе 1000 руб
 * за поход Витязь». Род глагола берётся у отправителя: «перевела» и
 * «перевёл» — разные слова, а не одна строка на всех.
 */
function moneyMessageText(
  amountRub: number,
  tripName: string,
  senderName: string,
  senderGender: string | null | undefined,
): string {
  const verb = senderGender === 'f' ? 'перевела' : 'перевёл';

  return `${senderName} ${verb} тебе ${amountRub} ₽ за поход «${tripName}».`;
}

/**
 * Дописанное к уведомлению, когда срок ожидания истёк (24.11.2026).
 *
 * Заказчик: «Так как время ожидания подтверждения вышло, перевод засчитан
 * как успешный. Если поступления тебе не было, свяжись с отправителем за
 * рамками ph». Фраза заменяет прежнее уведомление целиком — кнопок
 * подтверждения к этому моменту уже нет.
 */
const MONEY_SETTLED_TAIL =
  ' Так как время ожидания подтверждения вышло, перевод засчитан как успешный. ' +
  'Если поступления тебе не было, свяжись с отправителем за рамками ph.';

/**
 * Уникальный индекс `UQ_trip_expenses_client` сработал на вставке.
 *
 * Значит тот же чек уже создало параллельное устройство или повторный
 * запрос, ответ которого не дошёл. Код 23505 — единственный признак,
 * который даёт Postgres через TypeORM.
 */
function isClientDuplicate(problem: unknown): boolean {
  if (!(problem instanceof QueryFailedError)) return false;

  const driverError = (problem as QueryFailedError & {
    driverError?: { code?: string };
  }).driverError;

  return driverError?.code === '23505';
}

/**
 * «Бухгалтерия» похода — деньги, балансы и компенсации (11.11.2026).
 *
 * Заказчик: «таблица движения денег… всем видны все записи, чтобы была
 * понятна арифметика; строки с расходами редактируются авторами;
 * итоговый баланс пользователя; кнопки „Добавить расход“ и „Компенсация“».
 *
 * **Видят все участники, кроме отказавшихся.** Вкладка открыта составу
 * как чаты подготовки; править деньги может только идущий (`going`):
 * приглашённый ещё не тратил, а организатор «не иду» деньги не делит.
 * Отказ от похода финансовую историю не стирает — доли остаются в базе,
 * и баланс не сходится в ноль у тех, кто дошёл.
 *
 * **Правила прав** (проверены e2e):
 * - расход добавляет любой идущий, правит и удаляет — **только автор**;
 * - компенсацию создаёт должник за себя, подтверждает **только получатель**,
 *   отменяет ожидающую — только отправитель;
 * - подтверждённая компенсация не правится и не удаляется.
 *
 * **Все изменения возвращают вкладку целиком**, а не одну строку: баланс
 * и подсказки считаются из всех записей, поэтому «вернуть строку» с
 * фронта значило бы оставить его считать арифметику второй раз и
 * разойтись с сервером. После каждой операции уходит SSE-сигнал.
 */
@Injectable()
export class TripFinanceService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly trips: TripsService,
    private readonly events: TripEventsService,
    private readonly conversations: ConversationEventsService,
    private readonly users: UsersService,
  ) {}

  /** Вся вкладка: расходы, компенсации, балансы и мои подсказки. */
  async getView(userId: string, tripId: number): Promise<TripFinanceDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, String(trip.id), userId);

    // «Автосогласие через 72 часа» (20.11.2026) закрывается при чтении
    // вкладки, а не кроном: отдельного планировщика в проекте нет, а баланс
    // обязан сойтись в тот момент, когда его смотрят. Повторный вызов ничего
    // не меняет — строки уже `confirmed`.
    const settled = await this.settleExpiredCompensations(manager, trip);
    const view = await this.buildView(manager, trip, userId);

    if (settled) this.events.emitFinance(String(tripId), userId);

    return view;
  }

  /**
   * Право открыть SSE-поток вкладки: тот же состав, что видит финансы.
   *
   * Публичный метод, потому что проверка нужна контроллеру потока —
   * до того, как уйдут заголовки `text/event-stream`.
   */
  async assertCanWatch(userId: string, tripId: number): Promise<void> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, String(trip.id), userId);
  }

  /** Добавить расход. Автор записи = плательщик. */
  async createExpense(
    userId: string,
    tripId: number,
    dto: SaveTripExpenseDto,
  ): Promise<TripFinanceDto> {
    const view = await this.dataSource.transaction(async (manager) => {
      const trip = await this.trips.getVisibleTrip(userId, tripId);
      await this.assertGoing(manager, String(trip.id), userId);

      await this.insertExpense(manager, trip, userId, dto);

      return this.buildView(manager, trip, userId);
    });

    this.events.emitFinance(String(tripId), userId);
    return view;
  }

  /**
   * Принять пачку офлайн-чеков (19.11.2026).
   *
   * Заказчик: «создание расходных чеков должно быть доступно оффлайн
   * (за наличку)». Чек рождается на телефоне, лежит в очереди устройства
   * и уезжает сюда, когда появится связь ([lifecycle.md](../../docs/ph/lifecycle.md) §3).
   *
   * **Почему пачка, а не по одному.** Очередь — одна точка отправки: три
   * чека за день пути должны уехать одним запросом, а не тремя. Ответ —
   * вкладка целиком, как у остальных денежных действий, чтобы экран сразу
   * показал настоящие доли и балансы.
   *
   * **Почему не «всё или ничего».** Права проверяются один раз до пачки:
   * если человек больше не идёт, весь запрос получает 403 и очередь
   * остаётся на устройстве. Но отдельный чек мог быть заведён на человека,
   * который уже вышел, — такой отклоняется с объяснением, а остальные
   * принимаются. Иначе одна плохая запись держала бы очередь вечно.
   *
   * **Идемпотентность.** Ключ — `clientId` с устройства; чек с уже
   * существующим ключом считается принятым и второй раз не создаётся.
   * Повтор после обрыва на середине ответа безопасен, в том числе когда
   * два устройства отправили одну и ту же очередь: гонку ловит уникальный
   * индекс `UQ_trip_expenses_client` (код 23505 = «уже создан»).
   */
  async syncExpenses(
    userId: string,
    tripId: number,
    dto: SyncTripExpensesDto,
  ): Promise<TripFinanceSyncDto> {
    // Права — до пачки: без этого «не иду» тонуло бы в отказах по каждому
    // чеку, а очередь на устройстве не поняла бы, что виновата не запись.
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertGoing(this.dataSource.manager, String(trip.id), userId);

    // Обязательность ключа проверяем здесь, а не декоратором: `@IsOptional`
    // у поля в родительском DTO гасит любой `@IsDefined` в наследнике.
    // Без ключа повторную отправку не отличить от нового чека.
    if (dto.entries.some((entry) => !entry.clientId)) {
      throw new BadRequestException(
        'У чека из очереди должен быть ключ с устройства',
      );
    }

    const results: TripExpenseSyncResultDto[] = [];
    let created = false;

    for (const entry of dto.entries) {
      try {
        const inserted = await this.dataSource.transaction(async (manager) =>
          this.insertExpense(manager, trip, userId, entry),
        );
        created = created || inserted;
        results.push({ clientId: entry.clientId, status: 'accepted' });
      } catch (problem) {
        if (isClientDuplicate(problem)) {
          // Параллельная отправка того же чека уже создала строку.
          results.push({ clientId: entry.clientId, status: 'accepted' });
          continue;
        }

        if (
          problem instanceof ForbiddenException ||
          problem instanceof BadRequestException ||
          problem instanceof ConflictException
        ) {
          results.push({
            clientId: entry.clientId,
            status: 'rejected',
            message: problem.message,
          });
          continue;
        }

        throw problem;
      }
    }

    const view = await this.buildView(
      this.dataSource.manager,
      trip,
      userId,
    );

    // Сигнал — один на пачку: другие вкладки перечитают вкладку целиком.
    if (created) this.events.emitFinance(String(tripId), userId);

    return { ...view, results };
  }

  /** Поправить расход. Только автор — «строки с расходами правят авторы». */
  async updateExpense(
    userId: string,
    tripId: number,
    expenseId: number,
    dto: SaveTripExpenseDto,
  ): Promise<TripFinanceDto> {
    const view = await this.dataSource.transaction(async (manager) => {
      const trip = await this.trips.getVisibleTrip(userId, tripId);
      await this.assertGoing(manager, String(trip.id), userId);

      // Завершённый поход: новые чеки можно, прежние — нельзя (20.11.2026).
      this.assertExpenseEditable(trip);

      const expense = await manager.findOne(TripExpense, {
        where: { id: String(expenseId), tripId: String(trip.id) },
      });
      if (!expense) throw new NotFoundException('Расход не найден');
      if (!(await this.canManageExpense(manager, expense, userId))) {
        throw new ForbiddenException('Править расход может только автор');
      }

      // Плательщика можно сменить: чек, записанный на себя, нередко
      // оказывается тратой человека без аккаунта, которого я веду.
      if (dto.payerUserId !== undefined && dto.payerUserId !== expense.authorUserId) {
        await this.assertCanActFor(
          manager,
          String(trip.id),
          userId,
          dto.payerUserId,
        );
        expense.authorUserId = dto.payerUserId;
      }

      const participants = await this.goingParticipants(manager, String(trip.id));
      const shares = this.sharesFor(dto, participants);

      expense.amountRub = dto.amountRub;
      expense.description = this.descriptionFor(dto);
      expense.split = dto.split;
      // Дату не передали — оставляем прежнюю, а не «сегодня».
      if (dto.spentAt !== undefined) expense.spentAt = dto.spentAt;
      await manager.save(expense);

      // Доли пересобираются целиком: частичная правка суммы оставила бы
      // строки от прежнего деления, и сумма долей перестала бы сходиться.
      await manager.delete(TripExpenseShare, { expenseId: expense.id });
      await this.saveShares(manager, expense.id, shares);

      return this.buildView(manager, trip, userId);
    });

    this.events.emitFinance(String(tripId), userId);
    return view;
  }

  /** Удалить расход. Только автор; доли уходят каскадом. */
  async deleteExpense(
    userId: string,
    tripId: number,
    expenseId: number,
  ): Promise<TripFinanceDto> {
    const view = await this.dataSource.transaction(async (manager) => {
      const trip = await this.trips.getVisibleTrip(userId, tripId);
      await this.assertGoing(manager, String(trip.id), userId);

      // Удаление тоже закрыто: «прежние чеки не правятся и не удаляются».
      this.assertExpenseEditable(trip);

      const expense = await manager.findOne(TripExpense, {
        where: { id: String(expenseId), tripId: String(trip.id) },
      });
      if (!expense) throw new NotFoundException('Расход не найден');
      if (!(await this.canManageExpense(manager, expense, userId))) {
        throw new ForbiddenException('Удалить расход может только автор');
      }

      await manager.delete(TripExpense, { id: expense.id });

      return this.buildView(manager, trip, userId);
    });

    this.events.emitFinance(String(tripId), userId);
    return view;
  }

  /**
   * Создать ожидающую компенсацию: «я перевёл тебе столько».
   *
   * **Платит семья, и касса у неё общая (12.11.2026).** Заказчик:
   * «сумма к компенсации рассчитывается от семьи… проще — папа платит
   * за всех», а потом уточнил, что это общая касса: «компенсация семье
   * любому её члену, и „платит семья“ при компенсации другим участникам».
   * Поэтому `toUserId` — любой человек семьи получателя, а сумма проверяется
   * против **чистого остатка** всей своей семьи и всей семьи получателя.
   *
   * **Одно действие — один перевод.** Сумма считается по кассе семьи,
   * поэтому раскладывать её по личным долгам не нужно: получателю
   * подтверждать одну строку, а не три. Личные остатки — то, что видно
   * на экране (13.11.2026); касса семьи живёт только в этом расчёте.
   *
   * Отправитель строки — тот, кто нажал «Я перевёл» (в том числе человек
   * без аккаунта, за которого действует ведущий): семья платит как один
   * кошелёк, и отменить перевод сможет любой её участник.
   *
   * Должник — только своя семья: перевести за постороннего нельзя.
   * Своей семье не переводят — внутри семьи деньги не двигаются.
   */
  async createCompensation(
    userId: string,
    tripId: number,
    toUserId: string,
    amountRub: number,
    fromUserId?: string,
  ): Promise<TripFinanceDto> {
    // Отправитель известен до транзакции: его имя и род нужны тексту
    // уведомления, а `users.findById` ходит своим менеджером.
    const senderId = fromUserId ?? userId;
    const sender = await this.users.findById(senderId);

    const view = await this.dataSource.transaction(async (manager) => {
      const trip = await this.trips.getVisibleTrip(userId, tripId);
      await this.assertGoing(manager, String(trip.id), userId);

      // «Папа платит за всех» и «я веду Дядю Витю»: отправителем может быть
      // человек без аккаунта, но действует всегда вошедший участник.
      await this.assertCanActFor(manager, String(trip.id), userId, senderId);

      if (toUserId === senderId) {
        throw new BadRequestException('Перевести компенсацию самому себе нельзя');
      }

      const participants = await this.goingParticipants(manager, String(trip.id));

      // Получателем может быть и ушедший (20.11.2026): «компенсировать
      // можно любому, включая declined». Он потерял доступ к вкладке, но
      // долг группы перед ним никуда не делся, и закрыть его — обязанность
      // тех, кто остался. Приглашённому не переводят: он ещё не решил.
      const recipient = await manager.findOne(TripParticipant, {
        where: { tripId: String(trip.id), userId: toUserId },
        relations: { user: true },
      });
      if (!recipient || recipient.status === 'invited') {
        throw new BadRequestException('Получатель не участвует в этом походе');
      }
      const recipientDeclined = recipient.status === 'declined';

      const { expenses, compensations } = await this.loadMoney(
        manager,
        String(trip.id),
      );
      const memberIds = participants.map((item) => item.userId);
      const remaining = remainingFromEntities(
        expenses,
        compensations,
        memberIds,
      );
      const families = await this.goingFamilies(manager, participants);

      const myFamily = families.find((group) => group.includes(senderId)) ?? [
        senderId,
      ];
      // Ушедший платит сам за себя: его семья, если кто-то из родных идёт,
      // считает свою кассу отдельно, а долг перед ушедшим — личный.
      const targetFamily = recipientDeclined
        ? [toUserId]
        : (families.find((group) => group.includes(toUserId)) ?? [toUserId]);

      if (targetFamily.includes(senderId)) {
        throw new BadRequestException('Своей семье переводить не нужно');
      }

      const debt = familyDebt(remaining, myFamily);
      if (debt <= 0) {
        throw new BadRequestException(
          senderId === userId
            ? 'Тебе не нужно ничего компенсировать'
            : 'Этому человеку нечего компенсировать',
        );
      }

      const credit = familyCredit(remaining, targetFamily);
      if (credit <= 0) {
        throw new BadRequestException(
          targetFamily.length > 1
            ? 'Этой семье ты ничего не должен'
            : 'Этому человеку ты ничего не должен',
        );
      }

      const limit = Math.min(debt, credit);
      if (amountRub > limit) {
        throw new BadRequestException(
          `Больше остатка: можно перевести ${limit} ₽`,
        );
      }

      const compensation = await manager.save(
        manager.create(TripCompensation, {
          tripId: String(trip.id),
          fromUserId: senderId,
          // Получатель — любой человек семьи: касса у неё одна, а строка
          // хранит, кому именно перевели (и кто сможет подтвердить —
          // подтвердить может любой родной, см. `buildView`).
          toUserId,
          amountRub,
          kind: 'compensation',
          status: 'pending',
          confirmedAt: null,
        }),
      );

      // Уведомление получателю — всегда, а не только ушедшему (24.11.2026).
      //
      // Заказчик: «Алиса отправляет сообщение о переводе Борису… Борису
      // приходит уведомление „Алиса перевела тебе 1000 руб за поход
      // Витязь“, есть кнопка „Подтвердить“ и поле ввода „сообщение
      // отправителю“». Вкладка «Бухгалтерия» остаётся вторым путём: ответ
      // в уведомлении закрывает ту же строку компенсации.
      //
      // Дед-лайн (72 часа) с этого шага действует для всех, а не только для
      // `declined`: `settleExpiredCompensations` больше не смотрит на статус.
      await this.postCompensationMessage(
        manager,
        trip,
        senderId,
        compensation,
        sender?.displayName ?? '',
        sender?.gender,
      );

      return this.buildView(manager, trip, userId);
    });

    this.events.emitFinance(String(tripId), userId);
    return view;
  }

  /**
   * «Получено» — подтверждает только получатель.
   *
   * Повторное нажатие не ошибка: человек мог дважды ткнуть, а состояние
   * уже подтверждено. Деньги двигает только этот переход.
   */
  async confirmCompensation(
    userId: string,
    tripId: number,
    compensationId: number,
  ): Promise<TripFinanceDto> {
    const view = await this.dataSource.transaction(async (manager) => {
      const trip = await this.trips.getVisibleTrip(userId, tripId);

      // `FOR UPDATE`: два устройства могут подтвердить одновременно,
      // и без блокировки оба записали бы одно и то же время.
      const compensation = await manager.findOne(TripCompensation, {
        where: { id: String(compensationId), tripId: String(trip.id) },
        lock: { mode: 'pessimistic_write' },
      });
      if (!compensation) throw new NotFoundException('Компенсация не найдена');

      // Обычную компенсацию подтверждает идущий. Залог — не компенсация:
      // организатор может быть «не иду», но деньги залога всё равно
      // принимает он. Поэтому для `deposit` проверка «идёт» снята,
      // а право остаётся у получателя (или его семьи / ведущего).
      if (compensation.kind !== 'deposit') {
        await this.assertGoing(manager, String(trip.id), userId);
      }

      if (
        compensation.toUserId !== userId &&
        !(await this.isFamilyOf(manager, compensation.toUserId, userId)) &&
        !(await this.isManagedVirtual(manager, compensation.toUserId, userId))
      ) {
        throw new ForbiddenException(
          'Подтвердить получение может только получатель',
        );
      }

      if (compensation.status === 'pending') {
        compensation.status = 'confirmed';
        compensation.confirmedAt = new Date();
        await manager.save(compensation);
      }

      // Подтверждение из вкладки закрывает и уведомление в переписке
      // (24.11.2026): с этого шага уведомление есть у любого перевода,
      // и без этого кнопки «Подтверждаю» висели бы в ленте после расчёта.
      await this.closeLinkedAction(manager, compensation.id);

      // Залог — тот же перевод, но у него есть покрытие (v3, 18.11.2026):
      // сумма сверх недостачи становится обычным переводом, а состояние
      // `held` ставится только тогда, когда залог покрыт целиком.
      if (compensation.kind === 'deposit') {
        await this.splitDepositOnConfirm(manager, trip, compensation);

        const sender = await manager.findOne(TripParticipant, {
          where: {
            tripId: String(trip.id),
            userId: compensation.fromUserId,
          },
        });

        if (sender !== null && trip.depositRub !== null && trip.depositRub > 0) {
          const coverage = await this.depositCoverageOf(
            manager,
            String(trip.id),
            trip.depositRub,
            compensation.fromUserId,
          );

          sender.depositHolderUserId = compensation.toUserId;
          if (coverage.dueRub === 0 && sender.depositStatus === 'pending') {
            sender.depositStatus = 'held';
          }
          sender.depositUpdatedBy = userId;
          sender.depositUpdatedAt = compensation.confirmedAt ?? new Date();
          await manager.save(sender);
        }
      }

      return this.buildView(manager, trip, userId);
    });

    this.events.emitFinance(String(tripId), userId);
    return view;
  }

  /**
   * Отменить ожидающую компенсацию — только отправитель.
   *
   * Подтверждённую не удаляем: деньги уже двигались, и «отменить» их
   * значило бы показать историю, которой не было.
   */
  async deleteCompensation(
    userId: string,
    tripId: number,
    compensationId: number,
  ): Promise<TripFinanceDto> {
    const view = await this.dataSource.transaction(async (manager) => {
      const trip = await this.trips.getVisibleTrip(userId, tripId);
      await this.assertGoing(manager, String(trip.id), userId);

      const compensation = await manager.findOne(TripCompensation, {
        where: { id: String(compensationId), tripId: String(trip.id) },
        lock: { mode: 'pessimistic_write' },
      });
      if (!compensation) throw new NotFoundException('Компенсация не найдена');
      if (
        compensation.fromUserId !== userId &&
        !(await this.isFamilyOf(manager, compensation.fromUserId, userId)) &&
        !(await this.isManagedVirtual(manager, compensation.fromUserId, userId))
      ) {
        throw new ForbiddenException(
          'Отменить компенсацию может только отправитель',
        );
      }
      if (compensation.status !== 'pending') {
        throw new ConflictException(
          'Подтверждённую компенсацию отменить нельзя',
        );
      }

      await manager.delete(TripCompensation, { id: compensation.id });

      // Отменённый перевод не должен оставлять в переписке просьбу
      // подтвердить получение (24.11.2026): сообщение пришло от отправителя,
      // и «подтверди» на отменённые деньги — прямая ошибка. Действие
      // удаляется вместе с сообщениями, как в «мой косяк» у `MessageActionsService`.
      await this.dropLinkedActions(manager, compensation.id);

      return this.buildView(manager, trip, userId);
    });

    this.events.emitFinance(String(tripId), userId);
    return view;
  }

  /**
   * «Отправить уведомления о компенсации» (24.11.2026).
   *
   * Заказчик: «В разделе Поход/Бухгалтерия кнопка, доступная организаторам
   * „Отправить уведомления о компенсации“. По ней улетают уведомления
   * участникам с отрицательным балансом и участникам с нулевым балансом при
   * установленном залоге — „Организатор запросил платёж по походу Витязь“
   * с кнопкой „Перейти“. Переход — раздел Бухгалтерия похода».
   *
   * **Кому.** Идущим участникам, у кого остаток с учётом ожидающих переводов
   * отрицательный; при установленном залоге — ещё и тем, у кого он ровно
   * ноль. Ожидающие переводы учитываются, иначе просьба пришла бы человеку,
   * который только что перевёл. Люди без аккаунта пропускаются: входить
   * в приложение им нечем, уведомление некуда положить.
   *
   * **Кнопка «Перейти»** — действие вида `payment_request` (см.
   * `MessageActionDto`): ответа не требует, `payload.tripId` говорит клиенту,
   * куда вести, и из `GET /message-actions/pending` такие не показываются.
   *
   * **Повтор не плодит строк.** Как у уведомления альманаха: если такое же
   * непрочитанное уже лежит, второе не пишем — иначе одно нажатие «на всякий
   * случай» давало бы две одинаковые строки в ленте.
   */
  async requestPayments(
    userId: string,
    tripId: number,
  ): Promise<TripFinanceNotifyDto> {
    const sent: Array<{ conversationId: string; recipientId: string }> = [];
    let recipients = 0;

    const view = await this.dataSource.transaction(async (manager) => {
      const trip = await this.trips.getVisibleTrip(userId, tripId);
      const roles = await this.organizerRoles(manager, trip);
      const role = roles.get(userId);
      const mine = await manager.findOne(TripParticipant, {
        where: { tripId: String(trip.id), userId },
      });
      const active =
        mine?.status === 'going' ||
        mine?.status === 'maybe' ||
        mine?.status === 'helping';

      if (role === undefined || (role === 'coOrganizer' && !active)) {
        throw new ForbiddenException(
          'Уведомления о компенсации отправляет организатор',
        );
      }

      const body = `Организатор запросил платёж по походу «${tripNameOf(trip)}».`;
      const debtors = await this.paymentRequestRecipients(manager, trip);
      recipients = debtors.filter((row) => row.userId !== userId).length;

      for (const recipient of debtors) {
        if (recipient.userId === userId) continue;
        if (recipient.user?.isVirtual === true) continue;

        const conversation = await this.directConversationOf(
          manager,
          userId,
          recipient.userId,
        );

        if (await this.hasUnreadBody(manager, conversation.id, userId, body)) {
          continue;
        }

        const action = await manager.save(
          manager.create(MessageAction, {
            kind: 'payment_request',
            targetUserId: recipient.userId,
            payload: { tripId: String(trip.id), tripTitle: tripNameOf(trip) },
            state: 'pending',
          }),
        );

        await manager.insert(Message, {
          conversationId: conversation.id,
          senderId: userId,
          body,
          actionId: action.id,
        });

        sent.push({
          conversationId: String(conversation.id),
          recipientId: recipient.userId,
        });
      }

      return this.buildView(manager, trip, userId);
    });

    // Событие — после коммита: до него открытая лента получателя показала бы
    // сообщение, которого ещё нет.
    for (const item of sent) {
      this.conversations.emitMessage(
        [item.recipientId, userId],
        item.conversationId,
        userId,
      );
    }

    return { ...view, notified: sent.length, recipients };
  }

  /**
   * Кому просить платёж: отрицательный остаток, а при залоге — и ноль.
   *
   * Остаток — `remainingFromEntities`, та же функция, что считает «с учётом
   * ожидающих» на вкладке: второго расчёта денег быть не должно.
   */
  private async paymentRequestRecipients(
    manager: EntityManager,
    trip: Trip,
  ): Promise<TripParticipant[]> {
    const tripId = String(trip.id);
    const { expenses, compensations } = await this.loadMoney(manager, tripId);
    const participants = await this.goingParticipants(manager, tripId);
    const memberIds = participants.map((item) => item.userId);

    const adjustments = await manager.find(TripDepositAdjustment, {
      where: { tripId },
    });
    const remaining = remainingFromEntities(
      expenses,
      compensations,
      memberIds,
      adjustments.map((row) => ({
        userId: row.userId,
        amountRub: row.amountRub,
      })),
    );

    const hasDeposit = trip.depositRub !== null && trip.depositRub > 0;

    return participants.filter((participant) => {
      const rest = remaining.get(participant.userId) ?? 0;

      return rest < 0 || (hasDeposit && rest === 0);
    });
  }

  /** Лежит ли у получателя непрочитанное сообщение ровно с таким текстом. */
  private async hasUnreadBody(
    manager: EntityManager,
    conversationId: string,
    senderId: string,
    body: string,
  ): Promise<boolean> {
    const rows = await manager.query(
      `SELECT 1
         FROM messages m
         LEFT JOIN conversation_members cm
           ON cm.conversation_id = m.conversation_id
          AND cm.user_id <> m.sender_id
        WHERE m.conversation_id = $1
          AND m.sender_id = $2
          AND m.body = $3
          AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)
        LIMIT 1`,
      [conversationId, senderId, body],
    );

    return (rows as unknown[]).length > 0;
  }

  /**
   * Закрыть действие, связанное с компенсацией (24.11.2026).
   *
   * Подтверждение из вкладки и автосогласие через 72 часа должны убирать
   * кнопки из уведомления: состояние живёт в `message_actions`, а не
   * в сообщении. Связь — `payload.compensationId`, отдельной колонки нет.
   */
  private async closeLinkedAction(
    manager: EntityManager,
    compensationId: string,
  ): Promise<void> {
    await manager.query(
      `UPDATE "message_actions"
          SET "state" = 'confirmed', "responded_at" = now(), "updated_at" = now()
        WHERE "kind" = 'money_received'
          AND "payload"->>'compensationId' = $1
          AND "state" IN ('pending', 'disputed')`,
      [String(compensationId)],
    );
  }

  /**
   * Удалить действия и их сообщения отменённой компенсации.
   *
   * Сообщения — до действий: у ссылки `ON DELETE SET NULL`, и если удалить
   * действие первым, «подтверди получение» осталось бы висеть без кнопок
   * (тот же порядок, что в «мой косяк» у `MessageActionsService`).
   */
  private async dropLinkedActions(
    manager: EntityManager,
    compensationId: string,
  ): Promise<void> {
    const rows = (await manager.query(
      `SELECT "id" FROM "message_actions"
        WHERE "kind" = 'money_received'
          AND "payload"->>'compensationId' = $1`,
      [String(compensationId)],
    )) as Array<{ id: string }>;

    for (const row of rows) {
      await manager.delete(Message, { actionId: row.id });
      await manager.delete(MessageAction, { id: row.id });
    }
  }

  // ─────────────────────────── сборка вкладки ───────────────────────────

  private async buildView(
    manager: EntityManager,
    trip: Trip,
    viewerId: string,
  ): Promise<TripFinanceDto> {
    const tripId = String(trip.id);
    const { expenses, compensations } = await this.loadMoney(manager, tripId);
    const participants = await this.goingParticipants(manager, tripId);
    const memberIds = participants.map((item) => item.userId);

    // Люди вне `going`: «пока думаю», «помогаю» и ушедшие. С 20.11.2026 они
    // остаются видимыми и участниками расчётов, пока с ними не рассчитались
    // в ноль. Их баланс считается и так (доли расходов хранятся по человеку),
    // а вот получать компенсацию ушедший должен уметь — «компенсировать
    // можно любому, включая declined» (finance.md §2.2).
    const others = await manager.find(TripParticipant, {
      where: { tripId, status: Not('going') },
      relations: { user: true },
      order: { createdAt: 'ASC', userId: 'ASC' },
    });

    // 18.11.2026: перевод залога идёт через `trip_compensations`
    // (`kind = 'deposit'`), поэтому баланс уже считает его обычным
    // переводом: у отправителя плюс, у организатора минус — «теперь он
    // должен». Корректировки остались только на возврат залога: тогда доля
    // ушедшего расходится на идущих.
    const adjustments = await manager.find(TripDepositAdjustment, {
      where: { tripId },
      relations: { sourceUser: true, user: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const adjustmentRows: BalanceAdjustment[] = adjustments.map((row) => ({
      userId: row.userId,
      amountRub: row.amountRub,
    }));

    // Строки фонда: удержанный залог, который уже не вернуть молча.
    const forfeits = await manager.find(TripDepositForfeit, {
      where: { tripId },
      relations: { sourceUser: true },
      order: { createdAt: 'DESC', id: 'DESC' },
    });

    const balances = balancesFromEntities(
      expenses,
      compensations,
      memberIds,
      adjustmentRows,
    );
    const remaining = remainingFromEntities(
      expenses,
      compensations,
      memberIds,
      adjustmentRows,
    );

    const userById = new Map(
      [...participants, ...others].map((participant) => [
        participant.userId,
        participant.user,
      ]),
    );

    // Семья — компонента связей; в походе важны только идущие, поэтому
    // группа фильтруется по составу, а порядок внутри неё — порядок состава.
    const families = await this.goingFamilies(manager, participants);

    /**
     * Семьи для подсказок компенсации: идущие плюс те, кто вне `going`, но
     * кому ещё должны (ушедший с кредитом, «пока думаю» с долей). Вторые
     * идут одиночками: их родные, если идут, уже в своей семье, а касса
     * ушедшего считается по нему одному.
     */
    const familiesForCompensation: string[][] = [
      ...families,
      ...others.map((participant) => [participant.userId]),
    ];

    const myFamily = families.find((group) => group.includes(viewerId)) ?? [
      viewerId,
    ];
    const myFamilySet = new Set(myFamily);

    /**
     * Люди без аккаунта, которых ведёт смотрящий: за них он записывает
     * платёж и перевод. Семейный случай сюда не входит — за родных
     * действует семья, а не отдельный выбор.
     */
    const managedParticipants = participants.filter(
      (participant) =>
        participant.user?.isVirtual === true &&
        participant.user.virtualOwnerUserId === viewerId,
    );
    const managedIds = new Set(
      managedParticipants.map((participant) => participant.userId),
    );

    const familyOf = (userId: string): string[] =>
      families.find((group) => group.includes(userId)) ?? [userId];

    const optionsFor = (senderId: string): CompensationOptionDto[] =>
      compensationOptions(senderId, remaining, familiesForCompensation).map(
        (option) => {
          const people = option.userIds.map(
            (userId) => userById.get(userId)!,
          );

          return {
            userIds: [...option.userIds],
            displayName: joinNames(people.map((person) => person.displayName)),
            amountRub: option.amountRub,
            members: people.map((person) => ({
              userId: person.id,
              displayName: person.displayName,
              gender: person.gender,
              paymentDetails: person.paymentDetails,
              paymentBank: person.paymentBank,
            })),
          };
        },
      );

    const suggestions = optionsFor(viewerId);

    // Общая касса семьи (12.11.2026): одна цифра на семью, а не на человека.
    // Внутри семьи плюс одного гасит минус другого — это «общий кошелёк».
    // С 13.11.2026 на экране касс нет: их используют только подсказки
    // компенсации, а балансы человек видит личные.
    const familyDtos: FinanceFamilyDto[] = families.map((group) => {
      const people = group.map((userId) => userById.get(userId)!);

      return {
        memberIds: [...group],
        displayName: joinNames(people.map((person) => person.displayName)),
        balanceRub: familyBalance(balances, group),
        remainingRub: familyBalance(remaining, group),
        isMine: group.includes(viewerId),
      };
    });

    // Право позвать должников (24.11.2026) — у организатора и у
    // соорганизатора, пока он в походе. Считается здесь же, на сервере:
    // спрятанная кнопка — не запрет, а решение принимает `requestPayments`.
    const myRoles = await this.organizerRoles(manager, trip);
    const myRole = myRoles.get(viewerId);
    const myStatus = [...participants, ...others].find(
      (participant) => participant.userId === viewerId,
    )?.status;
    const canRequestPayments =
      myRole === 'organizer' ||
      (myRole === 'coOrganizer' &&
        (myStatus === 'going' || myStatus === 'maybe' || myStatus === 'helping'));

    const me: MyFinanceDto = {
      balanceRub: balances.get(viewerId) ?? 0,
      remainingRub: remaining.get(viewerId) ?? 0,
      // Касса семьи — расчёт для компенсации (13.11.2026): экран показывает
      // личный `balanceRub`, а «папа платит за сына» считается по кассе.
      familyBalanceRub: familyBalance(balances, myFamily),
      familyRemainingRub: familyBalance(remaining, myFamily),
      // Долг и кредит кассы: по ним считается вариант перевода, когда личный
      // остаток смотрящего ничего не говорит (плюс у меня, минус у родного).
      familyDebtRub: familyDebt(remaining, myFamily),
      familyCreditRub: familyCredit(remaining, myFamily),
      // Приглашённый видит вкладку, но ещё не тратил: экран по этому флагу
      // выключает кнопки. Проверка прав остаётся на сервере (`assertGoing`).
      canSpend: memberIds.includes(viewerId),
      canRequestPayments,
      suggestions,
    };

    const members: FinanceMemberDto[] = this.membersView(
      participants,
      others,
      balances,
      remaining,
      managedIds,
    );

    const managedSenders: CompensationSenderDto[] = managedParticipants.map(
      (participant) => {
        const senderFamily = familyOf(participant.userId);

        return {
          userId: participant.userId,
          displayName: participant.user.displayName,
          familyDebtRub: familyDebt(remaining, senderFamily),
          familyCreditRub: familyCredit(remaining, senderFamily),
          suggestions: optionsFor(participant.userId),
        };
      },
    );

    return {
      expenses: expenses.map((expense) => {
        const dto = TripExpenseDto.from(expense, viewerId);

        // Расход человека без аккаунта правит тот, кто его ведёт.
        if (managedIds.has(expense.authorUserId)) dto.canEdit = true;

        // После завершения похода прежние чеки не правятся и не удаляются
        // (20.11.2026): расчёты ещё идут, а записи о тратах — история.
        // Кнопки «Править»/«Удалить» экран рисует по этому флагу, поэтому
        // снимаем его на сервере, а не надеемся на проверку при сохранении.
        if (trip.completedAt !== null) dto.canEdit = false;

        return dto;
      }),
      compensations: compensations.map((compensation) => {
        const dto = TripCompensationDto.from(compensation, viewerId);

        // Семья действует как один кошелёк: «папа перевёл за всех» —
        // значит отменить это может любой из семьи отправителя, а получить
        // подтверждение — любой из семьи получателя. Перевод человека
        // без аккаунта отменяет тот, кто его ведёт.
        if (compensation.status === 'pending') {
          if (myFamilySet.has(compensation.fromUserId)) dto.canCancel = true;
          if (managedIds.has(compensation.fromUserId)) dto.canCancel = true;
          if (myFamilySet.has(compensation.toUserId)) dto.canConfirm = true;
          if (managedIds.has(compensation.toUserId)) dto.canConfirm = true;
        }

        return dto;
      }),
      members,
      families: familyDtos,
      me,
      managedSenders,
      deposit: await this.buildDeposit(
        manager,
        trip,
        viewerId,
        expenses,
        compensations,
        balances,
        remaining,
      ),
      depositForfeits: this.buildDepositForfeits(forfeits),
      depositReturns: this.buildDepositReturns(adjustments),
    };
  }

  /**
   * Блок залога (17.11.2026, v3 — 18.11.2026).
   *
   * `null` — залога нет, и на экране нет ничего: пустой блок «Залог: 0 ₽»
   * только сбивал бы с толку.
   *
   * **Залог покрывается расходами (v3).** Заказчик: «если участник
   * не потратился на сумму залога, то доступна кнопка „Перевести залог“…
   * если он понёс расходов больше залоговой суммы, то кнопка скрыта».
   * Поэтому у каждого человека считается `covered = min(D, invested +
   * transferred)`: расходы, которые он оплатил, и подтверждённые переводы
   * идут в зачёт. Отдельные 200 ₽ переводит только тот, кому расходов
   * не хватает до суммы залога.
   *
   * **Секция — не весь состав, а риск.** Ушедшие с ненулевым покрытием
   * (у них решают, вернуть залог или удержать) и идущие, которые не добрали
   * залог («не перевёл залог и недостаточно вложился»). Ушедший с нулём
   * не показывается вовсе: решать нечего.
   *
   * **Рядовой участник секцию не видит.** Он получает `me` — свой залог,
   * покрытие и кнопку «Перевести залог» в «Твоём балансе»; секция риска —
   * только организатору и соорганизатору.
   */
  private async buildDeposit(
    manager: EntityManager,
    trip: Trip,
    viewerId: string,
    expenses: readonly TripExpense[],
    compensations: readonly TripCompensation[],
    balances: ReadonlyMap<string, number>,
    remaining: ReadonlyMap<string, number>,
  ): Promise<TripDepositDto | null> {
    if (trip.depositRub === null || trip.depositRub <= 0) return null;

    const amountRub = trip.depositRub;
    const participants = await this.loadDepositParticipants(manager, trip);

    // «Вложился» — сколько человек уже оплатил расходов похода.
    const investedByUser = new Map<string, number>();
    for (const expense of expenses) {
      investedByUser.set(
        expense.authorUserId,
        (investedByUser.get(expense.authorUserId) ?? 0) + expense.amountRub,
      );
    }

    // Переводы залога: подтверждённые покрывают залог, ожидающие его
    // бронируют — иначе человек отправил бы ту же недостачу второй раз,
    // пока первый перевод ждёт «Получено» (v3, 18.11.2026).
    const transferredByUser = new Map<string, number>();
    const pendingByUser = new Map<string, number>();
    for (const row of compensations) {
      if (row.kind !== 'deposit') continue;
      const target =
        row.status === 'confirmed' ? transferredByUser : pendingByUser;
      target.set(row.fromUserId, (target.get(row.fromUserId) ?? 0) + row.amountRub);
    }

    const coverageOf = (userId: string): DepositCoverage =>
      depositCoverage({
        amountRub,
        investedRub: investedByUser.get(userId) ?? 0,
        transferredRub: transferredByUser.get(userId) ?? 0,
        pendingRub: pendingByUser.get(userId) ?? 0,
      });

    const organizerRoles = await this.organizerRoles(manager, trip);
    // Получатели для самого смотрящего. Виртуальному человеку список
    // считается отдельно: он платит организатору, который его ведёт,
    // а тот сам себе залог не переводит.
    const selfRecipients = await this.depositRecipients(
      manager,
      trip,
      participants,
      viewerId,
    );

    const rows = participants.map((participant) =>
      this.depositRow(
        participant,
        viewerId,
        coverageOf(participant.userId),
        organizerRoles.has(participant.userId),
        this.hasOpenMoney(participant.userId, balances, remaining),
      ),
    );

    // Список — не весь состав, а **риск** (18.11.2026): ушедшие, у которых
    // хоть что-то покрыто (решать есть что), и идущие, которые не добрали
    // залог. Ушедший с нулём не показывается вовсе: ни денег, ни расходов,
    // решать нечего — заказчик просил его не упоминать.
    //
    // **С 20.11.2026 ушедший исчезает и тогда, когда с ним рассчитались
    // в ноль** (переводы подтверждены или истекли 72 часа): деньги уже ушли,
    // пересобирать нечего, «Удержать» недоступно.
    const declined = rows.filter(
      (row) =>
        row.declined &&
        row.coveredRub > 0 &&
        this.hasOpenMoney(row.userId, balances, remaining),
    );
    const uncovered = rows.filter(
      (row) => !row.declined && !organizerRoles.has(row.userId) && row.missingRub > 0,
    );

    const mine = participants.find(
      (participant) => participant.userId === viewerId,
    );
    const myRow = rows.find((row) => row.isMe) ?? null;
    const organizerRole = organizerRoles.get(viewerId);
    const isActive = (status: string | undefined): boolean =>
      status === 'going' || status === 'maybe';
    const canManage =
      organizerRole === 'organizer' ||
      (organizerRole === 'coOrganizer' &&
        (isActive(mine?.status) || mine?.status === 'helping'));

    // Свой залог организатор не переводит: деньги у него самого. В расчёте
    // экрана это `selfHeld`, а не выдуманный перевод.
    const selfHeld =
      myRow !== null &&
      organizerRole !== undefined &&
      isActive(mine?.status);

    const me: MyDepositDto | null =
      mine !== undefined && isActive(mine.status) && myRow !== null
        ? {
            status: myRow.status,
            amountRub,
            investedRub: myRow.investedRub,
            transferredRub: myRow.transferredRub,
            pendingRub: myRow.pendingRub,
            coveredRub: selfHeld ? amountRub : myRow.coveredRub,
            missingRub: selfHeld ? 0 : myRow.missingRub,
            dueRub: selfHeld ? 0 : myRow.dueRub,
            canTransfer:
              !selfHeld &&
              myRow.pendingRub === 0 &&
              myRow.dueRub > 0 &&
              selfRecipients.length > 0,
            selfHeld,
            holderName: myRow.holderName,
            hasPendingTransfer: myRow.hasPendingTransfer,
          }
        : null;

    // Кто может нажать «Я передал»: сам смотрящий и люди без аккаунта,
    // которых он ведёт. Без этого организатор с виртуальными друзьями
    // не увидел бы кнопку вовсе (замечание заказчика 18.11.2026).
    const senders: DepositSenderDto[] = [];
    if (me?.canTransfer && mine !== undefined) {
      senders.push({
        userId: viewerId,
        displayName: mine.user?.displayName ?? '',
        isMe: true,
        dueRub: me.dueRub,
        recipients: selfRecipients,
      });
    }
    for (const participant of participants) {
      if (participant.userId === viewerId) continue;
      if (!isActive(participant.status)) continue;
      if (organizerRoles.has(participant.userId)) continue;
      if (
        participant.user?.isVirtual !== true ||
        participant.user.virtualOwnerUserId !== viewerId
      ) {
        continue;
      }

      const coverage = coverageOf(participant.userId);
      // Пока перевод в пути, кнопку не показываем и за виртуального: второй
      // перевод до подтверждения первого — двойная отправка денег.
      if (coverage.dueRub <= 0 || coverage.pendingRub > 0) continue;

      const senderRecipients = await this.depositRecipients(
        manager,
        trip,
        participants,
        participant.userId,
      );
      if (senderRecipients.length === 0) continue;

      senders.push({
        userId: participant.userId,
        displayName: participant.user.displayName ?? '',
        isMe: false,
        dueRub: coverage.dueRub,
        recipients: senderRecipients,
      });
    }

    return {
      amountRub,
      canManage,
      me,
      // Секция риска — только организатору и соорганизатору: рядовому
      // участнику незачем видеть решения по чужим залогам, а свой он видит
      // в `me`. Пустой массив вместо списка — чтобы правило было видно
      // и в данных, а не только в вёрстке.
      participants: canManage ? [...declined, ...uncovered] : [],
      senders,
    };
  }

  /** Строка участника для секции риска. */
  private depositRow(
    participant: TripParticipant,
    viewerId: string,
    coverage: DepositCoverage,
    isOrganizer: boolean,
    settleOpen: boolean,
  ): DepositParticipantDto {
    const isActive =
      participant.status === 'going' || participant.status === 'maybe';
    // Свой залог организатор не «сдаёт»: деньги у него самого. Показываем
    // это как `held`, хотя в базе человек мог не отмечать ничего.
    const selfHeld = isOrganizer && isActive;

    // Решение организатора хранится в `deposit_status`; `held` вычисляется
    // из покрытия: залог покрыт расходами, переводом или деньгами
    // организатора — значит, сдавать больше нечего (v3, 18.11.2026).
    const decision =
      participant.depositStatus === 'returned' ||
      participant.depositStatus === 'forfeited'
        ? participant.depositStatus
        : null;
    const status: DepositStatus =
      decision ?? (selfHeld || coverage.missingRub === 0 ? 'held' : 'pending');

    return {
      userId: participant.userId,
      displayName: participant.user?.displayName ?? '',
      avatarUrl: participant.user?.avatarUrl ?? null,
      status,
      updatedByName: participant.depositUpdatedByUser?.displayName ?? null,
      updatedAt: participant.depositUpdatedAt?.toISOString() ?? null,
      isMe: participant.userId === viewerId,
      investedRub: coverage.investedRub,
      transferredRub: coverage.transferredRub,
      pendingRub: coverage.pendingRub,
      coveredRub: selfHeld ? coverage.coveredRub + coverage.missingRub : coverage.coveredRub,
      missingRub: selfHeld ? 0 : coverage.missingRub,
      dueRub: selfHeld ? 0 : coverage.dueRub,
      holderName:
        participant.depositHolderUser?.displayName ??
        (selfHeld ? participant.user?.displayName ?? null : null),
      declined: participant.status === 'declined',
      hasPendingTransfer: coverage.pendingRub > 0,
      // Решать судьбу залога можно, только когда хоть что-то покрыто:
      // ушедший с нулём в списке не показывается вовсе (v3). С 20.11.2026
      // к этому добавилось «расчёт не закрыт»: пока с ушедшим не
      // рассчитались в ноль, флаг работает сколько угодно раз; после —
      // деньги уже ушли, и удерживать нечего.
      canDecide:
        participant.status === 'declined' &&
        coverage.coveredRub > 0 &&
        settleOpen,
    };
  }

  /**
   * Участники, с которыми работает залог: идущие, «пока думаю»,
   * помогающие и вышедшие.
   *
   * Вышедшие нужны с 17.11.2026: их залог уже у организатора, и решать его
   * судьбу — «Вернуть» или «Удержать» — тоже организатору.
   *
   * `helping` добавлен 20.11.2026 вместе с возвратом статуса: человек,
   * который помогает, но не идёт, мог вложиться в закупки, и его деньги
   * не должны исчезнуть из расчёта только потому, что он не едет.
   */
  private async loadDepositParticipants(
    manager: EntityManager,
    trip: Trip,
  ): Promise<TripParticipant[]> {
    return manager.find(TripParticipant, {
      // Приглашённый ещё не решил: залога с него не спрашивают и в списке
      // его нет — иначе «Ещё не ответил» висел бы в секции риска вечно.
      where: {
        tripId: String(trip.id),
        status: In(['going', 'maybe', 'helping', 'declined']),
      },
      relations: {
        user: true,
        depositUpdatedByUser: true,
        depositHolderUser: true,
      },
      order: { createdAt: 'ASC', userId: 'ASC' },
    });
  }

  /**
   * Кому можно перевести залог: автор похода и соорганизаторы.
   *
   * Прямых переводов между участниками в приложении нет, поэтому залог
   * уходит организатору, и он «становится частичным держателем кассы»
   * (слова заказчика). Автор похода в списке всегда — даже «не иду»:
   * организовывать и ходить — разные вещи (17.11.2026). Соорганизатор —
   * только если сам в походе: переводить деньги тому, кто вышел, незачем.
   *
   * Себя из списка убираем: переводить залог самому себе бессмысленно.
   * Организатор свой залог не переводит — деньги у него самого; кнопка
   * с этим списком нужна ему за людей без аккаунта.
   */
  private async depositRecipients(
    manager: EntityManager,
    trip: Trip,
    participants: readonly TripParticipant[],
    viewerId: string,
  ): Promise<DepositRecipientDto[]> {
    const roles = await this.organizerRoles(manager, trip);
    const byId = new Map(
      participants.map((participant) => [participant.userId, participant]),
    );
    const recipients: DepositRecipientDto[] = [];

    const organizer = byId.get(trip.organizerUserId);
    if (organizer !== undefined && organizer.userId !== viewerId) {
      recipients.push(this.toDepositRecipient(organizer, 'organizer'));
    }

    for (const participant of participants) {
      if (participant.userId === trip.organizerUserId) continue;
      if (participant.userId === viewerId) continue;
      if (roles.get(participant.userId) !== 'coOrganizer') continue;
      if (participant.status !== 'going' && participant.status !== 'maybe') {
        continue;
      }

      recipients.push(this.toDepositRecipient(participant, 'coOrganizer'));
    }

    return recipients;
  }

  /**
   * Автор похода и соорганизаторы: кому переводят залог и кто решает
   * его судьбу. Автор — всегда, даже «не иду»: организовывать и ходить
   * разные вещи. Соорганизатор — только пока идёт: он должен видеть
   * залоги и подтверждать получение.
   */
  private async organizerRoles(
    manager: EntityManager,
    trip: Trip,
  ): Promise<Map<string, 'organizer' | 'coOrganizer'>> {
    const roles = new Map<string, 'organizer' | 'coOrganizer'>();
    roles.set(trip.organizerUserId, 'organizer');

    const roleRows = await manager.find(TripParticipantRole, {
      where: { tripId: String(trip.id) },
    });
    const coOrganizer = await manager.findOne(Role, {
      where: { code: COORGANIZER_ROLE_CODE },
    });
    if (coOrganizer === null) return roles;

    for (const row of roleRows) {
      if (row.roleId !== coOrganizer.id) continue;
      if (roles.has(row.userId)) continue;
      roles.set(row.userId, 'coOrganizer');
    }

    return roles;
  }

  private toDepositRecipient(
    participant: TripParticipant,
    role: 'organizer' | 'coOrganizer',
  ): DepositRecipientDto {
    return {
      userId: participant.userId,
      displayName: participant.user?.displayName ?? '',
      role,
      gender: participant.user?.gender ?? 'm',
      paymentDetails: participant.user?.paymentDetails ?? null,
      paymentBank: participant.user?.paymentBank ?? null,
    };
  }

  /**
   * Удержания залогов для ленты «Движения денег» (18.11.2026).
   *
   * Удержание не двигает личные балансы, но пополняет фонд группы, поэтому
   * человек должен видеть, откуда плюс в бюджете. Одно удержание — одна
   * строка с суммой; долей идущим здесь больше нет, потому что удержанный
   * залог покрывает долю самого ушедшего.
   */
  private buildDepositForfeits(
    rows: readonly TripDepositForfeit[],
  ): TripDepositForfeitDto[] {
    return rows.map((row) => ({
      id: String(row.id),
      at: row.createdAt.toISOString(),
      sourceUserId: row.sourceUserId,
      sourceName: row.sourceUser?.displayName ?? '',
      amountRub: row.amountRub,
    }));
  }

  /**
   * Возвраты залогов для ленты (18.11.2026).
   *
   * Заказчик просил «удалить запись в Движении средств» при возврате —
   * удаляется запись **удержания**. Но возврат пересобирает доли: ушедшему
   * плюс его доля, идущим минус их часть. Эти цифры меняются, и лента
   * обязана их объяснить, иначе они «за спиной». Одна строка на возврат.
   */
  private buildDepositReturns(
    adjustments: readonly TripDepositAdjustment[],
  ): TripDepositReturnDto[] {
    const groups = new Map<string, TripDepositAdjustment[]>();

    for (const row of adjustments) {
      const list = groups.get(row.sourceUserId) ?? [];
      list.push(row);
      groups.set(row.sourceUserId, list);
    }

    return [...groups.entries()]
      .map(([sourceUserId, rows]) => {
        const positive = rows.filter((row) => row.amountRub > 0);
        const at = rows[0]?.createdAt ?? new Date();
        const amountRub = positive.reduce(
          (sum, row) => sum + row.amountRub,
          0,
        );

        return {
          id: `${sourceUserId}-${at.getTime()}`,
          at: at.toISOString(),
          sourceUserId,
          sourceName: rows[0]?.sourceUser?.displayName ?? '',
          amountRub,
          shares: rows
            .filter((row) => row.amountRub < 0)
            .map((row) => ({
              userId: row.userId,
              displayName: row.user?.displayName ?? '',
              amountRub: Math.abs(row.amountRub),
            })),
        };
      })
      .filter((row) => row.amountRub > 0)
      .sort((left, right) =>
        left.at < right.at ? 1 : left.at > right.at ? -1 : 0,
      );
  }

  /**
   * Пересобрать доли ушедшего при возврате залога (18.11.2026).
   *
   * Заказчик: «A уговорил организатора вернуть залог, баланс стал A +1000,
   * B, C, D, E −250, разошли полюбовно». Значит, доля A в общих расходах
   * ложится на идущих: у источника **плюс** его доля, у каждого идущего
   * **минус** его часть. Считаем по сохранённым долям расходов
   * (`trip_expense_shares`) и ничего в истории не переписываем: это
   * сегодняшнее решение организатора, а не прошедшая трата.
   *
   * **Удержание корректировок не создаёт.** Залог покрывает долю ушедшего,
   * и личные балансы остаются прежними: в примере заказчика после
   * удержания всё ещё A +800, B, C, D, E −200. Поэтому `forfeited`
   * и `pending` просто очищают строки, а строки появляются только
   * у `returned`.
   */
  private async syncDepositAdjustments(
    manager: EntityManager,
    trip: Trip,
    targetUserId: string,
    status: DepositDecision,
  ): Promise<void> {
    await manager.delete(TripDepositAdjustment, {
      tripId: String(trip.id),
      sourceUserId: targetUserId,
    });

    if (status !== 'returned') return;

    // Доля ушедшего — сумма всех его долей по расходам похода. Расход
    // ещё и плательщика: если он платил, это уже в его балансе, а здесь
    // важна именно доля, которую теперь берут на себя идущие.
    const expenses = await manager.find(TripExpense, {
      where: { tripId: String(trip.id) },
      relations: { shares: true },
    });
    const shareRub = expenses.reduce(
      (sum, expense) =>
        sum +
        (expense.shares ?? [])
          .filter((share) => share.userId === targetUserId)
          .reduce((inner, share) => inner + share.amountRub, 0),
      0,
    );
    if (shareRub <= 0) return;

    const going = await this.goingParticipants(manager, String(trip.id));
    // Делить не на кого — все вышли: возвращать долю некому, строк нет.
    if (going.length === 0) return;

    const shares = splitAmount(
      shareRub,
      going.map((participant) => participant.userId),
    );
    const rows = [
      manager.create(TripDepositAdjustment, {
        tripId: String(trip.id),
        sourceUserId: targetUserId,
        userId: targetUserId,
        amountRub: shareRub,
      }),
      ...shares.map((share) =>
        manager.create(TripDepositAdjustment, {
          tripId: String(trip.id),
          sourceUserId: targetUserId,
          userId: share.userId,
          amountRub: -share.amountRub,
        }),
      ),
    ];

    await manager.save(rows);
  }

  /**
   * Покрытие залога одного человека по данным базы (v3, 18.11.2026).
   *
   * Тот же расчёт, что в `buildDeposit`, но без готового ответа вкладки:
   * нужен действиям — переводу и решению организатора. Считается по
   * **оплаченным** расходам (`author_user_id`), а не по долям: залог
   * покрывают реально вложенные деньги.
   */
  private async depositCoverageOf(
    manager: EntityManager,
    tripId: string,
    amountRub: number,
    userId: string,
  ): Promise<DepositCoverage> {
    const [expenses, transfers] = await Promise.all([
      manager.find(TripExpense, { where: { tripId } }),
      manager.find(TripCompensation, {
        where: { tripId, fromUserId: userId, kind: 'deposit' },
      }),
    ]);

    const investedRub = expenses
      .filter((row) => row.authorUserId === userId)
      .reduce((sum, row) => sum + row.amountRub, 0);

    let transferredRub = 0;
    let pendingRub = 0;
    for (const row of transfers) {
      if (row.status === 'confirmed') transferredRub += row.amountRub;
      else pendingRub += row.amountRub;
    }

    return depositCoverage({
      amountRub,
      investedRub,
      transferredRub,
      pendingRub,
    });
  }

  /**
   * Подтверждённый перевод залога: отделить излишек «с запасом».
   *
   * Заказчик разрешил переводить больше недостачи. Залогом остаётся ровно
   * столько, сколько нужно для покрытия (с учётом расходов и других
   * переводов), остальное — **обычный подтверждённый перевод**: он виден
   * в движении и живёт в расчётах по общим правилам, поэтому при удержании
   * не исчезает вместе с залогом, а при возврате не теряется.
   *
   * Если залог уже покрыт (например, расходами), вся строка становится
   * обычным переводом: `kind = 'deposit'` с нулевым покрытием врал бы.
   */
  private async splitDepositOnConfirm(
    manager: EntityManager,
    trip: Trip,
    compensation: TripCompensation,
  ): Promise<void> {
    const amountRub = trip.depositRub;
    if (amountRub === null || amountRub <= 0) return;

    const expenses = await manager.find(TripExpense, {
      where: { tripId: String(trip.id) },
    });
    const investedRub = expenses
      .filter((row) => row.authorUserId === compensation.fromUserId)
      .reduce((sum, row) => sum + row.amountRub, 0);

    // Текущая строка уже помечена подтверждённой, поэтому её вычитаем:
    // «другие переводы» — это то, что было покрыто до неё.
    const confirmed = await manager.find(TripCompensation, {
      where: {
        tripId: String(trip.id),
        fromUserId: compensation.fromUserId,
        kind: 'deposit',
        status: 'confirmed',
      },
    });
    const otherTransferredRub = confirmed
      .filter((row) => row.id !== compensation.id)
      .reduce((sum, row) => sum + row.amountRub, 0);

    const coveredByOthersRub = Math.min(
      amountRub,
      investedRub + otherTransferredRub,
    );
    const { depositRub, excessRub } = splitDepositExcess(
      compensation.amountRub,
      Math.max(0, amountRub - coveredByOthersRub),
    );

    if (depositRub === 0) {
      compensation.kind = 'compensation';
      await manager.save(compensation);
      return;
    }

    if (excessRub <= 0) return;

    compensation.amountRub = depositRub;
    await manager.save(compensation);

    await manager.save(
      manager.create(TripCompensation, {
        tripId: String(trip.id),
        fromUserId: compensation.fromUserId,
        toUserId: compensation.toUserId,
        amountRub: excessRub,
        // Получатель уже нажал «Получено» на всю сумму: излишек — обычный
        // перевод, и подтверждать его второй раз незачем.
        kind: 'compensation',
        status: 'confirmed',
        confirmedAt: compensation.confirmedAt ?? new Date(),
      }),
    );
  }

  /**
   * Решение организатора по залогу вышедшего (17.11.2026, v3 — 18.11.2026).
   *
   * «Сдал» здесь больше нет: сдачу подтверждает получатель перевода, как
   * компенсацию. Организатор решает только судьбу залога вышедшего:
   *
   * - `forfeited` — залог остаётся в фонде группы. Переводы залога
   *   удаляются (деньги больше не принадлежат ушедшему), в ленте
   *   появляется строка «Залог удержан» на **покрытую** часть
   *   `min(D, covered)`. Личные балансы не двигаются: залог покрывает
   *   долю ушедшего.
   * - `returned` — залог возвращается: удаляются и переводы, и удержание,
   *   а доля ушедшего расходится на идущих (`syncDepositAdjustments`).
   * - `pending` — снять решение (в интерфейсе v3 кнопки «Снять» нет;
   *   значение осталось для API и повторного открытия решения).
   *
   * **Решают по покрытию, а не по `deposit_status`** (v3): ушедший мог
   * покрыть залог расходами и не иметь ни одного перевода — в примере
   * заказчика A вложил 1 000 ₽ при залоге 200 ₽. У такого человека
   * `covered = 200 > 0`, и «Вернуть/Удержать» работать обязано.
   *
   * Правила по цели: `invited` — 400 (ещё не ответил); решения
   * `forfeited`/`returned` — только `declined` (ради этого секция и нужна);
   * сброс `pending` — любому участнику.
   */
  async setDepositStatus(
    userId: string,
    tripId: number,
    targetUserId: string,
    status: DepositDecision,
  ): Promise<TripFinanceDto> {
    const view = await this.dataSource.transaction(async (manager) => {
      const trip = await this.trips.getVisibleTrip(userId, tripId);

      const roles = await this.organizerRoles(manager, trip);
      const role = roles.get(userId);
      const actor = await manager.findOne(TripParticipant, {
        where: { tripId: String(trip.id), userId },
        relations: { user: true },
      });
      /**
       * Судьбу залога решают организатор и соорганизатор. Соорганизатор —
       * и в статусе `helping` (20.11.2026): роль не зависит от того, идёт
       * он сам, а «помогаю, но не иду» — именно про такого человека.
       */
      const canManage =
        role === 'organizer' ||
        (role === 'coOrganizer' &&
          (actor?.status === 'going' ||
            actor?.status === 'maybe' ||
            actor?.status === 'helping'));
      if (!canManage) {
        throw new ForbiddenException('Судьбу залога решает организатор похода');
      }

      if (trip.depositRub === null || trip.depositRub <= 0) {
        throw new BadRequestException('У этого похода нет залога');
      }

      const participant = await manager.findOne(TripParticipant, {
        where: { tripId: String(trip.id), userId: targetUserId },
      });

      if (!participant) {
        throw new NotFoundException('Этот человек не участвует в походе');
      }

      if (participant.status === 'invited') {
        throw new BadRequestException(
          'Этот человек ещё не ответил на приглашение',
        );
      }

      if (
        (status === 'forfeited' || status === 'returned') &&
        participant.status !== 'declined'
      ) {
        throw new BadRequestException(
          'Залог решают, когда человек вышел из похода',
        );
      }

      // Решать судьбу залога можно, когда **покрыто хоть что-то** (v3,
      // 18.11.2026): залог мог быть покрыт расходами, а не переводом.
      // Ушедшего с нулём в списке риска нет вовсе — и решать там нечего.
      const coverage = await this.depositCoverageOf(
        manager,
        String(trip.id),
        trip.depositRub,
        targetUserId,
      );

      if (
        (status === 'forfeited' || status === 'returned') &&
        coverage.coveredRub <= 0
      ) {
        throw new BadRequestException('Залог не покрыт — решать нечего');
      }

      // «Расчёт закрыт» (20.11.2026). Пока с ушедшим не сошлись в ноль,
      // переключатель работает сколько угодно раз. Как только сошлись
      // (переводы подтверждены или истекли 72 часа), деньги уже ушли,
      // и «Удержать» нечего: кнопки на экране нет, но запрос можно послать
      // руками — поэтому проверка живёт и на сервере.
      const money = await this.loadMoney(manager, String(trip.id));
      const going = await this.goingParticipants(manager, String(trip.id));
      const goingIds = going.map((item) => item.userId);
      const balances = balancesFromEntities(
        money.expenses,
        money.compensations,
        goingIds,
      );
      const remaining = remainingFromEntities(
        money.expenses,
        money.compensations,
        goingIds,
      );
      if (!this.hasOpenMoney(targetUserId, balances, remaining)) {
        throw new ConflictException(
          'С ушедшим уже рассчитались — удерживать нечего',
        );
      }

      // Залог больше не принадлежит ушедшему: его перевод удаляется при
      // любом решении. Возврат возвращает деньги, удержание оставляет их
      // в фонде — но строку «он заплатил» в обоих случаях заменяет решение.
      await manager.delete(TripCompensation, {
        tripId: String(trip.id),
        fromUserId: targetUserId,
        kind: 'deposit',
      });

      if (status === 'forfeited') {
        await manager.delete(TripDepositForfeit, {
          tripId: String(trip.id),
          sourceUserId: targetUserId,
        });
        await manager.save(
          manager.create(TripDepositForfeit, {
            tripId: String(trip.id),
            sourceUserId: targetUserId,
            // Удерживается покрытая часть залога, а не всегда вся сумма:
            // у ушедшего с 50 ₽ вложений залог покрыт лишь на 50 ₽
            // (v3, 18.11.2026 — предлагалось в плане, принято здесь).
            amountRub: Math.min(trip.depositRub, coverage.coveredRub),
          }),
        );
      } else {
        await manager.delete(TripDepositForfeit, {
          tripId: String(trip.id),
          sourceUserId: targetUserId,
        });
      }

      await this.syncDepositAdjustments(
        manager,
        trip,
        targetUserId,
        status,
      );

      participant.depositStatus = status;
      participant.depositUpdatedBy = userId;
      participant.depositUpdatedAt = new Date();
      // Удержанный залог остаётся у того, кто решил; возвращённый и снятый
      // держателя не имеют — деньги ушли или решение отменено.
      participant.depositHolderUserId =
        status === 'forfeited' ? userId : null;
      await manager.save(participant);

      return this.buildView(manager, trip, userId);
    });

    this.events.emitFinance(String(tripId), userId);
    return view;
  }

  /**
   * «Перевести залог» — участник переводит его организатору (17.11.2026,
   * v3 — 18.11.2026).
   *
   * Заказчик: «Перевод организатору — это „залог за участие“ в движении,
   * у организатора соответственно уменьшается баланс, теперь он должен».
   * Поэтому это не отметка, а **ожидающий перевод** в `trip_compensations`
   * с `kind = 'deposit'`. Получатель подтверждает его кнопкой «Получено»
   * (тот же механизм, что у компенсации), и только тогда балансы двигаются:
   * у отправителя плюс, у организатора минус.
   *
   * **Сумма — недостача, но её можно менять (v3).** Заказчик: «в модалке
   * перевода подставим недостающую сумму, её конечно же можно изменить
   * на любую». Переводов до покрытия может быть несколько: залог
   * докладывают частями.
   *
   * `fromUserId` — за человека без аккаунта, которого ведёт смотрящий:
   * у виртуального нет входа, и залог за него передаёт ведущий. Это и есть
   * ответ на «у меня есть виртуальные друзья, а кнопки не вижу».
   */
  async transferDeposit(
    userId: string,
    tripId: number,
    recipientUserId: string,
    amountRub: number,
    fromUserId?: string,
  ): Promise<TripFinanceDto> {
    const view = await this.dataSource.transaction(async (manager) => {
      const trip = await this.trips.getVisibleTrip(userId, tripId);

      if (trip.depositRub === null || trip.depositRub <= 0) {
        throw new BadRequestException('У этого похода нет залога');
      }

      const senderId = fromUserId ?? userId;
      await this.assertCanActFor(
        manager,
        String(trip.id),
        userId,
        senderId,
      );

      const sender = await manager.findOne(TripParticipant, {
        where: { tripId: String(trip.id), userId: senderId },
        relations: { user: true },
      });

      if (sender === null || (sender.status !== 'going' && sender.status !== 'maybe')) {
        throw new ForbiddenException('Залог переводит участник похода');
      }

      // Покрытие: оплаченные расходы человека плюс подтверждённые переводы
      // (v3, 18.11.2026). Пока недостача не закрыта, переводить можно
      // частями; отправленное, но ещё не подтверждённое бронирует остаток,
      // чтобы человек не отправил ту же сумму второй раз.
      const coverage = await this.depositCoverageOf(
        manager,
        String(trip.id),
        trip.depositRub,
        senderId,
      );

      if (coverage.coveredRub >= trip.depositRub) {
        throw new BadRequestException('Залог уже покрыт — переводить нечего');
      }

      if (coverage.dueRub <= 0) {
        throw new BadRequestException(
          'Залог уже переведён или ждёт подтверждения',
        );
      }

      const participants = await this.loadDepositParticipants(manager, trip);
      const recipients = await this.depositRecipients(
        manager,
        trip,
        participants,
        senderId,
      );

      if (
        !recipients.some(
          (recipient) => recipient.userId === recipientUserId,
        )
      ) {
        throw new BadRequestException(
          'Залог переводится организатору похода',
        );
      }

      await manager.save(
        manager.create(TripCompensation, {
          tripId: String(trip.id),
          fromUserId: senderId,
          toUserId: recipientUserId,
          // Сумма произвольная: в модалке подставлена недостача, но её
          // можно изменить, в том числе в бо́льшую сторону — «с запасом».
          // Излишек при подтверждении станет обычным переводом.
          amountRub,
          kind: 'deposit',
          status: 'pending',
          confirmedAt: null,
        }),
      );

      return this.buildView(manager, trip, userId);
    });

    this.events.emitFinance(String(tripId), userId);
    return view;
  }

  /**
   * Кого экран показывает в балансах: идущие плюс все остальные с ненулевым
   * балансом (17.11.2026, уточнено 20.11.2026).
   *
   * Вышедший из похода остаётся в расчётах: у него могут быть доли расходов
   * и удержанный залог, и группа должна видеть и то и другое. `finance.md`
   * §2.2 говорит то же про долги ушедшего: «группа видит его баланс».
   * Нулевых вышедших не показываем — строка «Борис 0 ₽» ничего не добавляет,
   * а вкладку он уже не откроет (403).
   *
   * **С 20.11.2026 правило шире `declined`.** Человек, который перешёл из
   * `going` в `maybe` или `helping`, тоже остаётся в балансах, пока с ним
   * не рассчитались: его доля расходов никуда не делась. Рассчитались
   * в ноль — строки нет, но движение средств помнит переводы.
   */
  private membersView(
    going: readonly TripParticipant[],
    others: readonly TripParticipant[],
    balances: ReadonlyMap<string, number>,
    remaining: ReadonlyMap<string, number>,
    managedIds: ReadonlySet<string>,
  ): FinanceMemberDto[] {
    const withMoney = others.filter(
      (participant) => (balances.get(participant.userId) ?? 0) !== 0,
    );

    return [...going, ...withMoney].map((participant) => ({
      userId: participant.userId,
      displayName: participant.user?.displayName ?? '',
      avatarUrl: participant.user?.avatarUrl ?? null,
      balanceRub: balances.get(participant.userId) ?? 0,
      remainingRub: remaining.get(participant.userId) ?? 0,
      isVirtual: participant.user?.isVirtual === true,
      managedByMe: managedIds.has(participant.userId),
      paymentDetails: participant.user?.paymentDetails ?? null,
      paymentBank: participant.user?.paymentBank ?? null,
    }));
  }

  /**
   * С человеком ещё не рассчитались? `false` — «расчёт закрыт» (20.11.2026).
   *
   * Закрыт он тогда, когда сошлись **оба** нуля: подтверждённый баланс
   * (деньги уже переведены) и остаток с ожидающими переводами (в пути
   * ничего не висит). Пока висит хотя бы ожидающий перевод, ушедший ещё
   * в «Балансах»: исход перевода неизвестен.
   */
  private hasOpenMoney(
    userId: string,
    balances: ReadonlyMap<string, number>,
    remaining: ReadonlyMap<string, number>,
  ): boolean {
    return (
      (balances.get(userId) ?? 0) !== 0 ||
      (remaining.get(userId) ?? 0) !== 0
    );
  }

  /** Расходы с долями и именами плюс компенсации с людьми — два запроса. */
  private async loadMoney(
    manager: EntityManager,
    tripId: string,
  ): Promise<{
    expenses: TripExpense[];
    compensations: TripCompensation[];
  }> {
    const [expenses, compensations] = await Promise.all([
      manager.find(TripExpense, {
        where: { tripId },
        relations: { author: true, shares: { user: true } },
        order: { spentAt: 'DESC', id: 'DESC' },
      }),
      manager.find(TripCompensation, {
        where: { tripId },
        relations: { fromUser: true, toUser: true },
        order: { createdAt: 'DESC', id: 'DESC' },
      }),
    ]);

    return { expenses, compensations };
  }

  private async goingParticipants(
    manager: EntityManager,
    tripId: string,
  ): Promise<TripParticipant[]> {
    return manager.find(TripParticipant, {
      where: { tripId, status: 'going' },
      relations: { user: true },
      // Порядок состава: от него зависит, кому достанется рубль остатка,
      // и в каком порядке имена внутри семьи. Второй ключ — `userId`:
      // у людей, добавленных одним действием, `createdAt` совпадает
      // до миллисекунды, и без второго ключа порядок прыгал между запросами.
      order: { createdAt: 'ASC', userId: 'ASC' },
    });
  }

  /**
   * Идущие участники, разложенные по семьям, в порядке состава.
   *
   * Компоненту родства считает `UsersService` — правило «семья — это
   * компонента связей» живёт в одном месте. Здесь она обрезается по составу
   * похода: родной, который не идёт, получать перевод не может, и его
   * кредит не должен увеличивать сумму варианта.
   */
  private async goingFamilies(
    manager: EntityManager,
    participants: TripParticipant[],
  ): Promise<string[][]> {
    const ids = participants.map((item) => item.userId);
    const components = await this.users.familyComponentsOf(ids, manager);

    const groups: string[][] = [];
    const seen = new Set<string>();

    for (const userId of ids) {
      if (seen.has(userId)) continue;

      const component = new Set(components.get(userId) ?? [userId]);
      const group = ids.filter((id) => component.has(id));
      for (const id of group) seen.add(id);

      groups.push(group);
    }

    return groups;
  }

  /** Проверить участника похода: в составе и не отказался. */
  private async assertParticipant(
    manager: EntityManager,
    tripId: string,
    userId: string,
  ): Promise<void> {
    const count = await manager.count(TripParticipant, {
      where: { tripId, userId, status: Not('declined') },
    });

    if (count === 0) {
      throw new ForbiddenException('Это доступно только участнику похода');
    }
  }

  /**
   * Прежние чеки завершённого похода не правятся и не удаляются (20.11.2026).
   *
   * Заказчик: «Бухгалтерия — новые расходные чеки, доли, компенсации и
   * судьба залогов, потому что расчёты ещё идут. Прежние чеки не правятся
   * и не удаляются». Поэтому закрыты ровно две ручки — правка и удаление;
   * создание (в том числе пачкой из офлайн-очереди), компенсации и залог
   * работают, иначе после возвращения не закрыть расчёты.
   */
  private assertExpenseEditable(trip: Trip): void {
    if (trip.completedAt === null) return;

    throw new ConflictException(
      'Поход завершён: прежние чеки не правятся и не удаляются. Добавить новый чек можно',
    );
  }

  /** Деньги правит только идущий: приглашённый ещё не тратил. */
  private async assertGoing(
    manager: EntityManager,
    tripId: string,
    userId: string,
  ): Promise<void> {
    const count = await manager.count(TripParticipant, {
      where: { tripId, userId, status: 'going' },
    });

    if (count === 0) {
      throw new ForbiddenException(
        'Деньги похода может менять только идущий участник',
      );
    }
  }

  /**
   * «Этот человек из моей семьи?» — для прав подтверждения и отмены.
   *
   * Семья платит одним кошельком: папа, отправивший перевод за сына, должен
   * иметь право его отменить, а родной получателя — подтвердить получение.
   * Правило то же, что у подсказок, — компонента родства.
   */
  private async isFamilyOf(
    manager: EntityManager,
    otherUserId: string,
    userId: string,
  ): Promise<boolean> {
    if (otherUserId === userId) return true;

    const component = await this.users.familyComponent(otherUserId, manager);

    return component.some((person) => person.id === userId);
  }

  /**
   * «Этого человека без аккаунта веду я?» — для платежей и переводов.
   *
   * С 12.11.2026 у виртуального нет входа, поэтому записать за него платёж
   * или компенсацию может только тот, кто его завёл. Чужой виртуальный
   * и настоящий человек — нет: за настоящего он сам.
   */
  private async isManagedVirtual(
    manager: EntityManager,
    otherUserId: string,
    userId: string,
  ): Promise<boolean> {
    if (otherUserId === userId) return true;

    const participant = await manager.findOne(TripParticipant, {
      where: { userId: otherUserId },
      relations: { user: true },
    });

    return (
      participant?.user?.isVirtual === true &&
      participant.user.virtualOwnerUserId === userId
    );
  }

  /** Можно ли записать действие за этого человека: за себя или за своего виртуального. */
  private async assertCanActFor(
    manager: EntityManager,
    tripId: string,
    actorId: string,
    targetUserId: string,
  ): Promise<void> {
    if (targetUserId === actorId) return;

    const participant = await manager.findOne(TripParticipant, {
      where: { tripId, userId: targetUserId, status: 'going' },
      relations: { user: true },
    });

    if (
      !participant ||
      participant.user?.isVirtual !== true ||
      participant.user.virtualOwnerUserId !== actorId
    ) {
      throw new ForbiddenException(
        'Действовать можно только за себя или за своего человека без аккаунта',
      );
    }
  }

  /** Расход человека без аккаунта правит и удаляет тот, кто его ведёт. */
  private async canManageExpense(
    manager: EntityManager,
    expense: TripExpense,
    userId: string,
  ): Promise<boolean> {
    if (expense.authorUserId === userId) return true;

    return this.isManagedVirtual(manager, expense.authorUserId, userId);
  }

  /**
   * Доли по способу деления.
   *
   * `all` — все идущие, `commonEaters` — идущие, которые едят с общего
   * (`eatsSeparately = false`): кнопка «Чек» в «Питании» делит именно так.
   * `group` — только выбранные, причём в порядке состава: остаток от
   * деления не должен зависеть от порядка галочек в модалке.
   */
  private sharesFor(
    dto: SaveTripExpenseDto,
    participants: TripParticipant[],
  ): ShareAmount[] {
    const goingIds = participants.map((item) => item.userId);

    let userIds: string[];
    if (dto.split === 'all') {
      userIds = goingIds;
    } else if (dto.split === 'commonEaters') {
      userIds = participants
        .filter((item) => !item.eatsSeparately)
        .map((item) => item.userId);
      if (userIds.length === 0) {
        throw new BadRequestException(
          'В походе нет питающихся с общего — чек делить не на кого',
        );
      }
    } else {
      const chosen = dto.participantIds ?? [];
      if (chosen.length === 0) {
        throw new BadRequestException(
          'Выбери, на кого разделить расход',
        );
      }
      const unknown = chosen.filter((id) => !goingIds.includes(id));
      if (unknown.length > 0) {
        throw new BadRequestException(
          'В расходе есть человек, который не идёт в этом походе',
        );
      }
      userIds = goingIds.filter((id) => chosen.includes(id));
    }

    return splitAmount(dto.amountRub, userIds);
  }

  /**
   * Описание расхода: пустое допустимо только для чека из «Питания» —
   * там по смыслу это «на продукты». Для обычного расхода «за что»
   * обязательно: без него в таблице не понять арифметику.
   */
  private descriptionFor(dto: SaveTripExpenseDto): string {
    const text = (dto.description ?? '').trim();

    if (text.length > 0) return text;
    if (dto.split === 'commonEaters') return 'на продукты';

    throw new BadRequestException('Опиши, за что расход');
  }

  /**
   * Создать строку расхода и её доли; `true` — строка действительно новая.
   *
   * Общая часть онлайн-создания и синхронизации очереди (19.11.2026):
   * правила одни и те же, и вторая копия разошлась бы с первой на первой
   * правке. Уже существующий `clientId` — не ошибка, а повторная отправка:
   * возвращаем `false`, чтобы синхронизация пометила чек принятым.
   */
  private async insertExpense(
    manager: EntityManager,
    trip: Trip,
    userId: string,
    dto: SaveTripExpenseDto,
  ): Promise<boolean> {
    if (dto.clientId !== undefined) {
      const existing = await manager.findOne(TripExpense, {
        where: { tripId: String(trip.id), clientId: dto.clientId },
      });
      if (existing) return false;
    }

    const payerId = dto.payerUserId ?? userId;
    await this.assertCanActFor(manager, String(trip.id), userId, payerId);

    const participants = await this.goingParticipants(manager, String(trip.id));
    const shares = this.sharesFor(dto, participants);

    const expense = manager.create(TripExpense, {
      tripId: String(trip.id),
      authorUserId: payerId,
      amountRub: dto.amountRub,
      description: this.descriptionFor(dto),
      split: dto.split,
      spentAt: dto.spentAt ?? todayIso(),
      clientId: dto.clientId ?? null,
    });
    const saved = await manager.save(expense);

    await this.saveShares(manager, saved.id, shares);

    return true;
  }

  private async saveShares(
    manager: EntityManager,
    expenseId: string,
    shares: ShareAmount[],
  ): Promise<void> {
    const rows = shares.map((share) =>
      manager.create(TripExpenseShare, {
        expenseId,
        userId: share.userId,
        amountRub: share.amountRub,
      }),
    );

    if (rows.length > 0) await manager.save(rows);
  }

  // ─────────────────── ушедший и деньги (20.11.2026) ───────────────────

  /**
   * Что человек видит перед выходом из похода (20.11.2026).
   *
   * Уведомление двухшаговое: сначала снаряжение, потом деньги. Состав
   * первого шага — **задействованное снаряжение**, а не весь рюкзак:
   * «взял / несёт» — вещи похода, где он несущий, «в палатке» — место
   * в палатке на маршруте. Эти вещи после выхода освобождаются: вещь
   * остаётся в походе и ждёт нового несущего ([trips.service] `updateMyStatus`).
   *
   * Деньги — покрытие залога и остаток сверх него. `covered = 0` — о деньгах
   * не говорим вовсе; `covered > D` — предупреждаем, что переведут остальное.
   */
  async departureInfo(
    userId: string,
    tripId: number,
  ): Promise<TripDepartureDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);

    const participant = await manager.findOne(TripParticipant, {
      where: { tripId: String(trip.id), userId },
    });
    if (!participant) {
      throw new NotFoundException('Ты не в составе этого похода');
    }

    const gearRows = (await manager.query(
      `SELECT DISTINCT gt."name" AS "name"
         FROM "trip_gear" tg
         JOIN "gear_items" gi ON gi."id" = tg."gear_item_id"
         JOIN "gear_types" gt ON gt."id" = gi."gear_type_id"
        WHERE tg."trip_id" = $1
          AND tg."assigned_user_id" = $2
          AND tg."status" <> 'declined'
        ORDER BY gt."name"`,
      [String(trip.id), userId],
    )) as Array<{ name: string }>;

    // Место в палатке — не строка `trip_gear`: оно живёт отдельно и держит
    // палатку по `tent_gear_id`. Тип берём у самой палатки, а не пишем
    // «Палатка» строкой: справочник типов правится заказчиком.
    const tentRows = (await manager.query(
      `SELECT DISTINCT gt."name" AS "name"
         FROM "trip_route_lodgers" l
         JOIN "trip_gear" tg
           ON tg."trip_id" = l."trip_id" AND tg."id" = l."tent_gear_id"
         JOIN "gear_items" gi ON gi."id" = tg."gear_item_id"
         JOIN "gear_types" gt ON gt."id" = gi."gear_type_id"
        WHERE l."trip_id" = $1 AND l."user_id" = $2
        ORDER BY gt."name"`,
      [String(trip.id), userId],
    )) as Array<{ name: string }>;

    const gearTypes = [...new Set([...gearRows, ...tentRows].map((row) => row.name))];

    const amountRub = trip.depositRub ?? 0;
    let deposit: TripDepartureDto['deposit'] = null;
    let coveredRub = 0;

    if (amountRub > 0) {
      const coverage = await this.depositCoverageOf(
        manager,
        String(trip.id),
        amountRub,
        userId,
      );
      coveredRub = coverage.coveredRub;
      deposit = {
        amountRub,
        coveredRub: coverage.coveredRub,
        holdRub: Math.min(amountRub, coverage.coveredRub),
        refundRub: Math.max(0, coverage.coveredRub - amountRub),
      };
    } else {
      // Залога нет, а вложения есть: второй шаг уведомления всё равно нужен
      // («расходы компенсируют участники»). Считаем только оплаченные
      // расходы — переводить залог без залога некуда.
      const rows = (await manager.query(
        `SELECT COALESCE(SUM("amount_rub"), 0)::int AS "invested"
           FROM "trip_expenses"
          WHERE "trip_id" = $1 AND "author_user_id" = $2`,
        [String(trip.id), userId],
      )) as Array<{ invested: number }>;
      coveredRub = Number(rows[0]?.invested ?? 0);
    }

    return { gearTypes, coveredRub, deposit };
  }

  /**
   * Личное сообщение о переводе (20.11.2026; всем получателям — 24.11.2026).
   *
   * Сначала так уведомляли только ушедшего: вкладку «Бухгалтерия» он уже не
   * откроет. Заказчик распространил сценарий на всех — уведомление с
   * кнопкой «Подтверждаю» и полем «сообщение отправителю» должно приходить
   * каждому получателю перевода. Состояние ответа — в `message_actions`,
   * ссылка на компенсацию в `payload` (схему не меняем, миграции нет).
   *
   * Чат создаётся, если его ещё нет: пара хранится отсортированной, как
   * в `ConversationsService.openDirect`.
   */
  private async postCompensationMessage(
    manager: EntityManager,
    trip: Trip,
    senderId: string,
    compensation: TripCompensation,
    senderName: string,
    senderGender: string | null | undefined,
  ): Promise<void> {
    const conversation = await this.directConversationOf(
      manager,
      senderId,
      compensation.toUserId,
    );

    const action = await manager.save(
      manager.create(MessageAction, {
        kind: 'money_received',
        targetUserId: compensation.toUserId,
        payload: {
          tripId: String(trip.id),
          compensationId: compensation.id,
          amountRub: compensation.amountRub,
          fromUserId: senderId,
        },
        state: 'pending',
      }),
    );

    await manager.insert(Message, {
      conversationId: conversation.id,
      senderId,
      body: moneyMessageText(
        compensation.amountRub,
        tripNameOf(trip),
        senderName,
        senderGender,
      ),
      actionId: action.id,
    });
  }

  /**
   * Личный диалог пары — найти или открыть.
   *
   * Пара хранится отсортированной (`direct_a < direct_b`). Строки состава
   * чиним на месте, как `openDirect`: у личного диалога доступ — это и есть
   * состав.
   */
  private async directConversationOf(
    manager: EntityManager,
    firstUserId: string,
    secondUserId: string,
  ): Promise<Conversation> {
    const [a, b] = [firstUserId, secondUserId].sort();

    const existing = await manager.findOne(Conversation, {
      where: { kind: 'direct', directA: a, directB: b },
    });

    if (existing) {
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

    const created = await manager.save(
      manager.create(Conversation, { kind: 'direct', directA: a, directB: b }),
    );

    await manager.insert(ConversationMember, [
      { conversationId: created.id, userId: a },
      { conversationId: created.id, userId: b },
    ]);

    return created;
  }

  /**
   * Автосогласие через 72 часа (20.11.2026; для всех получателей — 24.11.2026).
   *
   * Проверяется при чтении вкладки, а не кроном: планировщика в проекте нет,
   * а расчёт обязан сойтись тогда, когда на него смотрят. Сначала так
   * закрывались только переводы **ушедшим**; заказчик распространил срок на
   * всех: «Борис ушёл в другой поход, был оффлайн и не подтвердил перевод —
   * транзакция завершается успешно». Идущий тоже может не открыть вкладку
   * трое суток, и висящий перевод не должен держать расчёт.
   *
   * Ответ «не получено» (`disputed`) автосогласие отменяет: человек уже
   * сказал, что денег нет, и молча подтверждать за него нельзя — строка
   * остаётся `pending`, пока отправитель не разберётся.
   *
   * **Уведомление переписывается, а не дополняется** (24.11.2026): заказчик
   * просил, чтобы вместо просьбы подтвердить в личном диалоге лежало
   * объяснение «время вышло, перевод засчитан». Кнопок к этому моменту нет —
   * `message_actions` уже `confirmed`, — но текст должен объяснить, почему.
   *
   * `true` — что-то подтвердилось, и вызывающему стоит разослать SSE.
   */
  private async settleExpiredCompensations(
    manager: EntityManager,
    trip: Trip,
  ): Promise<boolean> {
    const tripId = String(trip.id);
    const pending = await manager.find(TripCompensation, {
      where: { tripId, status: 'pending', kind: 'compensation' },
    });
    if (pending.length === 0) return false;

    const deadline = Date.now() - AUTO_CONFIRM_MS;
    let settled = false;

    for (const row of pending) {
      if (row.createdAt.getTime() > deadline) continue;

      const actions = (await manager.query(
        `SELECT "id", "state" FROM "message_actions"
          WHERE "kind" = 'money_received'
            AND "payload"->>'compensationId' = $1
          ORDER BY "id" DESC
          LIMIT 1`,
        [String(row.id)],
      )) as Array<{ id: string; state: string }>;

      if (actions[0]?.state === 'disputed') continue;

      // Время подтверждения — конец срока, а не «сейчас»: дата в ленте
      // должна объяснять, когда расчёт закрылся, а не когда его посмотрели.
      row.status = 'confirmed';
      row.confirmedAt = new Date(row.createdAt.getTime() + AUTO_CONFIRM_MS);
      await manager.save(row);

      if (actions[0] === undefined) {
        settled = true;
        continue;
      }

      await manager.query(
        `UPDATE "message_actions"
            SET "state" = 'confirmed', "responded_at" = now(), "updated_at" = now()
          WHERE "id" = $1`,
        [actions[0].id],
      );

      // Текст собираем заново, а не правим суффикс: у части уведомлений
      // лежит прежняя формулировка, а заказчик назвал новую дословно.
      const sender = await this.users.findById(row.fromUserId);
      const body =
        moneyMessageText(
          row.amountRub,
          tripNameOf(trip),
          sender?.displayName ?? '',
          sender?.gender,
        ) + MONEY_SETTLED_TAIL;

      await manager.query(
        `UPDATE "messages" SET "body" = $2 WHERE "action_id" = $1`,
        [actions[0].id, body],
      );

      settled = true;
    }

    return settled;
  }
}
