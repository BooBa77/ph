import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { GEAR_TYPE_CODES } from '../gear/gear.types';
import {
  AddSleepingDto,
  LodgeRouteDto,
  RouteLodgerDto,
  RouteNightDto,
  RouteNightInputDto,
  RouteSleepingDto,
  RouteTravelerDto,
  SaveRouteNightsDto,
  TripRouteDto,
} from './dto/trip-route.dto';
import { TripParticipant } from './entities/trip-participant.entity';
import { TripRouteLodger } from './entities/trip-route-lodger.entity';
import { TripRouteNight } from './entities/trip-route-night.entity';
import { TripRouteSleeping } from './entities/trip-route-sleeping.entity';
import { Trip } from './entities/trip.entity';
import {
  COOKING_NIGHT_KINDS,
  PLACE_NIGHT_KINDS,
  ROUTE_TAB,
  SLEEPING_TYPE_CODES,
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

/** Строка личной вещи ночёвки: хватает названия, типа и веса. */
interface SleepingRow {
  id: string;
  gear_item_id: string;
  type_code: string;
  title: string;
  weight_grams: number | null;
}

/**
 * Вкладка «Ночёвки»: таблица ночей, личные спальники и кто где живёт.
 *
 * **Правится целиком.** Экран — сетка ночей; правка по одной строке
 * заставляла бы клиента помнить id и порядок. Поэтому `PUT` присылает все
 * ночи, сервис заменяет набор в одной транзакции и отвечает вкладкой.
 * Экран применяет правку на лету (01.11.2026): кнопок «Сохранить» больше
 * нет, каждое изменение уходит этим же `PUT`.
 *
 * **У ночи один вариант** (01.11.2026). Заказчик отменил комбинированные
 * ночи: «На одну ночь один вариант ночёвки». `kind` и `cooking` — поля
 * ночи, ссылок на палатку и машину нет: распределение по палаткам действует
 * на весь поход, а машины с «Трансфером» не связаны.
 *
 * **Кто где живёт — одно место на весь поход** (ответ заказчика 31.10.2026):
 * отдельные ручки посадки в палатку, а не «люди в варианте ночи». Человек
 * живёт в палатке всю дорогу, и ночная таблица лишь показывает это по каждой
 * ночи.
 *
 * **Спальник и коврик — личные** (01.11.2026). `GET /route` отдаёт строки
 * только смотрящему: чужих вещей не видит никто, включая организатора.
 * Виртуальные участники сюда не попадают — они для общественного снаряжения.
 *
 * **Права.** Видят участники похода (403 остальным — как «Трансфер»),
 * правят ночи те, у кого право вкладки `route` (`canEditTab`), а палатку,
 * как и рейс в «Трансфере», дополнительно правит её хозяин. Личные вещи
 * правит каждый сам — право вкладки для них не нужно.
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
   * Сохранить таблицу ночёвок целиком: ночи, место, даты и вариант.
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
      this.assertNights(dto.nights);

      // Замена набора: распределение людей висит на палатках, а не на
      // ночах, и переживает правку спокойно.
      await trx.delete(TripRouteNight, { tripId: trip.id });

      for (const night of dto.nights) {
        await trx.insert(TripRouteNight, {
          tripId: trip.id,
          position: night.position,
          place: this.placeOf(night),
          nightDate: night.date ?? null,
          kind: night.kind ?? null,
          cooking: night.cooking ?? null,
        });
      }
    });

    return this.buildPlan(manager, trip, userId);
  }

  /**
   * Добавить себе спальник или коврик.
   *
   * Вещь — обязательно предмет **своего** каталога и обязательно типа
   * «Спальник» или «Коврик»: секция личная, чужую вещь сюда не положить.
   * Повторное добавление той же вещи ничего не ломает (`ON CONFLICT
   * DO NOTHING`), а количество вещей не ограничено.
   */
  async addSleeping(
    userId: string,
    tripId: number,
    dto: AddSleepingDto,
  ): Promise<TripRouteDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);
    await this.assertSleepingItem(manager, userId, dto.gearItemId);

    await manager
      .createQueryBuilder()
      .insert()
      .into(TripRouteSleeping)
      .values({
        tripId: trip.id,
        userId,
        gearItemId: dto.gearItemId,
      })
      .orIgnore()
      .execute();

    return this.buildPlan(manager, trip, userId);
  }

  /**
   * Убрать свою вещь из ночёвки.
   *
   * Удаление идёт по `(id, trip, user)`: чужую строку им не убрать, и это
   * не ошибка — повторное удаление тоже возвращает вкладку, как освобождение
   * места в палатке.
   */
  async removeSleeping(
    userId: string,
    tripId: number,
    sleepingId: string,
  ): Promise<TripRouteDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);

    await manager.delete(TripRouteSleeping, {
      id: sleepingId,
      tripId: trip.id,
      userId,
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

  /** Собрать вкладку: ночи, личные вещи, места жительства и кого можно сажать. */
  private async buildPlan(
    manager: EntityManager,
    trip: Trip,
    userId: string,
  ): Promise<TripRouteDto> {
    const [nights, sleeping, lodgers, members, canEdit] = await Promise.all([
      manager.find(TripRouteNight, {
        where: { tripId: trip.id },
        order: { position: 'ASC', id: 'ASC' },
      }),
      this.sleepingRows(manager, trip.id, userId),
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

    const nightDtos = nights.map(
      (night): RouteNightDto => ({
        id: night.id,
        position: night.position,
        date: night.nightDate,
        place: night.place,
        kind: night.kind,
        cooking: night.cooking,
      }),
    );

    const sleepingDtos = sleeping.map(
      (row): RouteSleepingDto => ({
        id: row.id,
        gearItemId: row.gear_item_id,
        typeCode: row.type_code,
        title: row.title,
        weightGrams: row.weight_grams,
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

    return {
      canEdit,
      nights: nightDtos,
      sleeping: sleepingDtos,
      lodgers: lodgerDtos,
      travelers,
    };
  }

  /** Ночи: номера и правила одной ночи. */
  private assertNights(nights: RouteNightInputDto[]): void {
    const positions = new Set<number>();

    for (const night of nights) {
      if (positions.has(night.position)) {
        throw new BadRequestException('Номер ночи повторяется');
      }

      positions.add(night.position);
      this.assertNight(night);
    }
  }

  /**
   * Правила одной ночи: что с чем сочетается.
   *
   * У ночи один вариант (01.11.2026), поэтому смешивать больше нечего.
   * Пустой вариант — законное состояние: «ещё не выбрали», на экране это
   * считается «идём всю ночь», места у такой ночи быть не может.
   */
  private assertNight(night: RouteNightInputDto): void {
    const kind = night.kind ?? null;
    const place = this.placeOf(night);

    if (
      place !== null &&
      (kind === null || !PLACE_NIGHT_KINDS.includes(kind))
    ) {
      throw new BadRequestException(
        'Место — только у ночи с ночлегом: выберите вариант или уберите район',
      );
    }

    if (
      night.cooking !== null &&
      night.cooking !== undefined &&
      (kind === null || !COOKING_NIGHT_KINDS.includes(kind))
    ) {
      throw new BadRequestException(
        'Готовка — только у палатки, избы и машины',
      );
    }
  }

  /**
   * Личные спальники и коврики **смотрящего**.
   *
   * Не всей группы: секция личная, и заказчик отдельно сказал, что спальники
   * виртуальных участников организатору не показываются. Фильтр по
   * `is_virtual` — страховка: войти виртуальным нельзя, но если модель
   * когда-нибудь позволит, личное не должно утечь.
   */
  private async sleepingRows(
    manager: EntityManager,
    tripId: string,
    userId: string,
  ): Promise<SleepingRow[]> {
    return (await manager.query(
      `SELECT s.id::text AS id,
              s.gear_item_id::text AS gear_item_id,
              gt.code AS type_code,
              gi.title,
              gi.weight_grams
         FROM trip_route_sleeping s
         JOIN gear_items gi ON gi.id = s.gear_item_id
         JOIN gear_types gt ON gt.id = gi.gear_type_id
         JOIN users u ON u.id = s.user_id
        WHERE s.trip_id = $1
          AND s.user_id = $2
          AND u.is_virtual = false
          AND gt.code = ANY($3::text[])
        ORDER BY s.id ASC`,
      [tripId, userId, SLEEPING_TYPE_CODES],
    )) as SleepingRow[];
  }

  /** Вещь для ночёвки — своя и только спальник или коврик. */
  private async assertSleepingItem(
    manager: EntityManager,
    userId: string,
    gearItemId: string,
  ): Promise<void> {
    const rows = (await manager.query(
      `SELECT gt.code
         FROM gear_items gi
         JOIN gear_types gt ON gt.id = gi.gear_type_id
        WHERE gi.id = $1::bigint
          AND gi.owner_user_id = $2
          AND gi.is_trip_only = false`,
      [gearItemId, userId],
    )) as { code: string }[];

    const item = rows[0];

    if (item === undefined) {
      throw new BadRequestException(
        'Спальник и коврик — вещи из вашего каталога снаряжения',
      );
    }

    if (!(SLEEPING_TYPE_CODES as readonly string[]).includes(item.code)) {
      throw new BadRequestException(
        'В ночёвку берут спальник или коврик — у этой вещи другой тип',
      );
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

  /**
   * Палатки похода одним запросом: название вещи, тип и хозяин.
   *
   * Через `trip_gear → gear_items → gear_types` — иначе тип пришлось бы
   * спрашивать по одной вещи, а мест жительства в походе несколько.
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
