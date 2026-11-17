import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In, Not } from 'typeorm';

import {
  CompensationOptionDto,
  CompensationSenderDto,
  DepositParticipantDto,
  DepositRecipientDto,
  DepositSummaryDto,
  FinanceFamilyDto,
  FinanceMemberDto,
  MyDepositDto,
  MyFinanceDto,
  SaveTripExpenseDto,
  TripCompensationDto,
  TripDepositDto,
  TripDepositForfeitDto,
  TripExpenseDto,
  TripFinanceDto,
} from './dto/trip-finance.dto';
import { TripCompensation } from './entities/trip-compensation.entity';
import { TripDepositAdjustment } from './entities/trip-deposit-adjustment.entity';
import { TripExpense } from './entities/trip-expense.entity';
import { TripExpenseShare } from './entities/trip-expense-share.entity';
import { TripParticipant } from './entities/trip-participant.entity';
import { TripParticipantRole } from './entities/trip-participant-role.entity';
import { Trip } from './entities/trip.entity';
import { Role } from './entities/role.entity';
import { COORGANIZER_ROLE_CODE } from './trip-tabs';
import {
  ORGANIZER_ROLE_CODE,
  type DepositStatus,
} from './trip.types';
import {
  balancesFromEntities,
  compensationOptions,
  familyBalance,
  familyCredit,
  familyDebt,
  joinNames,
  remainingFromEntities,
  splitAmount,
  type BalanceAdjustment,
  type ShareAmount,
} from './finance';
import { TripEventsService } from './trip-events.service';
import { TripsService } from './trips.service';
import { UsersService } from '../users/users.service';

/** Сегодняшняя дата строкой `ГГГГ-ММ-ДД` (сервер живёт в UTC). */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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
    private readonly users: UsersService,
  ) {}

  /** Вся вкладка: расходы, компенсации, балансы и мои подсказки. */
  async getView(userId: string, tripId: number): Promise<TripFinanceDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, String(trip.id), userId);

    return this.buildView(manager, trip, userId);
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
      });
      const saved = await manager.save(expense);

      await this.saveShares(manager, saved.id, shares);

      return this.buildView(manager, trip, userId);
    });

    this.events.emitFinance(String(tripId), userId);
    return view;
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
    const view = await this.dataSource.transaction(async (manager) => {
      const trip = await this.trips.getVisibleTrip(userId, tripId);
      await this.assertGoing(manager, String(trip.id), userId);

      // «Папа платит за всех» и «я веду Дядю Витю»: отправителем может быть
      // человек без аккаунта, но действует всегда вошедший участник.
      const senderId = fromUserId ?? userId;
      await this.assertCanActFor(manager, String(trip.id), userId, senderId);

      if (toUserId === senderId) {
        throw new BadRequestException('Перевести компенсацию самому себе нельзя');
      }

      const participants = await this.goingParticipants(manager, String(trip.id));
      if (!participants.some((item) => item.userId === toUserId)) {
        throw new BadRequestException('Получатель не идёт в этом походе');
      }

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
      const targetFamily = families.find((group) =>
        group.includes(toUserId),
      ) ?? [toUserId];

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

      await manager.save(
        manager.create(TripCompensation, {
          tripId: String(trip.id),
          fromUserId: senderId,
          // Получатель — любой человек семьи: касса у неё одна, а строка
          // хранит, кому именно перевели (и кто сможет подтвердить —
          // подтвердить может любой родной, см. `buildView`).
          toUserId,
          amountRub,
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
      await this.assertGoing(manager, String(trip.id), userId);

      // `FOR UPDATE`: два устройства могут подтвердить одновременно,
      // и без блокировки оба записали бы одно и то же время.
      const compensation = await manager.findOne(TripCompensation, {
        where: { id: String(compensationId), tripId: String(trip.id) },
        lock: { mode: 'pessimistic_write' },
      });
      if (!compensation) throw new NotFoundException('Компенсация не найдена');
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

      return this.buildView(manager, trip, userId);
    });

    this.events.emitFinance(String(tripId), userId);
    return view;
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

    // Удержанные залоги двигают балансы (17.11.2026): заказчик назвал
    // удержание доходом фонда группы. Это отдельные строки, а не расходы:
    // у источника сумма отрицательная, у идущих — его доля.
    const adjustments = await manager.find(TripDepositAdjustment, {
      where: { tripId },
      relations: { sourceUser: true, user: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const adjustmentRows: BalanceAdjustment[] = adjustments.map((row) => ({
      userId: row.userId,
      amountRub: row.amountRub,
    }));

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
      participants.map((participant) => [participant.userId, participant.user]),
    );

    // Семья — компонента связей; в походе важны только идущие, поэтому
    // группа фильтруется по составу, а порядок внутри неё — порядок состава.
    const families = await this.goingFamilies(manager, participants);
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
      compensationOptions(senderId, remaining, families).map((option) => {
        const people = option.userIds.map((userId) => userById.get(userId)!);

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
      });

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
      suggestions,
    };

    const members: FinanceMemberDto[] = await this.visibleMembers(
      manager,
      tripId,
      participants,
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
      deposit: await this.buildDeposit(manager, trip, viewerId, expenses),
      depositForfeits: this.buildDepositForfeits(adjustments),
    };
  }

  /**
   * Блок залога: сумма, счётчики и **секция риска** (17.11.2026).
   *
   * `null` — залога нет, и на экране нет ничего: пустой блок «Залог: 0 ₽»
   * только сбивал бы с толку.
   *
   * Список — не весь состав, а только те, с кем организатору ещё что-то
   * делать (слова заказчика): **отказавшиеся** (решить, вернуть залог или
   * удержать) и **не вложившие сумму залога** (`investedRub` меньше суммы).
   * Кто залог уже перевёл или потратился на поход не меньше залога —
   * в списке не показываются, «экономим пространство»: их видно
   * в счётчиках шапки.
   */
  private async buildDeposit(
    manager: EntityManager,
    trip: Trip,
    viewerId: string,
    expenses: readonly TripExpense[],
  ): Promise<TripDepositDto | null> {
    if (trip.depositRub === null || trip.depositRub <= 0) return null;

    const amountRub = trip.depositRub;
    const participants = await this.loadDepositParticipants(manager, trip);
    const inTrip = participants.filter(
      (participant) =>
        participant.status === 'going' || participant.status === 'maybe',
    );

    // «Вложился» — сколько человек уже оплатил расходов похода. Залог
    // закрывает риск потерять эти деньги, поэтому не вложивших сумму
    // залога организатору видно отдельно.
    const invested = new Map<string, number>();
    for (const expense of expenses) {
      invested.set(
        expense.authorUserId,
        (invested.get(expense.authorUserId) ?? 0) + expense.amountRub,
      );
    }

    const rows = participants.map((participant) =>
      this.depositRow(participant, viewerId, invested.get(participant.userId) ?? 0),
    );

    const declined = rows.filter((row) => row.declined);
    const uncovered = rows.filter(
      (row) =>
        !row.declined &&
        row.status === 'pending' &&
        row.investedRub < amountRub,
    );

    const count = (status: DepositStatus): number =>
      inTrip.filter((participant) => participant.depositStatus === status)
        .length;

    const summary: DepositSummaryDto = {
      total: inTrip.length,
      // Доли удержания делятся по идущим: «пока думаю» ещё может отказаться.
      going: inTrip.filter((participant) => participant.status === 'going')
        .length,
      held: count('held'),
      returned: count('returned'),
      forfeited: count('forfeited'),
      pending: count('pending'),
      // Наличные на руках считаются по всем, включая отказавшихся: их залог
      // у организатора остаётся, пока он не решил, что с ним делать.
      cashRub:
        participants.filter(
          (participant) => participant.depositStatus === 'held',
        ).length * amountRub,
    };

    const recipients = await this.depositRecipients(
      manager,
      trip,
      participants,
      viewerId,
    );

    const mine = participants.find(
      (participant) => participant.userId === viewerId,
    );
    const me: MyDepositDto | null =
      mine !== undefined &&
      (mine.status === 'going' || mine.status === 'maybe')
        ? {
            status: mine.depositStatus,
            amountRub,
            canTransfer:
              mine.depositStatus === 'pending' && recipients.length > 0,
            holderName: mine.depositHolderUser?.displayName ?? null,
          }
        : null;

    return {
      amountRub,
      canManage: trip.organizerUserId === viewerId,
      summary,
      me,
      // Отказавшиеся — первыми: ради них секция и существует.
      participants: [...declined, ...uncovered],
      // Полный список — только по запросу «Показать всех»: ошибочную
      // отметку организатор должен уметь снять, а место на экране
      // заказчик просил экономить.
      allParticipants: rows,
      recipients,
    };
  }

  /** Строка участника для секции залога. */
  private depositRow(
    participant: TripParticipant,
    viewerId: string,
    investedRub: number,
  ): DepositParticipantDto {
    return {
      userId: participant.userId,
      displayName: participant.user?.displayName ?? '',
      avatarUrl: participant.user?.avatarUrl ?? null,
      status: participant.depositStatus,
      updatedByName: participant.depositUpdatedByUser?.displayName ?? null,
      updatedAt: participant.depositUpdatedAt?.toISOString() ?? null,
      isMe: participant.userId === viewerId,
      investedRub,
      holderName: participant.depositHolderUser?.displayName ?? null,
      declined: participant.status === 'declined',
    };
  }

  /**
   * Участники, с которыми работает залог: идущие, «пока думаю» и вышедшие.
   *
   * Вышедшие нужны с 17.11.2026: их залог уже у организатора, и решать его
   * судьбу — «Вернуть» или «Удержать» — тоже организатору.
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
        status: In(['going', 'maybe', 'declined']),
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
   * Организатор, который сам идёт, отмечает свой залог кнопкой «Сдал».
   */
  private async depositRecipients(
    manager: EntityManager,
    trip: Trip,
    participants: readonly TripParticipant[],
    viewerId: string,
  ): Promise<DepositRecipientDto[]> {
    const roleRows = await manager.find(TripParticipantRole, {
      where: { tripId: String(trip.id) },
    });

    const roles = await manager.find(Role, {
      where: { code: In([ORGANIZER_ROLE_CODE, COORGANIZER_ROLE_CODE]) },
    });
    const coOrganizerRoleIds = new Set(
      roles
        .filter((role) => role.code === COORGANIZER_ROLE_CODE)
        .map((role) => role.id),
    );
    const coOrganizerIds = new Set(
      roleRows
        .filter((row) => coOrganizerRoleIds.has(row.roleId))
        .map((row) => row.userId),
    );

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
      if (!coOrganizerIds.has(participant.userId)) continue;
      if (participant.status !== 'going' && participant.status !== 'maybe') {
        continue;
      }

      recipients.push(this.toDepositRecipient(participant, 'coOrganizer'));
    }

    return recipients;
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
   * Удержания залогов для ленты «Движения денег» (17.11.2026).
   *
   * Строки удержания двигают балансы, поэтому их видно там же, где расходы
   * и переводы: иначе у идущих молча меняются цифры. Одно удержание —
   * одна строка ленты со списком тех, кому достались доли.
   */
  private buildDepositForfeits(
    adjustments: readonly TripDepositAdjustment[],
  ): TripDepositForfeitDto[] {
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
        const amountRub =
          positive.reduce((sum, row) => sum + row.amountRub, 0) ||
          Math.abs(rows.find((row) => row.amountRub < 0)?.amountRub ?? 0);

        return {
          id: `${sourceUserId}-${at.getTime()}`,
          at: at.toISOString(),
          sourceUserId,
          sourceName: rows[0]?.sourceUser?.displayName ?? '',
          amountRub,
          shares: positive.map((row) => ({
            userId: row.userId,
            displayName: row.user?.displayName ?? '',
            amountRub: row.amountRub,
          })),
        };
      })
      .sort((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0));
  }

  /**
   * Создать или снять корректировки баланса от удержания залога.
   *
   * Формула заказчика: «A −залог, каждому идущему +залог/число идущих».
   * Делит `splitAmount`, поэтому остаток от деления по рублю уходит первым
   * по составу — как у долей расхода, и сумма строк всегда ноль.
   *
   * Если идущих нет (все отказались), удерживать не для кого: балансы
   * не трогаем, залог остаётся у организатора.
   */
  private async syncDepositAdjustments(
    manager: EntityManager,
    trip: Trip,
    targetUserId: string,
    status: DepositStatus,
  ): Promise<void> {
    await manager.delete(TripDepositAdjustment, {
      tripId: String(trip.id),
      sourceUserId: targetUserId,
    });

    if (status !== 'forfeited') return;

    const amountRub = trip.depositRub ?? 0;
    if (amountRub <= 0) return;

    const going = await this.goingParticipants(manager, String(trip.id));
    const shares: ShareAmount[] = splitAmount(
      amountRub,
      going.map((participant) => participant.userId),
    );
    if (shares.length === 0) return;

    const deltas = new Map<string, number>();
    deltas.set(targetUserId, -amountRub);
    for (const share of shares) {
      deltas.set(
        share.userId,
        (deltas.get(share.userId) ?? 0) + share.amountRub,
      );
    }

    // У источника-идущего обе строки сходятся в одну: он и теряет залог,
    // и получает свою долю, поэтому пары «минус и плюс» на него не нужно.
    const rows = [...deltas.entries()]
      .filter(([, amount]) => amount !== 0)
      .map(([userId, amount]) =>
        manager.create(TripDepositAdjustment, {
          tripId: String(trip.id),
          sourceUserId: targetUserId,
          userId,
          amountRub: amount,
        }),
      );

    if (rows.length > 0) await manager.save(rows);
  }

  /**
   * Поставить состояние залога участнику (17.11.2026).
   *
   * Отмечает **только организатор**: «сдал» — это факт получения денег,
   * и подтверждает его тот, кому их отдали. Сам участник с 17.11.2026 может
   * только **перевести** залог (`transferDeposit`), а не выставить себе
   * «удержан» или «вернули».
   *
   * Правила по цели:
   * - `invited` — 400: ещё не решил, спрашивать нечего;
   * - `declined` — **можно**, и это главный случай: залог у организатора
   *   остался, и он решает, вернуть его или удержать;
   * - любой другой участник похода — можно, в том числе `maybe`.
   *
   * `forfeited` не просто меняет подпись: он перераспределяет залог между
   * идущими (`syncDepositAdjustments`). Возврат залога или сброс отметки
   * снимает это перераспределение.
   *
   * Сумма залога приходит из похода, а не из тела запроса: одна цифра
   * на всех — её правят в «Правке похода», и второй источник суммы здесь
   * однажды разошёлся бы с первым.
   */
  async setDepositStatus(
    userId: string,
    tripId: number,
    targetUserId: string,
    status: DepositStatus,
  ): Promise<TripFinanceDto> {
    const view = await this.dataSource.transaction(async (manager) => {
      const trip = await this.trips.getVisibleTrip(userId, tripId);

      if (trip.organizerUserId !== userId) {
        throw new ForbiddenException('Отметки о залоге ставит организатор похода');
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

      const previous = participant.depositStatus;

      participant.depositStatus = status;
      participant.depositUpdatedBy = userId;
      participant.depositUpdatedAt = new Date();
      // «Надо сдать» — это новая раздача: прежний держатель больше не при чём.
      if (status === 'pending') participant.depositHolderUserId = null;
      // «Сдал» руками — деньги у того, кто отметил: организатор и есть
      // держатель кассы. Переведённый залог держателя уже знает.
      if (status === 'held' && participant.depositHolderUserId === null) {
        participant.depositHolderUserId = userId;
      }
      await manager.save(participant);

      if (previous !== status) {
        await this.syncDepositAdjustments(manager, trip, targetUserId, status);
      }

      return this.buildView(manager, trip, userId);
    });

    this.events.emitFinance(String(tripId), userId);
    return view;
  }

  /**
   * «Перевести залог» — участник переводит залог организатору (17.11.2026).
   *
   * Заказчик: «прямых переводов между участниками нет; если участник ещё
   * никому не должен и общих расходов не производит, но хочет внести залог,
   * инструментов нет. В этом случае организатор становится частичным
   * держателем кассы». Поэтому кнопка отдельная: она не требует долга
   * (компенсация требует) и не двигает балансы — залог двигает их только
   * в момент удержания.
   *
   * Статус сразу `held`: приложение доверяет группе (как с присутствием
   * и отметками питания), а факт перевода виден организатору в блоке.
   */
  async transferDeposit(
    userId: string,
    tripId: number,
    recipientUserId: string,
  ): Promise<TripFinanceDto> {
    const view = await this.dataSource.transaction(async (manager) => {
      const trip = await this.trips.getVisibleTrip(userId, tripId);

      if (trip.depositRub === null || trip.depositRub <= 0) {
        throw new BadRequestException('У этого похода нет залога');
      }

      const participant = await manager.findOne(TripParticipant, {
        where: { tripId: String(trip.id), userId },
      });

      if (
        participant === null ||
        (participant.status !== 'going' && participant.status !== 'maybe')
      ) {
        throw new ForbiddenException('Залог переводит участник похода');
      }

      if (participant.depositStatus !== 'pending') {
        throw new BadRequestException('Залог уже отмечен — переводить нечего');
      }

      const participants = await this.loadDepositParticipants(manager, trip);
      const recipients = await this.depositRecipients(
        manager,
        trip,
        participants,
        userId,
      );

      if (!recipients.some((recipient) => recipient.userId === recipientUserId)) {
        throw new BadRequestException('Залог переводится организатору похода');
      }

      participant.depositStatus = 'held';
      participant.depositUpdatedBy = userId;
      participant.depositUpdatedAt = new Date();
      participant.depositHolderUserId = recipientUserId;
      await manager.save(participant);

      return this.buildView(manager, trip, userId);
    });

    this.events.emitFinance(String(tripId), userId);
    return view;
  }

  /**
   * Кого экран показывает в балансах: идущие плюс вышедшие с ненулевым
   * балансом (17.11.2026).
   *
   * Вышедший из похода остаётся в расчётах: у него могут быть доли расходов
   * и удержанный залог, и группа должна видеть и то и другое. `finance.md`
   * §2.2 говорит то же про долги ушедшего: «группа видит его баланс».
   * Нулевых вышедших не показываем — строка «Борис 0 ₽» ничего не добавляет,
   * а вкладку он уже не откроет (403).
   */
  private async visibleMembers(
    manager: EntityManager,
    tripId: string,
    going: readonly TripParticipant[],
    balances: ReadonlyMap<string, number>,
    remaining: ReadonlyMap<string, number>,
    managedIds: ReadonlySet<string>,
  ): Promise<FinanceMemberDto[]> {
    const declined = await manager.find(TripParticipant, {
      where: { tripId, status: 'declined' },
      relations: { user: true },
      order: { createdAt: 'ASC', userId: 'ASC' },
    });

    const withMoney = declined.filter(
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
}
