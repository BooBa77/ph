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
  CompensationSenderDto,
  FinanceFamilyDto,
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
  familyBalance,
  familyCredit,
  familyDebt,
  joinNames,
  remainingFromEntities,
  splitAmount,
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
      if (!(await this.canManageExpense(manager, expense, userId))) {
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
   * **Платит семья, и касса у неё общая (12.11.2026).** Заказчик:
   * «сумма к компенсации рассчитывается от семьи… проще — папа платит
   * за всех», а потом уточнил, что это общая касса: «компенсация семье
   * любому её члену, и „платит семья“ при компенсации другим участникам».
   * Поэтому `toUserId` — любой человек семьи получателя, а сумма проверяется
   * против **чистого остатка** всей своей семьи и всей семьи получателя.
   *
   * **Одно действие — один перевод.** Баланс теперь семейный, поэтому
   * раскладывать сумму по личным долгам не нужно: получателю подтверждать
   * одну строку, а не три. Личные остатки остаются в базе как внутренняя
   * арифметика семьи и на экране не показываются.
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

    // Общая касса семьи (12.11.2026): одна строка на семью, а не на человека.
    // Внутри семьи плюс одного гасит минус другого — это и есть «общий
    // кошелёк»; на экране балансы показываются по кассам.
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
      // Мой личный остаток — внутренняя арифметика семьи. Экран показывает
      // кассу: `familyBalanceRub`, а не эту цифру.
      familyBalanceRub: familyBalance(balances, myFamily),
      familyRemainingRub: familyBalance(remaining, myFamily),
      // Долг и кредит кассы: по ним экран объясняет, почему «Компенсация»
      // выключена, когда личный остаток ничего не говорит.
      familyDebtRub: familyDebt(remaining, myFamily),
      familyCreditRub: familyCredit(remaining, myFamily),
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
      isVirtual: participant.user.isVirtual === true,
      managedByMe: managedIds.has(participant.userId),
      paymentDetails: participant.user.paymentDetails,
      paymentBank: participant.user.paymentBank,
    }));

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
