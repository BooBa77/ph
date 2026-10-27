import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import {
  AddTransferPassengerDto,
  CreateTransferLegDto,
  TransferLegDto,
  TransferPassengerDto,
  TransferTravelerDto,
  TripTransferDto,
  UpdateTransferLegDto,
} from './dto/trip-transfer.dto';
import { TripTransferLeg } from './entities/trip-transfer-leg.entity';
import { TripTransferPassenger } from './entities/trip-transfer-passenger.entity';
import { TripParticipant } from './entities/trip-participant.entity';
import { Vehicle } from './entities/vehicle.entity';
import { Trip } from './entities/trip.entity';
import {
  TRANSFER_PERSONAL_MODES,
  TRANSFER_PUBLIC_MODES,
  TRANSFER_ROUND_TRIP_COMPENSATIONS,
  TRANSFER_TAB,
  type TransferCompensation,
  type TransferMode,
  type TransferPassengerStatus,
} from './trip-transfer.types';
import { TripsService } from './trips.service';

/**
 * «Трансфер» — вкладка подготовки похода (`docs/ph/transfer.md`).
 *
 * Вторая редакция (27.10.2026): карточка перемещения — это и есть транспорт.
 * Способ доставки, время, откуда и куда, места, владелец и компенсация
 * живут в одной строке; машины отдельной сущностью больше нет.
 *
 * ## Правила доступа
 *
 * | Действие | Кто |
 * |---|---|
 * | видеть вкладку | любой участник похода, кроме `declined` |
 * | создать карточку | любой участник: свой транспорт — с флагом «наше ТС», рейс — без флага |
 * | флаг «наше ТС» | только право на вкладку (организатор, роль) |
 * | править и убрать карточку | право на вкладку или владелец этого ТС |
 * | присоединиться | участник, который идёт: на рейс — сразу, на чужое ТС — заявкой |
 * | принять заявку, посадить другого | владелец ТС или право на вкладку |
 * | уйти | сам человек, в любом статусе |
 *
 * «Владелец принимает» — решение заказчика 27.10.2026: место в чужой машине
 * даёт тот, чья это машина, а не организатор. На рейсе спрашивать некого —
 * там билет, поэтому заявок нет.
 *
 * ## Компенсация
 *
 * `free` — безвозмездно; `ticket` — цена билета (только рейсы);
 * `shared` — общий расход; `sharedPerPassenger` — общий расход на пассажиров.
 * У общих расходов бывает флаг «туда-обратно». Проверки дублируют CHECK-и
 * базы, но с понятным текстом: 400, а не 500 от ограничения.
 */
@Injectable()
export class TripTransferService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly trips: TripsService,
  ) {}

  // ───────────────────────────── чтение ─────────────────────────────

  /** Вкладка целиком. Видят участники похода; гость её не видит вообще. */
  async getPlan(userId: string, tripId: number): Promise<TripTransferDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);

    return this.buildPlan(manager, trip, userId);
  }

  // ───────────────────────────── карточки ─────────────────────────────

  /**
   * Новая карточка перемещения.
   *
   * Участник заводит **свой** транспорт: флаг «наше ТС» и владелец
   * проставляются сами. Рейс (автобус, ж/д, корабль, вертолёт) он тоже
   * может завести — нашёл, купил, знает время, — но без флага: владельца
   * у рейса в группе нет. Флаг вручную ставит только тот, кому роль дала
   * вкладку.
   */
  async createLeg(
    userId: string,
    tripId: number,
    dto: CreateTransferLegDto,
  ): Promise<TripTransferDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);

    const canEditTab = await this.trips.canEditTab(userId, trip, TRANSFER_TAB);

    /**
     * Транспорт из каталога: способ, места и владелец берутся оттуда.
     * Это и есть «выбором из имеющихся, а не заполнением полей».
     */
    const vehicle =
      dto.vehicleId != null
        ? await this.vehicleOrFail(manager, userId, dto.vehicleId)
        : null;

    const mode = vehicle?.mode ?? dto.mode;

    const { isOwnVehicle, ownerUserId } = vehicle
      ? { isOwnVehicle: true, ownerUserId: userId }
      : this.resolveOwnership({ ...dto, mode }, userId, canEditTab);

    if (isOwnVehicle) {
      await this.assertTraveler(manager, trip.id, ownerUserId as string);
    }

    const amount =
      dto.compensation === 'free' ? null : (dto.compensationAmountRub ?? null);
    const isRoundTrip = dto.isRoundTrip ?? false;

    this.assertCompensation(mode, dto.compensation, amount, isRoundTrip);

    const last = await manager.findOne(TripTransferLeg, {
      where: { tripId: trip.id, direction: dto.direction },
      order: { position: 'DESC', id: 'DESC' },
    });

    const leg = await manager.save(
      manager.create(TripTransferLeg, {
        tripId: trip.id,
        direction: dto.direction,
        position: (last?.position ?? 0) + 1,
        mode,
        departsAt: new Date(dto.departsAt),
        fromPlace: this.place(dto.fromPlace, 'Откуда'),
        toPlace: this.place(dto.toPlace, 'Докуда'),
        isOwnVehicle,
        ownerUserId,
        seats: vehicle ? vehicle.seats : (dto.seats ?? null),
        vehicleId: vehicle?.id ?? null,
        compensation: dto.compensation,
        compensationAmountRub: amount,
        isRoundTrip,
        note: this.note(dto.note),
      }),
    );

    // Владелец едет в своём ТС: место он занимает, и «присоединяться»
    // к собственной машине ему нечего.
    if (ownerUserId !== null) {
      await manager.insert(TripTransferPassenger, {
        tripId: trip.id,
        legId: leg.id,
        userId: ownerUserId,
        status: 'accepted',
      });
    }

    return this.buildPlan(manager, trip, userId);
  }

  /**
   * Правка карточки: право вкладки или владелец этого ТС.
   *
   * Проверяется **итог**, а не патч: карточка «своё авто с общим расходом»
   * при `mode: 'bus'` перестаёт быть законной и без флага, и без
   * компенсации, поэтому 400 с текстом, а не 500 от CHECK.
   */
  async updateLeg(
    userId: string,
    tripId: number,
    legId: number,
    dto: UpdateTransferLegDto,
  ): Promise<TripTransferDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);

    const leg = await this.legOrFail(manager, trip.id, legId);
    const canEditTab = await this.trips.canEditTab(userId, trip, TRANSFER_TAB);

    if (leg.ownerUserId !== userId && !canEditTab) {
      throw new ForbiddenException(
        'Карточку правит тот, кто ведёт трансфер, или владелец этого ТС',
      );
    }

    const mode = dto.mode ?? leg.mode;

    /** Выбрали транспорт из каталога — способ и места берутся оттуда. */
    const vehicle =
      dto.vehicleId != null
        ? await this.vehicleOrFail(manager, userId, dto.vehicleId)
        : null;

    let isOwnVehicle = vehicle !== null ? true : leg.isOwnVehicle;
    let ownerUserId = vehicle !== null ? userId : leg.ownerUserId;
    let vehicleId =
      dto.vehicleId === undefined ? leg.vehicleId : (vehicle?.id ?? null);
    let seats =
      vehicle !== null
        ? vehicle.seats
        : dto.seats !== undefined
          ? dto.seats
          : leg.seats;

    const effectiveMode = vehicle?.mode ?? mode;

    /**
     * Флаг и владельца меняет только право вкладки. Владелец своей карточки
     * присылает их же без изменений (форма отправляет всё, что знает) —
     * это не попытка что-то поменять, и 403 тут был бы ошибкой.
     */
    const flagChanged =
      dto.isOwnVehicle !== undefined && dto.isOwnVehicle !== leg.isOwnVehicle;
    const ownerChanged =
      dto.ownerUserId !== undefined && dto.ownerUserId !== leg.ownerUserId;

    if ((flagChanged || ownerChanged) && !canEditTab && vehicle === null) {
      throw new ForbiddenException(
        'Флаг «наше ТС» и владельца меняет организатор или тот, кому роль дала вкладку',
      );
    }

    if (vehicle === null && flagChanged) {
      isOwnVehicle = dto.isOwnVehicle === true;

      if (isOwnVehicle) {
        ownerUserId = dto.ownerUserId ?? leg.ownerUserId ?? userId;
        await this.assertTraveler(manager, trip.id, ownerUserId);
      } else {
        ownerUserId = null;
      }
    } else if (vehicle === null && ownerChanged) {
      if (!isOwnVehicle) {
        throw new BadRequestException(
          'Владелец бывает только у своего ТС — у рейса его нет',
        );
      }

      ownerUserId = dto.ownerUserId ?? null;
      if (ownerUserId !== null) {
        await this.assertTraveler(manager, trip.id, ownerUserId);
      }
    }

    if (isOwnVehicle && !this.isPersonalMode(effectiveMode)) {
      throw new BadRequestException(
        'У рейса (автобус, ж/д, корабль, вертолёт) не бывает владельца — снимите «наше ТС» или смените способ',
      );
    }

    const compensation = dto.compensation ?? leg.compensation;
    const amount =
      dto.compensationAmountRub !== undefined
        ? dto.compensationAmountRub
        : leg.compensationAmountRub;
    const isRoundTrip = dto.isRoundTrip ?? leg.isRoundTrip;

    this.assertCompensation(
      effectiveMode,
      compensation,
      compensation === 'free' ? null : amount,
      isRoundTrip,
    );

    /**
     * Сторона меняется — карточка встаёт в конец новой области: порядок
     * в «Обратно» свой, и сохранять номер из «Туда» значило бы поставить
     * её в середину чужого списка.
     */
    if (dto.direction !== undefined && dto.direction !== leg.direction) {
      const last = await manager.findOne(TripTransferLeg, {
        where: { tripId: trip.id, direction: dto.direction },
        order: { position: 'DESC', id: 'DESC' },
      });
      leg.direction = dto.direction;
      leg.position = (last?.position ?? 0) + 1;
    }

    leg.mode = effectiveMode;
    if (dto.departsAt !== undefined) leg.departsAt = new Date(dto.departsAt);
    if (dto.fromPlace !== undefined) leg.fromPlace = this.place(dto.fromPlace, 'Откуда');
    if (dto.toPlace !== undefined) leg.toPlace = this.place(dto.toPlace, 'Докуда');
    leg.isOwnVehicle = isOwnVehicle;
    leg.ownerUserId = isOwnVehicle ? ownerUserId : null;
    leg.seats = seats;
    leg.vehicleId = vehicleId;
    leg.compensation = compensation;
    leg.compensationAmountRub = compensation === 'free' ? null : amount;
    leg.isRoundTrip = isRoundTrip;
    if (dto.note !== undefined) leg.note = this.note(dto.note);

    await manager.save(leg);

    // Сменился владелец — он должен оказаться пассажиром своей карточки.
    if (leg.ownerUserId !== null) {
      await this.placePassenger(manager, trip.id, leg.id, leg.ownerUserId, 'accepted');
    }

    return this.buildPlan(manager, trip, userId);
  }

  /** Убрать карточку: право вкладки или владелец ТС. */
  async removeLeg(
    userId: string,
    tripId: number,
    legId: number,
  ): Promise<TripTransferDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);

    const leg = await this.legOrFail(manager, trip.id, legId);
    await this.assertCanManageLeg(trip, userId, leg);

    await manager.delete(TripTransferLeg, { id: leg.id });

    return this.buildPlan(manager, trip, userId);
  }

  // ───────────────────────────── пассажиры ─────────────────────────────

  /**
   * Присоединиться к карточке.
   *
   * На рейс — сразу (`accepted`): билет куплен, спрашивать некого.
   * На чужое ТС — заявкой (`requested`): владелец решает, кого везёт.
   * На своё ТС владелец уже в списке, повторно не садится.
   */
  async join(
    userId: string,
    tripId: number,
    legId: number,
  ): Promise<TripTransferDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);
    await this.assertTraveler(manager, trip.id, userId);

    const leg = await this.legOrFail(manager, trip.id, legId);

    const existing = await manager.findOne(TripTransferPassenger, {
      where: { legId: leg.id, userId },
    });
    if (existing) {
      throw new ConflictException('Вы уже в этой карточке');
    }

    const status: TransferPassengerStatus = leg.isOwnVehicle
      ? 'requested'
      : 'accepted';

    if (status === 'accepted') await this.assertFreeSeat(manager, leg);

    await manager.insert(TripTransferPassenger, {
      tripId: trip.id,
      legId: leg.id,
      userId,
      status,
    });

    return this.buildPlan(manager, trip, userId);
  }

  /**
   * Посадить другого человека: владелец ТС или право вкладки.
   *
   * `status` по умолчанию `accepted` — владелец сажает сам и сразу.
   * `requested` — «попросился, реши»: заявку потом принимают той же ручкой.
   */
  async addPassenger(
    userId: string,
    tripId: number,
    legId: number,
    dto: AddTransferPassengerDto,
  ): Promise<TripTransferDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);

    const leg = await this.legOrFail(manager, trip.id, legId);
    await this.assertCanManageLeg(trip, userId, leg);
    await this.assertTraveler(manager, trip.id, dto.userId);

    const existing = await manager.findOne(TripTransferPassenger, {
      where: { legId: leg.id, userId: dto.userId },
    });
    if (existing) {
      throw new ConflictException('Этот человек уже в карточке');
    }

    const status = dto.status ?? 'accepted';
    if (status === 'accepted') await this.assertFreeSeat(manager, leg);

    await manager.insert(TripTransferPassenger, {
      tripId: trip.id,
      legId: leg.id,
      userId: dto.userId,
      status,
    });

    return this.buildPlan(manager, trip, userId);
  }

  /**
   * Принять заявку: владелец ТС или право вкладки.
   *
   * Принятие — это и есть посадка, поэтому место проверяется здесь:
   * заявку можно подать и в полную машину, а принять — уже нет.
   */
  async acceptPassenger(
    userId: string,
    tripId: number,
    legId: number,
    targetUserId: string,
  ): Promise<TripTransferDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);

    const leg = await this.legOrFail(manager, trip.id, legId);
    await this.assertCanManageLeg(trip, userId, leg);

    const row = await manager.findOne(TripTransferPassenger, {
      where: { legId: leg.id, userId: targetUserId },
    });
    if (!row) throw new NotFoundException('Этот человек не в этой карточке');

    if (row.status === 'accepted') {
      return this.buildPlan(manager, trip, userId);
    }

    await this.assertFreeSeat(manager, leg);

    row.status = 'accepted';
    await manager.save(row);

    return this.buildPlan(manager, trip, userId);
  }

  /**
   * Уйти самому или убрать человека: себя — в любом статусе (это и есть
   * «пассажир может отказаться»), другого — владелец ТС или право вкладки.
   */
  async removePassenger(
    userId: string,
    tripId: number,
    legId: number,
    targetUserId: string,
  ): Promise<TripTransferDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);

    const leg = await this.legOrFail(manager, trip.id, legId);

    if (targetUserId !== userId) {
      await this.assertCanManageLeg(trip, userId, leg);
    }

    const row = await manager.findOne(TripTransferPassenger, {
      where: { legId: leg.id, userId: targetUserId },
    });
    if (!row) throw new NotFoundException('Этот человек не в этой карточке');

    if (leg.ownerUserId === targetUserId) {
      throw new BadRequestException(
        'Владелец своего ТС уходит вместе с карточкой — уберите её целиком',
      );
    }

    await manager.delete(TripTransferPassenger, { id: row.id });

    return this.buildPlan(manager, trip, userId);
  }

  // ───────────────────────────── сборка ответа ─────────────────────────────

  /**
   * Вкладка целиком: карточки двух сторон, пассажиры, заявки.
   *
   * `joinStatus` считается здесь, а не на клиенте: правило «рейс — сразу,
   * чужое ТС — заявкой» одно, и вторая его копия на фронте разошлась бы
   * с первой при первой же правке.
   */
  private async buildPlan(
    manager: EntityManager,
    trip: Trip,
    userId: string,
  ): Promise<TripTransferDto> {
    const [legs, passengers, members, canEdit] = await Promise.all([
      manager.find(TripTransferLeg, {
        where: { tripId: trip.id },
        relations: { owner: { user: true }, vehicle: true },
        order: { direction: 'ASC', position: 'ASC', id: 'ASC' },
      }),
      manager.find(TripTransferPassenger, {
        where: { tripId: trip.id },
        relations: { member: { user: true } },
        order: { id: 'ASC' },
      }),
      manager.find(TripParticipant, {
        where: { tripId: trip.id, status: 'going' },
        relations: { user: true },
      }),
      this.trips.canEditTab(userId, trip, TRANSFER_TAB),
    ]);

    const going = new Set(members.map((member) => member.userId));

    const passengersByLeg = new Map<string, TripTransferPassenger[]>();
    for (const passenger of passengers) {
      const list = passengersByLeg.get(passenger.legId) ?? [];
      list.push(passenger);
      passengersByLeg.set(passenger.legId, list);
    }

    const legDtos = legs.map((leg): TransferLegDto => {
      const inLeg = passengersByLeg.get(leg.id) ?? [];
      const accepted = inLeg.filter((person) => person.status === 'accepted');
      const mine = inLeg.find((person) => person.userId === userId) ?? null;

      const joinStatus: TransferPassengerStatus | null =
        mine !== null || !going.has(userId)
          ? null
          : leg.isOwnVehicle
            ? 'requested'
            : 'accepted';

      return {
        id: leg.id,
        direction: leg.direction,
        position: leg.position,
        mode: leg.vehicle?.mode ?? leg.mode,
        departsAt: leg.departsAt.toISOString(),
        fromPlace: leg.fromPlace,
        toPlace: leg.toPlace,
        isOwnVehicle: leg.isOwnVehicle,
        ownerUserId: leg.ownerUserId,
        ownerName: leg.owner?.user?.displayName ?? null,
        seats: leg.vehicle?.seats ?? leg.seats,
        vehicleId: leg.vehicleId,
        vehicleTitle: leg.vehicle?.title ?? null,
        occupied: accepted.length,
        compensation: leg.compensation,
        compensationAmountRub: leg.compensationAmountRub,
        isRoundTrip: leg.isRoundTrip,
        note: leg.note,
        canEdit: canEdit || leg.ownerUserId === userId,
        joinStatus,
        passengers: inLeg.map(
          (passenger): TransferPassengerDto => ({
            userId: passenger.userId,
            displayName: passenger.member?.user?.displayName ?? 'Участник',
            status: passenger.status,
          }),
        ),
      };
    });

    const travelers = members
      .map(
        (member): TransferTravelerDto => ({
          userId: member.userId,
          displayName: member.user?.displayName ?? 'Участник',
        }),
      )
      .sort((left, right) => left.displayName.localeCompare(right.displayName, 'ru'));

    return { canEdit, travelers, legs: legDtos };
  }

  // ───────────────────────────── проверки ─────────────────────────────

  /**
   * Чей это транспорт: флаг и владелец при создании.
   *
   * Участнику флаг не подчиняется: свой транспорт он заводит только как
   * «наше ТС», а рейс — только без флага. Флаг вручную — право вкладки.
   */
  private resolveOwnership(
    dto: CreateTransferLegDto,
    userId: string,
    canEditTab: boolean,
  ): { isOwnVehicle: boolean; ownerUserId: string | null } {
    const personal = this.isPersonalMode(dto.mode);

    if (!canEditTab) {
      if (dto.isOwnVehicle === true) {
        throw new ForbiddenException(
          'Флаг «наше ТС» ставит организатор или тот, кому роль дала вкладку',
        );
      }

      // Свой транспорт — сразу с флагом; рейс — без владельца.
      return personal
        ? { isOwnVehicle: true, ownerUserId: userId }
        : { isOwnVehicle: false, ownerUserId: null };
    }

    const isOwnVehicle = dto.isOwnVehicle ?? false;

    if (!isOwnVehicle) {
      return { isOwnVehicle: false, ownerUserId: null };
    }

    if (!personal) {
      throw new BadRequestException(
        'У рейса (автобус, ж/д, корабль, вертолёт) не бывает «нашего ТС»',
      );
    }

    return {
      isOwnVehicle: true,
      ownerUserId: dto.ownerUserId ?? userId,
    };
  }

  /** Компенсация: что с чем сочетается и когда нужна сумма. */
  private assertCompensation(
    mode: TransferMode,
    compensation: TransferCompensation,
    amount: number | null,
    isRoundTrip: boolean,
  ): void {
    const ticketAllowed = this.isPublicMode(mode);

    if (compensation === 'ticket' && !ticketAllowed) {
      throw new BadRequestException(
        'Цена билета бывает только у рейсов: автобус, ж/д, корабль, вертолёт',
      );
    }

    if (
      (compensation === 'shared' || compensation === 'sharedPerPassenger') &&
      ticketAllowed
    ) {
      throw new BadRequestException(
        'У рейса расход общий не бывает — там билет или безвозмездно',
      );
    }

    if (
      isRoundTrip &&
      !(TRANSFER_ROUND_TRIP_COMPENSATIONS as readonly string[]).includes(compensation)
    ) {
      throw new BadRequestException(
        '«Туда-обратно» бывает только у общих расходов',
      );
    }

    if (compensation === 'free') return;

    if (amount === null || amount <= 0) {
      throw new BadRequestException(
        'Укажите сумму компенсации — без неё непонятно, сколько с кого',
      );
    }
  }

  private isPersonalMode(mode: TransferMode): boolean {
    return (TRANSFER_PERSONAL_MODES as readonly string[]).includes(mode);
  }

  private isPublicMode(mode: TransferMode): boolean {
    return (TRANSFER_PUBLIC_MODES as readonly string[]).includes(mode);
  }

  /**
   * Участник похода — или 403. `declined` не участник: он в подготовке
   * не участвует (то же правило, что у снаряжения и чатов).
   */
  private async assertParticipant(
    manager: EntityManager,
    tripId: string,
    userId: string,
  ): Promise<TripParticipant> {
    const participant = await manager.findOne(TripParticipant, {
      where: { tripId, userId },
    });

    if (!participant || participant.status === 'declined') {
      throw new ForbiddenException(
        'Трансфер похода доступен только его участникам',
      );
    }

    return participant;
  }

  /** Карточку правит право вкладки или владелец этого ТС. */
  private async assertCanManageLeg(
    trip: Trip,
    userId: string,
    leg: TripTransferLeg,
  ): Promise<void> {
    if (leg.ownerUserId === userId) return;

    if (!(await this.trips.canEditTab(userId, trip, TRANSFER_TAB))) {
      throw new ForbiddenException(
        'Карточку правит тот, кто ведёт трансфер, или владелец этого ТС',
      );
    }
  }

  /**
   * Кого можно посадить: только «иду».
   *
   * «Пока не решил» место не занимает (то же правило, что у груза
   * в снаряжении): иначе место досталось бы тому, кто может не поехать.
   */
  private async assertTraveler(
    manager: EntityManager,
    tripId: string,
    userId: string,
  ): Promise<void> {
    const participant = await manager.findOne(TripParticipant, {
      where: { tripId, userId },
    });

    if (!participant || participant.status !== 'going') {
      throw new BadRequestException(
        'В карточку сажают только тех, кто идёт: «пока не решил» место не занимает',
      );
    }
  }

  /** Свободное место. Места не указаны — потолка нет. */
  private async assertFreeSeat(
    manager: EntityManager,
    leg: TripTransferLeg,
  ): Promise<void> {
    if (leg.seats === null) return;

    const occupied = await manager.count(TripTransferPassenger, {
      where: { legId: leg.id, status: 'accepted' },
    });

    if (occupied >= leg.seats) {
      throw new BadRequestException('В этом транспорте нет свободных мест');
    }
  }

  /** Поставить человека в карточку, не падая на повторной вставке. */
  private async placePassenger(
    manager: EntityManager,
    tripId: string,
    legId: string,
    userId: string,
    status: TransferPassengerStatus,
  ): Promise<void> {
    const row = await manager.findOne(TripTransferPassenger, {
      where: { legId, userId },
    });

    if (row) {
      row.status = status;
      await manager.save(row);
      return;
    }

    await manager.insert(TripTransferPassenger, {
      tripId,
      legId,
      userId,
      status,
    });
  }

  private async legOrFail(
    manager: EntityManager,
    tripId: string,
    legId: number,
  ): Promise<TripTransferLeg> {
    const leg = await manager.findOne(TripTransferLeg, {
      where: { id: String(legId), tripId },
    });

    if (!leg) throw new NotFoundException('Карточка трансфера не найдена');

    return leg;
  }

  /**
   * Транспорт из **своего** каталога или 404: чужих в каталоге нет,
   * и выбирать чужую машину на вкладке нечего.
   */
  private async vehicleOrFail(
    manager: EntityManager,
    userId: string,
    vehicleId: number,
  ): Promise<Vehicle> {
    const vehicle = await manager.findOne(Vehicle, {
      where: { id: String(vehicleId), ownerUserId: userId },
    });

    if (!vehicle) {
      throw new NotFoundException('Транспорт не найден в вашем каталоге');
    }

    return vehicle;
  }

  private place(value: string, field: string): string {
    const place = value.trim();

    if (place.length === 0) {
      throw new BadRequestException(`${field} — не пустое: это точка маршрута`);
    }

    return place;
  }

  private note(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;

    const note = value.trim();

    return note.length === 0 ? null : note;
  }
}
