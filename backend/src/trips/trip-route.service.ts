import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';

import { GEAR_TYPE_CODES } from '../gear/gear.types';
import {
  LodgeRouteDto,
  RouteLodgerDto,
  RouteNightDto,
  RouteNightInputDto,
  RouteOptionDto,
  RouteTravelerDto,
  SaveRouteNightsDto,
  TripRouteDto,
} from './dto/trip-route.dto';
import { TripParticipant } from './entities/trip-participant.entity';
import { TripRouteLodger } from './entities/trip-route-lodger.entity';
import { TripRouteNight } from './entities/trip-route-night.entity';
import { TripRouteOption } from './entities/trip-route-option.entity';
import { TripTransferLeg } from './entities/trip-transfer-leg.entity';
import { Trip } from './entities/trip.entity';
import {
  COOKING_NIGHT_KINDS,
  PLACE_NIGHT_KINDS,
  ROUTE_TAB,
  SOLO_NIGHT_KINDS,
  type NightKind,
  type RouteLodgerStatus,
} from './trip-route.types';
import { TripsService } from './trips.service';

/** Строка проверки палатки: вещь похода, её тип и хозяин. */
interface TentRow {
  id: string;
  owner_user_id: string;
  status: string;
  title: string;
  code: string;
}

/**
 * Вкладка «Ночёвки»: таблица ночей, варианты и кто где живёт.
 *
 * **Правится целиком.** Экран — сетка ночей; правка по одной строке
 * заставляла бы клиента помнить id и порядок, а половина правил (место
 * привязано к набору вариантов ночи, дубли запрещены) проверяется только
 * на ночи целиком. Поэтому `PUT` присылает все ночи, сервис заменяет
 * набор в одной транзакции и отвечает вкладкой.
 *
 * **Кто где живёт — одно место на весь поход** (ответ заказчика 31.10.2026):
 * отдельные ручки посадки в палатку, а не «люди в варианте ночи». Человек
 * живёт в палатке всю дорогу, и ночная таблица лишь показывает это по каждой
 * ночи.
 *
 * **Права.** Видят участники похода (403 остальным — как «Трансфер»),
 * правят те, у кого право вкладки `route` (`canEditTab`), а палатку,
 * как и рейс в «Трансфере», дополнительно правит её хозяин.
 */
@Injectable()
export class TripRouteService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly trips: TripsService,
  ) {}

  /** Вкладка целиком. Видят участники похода. */
  async getPlan(userId: string, tripId: number): Promise<TripRouteDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);

    return this.buildPlan(manager, trip, userId);
  }

  /**
   * Сохранить таблицу ночёвок целиком: ночи, место, даты и варианты.
   *
   * Распределение людей не трогается: оно живёт отдельно и на весь поход
   * (`trip_route_lodgers`), поэтому «переставил ночи» не сбрасывает,
   * кто где спит.
   */
  async saveNights(
    userId: string,
    tripId: number,
    dto: SaveRouteNightsDto,
  ): Promise<TripRouteDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);
    await this.assertCanEdit(trip, userId);

    await this.dataSource.transaction(async (trx) => {
      await this.assertNights(trx, trip, dto.nights);

      // Замена набора: каскад уносит варианты, а распределение людей
      // висит на палатках, а не на ночах, и переживает правку спокойно.
      await trx.delete(TripRouteNight, { tripId: trip.id });

      for (const night of dto.nights) {
        const place = this.placeOf(night);
        const saved = await trx.save(TripRouteNight, {
          tripId: trip.id,
          position: night.position,
          place,
          nightDate: night.date ?? null,
        });

        if (night.options.length === 0) continue;

        await trx.insert(
          TripRouteOption,
          night.options.map((option) => ({
            tripId: trip.id,
            nightId: saved.id,
            kind: option.kind,
            tentGearId: option.kind === 'tent' ? option.tentGearId! : null,
            carLegId: option.kind === 'car' ? option.carLegId! : null,
            cooking: option.cooking ?? null,
          })),
        );
      }
    });

    return this.buildPlan(manager, trip, userId);
  }

  /**
   * Посадить человека в палатку (себя или другого).
   *
   * Себя: в свою палатку или тому, кто ведёт вкладку, — сразу живёт;
   * в чужую — заявкой хозяину. Другого сажает хозяин палатки или тот,
   * кто ведёт вкладку, и сразу: заявка от чужого имени была бы странной.
   */
  async lodge(
    userId: string,
    tripId: number,
    targetUserId: string,
    dto: LodgeRouteDto,
  ): Promise<TripRouteDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);

    const tent = await this.tentOf(manager, trip.id, dto.tentGearId);
    await this.assertTraveler(manager, trip.id, targetUserId);

    const canEdit = await this.trips.canEditTab(userId, trip, ROUTE_TAB);
    const isTentOwner = tent.owner_user_id === userId;

    if (targetUserId !== userId && !isTentOwner && !canEdit) {
      throw new ForbiddenException(
        'В чужую палатку сажает её хозяин или тот, кто ведёт вкладку',
      );
    }

    const status: RouteLodgerStatus =
      targetUserId === userId && !isTentOwner && !canEdit
        ? 'requested'
        : 'accepted';

    const existing = await manager.findOne(TripRouteLodger, {
      where: { tripId: trip.id, userId: targetUserId },
    });

    if (existing === null) {
      await manager.insert(TripRouteLodger, {
        tripId: trip.id,
        userId: targetUserId,
        tentGearId: tent.id,
        status,
      });
    } else {
      await manager.update(
        TripRouteLodger,
        { id: existing.id },
        { tentGearId: tent.id, status },
      );
    }

    return this.buildPlan(manager, trip, userId);
  }

  /**
   * Принять заявку: «Попросился» → «живёт».
   *
   * Принимает хозяин палатки или тот, кто ведёт вкладку. Повторное принятие
   * ничего не ломает — заявка уже принята.
   */
  async acceptLodger(
    userId: string,
    tripId: number,
    targetUserId: string,
  ): Promise<TripRouteDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);

    const lodger = await manager.findOne(TripRouteLodger, {
      where: { tripId: trip.id, userId: targetUserId },
    });

    if (lodger === null) {
      throw new NotFoundException('Человек пока ни в одной палатке');
    }

    const tent = await this.tentOf(manager, trip.id, lodger.tentGearId);
    const canEdit = await this.trips.canEditTab(userId, trip, ROUTE_TAB);

    if (tent.owner_user_id !== userId && !canEdit) {
      throw new ForbiddenException(
        'Заявку принимает хозяин палатки или тот, кто ведёт вкладку',
      );
    }

    if (lodger.status !== 'accepted') {
      await manager.update(
        TripRouteLodger,
        { id: lodger.id },
        { status: 'accepted' },
      );
    }

    return this.buildPlan(manager, trip, userId);
  }

  /**
   * Освободить место: уйти самому, выселить хозяину палатки или тому,
   * кто ведёт вкладку. Повторный вызов ничего не делает — место и так
   * свободно.
   */
  async releaseLodger(
    userId: string,
    tripId: number,
    targetUserId: string,
  ): Promise<TripRouteDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);

    const lodger = await manager.findOne(TripRouteLodger, {
      where: { tripId: trip.id, userId: targetUserId },
    });

    if (lodger !== null) {
      const canEdit = await this.trips.canEditTab(userId, trip, ROUTE_TAB);
      const tent = await this.tentOf(manager, trip.id, lodger.tentGearId);

      if (
        targetUserId !== userId &&
        tent.owner_user_id !== userId &&
        !canEdit
      ) {
        throw new ForbiddenException(
          'Убрать человека из палатки может он сам, хозяин палатки или тот, кто ведёт вкладку',
        );
      }

      await manager.delete(TripRouteLodger, { id: lodger.id });
    }

    return this.buildPlan(manager, trip, userId);
  }

  /** Собрать вкладку: ночи, варианты, места жительства и кого можно сажать. */
  private async buildPlan(
    manager: EntityManager,
    trip: Trip,
    userId: string,
  ): Promise<TripRouteDto> {
    const [nights, options, lodgers, members, canEdit] = await Promise.all([
      manager.find(TripRouteNight, {
        where: { tripId: trip.id },
        order: { position: 'ASC', id: 'ASC' },
      }),
      manager.find(TripRouteOption, {
        where: { tripId: trip.id },
        order: { id: 'ASC' },
      }),
      manager.find(TripRouteLodger, {
        where: { tripId: trip.id },
        relations: { member: { user: true } },
        order: { id: 'ASC' },
      }),
      manager.find(TripParticipant, {
        where: { tripId: trip.id, status: 'going' },
        relations: { user: true },
      }),
      this.trips.canEditTab(userId, trip, ROUTE_TAB),
    ]);

    const tents = await this.tentRows(
      manager,
      trip.id,
      options
        .map((option) => option.tentGearId)
        .filter((id): id is string => id !== null),
    );
    const tentLabels = new Map(tents.map((row) => [row.id, row.title]));

    const carIds = options
      .map((option) => option.carLegId)
      .filter((id): id is string => id !== null);
    const cars =
      carIds.length === 0
        ? []
        : await manager.find(TripTransferLeg, {
            where: { tripId: trip.id, id: In(carIds) },
          });
    const carLabels = new Map(
      cars.map((leg) => [leg.id, `${leg.fromPlace} → ${leg.toPlace}`]),
    );

    const optionsByNight = new Map<string, TripRouteOption[]>();
    for (const option of options) {
      const list = optionsByNight.get(option.nightId) ?? [];
      list.push(option);
      optionsByNight.set(option.nightId, list);
    }

    const nightDtos = nights.map(
      (night): RouteNightDto => ({
        id: night.id,
        position: night.position,
        date: night.nightDate,
        place: night.place,
        options: (optionsByNight.get(night.id) ?? []).map(
          (option): RouteOptionDto => ({
            id: option.id,
            kind: option.kind,
            tentGearId: option.tentGearId,
            tentTitle:
              option.tentGearId === null
                ? null
                : (tentLabels.get(option.tentGearId) ?? null),
            carLegId: option.carLegId,
            carTitle:
              option.carLegId === null
                ? null
                : (carLabels.get(option.carLegId) ?? null),
            cooking: option.cooking,
          }),
        ),
      }),
    );

    const lodgerDtos = lodgers.map(
      (lodger): RouteLodgerDto => ({
        userId: lodger.userId,
        displayName: lodger.member?.user?.displayName ?? '',
        tentGearId: lodger.tentGearId,
        status: lodger.status,
      }),
    );

    const travelers = members
      .map(
        (member): RouteTravelerDto => ({
          userId: member.userId,
          displayName: member.user?.displayName ?? '',
        }),
      )
      .sort((left, right) =>
        left.displayName.localeCompare(right.displayName, 'ru'),
      );

    return { canEdit, nights: nightDtos, lodgers: lodgerDtos, travelers };
  }

  /** Ночи: номера и правила ночи целиком. */
  private async assertNights(
    manager: EntityManager,
    trip: Trip,
    nights: RouteNightInputDto[],
  ): Promise<void> {
    const positions = new Set<number>();

    for (const night of nights) {
      if (positions.has(night.position)) {
        throw new BadRequestException('Номер ночи повторяется');
      }

      positions.add(night.position);

      await this.assertNight(manager, trip, night);
    }
  }

  /**
   * Правила одной ночи: что с чем сочетается и куда ссылаются варианты.
   *
   * Пустой список вариантов — законное состояние: «ещё не выбрали»,
   * на экране это считается «идём всю ночь». Места у такой ночи быть
   * не может: некуда.
   */
  private async assertNight(
    manager: EntityManager,
    trip: Trip,
    night: RouteNightInputDto,
  ): Promise<void> {
    const kinds = night.options.map((option) => option.kind);
    const solo = kinds.filter((kind) =>
      SOLO_NIGHT_KINDS.includes(kind as NightKind),
    );

    if (solo.length > 0 && kinds.length > 1) {
      throw new BadRequestException(
        '«Идём всю ночь» и «в пути» не смешиваются с другими вариантами',
      );
    }

    const shared = kinds.filter((kind) => kind === 'hotel' || kind === 'hut');

    if (new Set(shared).size !== shared.length) {
      throw new BadRequestException(
        '«Гостиница» или «изба» — по одной строке в ночи',
      );
    }

    const place = this.placeOf(night);
    const needsPlace = kinds.some((kind) =>
      PLACE_NIGHT_KINDS.includes(kind as NightKind),
    );

    if (place !== null && !needsPlace) {
      throw new BadRequestException(
        'Место — только у ночи с ночлегом: выберите вариант или уберите район',
      );
    }

    const tentIds = night.options
      .map((option) => option.tentGearId)
      .filter((id): id is string => id !== null && id !== undefined);

    if (new Set(tentIds).size !== tentIds.length) {
      throw new BadRequestException('Одна палатка в ночи — одна строка');
    }

    for (const option of night.options) {
      if (option.kind === 'tent') {
        if (!option.tentGearId) {
          throw new BadRequestException(
            'У «Палатки» выберите палатку из снаряжения похода',
          );
        }

        await this.tentOf(manager, trip.id, option.tentGearId);
      }

      if (option.kind === 'car') {
        if (!option.carLegId) {
          throw new BadRequestException(
            'У «Машины» выберите своё ТС из «Трансфера»',
          );
        }

        await this.carOf(manager, trip.id, option.carLegId);
      }

      if (
        option.cooking !== null &&
        option.cooking !== undefined &&
        !COOKING_NIGHT_KINDS.includes(option.kind)
      ) {
        throw new BadRequestException(
          'Готовка — только у палатки, избы и машины',
        );
      }
    }
  }

  /** Палатка из снаряжения похода — или 400 с человеческим текстом. */
  private async tentOf(
    manager: EntityManager,
    tripId: string,
    tentGearId: string,
  ): Promise<TentRow> {
    const rows = await this.tentRows(manager, tripId, [tentGearId]);
    const tent = rows[0];

    if (tent === undefined) {
      throw new BadRequestException(
        'Палатка не из снаряжения этого похода — добавьте её в снаряжение',
      );
    }

    if (tent.status === 'declined') {
      throw new BadRequestException(
        'Эта палатка не едет в походе — выберите другую',
      );
    }

    if (tent.code !== GEAR_TYPE_CODES.tent) {
      throw new BadRequestException(
        'Ночевать можно только в палатке: у этой вещи другой тип',
      );
    }

    return tent;
  }

  /** Своё ТС из «Трансфера» — или 400. Общественный рейс машиной не бывает. */
  private async carOf(
    manager: EntityManager,
    tripId: string,
    carLegId: string,
  ): Promise<TripTransferLeg> {
    const leg = await manager.findOne(TripTransferLeg, {
      where: { tripId, id: carLegId },
    });

    if (leg === null) {
      throw new BadRequestException(
        'Машина не из «Трансфера» этого похода — заведите её в «Трансфере»',
      );
    }

    if (!leg.isOwnVehicle) {
      throw new BadRequestException(
        'Машина — только своё ТС из «Трансфера»: автобус и поезд ночлегом не считаются',
      );
    }

    return leg;
  }

  /**
   * Палатки похода одним запросом: название вещи, тип и хозяин.
   *
   * Через `trip_gear → gear_items → gear_types` — иначе тип пришлось бы
   * спрашивать по одной вещи, а ночь может ссылаться на несколько палаток.
   */
  private async tentRows(
    manager: EntityManager,
    tripId: string,
    gearIds: string[],
  ): Promise<TentRow[]> {
    if (gearIds.length === 0) return [];

    return (await manager.query(
      `SELECT tg.id::text AS id,
              tg.owner_user_id,
              tg.status,
              gi.title,
              gt.code
         FROM trip_gear tg
         JOIN gear_items gi ON gi.id = tg.gear_item_id
         JOIN gear_types gt ON gt.id = gi.gear_type_id
        WHERE tg.trip_id = $1
          AND tg.id = ANY($2::bigint[])`,
      [tripId, gearIds],
    )) as TentRow[];
  }

  /** Место ночёвки: `''` и пробелы — это «не записали», то есть `NULL`. */
  private placeOf(night: RouteNightInputDto): string | null {
    const place = (night.place ?? '').trim();

    if (place.length === 0) return null;

    return place;
  }

  /** Место жительства занимает только тот, кто идёт. */
  private async assertTraveler(
    manager: EntityManager,
    tripId: string,
    userId: string,
  ): Promise<void> {
    const participant = await manager.findOne(TripParticipant, {
      where: { tripId, userId },
    });

    if (participant === null || participant.status !== 'going') {
      throw new BadRequestException(
        'Жить в палатке может только тот, кто идёт в поход',
      );
    }
  }

  /**
   * Участник похода — или 403. `declined` не участник: он в подготовке
   * не участвует (то же правило, что у трансфера и снаряжения).
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
        'Ночёвки похода доступны только его участникам',
      );
    }

    return participant;
  }

  /** Править таблицу — право вкладки `route`. */
  private async assertCanEdit(trip: Trip, userId: string): Promise<void> {
    if (await this.trips.canEditTab(userId, trip, ROUTE_TAB)) return;

    throw new ForbiddenException('Ночёвки правит тот, кто ведёт вкладку');
  }
}
