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
  TRANSFER_TAB,
  transferModeOfVehicle,
  type TransferCompensation,
  type TransferDirection,
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
 * Проверки дублируют CHECK-и базы, но с понятным текстом: 400, а не 500
 * от ограничения.
 *
 * ## Заброски
 *
 * Заброска — цепочка этапов из тех же карточек (`chain_id` + `stage`),
 * отдельной сущности у неё нет (28.10.2026). Цепочка **переплетает стороны**:
 * маршрут бывает в один конец, а бывает парой — тогда в нём есть этапы
 * и «туда», и «обратно», и это по-прежнему одна заброска. Единая у них
 * только шкала времени: номер этапа сервис считает сам по отправлению,
 * потому что порядок задаёт дата, а не тип транспорта.
 *
 * ## Пары «туда-обратно»
 *
 * Пар может быть несколько — группа едет на нескольких машинах, и у каждой
 * своя обратная. Пара — это исходная карточка и одно зеркало: оплата у них
 * общая (задаётся на исходной), пассажиры синхронизируются в одну сторону,
 * а обратный выезд не может быть раньше прямого.
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
     * Транспорт из каталога: тип, места и владелец берутся оттуда.
     * Это и есть «выбором из имеющихся, а не заполнением полей».
     */
    const vehicle =
      dto.vehicleId != null
        ? await this.vehicleOrFail(manager, userId, dto.vehicleId)
        : null;

    const mode = vehicle ? this.vehicleMode(vehicle) : dto.mode;

    const { isOwnVehicle, ownerUserId } = vehicle
      ? { isOwnVehicle: true, ownerUserId: userId }
      : this.resolveOwnership({ ...dto, mode }, userId, canEditTab);

    if (isOwnVehicle) {
      await this.assertTraveler(manager, trip.id, ownerUserId as string);
    }

    const amount =
      dto.compensation === 'free' ? null : (dto.compensationAmountRub ?? null);

    this.assertCompensation(mode, dto.compensation, amount);

    const isRoundTrip = dto.isRoundTrip ?? false;
    this.assertRoundTripAllowed(mode, isRoundTrip);

    const chainId = dto.chainId ?? null;

    const last = await manager.findOne(TripTransferLeg, {
      where: { tripId: trip.id, direction: dto.direction },
      order: { position: 'DESC', id: 'DESC' },
    });

    const leg = await manager.save(
      manager.create(TripTransferLeg, {
        tripId: trip.id,
        direction: dto.direction,
        position: (last?.position ?? 0) + 1,
        chainId,
        /**
         * Номер этапа обязателен вместе с цепочкой (CHECK в базе), а
         * настоящий считается ниже — по времени отправления. Единица здесь
         * живёт один запрос и наружу не выходит.
         */
        stage: chainId === null ? null : 1,
        mode,
        departsAt: new Date(dto.departsAt),
        fromPlace: this.place(dto.fromPlace, 'Откуда'),
        toPlace: this.place(dto.toPlace, 'Докуда'),
        isOwnVehicle,
        ownerUserId,
        seats: this.seatsFor(mode, vehicle ? vehicle.seats : (dto.seats ?? null)),
        vehicleId: vehicle?.id ?? null,
        compensation: dto.compensation,
        compensationAmountRub: amount,
        isRoundTrip,
        note: this.note(dto.note),
      }),
    );

    /** Порядок в цепочке задаёт дата: новый этап мог встать в её середину. */
    if (chainId !== null) await this.recomputeStages(manager, trip.id, chainId);

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

    /**
     * «Туда-обратно» — это **пара карточек**: зеркальная встаёт в обратную
     * сторону с теми же людьми. Дальше составы живут врозь: на обратном
     * рейсе людей можно менять, и на прямой это не влияет.
     */
    if (leg.isRoundTrip) await this.createMirror(manager, trip.id, leg);

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

    /** Выбрали транспорт из каталога — тип и места берутся оттуда. */
    const vehicle =
      dto.vehicleId != null
        ? await this.vehicleOrFail(manager, userId, dto.vehicleId)
        : null;

    const effectiveMode = vehicle ? this.vehicleMode(vehicle) : mode;

    let isOwnVehicle = vehicle !== null ? true : leg.isOwnVehicle;
    let ownerUserId = vehicle !== null ? userId : leg.ownerUserId;
    let vehicleId =
      dto.vehicleId === undefined ? leg.vehicleId : (vehicle?.id ?? null);
    let seats = this.seatsFor(
      effectiveMode,
      vehicle !== null
        ? vehicle.seats
        : dto.seats !== undefined
          ? dto.seats
          : leg.seats,
    );

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

    const isRoundTrip = dto.isRoundTrip ?? leg.isRoundTrip;

    /**
     * Зеркало второй парой не бывает: оно пришло из исходной карточки,
     * и флаг на нём означал бы «зеркало зеркала». Правят исходную —
     * на экране у зеркала этого флага и нет.
     */
    if (isRoundTrip && leg.roundTripSourceId !== null) {
      throw new BadRequestException(
        'Это обратная карточка пары «туда-обратно» — флаг ставится на исходной, а не на зеркале',
      );
    }

    // Пара — только у своего и наёмного транспорта, не у рейсов.
    this.assertRoundTripAllowed(effectiveMode, isRoundTrip);

    /**
     * **У пары одна оплата** (уточнение заказчика 28.10.2026): «туда-обратно»
     * связан с деньгами напрямую — стоимость задаётся на исходной карточке
     * и живёт в обоих концах, сколько бы человек ни осталось. Поэтому
     * у зеркала компенсацию не читаем вовсе: что бы в него ни прислали,
     * остаётся то, что стоит на исходной.
     */
    const moneySource =
      leg.roundTripSourceId === null
        ? null
        : await manager.findOne(TripTransferLeg, {
            where: { id: leg.roundTripSourceId },
          });

    const compensation =
      moneySource?.compensation ?? dto.compensation ?? leg.compensation;
    const amount =
      moneySource !== null
        ? moneySource.compensationAmountRub
        : dto.compensationAmountRub !== undefined
          ? dto.compensationAmountRub
          : leg.compensationAmountRub;

    /**
     * У зеркала оплата приходит с исходной карточки, поэтому обычное
     * «смените компенсацию» тут не подсказка: поля этого нет. Если тип
     * транспорта с оплатой не сошёлся, говорим, где её менять.
     */
    if (
      moneySource !== null &&
      !this.compensationFits(effectiveMode, compensation)
    ) {
      throw new BadRequestException(
        'Оплата пары задана на исходной карточке и с этим типом транспорта не сочетается — смените тип здесь или оплату там',
      );
    }

    this.assertCompensation(
      effectiveMode,
      compensation,
      compensation === 'free' ? null : amount,
    );

    const direction = dto.direction ?? leg.direction;

    /**
     * **Заброска может переплетать стороны.** «Маршруты бывают как в один
     * конец, так и парами», и внутри пары этапы идут туда и обратно —
     * дата у них одна шкала, а сторона у каждого своя. Поэтому переводить
     * карточку в другую сторону можно и внутри цепочки: номер этапа
     * пересчитается по времени, и порядок останется верным.
     */
    const previousChainId = leg.chainId;
    const chainId = dto.chainId === undefined ? leg.chainId : dto.chainId;

    /**
     * Сторона меняется — карточка встаёт в конец новой области: порядок
     * в «Обратно» свой, и сохранять номер из «Туда» значило бы поставить
     * её в середину чужого списка.
     */
    if (direction !== leg.direction) {
      const last = await manager.findOne(TripTransferLeg, {
        where: { tripId: trip.id, direction },
        order: { position: 'DESC', id: 'DESC' },
      });
      leg.direction = direction;
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
    leg.chainId = chainId;
    if (chainId === null) leg.stage = null;
    else if (leg.stage === null) leg.stage = 1;
    leg.compensation = compensation;
    leg.compensationAmountRub = compensation === 'free' ? null : amount;
    leg.isRoundTrip = isRoundTrip;
    if (dto.note !== undefined) leg.note = this.note(dto.note);

    // Порядок дат у пары проверяем до записи: 400 не должна оставлять
    // карточку с уже сохранённым неверным временем.
    await this.assertPairOrder(manager, leg);

    await manager.save(leg);

    /**
     * Номер этапа — производное: переставили время или перевели карточку
     * в другую цепочку, и обе нумеруются заново.
     */
    if (leg.chainId !== null) {
      await this.recomputeStages(manager, trip.id, leg.chainId);
    }
    if (previousChainId !== null && previousChainId !== leg.chainId) {
      await this.recomputeStages(manager, trip.id, previousChainId);
    }

    // Сменился владелец — он должен оказаться пассажиром своей карточки.
    if (leg.ownerUserId !== null) {
      await this.placePassenger(manager, trip.id, leg.id, leg.ownerUserId, 'accepted');
    }

    // Флаг «туда-обратно» включили или сняли — зеркало появляется или уходит.
    await this.syncMirrorExistence(manager, trip.id, leg);

    // Оплата у пары одна: задали её на исходной — она же и в зеркале.
    await this.syncMoneyToMirror(manager, leg);

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

    const chainId = leg.chainId;

    await manager.delete(TripTransferLeg, { id: leg.id });

    // Ушёл этап — оставшиеся перенумеровываются: дырок в цепочке не бывает.
    if (chainId !== null) await this.recomputeStages(manager, trip.id, chainId);

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

    /**
     * В зеркало человека не копируем: составы пары не обязаны совпадать.
     * Но если он уже едет и на другом конце, порядок дат проверим — и
     * до вставки, чтобы 400 не оставила его посаженным.
     */
    await this.assertPairOrder(
      manager,
      leg,
      status === 'accepted' ? { userId } : undefined,
    );

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

    await this.assertPairOrder(
      manager,
      leg,
      status === 'accepted' ? { userId: dto.userId } : undefined,
    );

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

    await this.assertPairOrder(manager, leg, { userId: targetUserId });

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

    // Ушёл из «туда» — уходит и из обратного. Обратное на исходное не влияет.
    await this.removeFromMirror(manager, leg, targetUserId);

    return this.buildPlan(manager, trip, userId);
  }

  // ───────────────────────── пара «туда-обратно» ─────────────────────────

  /**
   * Зеркало пары «туда-обратно»: обратная карточка с теми же людьми.
   *
   * Точки меняются местами, тип, места, владелец, техника и компенсация
   * копируются. Время — тоже: обратный выезд человек поправит сам, если
   * он другой, а выдумывать дату за него не наше дело.
   *
   * **В заброску зеркало не входит** (`chainId: null`): заказчик сказал
   * «зеркалится ровно один этап», и цепочку в обратную сторону никто
   * не заводил — она собирается там сама, своими карточками.
   */
  private async createMirror(
    manager: EntityManager,
    tripId: string,
    source: TripTransferLeg,
  ): Promise<void> {
    const direction: TransferDirection =
      source.direction === 'there' ? 'back' : 'there';

    const last = await manager.findOne(TripTransferLeg, {
      where: { tripId, direction },
      order: { position: 'DESC', id: 'DESC' },
    });

    const mirror = await manager.save(
      manager.create(TripTransferLeg, {
        tripId,
        direction,
        position: (last?.position ?? 0) + 1,
        chainId: null,
        stage: null,
        mode: source.mode,
        departsAt: source.departsAt,
        fromPlace: source.toPlace,
        toPlace: source.fromPlace,
        isOwnVehicle: source.isOwnVehicle,
        ownerUserId: source.ownerUserId,
        seats: source.seats,
        vehicleId: source.vehicleId,
        compensation: source.compensation,
        compensationAmountRub: source.compensationAmountRub,
        isRoundTrip: false,
        roundTripSourceId: source.id,
        note: null,
      }),
    );

    const people = await manager.find(TripTransferPassenger, {
      where: { legId: source.id },
    });

    for (const person of people) {
      await manager.insert(TripTransferPassenger, {
        tripId,
        legId: mirror.id,
        userId: person.userId,
        status: person.status,
      });
    }
  }

  private async mirrorOf(
    manager: EntityManager,
    leg: TripTransferLeg,
  ): Promise<TripTransferLeg | null> {
    return manager.findOne(TripTransferLeg, {
      where: { roundTripSourceId: leg.id },
    });
  }

  /**
   * Оплата пары живёт на исходной карточке и повторяется в зеркале.
   *
   * «Туда-обратно» связан с деньгами напрямую: стоимость задаётся один раз
   * и распространяется на оба конца, даже если состав пассажиров изменился.
   * Как делить её по факту — дело «Бухгалтерии», а не этой вкладки.
   */
  private async syncMoneyToMirror(
    manager: EntityManager,
    leg: TripTransferLeg,
  ): Promise<void> {
    if (!leg.isRoundTrip) return;

    const mirror = await this.mirrorOf(manager, leg);
    if (!mirror) return;

    if (
      mirror.compensation === leg.compensation &&
      mirror.compensationAmountRub === leg.compensationAmountRub
    ) {
      return;
    }

    mirror.compensation = leg.compensation;
    mirror.compensationAmountRub = leg.compensationAmountRub;
    await manager.save(mirror);
  }

  /**
   * Обратный выезд не раньше прямого — **по общим пассажирам пары**.
   *
   * Составы у пары не обязаны совпадать: на обратном рейсе людей меняют,
   * и тогда проверять «пару» бессмысленно — обратный выезд вообще может
   * быть раньше прямого, если эти люди едут не туда и обратно, а,
   * например, только назад. Поэтому смотрим на пересечение: у кого в паре
   * оба конца, у того они и должны идти по времени (заказчик: «проверка
   * дат всё-таки на уровне участников»).
   *
   * Равенство разрешено намеренно: зеркало создаётся с временем исходной,
   * и пока обратный выезд не уточнили, даты совпадают. Запрещаем ровно то,
   * что уже ошибка, — возвращение раньше выезда.
   *
   * `coming` — человек, которого только собираются посадить: проверку
   * делаем **до** вставки, иначе 400 осталась бы после уже посаженного
   * пассажира.
   */
  private async assertPairOrder(
    manager: EntityManager,
    leg: TripTransferLeg,
    coming?: { userId: string },
  ): Promise<void> {
    const pair = await this.pairOf(manager, leg);
    if (pair === null) return;

    const [source, mirror] = pair;
    if (mirror.departsAt.getTime() >= source.departsAt.getTime()) return;

    const [going, riding] = await Promise.all([
      manager.find(TripTransferPassenger, {
        where: { legId: source.id, status: 'accepted' },
        relations: { member: { user: true } },
      }),
      manager.find(TripTransferPassenger, {
        where: { legId: mirror.id, status: 'accepted' },
      }),
    ]);

    const ridingIds = new Set(riding.map((row) => row.userId));
    const both = going.filter((row) => ridingIds.has(row.userId));

    /**
     * Сажаемого человека в пересечении ещё нет — он только собирается
     * сесть. Если он уже едет на другом конце, он тоже попадёт в проверку.
     */
    if (
      coming !== undefined &&
      !both.some((row) => row.userId === coming.userId)
    ) {
      const otherLegId = leg.id === source.id ? mirror.id : source.id;

      const other = await manager.findOne(TripTransferPassenger, {
        where: { legId: otherLegId, userId: coming.userId, status: 'accepted' },
        relations: { member: { user: true } },
      });

      if (other !== null) both.push(other);
    }

    // Никто не едет в оба конца — паре нечего проверять.
    if (both.length === 0) return;

    const names = both
      .map((row) => row.member?.user?.displayName ?? 'участник')
      .join(', ');

    throw new BadRequestException(
      `Обратный выезд раньше прямого: ${names} едет и туда, и обратно — поправьте время`,
    );
  }

  /** Исходная карточка пары и её зеркало; `null` — пары нет. */
  private async pairOf(
    manager: EntityManager,
    leg: TripTransferLeg,
  ): Promise<[TripTransferLeg, TripTransferLeg] | null> {
    const source =
      leg.roundTripSourceId === null
        ? leg
        : await manager.findOne(TripTransferLeg, {
            where: { id: leg.roundTripSourceId },
          });

    if (source === null) return null;

    const mirror =
      source.id === leg.id ? await this.mirrorOf(manager, leg) : leg;

    return mirror === null ? null : [source, mirror];
  }

  /**
   * Ушёл из исходной — уходит и из обратной.
   *
   * Единственная синхронизация пассажиров, которая осталась: заказчик
   * 27.10.2026 сказал прямо — «их убирают из исходной карточки, и они
   * исчезают из зеркала». В обратную сторону ничего не идёт: на обратном
   * рейсе людей можно менять, и на прямой это не влияет.
   */
  private async removeFromMirror(
    manager: EntityManager,
    leg: TripTransferLeg,
    userId: string,
  ): Promise<void> {
    if (!leg.isRoundTrip) return;

    const mirror = await this.mirrorOf(manager, leg);
    if (!mirror) return;

    await manager.delete(TripTransferPassenger, { legId: mirror.id, userId });
  }

  /** Флаг включили — зеркало появляется; сняли — уходит. */
  private async syncMirrorExistence(
    manager: EntityManager,
    tripId: string,
    leg: TripTransferLeg,
  ): Promise<void> {
    const mirror = await this.mirrorOf(manager, leg);

    if (leg.isRoundTrip && !mirror) {
      await this.createMirror(manager, tripId, leg);
      return;
    }

    if (!leg.isRoundTrip && mirror) {
      await manager.delete(TripTransferLeg, { id: mirror.id });
    }
  }

  /**
   * Места у рейсов не спрашиваем: у автобуса и поезда место даёт билет,
   * а не салон. У остального — как указали; `NULL` значит «не знаю»,
   * и потолка тогда нет.
   */
  private seatsFor(mode: TransferMode, seats: number | null): number | null {
    return this.isPublicMode(mode) ? null : seats;
  }

  // ───────────────────────────── цепочки ─────────────────────────────

  /**
   * Тип транспорта выбранной техники — или 400.
   *
   * Велосипед в каталоге остался, но этапом заброски быть перестал
   * (28.10.2026): группу с вещами он не возит. Отбиваем с текстом, а не
   * `undefined` в поле «тип».
   */
  private vehicleMode(vehicle: Vehicle): TransferMode {
    const mode = transferModeOfVehicle(vehicle.kind);

    if (mode === null) {
      throw new BadRequestException(
        'Велосипед в «Трансфере» не выбирают: он не возит группу. В «Снаряжении» он остаётся',
      );
    }

    return mode;
  }

  /**
   * Перенумеровать цепочку по времени отправления.
   *
   * `stage` — производное, а не ввод: заказчик сказал, что порядок задаёт
   * дата, и лодка может стоять и между конями, и после них. Поэтому номер
   * считается здесь при каждой записи и разойтись с порядком не может.
   *
   * Сторона в нумерации не участвует — цепочка свободно переплетает «туда»
   * и «обратно»: «маршруты бывают как в один конец, так и парами». Одна
   * шкала времени, номера сквозные, а сторона — свойство каждого этапа.
   */
  private async recomputeStages(
    manager: EntityManager,
    tripId: string,
    chainId: string,
  ): Promise<void> {
    const stages = await manager.find(TripTransferLeg, {
      where: { tripId, chainId },
      order: { departsAt: 'ASC', id: 'ASC' },
    });

    let index = 0;

    for (const leg of stages) {
      index += 1;
      if (leg.stage === index) continue;

      leg.stage = index;
      await manager.save(leg);
    }
  }

  /** Время, по которому цепочка встаёт в общий порядок: её первый этап. */
  private anchorOf(leg: TripTransferLeg, anchors: Map<string, number>): number {
    if (leg.chainId === null) return leg.departsAt.getTime();

    return anchors.get(leg.chainId) ?? leg.departsAt.getTime();
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
        order: { direction: 'ASC', departsAt: 'ASC', id: 'ASC' },
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

    /**
     * **Заброска идёт одним блоком.** Этапы цепочки упорядочены по времени,
     * но между ними могли вклиниться одиночные карточки других людей —
     * группировка по якорю (первому этапу) держит цепочку вместе и при этом
     * не ломает общий порядок по времени.
     */
    const anchors = new Map<string, number>();
    for (const leg of legs) {
      if (leg.chainId === null) continue;
      const time = leg.departsAt.getTime();
      const anchor = anchors.get(leg.chainId);
      if (anchor === undefined || time < anchor) anchors.set(leg.chainId, time);
    }

    const ordered = [...legs].sort((left, right) => {
      if (left.direction !== right.direction) {
        return left.direction === 'there' ? -1 : 1;
      }

      const byTime = this.anchorOf(left, anchors) - this.anchorOf(right, anchors);
      if (byTime !== 0) return byTime;

      const byStage = (left.stage ?? 0) - (right.stage ?? 0);
      if (byStage !== 0) return byStage;

      return Number(left.id) - Number(right.id);
    });

    const legDtos = ordered.map((leg): TransferLegDto => {
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
        chainId: leg.chainId,
        stage: leg.stage,
        mode: leg.vehicle
          ? (transferModeOfVehicle(leg.vehicle.kind) ?? leg.mode)
          : leg.mode,
        departsAt: leg.departsAt.toISOString(),
        fromPlace: leg.fromPlace,
        toPlace: leg.toPlace,
        isOwnVehicle: leg.isOwnVehicle,
        ownerUserId: leg.ownerUserId,
        ownerName: leg.owner?.user?.displayName ?? null,
        seats: leg.vehicle?.seats ?? leg.seats,
        vehicleId: leg.vehicleId,
        vehicleTitle: leg.vehicle?.brand ?? null,
        vehiclePlate: leg.vehicle?.plate ?? null,
        sourceLegId: leg.roundTripSourceId,
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

    /**
     * «Туда-обратно» здесь не проверяется вовсе: флаг про трансфер и про
     * деньги одновременно, но не про вид оплаты (28.10.2026). Раньше он
     * разрешался только у общих расходов, и пара без денег его теряла.
     */
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

  /**
   * «Туда-обратно» бывает всем, кроме общественного транспорта.
   *
   * Заказчик 28.10.2026: «билеты на общественный транспорт — раздельно
   * в каждую сторону; бензин для своего ТС — за два конца; наёмный
   * транспорт — за два конца. Получается, всё, кроме общественного».
   * Поэтому пара разрешена и у своего, и у наёмного транспорта (наёмный —
   * это та же карточка без владельца), а у автобуса, ж/д, корабля
   * и вертолёта её нет.
   */
  private assertRoundTripAllowed(
    mode: TransferMode,
    isRoundTrip: boolean,
  ): void {
    if (!isRoundTrip || !this.isPublicMode(mode)) return;

    throw new BadRequestException(
      'Билеты на автобус, ж/д, корабль и вертолёт покупают раздельно в каждую сторону — пары у рейса нет',
    );
  }

  private isPublicMode(mode: TransferMode): boolean {
    return (TRANSFER_PUBLIC_MODES as readonly string[]).includes(mode);
  }

  /**
   * Сходится ли оплата с типом транспорта — без броска.
   *
   * Нужно ровно для зеркала пары: там оплату не выбирают, и обычная
   * проверка сообщила бы «смените компенсацию», которой в форме нет.
   */
  private compensationFits(
    mode: TransferMode,
    compensation: TransferCompensation,
  ): boolean {
    if (compensation === 'ticket') return this.isPublicMode(mode);

    if (compensation === 'shared' || compensation === 'sharedPerPassenger') {
      return !this.isPublicMode(mode);
    }

    return true;
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
