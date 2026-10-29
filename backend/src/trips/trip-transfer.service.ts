import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';

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
 * | второй рейс того же направления | нельзя: заявка и заброска — можно |
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
 * Заброска — это рейс с флагом `is_stage`: «этап — это рейс, заброска,
 * одна карточка, а не группа» (заказчик 28.10.2026). Флаг отвечает ровно
 * за одно — в какой секции экрана показать строку. Никаких цепочек
 * и номеров этапов нет; порядок — по времени отправления.
 *
 * ## Пары «туда-обратно»
 *
 * «Туда-обратно» — это планирование: «вернёмся тем же способом», поэтому
 * флаг есть у любого транспорта, включая общественный. Пар может быть
 * несколько. В зеркало человек приходит автоматически, а уходит оттуда
 * свободно; удаление исходного удаляет и обратный (каскад).
 * Оплата общая только у своего и наёмного транспорта — у рейсов билеты
 * стоят на обеих карточках и могут отличаться по цене.
 *
 * ## Один рейс
 *
 * «У каждого пользователя может быть по одному рейсу туда-обратно»
 * (заказчик 28.10.2026). Второго рейса того же направления не бывает —
 * ни посадкой, ни принятием заявки, ни владельцем в своём ТС. Заявки
 * и заброски правило не касаются: заявка место не занимает, а этапы —
 * внутренние переезды, а не дорога от дома. Подробности —
 * в `assertSingleRide`.
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

    const isStage = dto.isStage ?? false;
    const isRoundTrip = dto.isRoundTrip ?? false;

    /**
     * «Туда-обратно» — только у рейса «Туда»: пара рождается там, а
     * обратный получается зеркалом. У «Обратно» флага нет (заказчик
     * 28.10.2026), иначе появилось бы «туда» из обратной карточки.
     */
    this.assertRoundTripDirection(dto.direction, isRoundTrip);

    if (isOwnVehicle) {
      const owner = ownerUserId as string;
      await this.assertTraveler(manager, trip.id, owner);

      /**
       * Владельца сервис сажает в его же ТС сам, и правило «один рейс»
       * распространяется и на него: иначе вторую машину можно было бы
       * завести на человека, который уже уехал другим рейсом. У пары
       * проверяются оба конца — в зеркало он тоже попадает.
       */
      await this.assertSingleRide(
        manager,
        trip.id,
        dto.direction,
        isStage,
        owner,
        [],
      );

      if (isRoundTrip) {
        await this.assertSingleRide(
          manager,
          trip.id,
          this.otherDirection(dto.direction),
          isStage,
          owner,
          [],
        );
      }
    }

    const amount =
      dto.compensation === 'free' ? null : (dto.compensationAmountRub ?? null);

    this.assertCompensation(mode, dto.compensation, amount);

    this.assertWithinTrip(trip, new Date(dto.departsAt));

    const last = await manager.findOne(TripTransferLeg, {
      where: { tripId: trip.id, direction: dto.direction },
      order: { position: 'DESC', id: 'DESC' },
    });

    const leg = await manager.save(
      manager.create(TripTransferLeg, {
        tripId: trip.id,
        direction: dto.direction,
        position: (last?.position ?? 0) + 1,
        isStage,
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

    /** Что было до правки: от этого зависит, кого сажает сервис сам. */
    const previousOwnerId = leg.ownerUserId;
    const wasRoundTrip = leg.isRoundTrip;
    const previousDirection = leg.direction;
    const previousStage = leg.isStage;

    if (leg.ownerUserId !== userId && !canEditTab) {
      throw new ForbiddenException(
        'Рейс правит тот, кто ведёт вкладку, или владелец этого ТС',
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
        'У рейса (автобус, ж/д, корабль, вертолёт) не бывает владельца — снимите «наше ТС» или смените тип транспорта',
      );
    }

    let isRoundTrip = dto.isRoundTrip ?? leg.isRoundTrip;

    /**
     * Зеркало второй парой не бывает: оно пришло из исходной карточки,
     * и флаг на нём означал бы «зеркало зеркала». Правят исходную —
     * на экране у зеркала этого флага и нет.
     */
    if (isRoundTrip && leg.roundTripSourceId !== null) {
      throw new BadRequestException(
        'Это обратный рейс пары — «туда-обратно» ставится на исходном',
      );
    }

    /**
     * **Оплата пары.** У своего и наёмного транспорта она одна: бензин
     * или аренда платятся «за два конца», и стоимость задаётся на исходном
     * рейсе. У общественного — наоборот: билеты стоят на обеих карточках
     * и могут отличаться по цене, поэтому у зеркала с рейсом своя цена.
     */
    const pairSource =
      leg.roundTripSourceId === null
        ? null
        : await manager.findOne(TripTransferLeg, {
            where: { id: leg.roundTripSourceId },
          });

    const sharedMoney =
      pairSource !== null &&
      !this.isPublicMode(effectiveMode) &&
      !this.isPublicMode(pairSource.mode);

    const compensation = sharedMoney
      ? (pairSource as TripTransferLeg).compensation
      : (dto.compensation ?? leg.compensation);
    const amount = sharedMoney
      ? (pairSource as TripTransferLeg).compensationAmountRub
      : dto.compensationAmountRub !== undefined
        ? dto.compensationAmountRub
        : leg.compensationAmountRub;

    this.assertCompensation(
      effectiveMode,
      compensation,
      compensation === 'free' ? null : amount,
    );

    const direction = dto.direction ?? leg.direction;

    /**
     * Сторону пары не меняют: у неё два конца, и перенос одного из них
     * сделал бы два «туда» или два «обратно».
     *
     * Флаг «туда-обратно» живёт только на рейсе «Туда» (заказчик
     * 28.10.2026): обратный появляется зеркалом, отдельно его не ставят.
     * Уже существующий флаг на обратном (старые данные) правкой не
     * блокируется — форма присылает `false`, и он снимается.
     */
    if (
      direction !== leg.direction &&
      (leg.isRoundTrip || leg.roundTripSourceId !== null)
    ) {
      throw new BadRequestException(
        'У рейса есть пара «туда-обратно» — сторону не меняют',
      );
    }

    if (isRoundTrip && (dto.isRoundTrip === true || direction !== leg.direction)) {
      this.assertRoundTripDirection(direction, isRoundTrip);
    }

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
    this.assertWithinTrip(trip, leg.departsAt);
    if (dto.isStage !== undefined) leg.isStage = dto.isStage;
    await this.assertLegDate(manager, trip, leg);
    if (dto.fromPlace !== undefined) leg.fromPlace = this.place(dto.fromPlace, 'Откуда');
    if (dto.toPlace !== undefined) leg.toPlace = this.place(dto.toPlace, 'Докуда');
    leg.isOwnVehicle = isOwnVehicle;
    leg.ownerUserId = isOwnVehicle ? ownerUserId : null;
    leg.seats = seats;
    leg.vehicleId = vehicleId;
    if (dto.isStage !== undefined) leg.isStage = dto.isStage;
    leg.compensation = compensation;
    leg.compensationAmountRub = compensation === 'free' ? null : amount;
    leg.isRoundTrip = isRoundTrip;
    if (dto.note !== undefined) leg.note = this.note(dto.note);

    /**
     * Посадки, которые сервис делает сам, проходят те же правила, что
     * и ручные: новый владелец садится в свой рейс, а включение пары
     * копирует уже посаженных в зеркало. Проверяем **до** записи — иначе
     * 400 пришла бы на сохранённую карточку (те же грабли, что у дат пары).
     */
    if (
      leg.isOwnVehicle &&
      leg.ownerUserId !== null &&
      leg.ownerUserId !== previousOwnerId
    ) {
      await this.assertSingleRide(
        manager,
        trip.id,
        leg.direction,
        leg.isStage,
        leg.ownerUserId,
        [leg.id],
      );

      if (isRoundTrip) {
        /** Зеркало этой же пары — не «второй обратный», его не считаем. */
        const mirror = await this.mirrorOf(manager, leg);

        await this.assertSingleRide(
          manager,
          trip.id,
          this.otherDirection(leg.direction),
          leg.isStage,
          leg.ownerUserId,
          mirror === null ? [] : [mirror.id],
        );
      }
    }

    if (isRoundTrip && !wasRoundTrip) {
      const seated = await manager.find(TripTransferPassenger, {
        where: { legId: leg.id, status: 'accepted' },
      });

      for (const person of seated) {
        await this.assertSingleRide(
          manager,
          trip.id,
          this.otherDirection(leg.direction),
          leg.isStage,
          person.userId,
          [leg.id],
        );
      }
    }

    /**
     * Карточка переехала в другую сторону или перестала быть заброской —
     * её пассажиры начинают считаться в новом направлении. Без проверки
     * человек, у которого уже есть рейс там, получил бы второй правкой
     * карточки, а не посадкой.
     */
    const countedDifferently =
      (leg.direction !== previousDirection || leg.isStage !== previousStage) &&
      !leg.isStage;

    if (countedDifferently) {
      const seated = await manager.find(TripTransferPassenger, {
        where: { legId: leg.id, status: 'accepted' },
      });

      for (const person of seated) {
        await this.assertSingleRide(
          manager,
          trip.id,
          leg.direction,
          leg.isStage,
          person.userId,
          [leg.id],
        );
      }
    }

    await manager.save(leg);

    // Сменился владелец — он должен оказаться пассажиром своего рейса.
    if (leg.ownerUserId !== null) {
      await this.placePassenger(manager, trip.id, leg.id, leg.ownerUserId, 'accepted');
    }

    // Флаг «туда-обратно» включили или сняли — зеркало появляется или уходит.
    await this.syncMirrorExistence(manager, trip.id, leg);

    /**
     * Пара едет одним способом: сменили тип на исходном — он же и в зеркале.
     * Заказчик 28.10.2026: «изменяем тип транспорта… ожидается, что
     * изменения перенесутся и в „обратно“». Оплата — отдельно: у своего
     * и наёмного она общая, у рейса билет на каждом конце свой.
     */
    await this.syncMirrorTransport(manager, leg);
    await this.syncMoneyToMirror(manager, leg);

    return this.buildPlan(manager, trip, userId);
  }

  /**
   * Удалить рейс: право вкладки или владелец ТС.
   *
   * Пара удаляется целиком: у зеркала внешний ключ на исходный с
   * `ON DELETE CASCADE`, поэтому «удалил туда — пропало и обратно»
   * работает у любого транспорта, а не только у личного.
   */
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
      throw new ConflictException('Вы уже в этом рейсе');
    }

    const status: TransferPassengerStatus = leg.isOwnVehicle
      ? 'requested'
      : 'accepted';

    if (status === 'accepted') await this.assertFreeSeat(manager, leg);

    /**
     * Проверяем **до** вставки: человек придёт и в зеркало пары, а там
     * может не быть места, да и порядок дат должен сойтись.
     */
    await this.assertCanSeat(manager, leg, userId, status);

    await manager.insert(TripTransferPassenger, {
      tripId: trip.id,
      legId: leg.id,
      userId,
      status,
    });

    await this.syncToMirror(manager, trip.id, leg, userId, status);

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
      throw new ConflictException('Этот человек уже в этом рейсе');
    }

    const status = dto.status ?? 'accepted';
    if (status === 'accepted') await this.assertFreeSeat(manager, leg);

    await this.assertCanSeat(manager, leg, dto.userId, status);

    await manager.insert(TripTransferPassenger, {
      tripId: trip.id,
      legId: leg.id,
      userId: dto.userId,
      status,
    });

    await this.syncToMirror(manager, trip.id, leg, dto.userId, status);

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
    if (!row) throw new NotFoundException('Этот участник не в этом рейсе');

    if (row.status === 'accepted') {
      return this.buildPlan(manager, trip, userId);
    }

    await this.assertFreeSeat(manager, leg);

    await this.assertCanSeat(manager, leg, targetUserId, 'accepted');

    row.status = 'accepted';
    await manager.save(row);

    await this.syncToMirror(manager, trip.id, leg, targetUserId, 'accepted');

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
    if (!row) throw new NotFoundException('Этот участник не в этом рейсе');

    if (leg.ownerUserId === targetUserId) {
      throw new BadRequestException(
        'Владельца ТС нельзя удалить — он уходит вместе со своим рейсом',
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
   * Точки меняются местами, тип, места, владелец и техника копируются.
   * Время — тоже: обратный выезд человек поправит сам, если он другой,
   * а выдумывать дату за него не наше дело.
   *
   * **Этап остаётся этапом**: зеркало получает тот же `is_stage`, иначе
   * обратная заброска выпадала бы в список рейсов.
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

    /**
     * Оплату копируем всегда, но общую включает сервис: у общественного
     * транспорта билеты на обоих концах считаются отдельно и могут
     * отличаться по цене.
     */
    const mirror = await manager.save(
      manager.create(TripTransferLeg, {
        tripId,
        direction,
        position: (last?.position ?? 0) + 1,
        isStage: source.isStage,
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
   * Тип транспорта пары один на два конца.
   *
   * Сменили «Ж/д» на «Автомобиль» на исходном рейсе — обратный становится
   * автомобилем тоже: пара и значит «вернуться тем же способом». Места
   * и техника переезжают вместе с типом, иначе в обратном остался бы
   * вагон с четырьмя местами.
   *
   * Оплату трогаем только тогда, когда она перестала подходить к новому
   * типу: у общественного должен быть билет, у своего — не билет.
   */
  private async syncMirrorTransport(
    manager: EntityManager,
    leg: TripTransferLeg,
  ): Promise<void> {
    if (!leg.isRoundTrip) return;

    const mirror = await this.mirrorOf(manager, leg);
    if (!mirror) return;

    mirror.mode = leg.mode;
    mirror.seats = leg.seats;
    mirror.isOwnVehicle = leg.isOwnVehicle;
    mirror.ownerUserId = leg.ownerUserId;
    mirror.vehicleId = leg.vehicleId;

    const publicMode = this.isPublicMode(mirror.mode);

    if (mirror.compensation === 'ticket' && !publicMode) {
      mirror.compensation = leg.compensation;
      mirror.compensationAmountRub = leg.compensationAmountRub;
    } else if (
      publicMode &&
      (mirror.compensation === 'shared' ||
        mirror.compensation === 'sharedPerPassenger')
    ) {
      mirror.compensation = 'ticket';
    }

    await manager.save(mirror);
  }

  /**
   * Оплата пары: у своего и наёмного транспорта она одна на два конца.
   *
   * «Бензин для своего ТС — за два конца; наёмный транспорт — за два конца».
   * У общественного наоборот: билеты стоят на обеих карточках и могут
   * отличаться по цене, поэтому там ничего не синхронизируем.
   */
  private async syncMoneyToMirror(
    manager: EntityManager,
    leg: TripTransferLeg,
  ): Promise<void> {
    if (!leg.isRoundTrip) return;
    if (this.isPublicMode(leg.mode)) return;

    const mirror = await this.mirrorOf(manager, leg);
    if (!mirror || this.isPublicMode(mirror.mode)) return;

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
   * Окно даты рейса — **по его участникам**.
   *
   * Заказчик 28.10.2026 расписал правила по направлениям:
   *
   * - дата «туда» не позже забросок участника и тем более его возвращения;
   * - дата «обратно» не раньше его забросок и его выезда;
   * - дата заброски — между его заездом и выездом;
   * - **у рейса без участников — только даты похода.**
   *
   * Последнее — поправка заказчика: «заброска может быть и без участников —
   * вещи будут вывозить, временные рамки похода соблюдены». Раньше этап без
   * людей дополнительно зажимался между первым «туда» и последним
   * «обратно», и заброску после чужого отъезда завести было нельзя.
   * Правило теперь ровно то, что сказано: **есть люди — считаем по ним**,
   * нет людей — рамки похода. Дни сравниваем, как `assertWithinTrip`:
   * в день выезда время роли не играет.
   */
  private async assertLegDate(
    manager: EntityManager,
    trip: Trip,
    leg: TripTransferLeg,
    coming?: string,
  ): Promise<void> {
    const [legs, rows] = await Promise.all([
      manager.find(TripTransferLeg, { where: { tripId: trip.id } }),
      manager.find(TripTransferPassenger, {
        where: { tripId: trip.id, status: 'accepted' },
      }),
    ]);

    const seats = new Set(
      rows.filter((row) => row.legId === leg.id).map((row) => row.userId),
    );
    if (coming !== undefined) seats.add(coming);

    const time = leg.departsAt.getTime();
    let from: number | null = null;
    let to: number | null = null;

    /** Даты похода — единственная рамка для рейса без участников. */
    if (seats.size === 0) {
      const day = (date: Date) => date.toISOString().slice(0, 10);

      if (trip.startsAt) {
        from = Date.parse(`${day(trip.startsAt)}T00:00:00.000Z`);
      }

      if (trip.endsAt) {
        to = Date.parse(`${day(trip.endsAt)}T23:59:59.999Z`);
      }
    }

    if (seats.size > 0) {
      const byId = new Map(legs.map((row) => [row.id, row]));
      const ownByUser = new Map<string, TripTransferLeg[]>();

      for (const row of rows) {
        if (!seats.has(row.userId) || row.legId === leg.id) continue;

        const own = byId.get(row.legId);
        if (own === undefined) continue;

        const list = ownByUser.get(row.userId) ?? [];
        list.push(own);
        ownByUser.set(row.userId, list);
      }

      const latest = (list: TripTransferLeg[]) =>
        list.length === 0
          ? null
          : Math.max(...list.map((row) => row.departsAt.getTime()));
      const earliest = (list: TripTransferLeg[]) =>
        list.length === 0
          ? null
          : Math.min(...list.map((row) => row.departsAt.getTime()));

      for (const own of ownByUser.values()) {
        const there = own.filter(
          (row) => !row.isStage && row.direction === 'there',
        );
        const back = own.filter(
          (row) => !row.isStage && row.direction === 'back',
        );
        const stages = own.filter((row) => row.isStage);

        /**
         * Рейс «туда» стоит на выезде из дома, «обратно» — на возвращении,
         * заброска — между ними. Поэтому границы берём с той стороны,
         * куда смотрит сам рейс.
         */
        const afterArrival =
          leg.isStage || leg.direction === 'back' ? latest(there) : null;
        const beforeDeparture =
          leg.isStage || leg.direction === 'there'
            ? earliest(back)
            : null;

        if (afterArrival !== null) {
          from = Math.max(from ?? afterArrival, afterArrival);
        }

        if (beforeDeparture !== null) {
          to = Math.min(to ?? beforeDeparture, beforeDeparture);
        }

        // Рейс «туда» не уезжает раньше собственных забросок: они уже
        // внутри поездки, значит выезд не позже первой из них.
        if (leg.direction === 'there' || leg.isStage) {
          const firstStage = earliest(stages);
          if (firstStage !== null) {
            to = Math.min(to ?? firstStage, firstStage);
          }
        }

        if (leg.direction === 'back' || leg.isStage) {
          const lastStage = latest(stages);
          if (lastStage !== null) {
            from = Math.max(from ?? lastStage, lastStage);
          }
        }
      }
    }

    if (from !== null && time < from) {
      throw new BadRequestException(
        'Дата раньше, чем участник приезжает — поправьте время',
      );
    }

    if (to !== null && time > to) {
      throw new BadRequestException(
        'Дата позже, чем участник уезжает — поправьте время',
      );
    }
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
   * Пассажир появился в исходной — появляется и в обратной.
   *
   * Правило заказчика дословно: «посадили человека в „туда“ — в „обратно“
   * он приходит автоматически, и его можно удалить с обратного рейса без
   * влияния на прямой. Удаление из прямого рейса автоматически удаляет
   * из обратного. Можно садить на обратный без влияния на прямой».
   *
   * Отсюда: синхронизация идёт **только от исходной к зеркалу** и только
   * тогда, когда сажают в исходную. Посадка прямо в зеркало на исходную
   * не влияет — у зеркала `isRoundTrip` всегда `false`, и функция для него
   * сразу выходит.
   */
  private async syncToMirror(
    manager: EntityManager,
    tripId: string,
    leg: TripTransferLeg,
    userId: string,
    status: TransferPassengerStatus,
  ): Promise<void> {
    if (!leg.isRoundTrip) return;

    const mirror = await this.mirrorOf(manager, leg);
    if (!mirror) return;

    const row = await manager.findOne(TripTransferPassenger, {
      where: { legId: mirror.id, userId },
    });

    if (row !== null) {
      // Он уже там: приняли на прямом — принимаем и на обратном.
      if (row.status !== status && status === 'accepted') {
        row.status = status;
        await manager.save(row);
      }
      return;
    }

    await manager.insert(TripTransferPassenger, {
      tripId,
      legId: mirror.id,
      userId,
      status,
    });
  }

  /**
   * Ушёл из исходной — уходит и из обратной.
   *
   * Обратное направление свободно: снять человека с обратного рейса можно,
   * и на прямой это не повлияет.
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
     * Порядок показа — по времени отправления; «туда» раньше «обратно»,
     * чтобы клиенту не приходилось пересобирать список самому.
     * Этапов в отдельном списке нет: этап — такая же строка, просто
     * с флагом, и раскладывает их по секциям экран.
     */
    const ordered = [...legs].sort((left, right) => {
      if (left.direction !== right.direction) {
        return left.direction === 'there' ? -1 : 1;
      }

      return left.departsAt.getTime() - right.departsAt.getTime() ||
        Number(left.id) - Number(right.id);
    });

    /**
     * Направления, в которых у смотрящего уже есть рейс, — без этой
     * карточки и без её пары: второй конец той же поездки не «другой рейс».
     */
    const legsById = new Map(legs.map((leg) => [leg.id, leg]));

    const takenDirections = (leg: TripTransferLeg): Set<TransferDirection> => {
      const family = new Set<string>([leg.id]);

      if (leg.roundTripSourceId !== null) family.add(leg.roundTripSourceId);

      for (const row of legs) {
        if (row.roundTripSourceId === leg.id) family.add(row.id);
      }

      const taken = new Set<TransferDirection>();

      for (const passenger of passengers) {
        if (passenger.userId !== userId || passenger.status !== 'accepted') {
          continue;
        }

        if (family.has(passenger.legId)) continue;

        const own = legsById.get(passenger.legId);

        if (own !== undefined && !own.isStage) taken.add(own.direction);
      }

      return taken;
    };

    const legDtos = ordered.map((leg): TransferLegDto => {
      const inLeg = passengersByLeg.get(leg.id) ?? [];
      const accepted = inLeg.filter((person) => person.status === 'accepted');
      const mine = inLeg.find((person) => person.userId === userId) ?? null;
      const taken = takenDirections(leg);
      const landing = this.landingDirections(leg);

      const joinStatus: TransferPassengerStatus | null =
        mine !== null ||
        !going.has(userId) ||
        landing.some((direction) => taken.has(direction))
          ? null
          : leg.isOwnVehicle
            ? 'requested'
            : 'accepted';

      return {
        id: leg.id,
        direction: leg.direction,
        position: leg.position,
        isStage: leg.isStage,
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
      throw new BadRequestException('Укажите сумму компенсации');
    }
  }

  private isPersonalMode(mode: TransferMode): boolean {
    return (TRANSFER_PERSONAL_MODES as readonly string[]).includes(mode);
  }

  /**
   * «Туда-обратно» — только у рейса «Туда».
   *
   * Заказчик 28.10.2026: «у обратных рейсов не должно быть флага
   * „Туда-обратно“». Пара рождается на рейсе «Туда»: флаг и создаёт
   * обратный. На «Обратно» он означал бы «туда» из обратной карточки.
   */
  private assertRoundTripDirection(
    direction: TransferDirection,
    isRoundTrip: boolean,
  ): void {
    if (!isRoundTrip || direction === 'there') return;

    throw new BadRequestException(
      'У обратного рейса не бывает флага «Туда-обратно» — он ставится на рейсе «Туда»',
    );
  }

  private isPublicMode(mode: TransferMode): boolean {
    return (TRANSFER_PUBLIC_MODES as readonly string[]).includes(mode);
  }

  /**
   * Рейс живёт внутри дат похода.
   *
   * Заказчик 28.10.2026: «создал „Туда“ и „Обратно“ на 30 октября, вставил
   * заброску на тракторе 28-го — косяк: старт внутреннего рейса вышел
   * за рамки выезда». Сравниваем календарные дни, а не часы: автобус
   * в шесть утра в день выезда — это тот же день, а не «раньше похода».
   * Пока даты не решены (`startsAt`/`endsAt` пусты), проверять не по чему.
   */
  private assertWithinTrip(trip: Trip, departsAt: Date): void {
    if (!trip.startsAt || !trip.endsAt) return;

    const day = (date: Date) => date.toISOString().slice(0, 10);
    const own = day(departsAt);

    if (own < day(trip.startsAt)) {
      throw new BadRequestException(
        'Рейс раньше начала похода — поправьте время',
      );
    }

    if (own > day(trip.endsAt)) {
      throw new BadRequestException(
        'Рейс позже возвращения — поправьте время',
      );
    }
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
        'Рейс правит тот, кто ведёт вкладку, или владелец этого ТС',
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
        'В рейс сажают только тех, кто идёт: «пока не решил» место не занимает',
      );
    }
  }

  /** Свободное место. Места не указаны — потолка нет. */
  private async assertFreeSeat(
    manager: EntityManager,
    leg: TripTransferLeg,
    message = 'На этот рейс нет свободных мест',
  ): Promise<void> {
    if (leg.seats === null) return;

    const occupied = await manager.count(TripTransferPassenger, {
      where: { legId: leg.id, status: 'accepted' },
    });

    if (occupied >= leg.seats) {
      throw new BadRequestException(message);
    }
  }

  /**
   * Можно ли посадить человека, не сломав пару.
   *
   * Проверка идёт **до** вставки: он придёт и в зеркало, а там может
   * не найтись места, и порядок дат должен сойтись. 400 после вставки
   * оставила бы человека посаженным на одном конце и жалующегося
   * на другом.
   */
  private async assertCanSeat(
    manager: EntityManager,
    leg: TripTransferLeg,
    userId: string,
    status: TransferPassengerStatus,
  ): Promise<void> {
    if (status !== 'accepted') return;

    /**
     * Один человек — один рейс этого направления. Проверка идёт до вставки
     * и до проверки дат: «уже едешь» — более простое объяснение, чем
     * «дата не сходится», и оно не зависит от порядка карточек.
     */
    await this.assertSingleRide(
      manager,
      leg.tripId,
      leg.direction,
      leg.isStage,
      userId,
      [leg.id],
    );

    const pair = await this.pairOf(manager, leg);

    if (pair !== null) {
      const [source, mirror] = pair;

      /**
       * Сажают в исходную — человек появится и в обратной. Если он там
       * ещё не сидит, место должно найтись: молча переполнить зеркало
       * хуже, чем сказать об этом сразу.
       */
      if (leg.id === source.id) {
        const already = await manager.findOne(TripTransferPassenger, {
          where: { legId: mirror.id, userId },
        });

        if (already === null) {
          await this.assertFreeSeat(
            manager,
            mirror,
            'На обратный маршрут нет свободных мест',
          );
        }

        /**
         * И второй конец пары — тоже рейс: человек, который уже едет
         * обратно другим рейсом, в зеркало не попадает. Проверяем до
         * вставки: посадка автоматическая, и 400 после неё оставила бы
         * его на одном конце.
         */
        await this.assertSingleRide(
          manager,
          mirror.tripId,
          mirror.direction,
          mirror.isStage,
          userId,
          [mirror.id],
        );
      }
    }

    const trip = await manager.findOne(Trip, { where: { id: leg.tripId } });
    if (trip !== null) {
      await this.assertLegDate(manager, trip, leg, userId);
    }
  }

  /**
   * Один человек — один рейс «туда» и один «обратно».
   *
   * Заказчик 28.10.2026 дословно: «у каждого пользователя может быть
   * по одному рейсу туда-обратно. Даже если он на такси до поезда ехал…
   * такси будет „туда“, а поезд пойдёт в заброски». Отсюда:
   *
   * - считается **направление**, а не количество: «туда» и «обратно» —
   *   два разных места, и оба могут быть заняты;
   * - проверяются только **принятые** посадки: `requested` место не
   *   занимает, и человек вправе проситься в несколько машин сразу
   *   (правило «проверка на посадку, не на заявку»);
   * - **заброски не считаются**: `is_stage` — внутренний переезд,
   *   а не дорога от дома, и этапов у человека сколько нужно.
   *
   * `exceptLegIds` — карточки, которые из подсчёта выкидываются: та, в
   * которую сажают (при принятии заявки строка в ней уже есть), и, когда
   * проверяется второй конец пары, — зеркало этой же пары. Чужая пара
   * не исключение: второй «обратно» у человека быть не должно.
   *
   * Имя в тексте 400 — чтобы человек видел, о ком речь: «Пётр уже определён
   * на обратный рейс».
   */
  private async assertSingleRide(
    manager: EntityManager,
    tripId: string,
    direction: TransferDirection,
    isStage: boolean,
    userId: string,
    exceptLegIds: string[],
  ): Promise<void> {
    if (isStage) return;

    const rows = await manager.find(TripTransferPassenger, {
      where: { tripId, userId, status: 'accepted' },
    });

    const otherLegIds = rows
      .map((row) => row.legId)
      .filter((id) => !exceptLegIds.includes(id));

    if (otherLegIds.length === 0) return;

    const taken = await manager.count(TripTransferLeg, {
      where: {
        tripId,
        id: In(otherLegIds),
        direction,
        isStage: false,
      },
    });

    if (taken === 0) return;

    const participant = await manager.findOne(TripParticipant, {
      where: { tripId, userId },
      relations: { user: true },
    });

    const name = participant?.user?.displayName ?? 'Участник';

    throw new BadRequestException(
      direction === 'there'
        ? `${name} уже определён на рейс туда`
        : `${name} уже определён на обратный рейс`,
    );
  }

  /** Другая сторона: у пары зеркало живёт в ней. */
  private otherDirection(direction: TransferDirection): TransferDirection {
    return direction === 'there' ? 'back' : 'there';
  }

  /**
   * Какие направления займёт посадка в эту карточку.
   *
   * Заброска — никаких (этап у человека не один), зеркало пары — только
   * своё (на исходную посадка в него не влияет), исходная пары — оба
   * (человек приходит и в зеркало), обычный рейс — своё.
   */
  private landingDirections(leg: TripTransferLeg): TransferDirection[] {
    if (leg.isStage) return [];
    if (leg.roundTripSourceId !== null) return [leg.direction];

    return leg.isRoundTrip
      ? [leg.direction, this.otherDirection(leg.direction)]
      : [leg.direction];
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

    if (!leg) throw new NotFoundException('Рейс не найден');

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
