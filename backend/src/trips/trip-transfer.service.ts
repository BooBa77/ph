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
  CreateTransferCarDto,
  CreateTransferLegDto,
  SeatTransferPassengerDto,
  TransferCarDto,
  TransferLegDto,
  TransferPassengerDto,
  TransferTravelerDto,
  TripTransferDto,
  UpdateTransferCarDto,
  UpdateTransferLegDto,
} from './dto/trip-transfer.dto';
import { TripTransferCar } from './entities/trip-transfer-car.entity';
import { TripTransferLeg } from './entities/trip-transfer-leg.entity';
import { TripTransferPassenger } from './entities/trip-transfer-passenger.entity';
import { TripParticipant } from './entities/trip-participant.entity';
import { Trip } from './entities/trip.entity';
import { TRANSFER_TAB } from './trip-transfer.types';
import { TripsService } from './trips.service';

/**
 * «Трансфер» — вкладка подготовки похода (`docs/ph/transfer.md`).
 *
 * ## Правила доступа
 *
 * | Действие | Кто |
 * |---|---|
 * | видеть вкладку | любой участник похода (кроме `declined`) |
 * | строки заброски: создать, поправить, убрать, «вернуться так же» | право на вкладку «Трансфер» |
 * | машина: создать | право на вкладку или **сам водитель своей машины** |
 * | машина: поправить, убрать | право на вкладку или водитель **этой** машины |
 * | посадить человека в строку и в машину | право на вкладку, водитель машины этой строки или **сам человек** |
 * | снять человека со строки | те же |
 *
 * «Пассажир может отказаться» — это не отдельный статус, а право снять
 * себя со строки: человек сам убирает себя из машины или из строки, и никто
 * не может ему помешать. Отказ при этом не записывается: место в машине —
 * не приглашение, а договорённость, которая либо есть, либо нет.
 *
 * ## Почему у машины есть право быть «своей»
 *
 * Заказчик сказал: «водитель выбирает пассажиров». Водитель без роли
 * не должен зависеть от организатора, но и править чужие строки ему незачем.
 * Поэтому право на правку считается **по машине** (`canEdit` в DTO),
 * а не по матрице ролей: матрица (`role_tab_permissions`) даёт вкладку
 * роли `driver` — и этого мало, потому что водителей в походе может быть
 * трое, а машина у каждого своя.
 *
 * ## Одно состояние на все действия
 *
 * Любая правка возвращает вкладку целиком (`TripTransferDto`). Собирать
 * состояние на клиенте из частичных ответов — верный способ однажды
 * показать «3 из 5» там, где уже «4 из 5»: места считаются сразу по двум
 * таблицам.
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

  // ───────────────────────────── строки ─────────────────────────────

  /** Новая строка заброски в конец списка. */
  async createLeg(
    userId: string,
    tripId: number,
    dto: CreateTransferLegDto,
  ): Promise<TripTransferDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);
    await this.assertCanEditTab(trip, userId);

    const last = await manager.findOne(TripTransferLeg, {
      where: { tripId: trip.id },
      order: { position: 'DESC', id: 'DESC' },
    });

    await manager.insert(TripTransferLeg, {
      tripId: trip.id,
      position: (last?.position ?? 0) + 1,
      departsAt: dto.departsAt ? new Date(dto.departsAt) : null,
      fromPlace: this.place(dto.fromPlace, 'Откуда'),
      toPlace: this.place(dto.toPlace, 'Куда'),
      mode: dto.mode,
      note: this.note(dto.note),
    });

    return this.buildPlan(manager, trip, userId);
  }

  /**
   * Поправить строку: три состояния поля, как у похода.
   *
   * Смена вида с «авто» на «поезд» при заведённых машинах — 400, а не тихое
   * удаление машин: у поезда их не бывает, но удалять чужие договорённости
   * за спиной нельзя. Сначала человек убирает машины, потом меняет вид.
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
    await this.assertCanEditTab(trip, userId);

    const leg = await this.legOrFail(manager, trip.id, legId);

    if (dto.mode !== undefined && dto.mode !== 'car') {
      const cars = await manager.count(TripTransferCar, { where: { legId: leg.id } });
      if (cars > 0) {
        throw new BadRequestException(
          'У этой строки есть машины — сначала уберите их, потом меняйте вид',
        );
      }
    }

    if (dto.mode !== undefined) leg.mode = dto.mode;
    if (dto.fromPlace !== undefined) leg.fromPlace = this.place(dto.fromPlace, 'Откуда');
    if (dto.toPlace !== undefined) leg.toPlace = this.place(dto.toPlace, 'Куда');
    if (dto.departsAt !== undefined) {
      leg.departsAt = dto.departsAt ? new Date(dto.departsAt) : null;
    }
    if (dto.note !== undefined) leg.note = this.note(dto.note);

    await manager.save(leg);

    return this.buildPlan(manager, trip, userId);
  }

  /** Убрать строку: машины и пассажиры уходят каскадом, поход не страдает. */
  async removeLeg(
    userId: string,
    tripId: number,
    legId: number,
  ): Promise<TripTransferDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);
    await this.assertCanEditTab(trip, userId);

    const leg = await this.legOrFail(manager, trip.id, legId);
    await manager.delete(TripTransferLeg, { id: leg.id });

    return this.buildPlan(manager, trip, userId);
  }

  /**
   * «Вернуться так же»: копия строки с обратными точками.
   *
   * **Дату не копируем.** Обратный выезд в момент, когда договариваются
   * о прямом, обычно ещё неизвестен, а выдуманное время хуже пустого:
   * на него никто не посмотрит и в нём поедут. Машины и люди копируются —
   * «так же» и значит «те же и так же», а дальше их правят по месту.
   */
  async returnSameWay(
    userId: string,
    tripId: number,
    legId: number,
  ): Promise<TripTransferDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);
    await this.assertCanEditTab(trip, userId);

    const leg = await this.legOrFail(manager, trip.id, legId);

    await this.dataSource.transaction(async (inTransaction) => {
      const last = await inTransaction.findOne(TripTransferLeg, {
        where: { tripId: trip.id },
        order: { position: 'DESC', id: 'DESC' },
      });

      const copy = await inTransaction.save(
        inTransaction.create(TripTransferLeg, {
          tripId: trip.id,
          position: (last?.position ?? 0) + 1,
          departsAt: null,
          fromPlace: leg.toPlace,
          toPlace: leg.fromPlace,
          mode: leg.mode,
          note: null,
        }),
      );

      const cars = await inTransaction.find(TripTransferCar, {
        where: { legId: leg.id },
        order: { id: 'ASC' },
      });
      const passengers = await inTransaction.find(TripTransferPassenger, {
        where: { legId: leg.id },
        order: { id: 'ASC' },
      });

      /** Какой пассажир попадает в какую копию машины. */
      const carIds = new Map<string, string>();

      for (const car of cars) {
        const saved = await inTransaction.save(
          inTransaction.create(TripTransferCar, {
            tripId: trip.id,
            legId: copy.id,
            ownership: car.ownership,
            driverUserId: car.driverUserId,
            driverName: car.driverName,
            driverPhone: car.driverPhone,
            seats: car.seats,
            note: car.note,
          }),
        );
        carIds.set(car.id, saved.id);
      }

      for (const passenger of passengers) {
        await inTransaction.insert(TripTransferPassenger, {
          tripId: trip.id,
          legId: copy.id,
          userId: passenger.userId,
          carId: passenger.carId === null ? null : (carIds.get(passenger.carId) ?? null),
        });
      }
    });

    return this.buildPlan(manager, trip, userId);
  }

  // ───────────────────────────── машины ─────────────────────────────

  /**
   * Машина в строке.
   *
   * Свою участник добавляет сам: «я поеду на своей» — это его решение,
   * а не распоряжение организатора. Наёмную заводит тот, кому роль дала
   * вкладку: у наёмной машины нет хозяина в составе, значит и отвечать
   * за неё некому, кроме ведущего.
   */
  async createCar(
    userId: string,
    tripId: number,
    legId: number,
    dto: CreateTransferCarDto,
  ): Promise<TripTransferDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);

    const leg = await this.legOrFail(manager, trip.id, legId);
    if (leg.mode !== 'car') {
      throw new BadRequestException(
        'Машины бывают только у строки «авто» — у поезда и автобуса их нет',
      );
    }

    const canEditTab = await this.trips.canEditTab(userId, trip, TRANSFER_TAB);
    const isOwn = dto.ownership === 'own';
    const driverUserId = isOwn ? (dto.driverUserId ?? null) : null;

    if (isOwn && driverUserId === null) {
      throw new BadRequestException(
        'У своей машины нужен водитель из участников похода',
      );
    }

    if (!canEditTab && !(isOwn && driverUserId === userId)) {
      throw new ForbiddenException(
        'Машину заводит тот, кто ведёт трансфер, или сам водитель своей машины',
      );
    }

    if (driverUserId !== null) {
      await this.assertTraveler(manager, trip.id, driverUserId);
    }

    const car = await manager.save(
      manager.create(TripTransferCar, {
        tripId: trip.id,
        legId: leg.id,
        ownership: dto.ownership,
        driverUserId,
        driverName: isOwn ? null : this.driverName(dto.driverName),
        driverPhone: this.optional(dto.driverPhone, 40, 'Телефон водителя'),
        seats: dto.seats ?? null,
        note: this.note(dto.note),
      }),
    );

    // Водитель едет в своей машине: место он занимает, и в «без машины»
    // ему делать нечего.
    if (driverUserId !== null) {
      await this.placePassenger(manager, trip.id, leg.id, driverUserId, car.id);
    }

    return this.buildPlan(manager, trip, userId);
  }

  /**
   * Поправить машину.
   *
   * `ownership` не меняется намеренно: «своя стала наёмной» — это не правка
   * поля, а другая машина с другим водителем. Смену водителя, места и
   * заметки делает водитель этой машины и без права на вкладку.
   */
  async updateCar(
    userId: string,
    tripId: number,
    carId: number,
    dto: UpdateTransferCarDto,
  ): Promise<TripTransferDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);

    const car = await this.carOrFail(manager, trip.id, carId);
    await this.assertCanManageCar(trip, userId, car);

    if (dto.driverUserId !== undefined) {
      if (car.ownership === 'hired') {
        throw new BadRequestException(
          'У наёмной машины водителя в составе нет — правьте имя и телефон',
        );
      }

      if (dto.driverUserId === null) {
        throw new BadRequestException(
          'У своей машины водитель обязателен: некому ехать',
        );
      }

      await this.assertTraveler(manager, trip.id, dto.driverUserId);
      car.driverUserId = dto.driverUserId;
      car.driverName = null;
      await this.placePassenger(
        manager,
        trip.id,
        car.legId,
        dto.driverUserId,
        car.id,
      );
    }

    if (dto.driverName !== undefined) {
      car.driverName =
        car.ownership === 'hired' ? this.driverName(dto.driverName) : null;
    }
    if (dto.driverPhone !== undefined) {
      car.driverPhone = this.optional(dto.driverPhone, 40, 'Телефон водителя');
    }
    if (dto.seats !== undefined) car.seats = dto.seats;
    if (dto.note !== undefined) car.note = this.note(dto.note);

    await manager.save(car);

    return this.buildPlan(manager, trip, userId);
  }

  /**
   * Убрать машину: её пассажиры остаются в строке нераспределёнными.
   *
   * Так это делает и база (`ON DELETE SET NULL` на `car_id`), поэтому
   * в сервисе нет ни одного цикла «освободить пассажиров»: людей не теряем,
   * но показываем, что о них надо договориться заново.
   */
  async removeCar(
    userId: string,
    tripId: number,
    carId: number,
  ): Promise<TripTransferDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);

    const car = await this.carOrFail(manager, trip.id, carId);
    await this.assertCanManageCar(trip, userId, car);

    await manager.delete(TripTransferCar, { id: car.id });

    return this.buildPlan(manager, trip, userId);
  }

  // ───────────────────────────── пассажиры ─────────────────────────────

  /**
   * Поставить человека в строку.
   *
   * Себя — можно всегда (это и есть «я еду этой заброской»), остальных —
   * тому, кто ведёт вкладку, или водителю машины этой строки: заказчик
   * сказал «водитель выбирает пассажиров». Сажаем только тех, кто **идёт**:
   * «пока не решил» не занимает место, которое может понадобиться другому.
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
    await this.assertCanManagePeople(trip, userId, leg.id, dto.userId);

    await this.assertTraveler(manager, trip.id, dto.userId);

    const existing = await manager.findOne(TripTransferPassenger, {
      where: { legId: leg.id, userId: dto.userId },
    });
    if (existing) {
      throw new ConflictException('Этот человек уже едет этой строкой');
    }

    await manager.insert(TripTransferPassenger, {
      tripId: trip.id,
      legId: leg.id,
      userId: dto.userId,
      carId: null,
    });

    return this.buildPlan(manager, trip, userId);
  }

  /**
   * Место в машине: `carId` или `null` («едет, но без машины»).
   *
   * Машина обязана быть из этой же строки: одиночный внешний ключ этого
   * не держит (см. миграцию), поэтому проверяем здесь и отвечаем 400,
   * а не 500 от базы. Места проверяются только при посадке: если человек
   * уже в машине, повторная посадка ничего не меняет.
   */
  async seatPassenger(
    userId: string,
    tripId: number,
    legId: number,
    targetUserId: string,
    dto: SeatTransferPassengerDto,
  ): Promise<TripTransferDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);

    const leg = await this.legOrFail(manager, trip.id, legId);

    // Снять себя можно всегда («пассажир может отказаться»), а сесть
    // в чужую машину — только водителю или ведущему вкладку.
    await this.assertCanManagePeople(
      trip,
      userId,
      leg.id,
      targetUserId,
      dto.carId === null || dto.carId === undefined,
    );

    const row = await manager.findOne(TripTransferPassenger, {
      where: { legId: leg.id, userId: targetUserId },
    });
    if (!row) {
      throw new NotFoundException('Этот человек не едет этой строкой');
    }

    const carId = dto.carId ?? null;

    if (carId === null) {
      row.carId = null;
      await manager.save(row);
      return this.buildPlan(manager, trip, userId);
    }

    const car = await manager.findOne(TripTransferCar, {
      where: { id: String(carId), legId: leg.id },
    });
    if (!car) {
      throw new BadRequestException('Эта машина не из этой строки заброски');
    }

    if (row.carId !== car.id) await this.assertFreeSeat(manager, car);

    row.carId = car.id;
    await manager.save(row);

    return this.buildPlan(manager, trip, userId);
  }

  /** Снять человека со строки: он в ней больше не едет. */
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
    await this.assertCanManagePeople(trip, userId, leg.id, targetUserId);

    const row = await manager.findOne(TripTransferPassenger, {
      where: { legId: leg.id, userId: targetUserId },
    });
    if (!row) {
      throw new NotFoundException('Этот человек не едет этой строкой');
    }

    await manager.delete(TripTransferPassenger, { id: row.id });

    return this.buildPlan(manager, trip, userId);
  }

  // ───────────────────────────── сборка ответа ─────────────────────────────

  /**
   * Вкладка целиком: строки, машины, пассажиры, кого можно посадить.
   *
   * Имена берутся из `users` через `trip_participants`, а не хранятся
   * в строках: человек меняет отображаемое имя в профиле, и в трансфере
   * оно должно меняться тоже. Меняется и имя водителя своей машины —
   * поэтому у своей `driver_name` пуст, а у наёмной заполнен.
   */
  private async buildPlan(
    manager: EntityManager,
    trip: Trip,
    userId: string,
  ): Promise<TripTransferDto> {
    const [legs, cars, passengers, members, canEdit] = await Promise.all([
      manager.find(TripTransferLeg, {
        where: { tripId: trip.id },
        order: { position: 'ASC', id: 'ASC' },
      }),
      manager.find(TripTransferCar, {
        where: { tripId: trip.id },
        relations: { driver: { user: true } },
        order: { id: 'ASC' },
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

    const carsByLeg = new Map<string, TripTransferCar[]>();
    for (const car of cars) {
      const list = carsByLeg.get(car.legId) ?? [];
      list.push(car);
      carsByLeg.set(car.legId, list);
    }

    const passengersByLeg = new Map<string, TripTransferPassenger[]>();
    for (const passenger of passengers) {
      const list = passengersByLeg.get(passenger.legId) ?? [];
      list.push(passenger);
      passengersByLeg.set(passenger.legId, list);
    }

    const legDtos = legs.map((leg): TransferLegDto => {
      const legCars = carsByLeg.get(leg.id) ?? [];
      const legPassengers = passengersByLeg.get(leg.id) ?? [];

      const carDtos = legCars.map((car): TransferCarDto => {
        const inCar = legPassengers.filter(
          (passenger) => passenger.carId === car.id,
        );
        const driverName =
          car.driverName ?? car.driver?.user?.displayName ?? 'Водитель';

        return {
          id: car.id,
          ownership: car.ownership,
          driverUserId: car.driverUserId,
          driverName,
          driverPhone: car.driverPhone,
          seats: car.seats,
          // У наёмной водителя в составе нет, но место он занимает.
          occupied: inCar.length + (car.driverUserId === null ? 1 : 0),
          canEdit: canEdit || car.driverUserId === userId,
        };
      });

      return {
        id: leg.id,
        position: leg.position,
        departsAt: leg.departsAt === null ? null : leg.departsAt.toISOString(),
        fromPlace: leg.fromPlace,
        toPlace: leg.toPlace,
        mode: leg.mode,
        note: leg.note,
        cars: carDtos,
        passengers: legPassengers.map(
          (passenger): TransferPassengerDto => ({
            userId: passenger.userId,
            displayName: passenger.member?.user?.displayName ?? 'Участник',
            carId: passenger.carId,
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

    return {
      meetingPlace: trip.meetingPlace,
      canEdit,
      travelers,
      legs: legDtos,
    };
  }

  // ───────────────────────────── проверки ─────────────────────────────

  /**
   * Участник похода — или 403.
   *
   * `declined` не участник: он в подготовке не участвует (то же правило,
   * что у снаряжения, чек-листов и чатов). Гость вкладку не видит вовсе.
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

  /** Право на вкладку: организатор, соорганизатор или роль с этой вкладкой. */
  private async assertCanEditTab(trip: Trip, userId: string): Promise<void> {
    if (!(await this.trips.canEditTab(userId, trip, TRANSFER_TAB))) {
      throw new ForbiddenException(
        'Строки заброски правит тот, кому роль дала вкладку «Трансфер»',
      );
    }
  }

  /** Право на конкретную машину: вкладка или сам её водитель. */
  private async assertCanManageCar(
    trip: Trip,
    userId: string,
    car: TripTransferCar,
  ): Promise<void> {
    if (car.driverUserId === userId) return;

    if (!(await this.trips.canEditTab(userId, trip, TRANSFER_TAB))) {
      throw new ForbiddenException(
        'Машину правит тот, кто ведёт трансфер, или её водитель',
      );
    }
  }

  /**
   * Право управлять людьми строки: вкладка, водитель машины этой строки
   * или сам человек.
   *
   * `allowSelf` включается не всегда: поставить себя в строку («я еду этой
   * заброской») и снять себя из машины человек вправе всегда, а **сесть
   * в чужую машину без водителя — нет**: место даёт водитель, он и выбирает
   * пассажиров (формулировка заказчика).
   */
  private async assertCanManagePeople(
    trip: Trip,
    userId: string,
    legId: string,
    targetUserId: string,
    allowSelf = true,
  ): Promise<void> {
    if (allowSelf && targetUserId === userId) return;

    if (await this.trips.canEditTab(userId, trip, TRANSFER_TAB)) return;

    const drivesHere = await this.dataSource.manager.findOne(TripTransferCar, {
      where: { legId, driverUserId: userId },
    });
    if (drivesHere) return;

    throw new ForbiddenException(
      'Сажать и снимать пассажиров может тот, кто ведёт трансфер, водитель машины этой строки — или сам человек',
    );
  }

  /**
   * Кого можно посадить: только «иду».
   *
   * «Пока не решил» ещё не занимает место в машине (то же правило, что
   * у груза в снаряжении): иначе место досталось бы тому, кто может
   * не поехать, а тому, кто точно едет, — не досталось.
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
        'В заброску сажают только тех, кто идёт: «пока не решил» место не занимает',
      );
    }
  }

  /** Свободное место. Места не указаны — потолка нет. */
  private async assertFreeSeat(
    manager: EntityManager,
    car: TripTransferCar,
  ): Promise<void> {
    if (car.seats === null) return;

    const inCar = await manager.count(TripTransferPassenger, {
      where: { carId: car.id },
    });
    // Место водителя: у своей машины он уже в списке пассажиров,
    // у наёмной — нет, но занято.
    const occupied = inCar + (car.driverUserId === null ? 1 : 0);

    if (occupied >= car.seats) {
      throw new BadRequestException('В этой машине нет свободных мест');
    }
  }

  /**
   * Посадить человека в машину, добавив его в строку, если его там нет.
   *
   * Нужно водителю своей машины: он занимает место в ней с того момента,
   * как завёл машину, и отдельного «а теперь добавьте себя в строку» быть
   * не должно.
   */
  private async placePassenger(
    manager: EntityManager,
    tripId: string,
    legId: string,
    userId: string,
    carId: string,
  ): Promise<void> {
    const row = await manager.findOne(TripTransferPassenger, {
      where: { legId, userId },
    });

    if (row) {
      row.carId = carId;
      await manager.save(row);
      return;
    }

    await manager.insert(TripTransferPassenger, {
      tripId,
      legId,
      userId,
      carId,
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

    if (!leg) throw new NotFoundException('Строка заброски не найдена');

    return leg;
  }

  private async carOrFail(
    manager: EntityManager,
    tripId: string,
    carId: number,
  ): Promise<TripTransferCar> {
    const car = await manager.findOne(TripTransferCar, {
      where: { id: String(carId), tripId },
    });

    if (!car) throw new NotFoundException('Машина в трансфере не найдена');

    return car;
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

  private driverName(value: string | null | undefined): string {
    const name = value?.trim() ?? '';

    if (name.length === 0) {
      throw new BadRequestException(
        'У наёмной машины нужно имя водителя — иначе некому звонить',
      );
    }

    return name;
  }

  private optional(
    value: string | null | undefined,
    limit: number,
    field: string,
  ): string | null {
    if (value === null || value === undefined) return null;

    const trimmed = value.trim();

    if (trimmed.length === 0) return null;

    if (trimmed.length > limit) {
      throw new BadRequestException(`${field} — до ${limit} символов`);
    }

    return trimmed;
  }
}
