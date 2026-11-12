import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, Not } from 'typeorm';

import {
  CompensationOptionDto,
  FinanceMemberDto,
  MyFinanceDto,
  SaveTripExpenseDto,
  TripCompensationDto,
  TripExpenseDto,
  TripFinanceDto,
} from './dto/trip-finance.dto';
import { TripCompensation } from './entities/trip-compensation.entity';
import { TripExpense } from './entities/trip-expense.entity';
import { TripExpenseShare } from './entities/trip-expense-share.entity';
import { TripParticipant } from './entities/trip-participant.entity';
import {
  balancesFromEntities,
  compensationOptions,
  remainingFromEntities,
  splitAmount,
  type ShareAmount,
} from './finance';
import { TripEventsService } from './trip-events.service';
import { TripsService } from './trips.service';

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
  ) {}

  /** Вся вкладка: расходы, компенсации, балансы и мои подсказки. */
  async getView(userId: string, tripId: number): Promise<TripFinanceDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, String(trip.id), userId);

    return this.buildView(manager, String(trip.id), userId);
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

      const participants = await this.goingParticipants(manager, String(trip.id));
      const shares = this.sharesFor(dto, participants);

      const expense = manager.create(TripExpense, {
        tripId: String(trip.id),
        authorUserId: userId,
        amountRub: dto.amountRub,
        description: this.descriptionFor(dto),
        split: dto.split,
        spentAt: dto.spentAt ?? todayIso(),
      });
      const saved = await manager.save(expense);

      await this.saveShares(manager, saved.id, shares);

      return this.buildView(manager, String(trip.id), userId);
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
      if (expense.authorUserId !== userId) {
        throw new ForbiddenException('Править расход может только автор');
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

      return this.buildView(manager, String(trip.id), userId);
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
      if (expense.authorUserId !== userId) {
        throw new ForbiddenException('Удалить расход может только автор');
      }

      await manager.delete(TripExpense, { id: expense.id });

      return this.buildView(manager, String(trip.id), userId);
    });

    this.events.emitFinance(String(tripId), userId);
    return view;
  }

  /**
   * Создать ожидающую компенсацию: «я перевёл тебе столько».
   *
   * Должник — только сам человек: перевести за другого значило бы
   * подписаться чужими деньгами. Сумма не больше остатка долга и не
   * больше кредита получателя: подсказка в модалке считается так же,
   * а «на рубль больше» — это уже подарок, а не расчёт.
   */
  async createCompensation(
    userId: string,
    tripId: number,
    toUserId: string,
    amountRub: number,
  ): Promise<TripFinanceDto> {
    const view = await this.dataSource.transaction(async (manager) => {
      const trip = await this.trips.getVisibleTrip(userId, tripId);
      await this.assertGoing(manager, String(trip.id), userId);

      if (toUserId === userId) {
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
      const remaining = remainingFromEntities(
        expenses,
        compensations,
        participants.map((item) => item.userId),
      );

      const debt = -(remaining.get(userId) ?? 0);
      if (debt <= 0) {
        throw new BadRequestException('Вам не нужно ничего компенсировать');
      }

      const credit = remaining.get(toUserId) ?? 0;
      if (credit <= 0) {
        throw new BadRequestException('Этому человеку вы ничего не должны');
      }
      if (amountRub > debt) {
        throw new BadRequestException(
          `Больше вашего остатка долга: осталось ${debt} ₽`,
        );
      }
      if (amountRub > credit) {
        throw new BadRequestException(
          `Больше, чем вы должны этому человеку: ${credit} ₽`,
        );
      }

      const compensation = manager.create(TripCompensation, {
        tripId: String(trip.id),
        fromUserId: userId,
        toUserId,
        amountRub,
        status: 'pending',
        confirmedAt: null,
      });
      await manager.save(compensation);

      return this.buildView(manager, String(trip.id), userId);
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
      if (compensation.toUserId !== userId) {
        throw new ForbiddenException(
          'Подтвердить получение может только получатель',
        );
      }

      if (compensation.status === 'pending') {
        compensation.status = 'confirmed';
        compensation.confirmedAt = new Date();
        await manager.save(compensation);
      }

      return this.buildView(manager, String(trip.id), userId);
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
      if (compensation.fromUserId !== userId) {
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

      return this.buildView(manager, String(trip.id), userId);
    });

    this.events.emitFinance(String(tripId), userId);
    return view;
  }

  // ─────────────────────────── сборка вкладки ───────────────────────────

  private async buildView(
    manager: EntityManager,
    tripId: string,
    viewerId: string,
  ): Promise<TripFinanceDto> {
    const { expenses, compensations } = await this.loadMoney(manager, tripId);
    const participants = await this.goingParticipants(manager, tripId);
    const memberIds = participants.map((item) => item.userId);

    const balances = balancesFromEntities(expenses, compensations, memberIds);
    const remaining = remainingFromEntities(expenses, compensations, memberIds);

    const userById = new Map(
      participants.map((participant) => [participant.userId, participant.user]),
    );

    const suggestions: CompensationOptionDto[] = compensationOptions(
      viewerId,
      remaining,
      memberIds,
    ).map((option) => {
      const user = userById.get(option.userId);
      return {
        userId: option.userId,
        displayName: user?.displayName ?? '',
        amountRub: option.amountRub,
        paymentDetails: user?.paymentDetails ?? null,
        paymentBank: user?.paymentBank ?? null,
      };
    });

    const me: MyFinanceDto = {
      balanceRub: balances.get(viewerId) ?? 0,
      remainingRub: remaining.get(viewerId) ?? 0,
      // Приглашённый видит вкладку, но ещё не тратил: экран по этому флагу
      // выключает кнопки. Проверка прав остаётся на сервере (`assertGoing`).
      canSpend: memberIds.includes(viewerId),
      suggestions,
    };

    const members: FinanceMemberDto[] = participants.map((participant) => ({
      userId: participant.userId,
      displayName: participant.user.displayName,
      avatarUrl: participant.user.avatarUrl,
      balanceRub: balances.get(participant.userId) ?? 0,
      remainingRub: remaining.get(participant.userId) ?? 0,
      paymentDetails: participant.user.paymentDetails,
      paymentBank: participant.user.paymentBank,
    }));

    return {
      expenses: expenses.map((expense) =>
        TripExpenseDto.from(expense, viewerId),
      ),
      compensations: compensations.map((compensation) =>
        TripCompensationDto.from(compensation, viewerId),
      ),
      members,
      me,
    };
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
      // Порядок состава: от него зависит, кому достанется рубль остатка.
      order: { createdAt: 'ASC' },
    });
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
          'Выберите, на кого разделить расход',
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

    throw new BadRequestException('Опишите, за что расход');
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
