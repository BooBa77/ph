import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { TripParticipant } from '../trips/entities/trip-participant.entity';
import { Trip } from '../trips/entities/trip.entity';
import type { TripTab } from '../trips/trip-tabs';
import { TripsService } from '../trips/trips.service';
import { User } from '../users/entities/user.entity';
import {
  AddManualTripGearDto,
  ProposeTripGearDto,
  TripGearItemDto,
  TripGearListDto,
  UpdateTripGearDto,
} from './dto/trip-gear.dto';
import { GearItem } from './entities/gear-item.entity';
import { TripGear } from './entities/trip-gear.entity';
import { GearService } from './gear.service';

/** Вкладка, право на правку которой открывает «Берём / Не берём». */
const GEAR_TAB: TripTab = 'gear';

/**
 * Общественное снаряжение похода — вкладка «Снаряжение» (Ф7).
 *
 * ## Правила доступа
 *
 * | Действие | Кто |
 * |---|---|
 * | видеть список | участник похода |
 * | предложить предмет из своего каталога | участник похода |
 * | добавить вещь вручную (себе) | участник похода |
 * | добавить вещь вручную виртуальному хозяину | организатор похода |
 * | «Берём / Не берём» | право на вкладку «Снаряжение» (завхоз, организатор…) |
 * | назначить несущего (перетащить) | **любой участник** |
 * | убрать вещь | владелец вещи или тот, кто ведёт снаряжение |
 *
 * Три разных права — это три решения заказчика 21.10.2026
 * (`gear-distribution.md` §5): распределять вручную может любой участник
 * («люди взрослые и договорятся сами»), утверждать состав — тот, кому
 * роль дала вкладку, а предлагать чужое снаряжение нельзя вообще: вещь
 * принадлежит владельцу каталога.
 *
 * ## Чего здесь нет
 *
 * Автоматического распределения, веса личных вещей по участникам и
 * экрана «Рюкзаки» здесь нет — это следующий шаг Ф7: сначала пакеты
 * продуктов в «Питании», потом расчёт и экран. Здесь только таблица
 * похода и то, что можно сделать руками.
 *
 * Уход участника на уровне модели уже работает: его вещи уходят из похода
 * каскадом, назначение на него обнуляется (`trip_gear` ссылается на
 * `trip_participants`). Отказ (`declined`) строку участника не удаляет,
 * поэтому вещи отказавшегося так сами не уйдут — это часть шага «уход
 * участника», вместе с палатками и машинами.
 */
@Injectable()
export class TripGearService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly trips: TripsService,
    /**
     * Каталог вещей — общий путь заведения (`GearService.createItem`):
     * тип, характеристики и обязательные значения у каталога и у «вручную»
     * одни и те же. Вторая копия этих правил означала бы, что однажды
     * одноразовая вещь заведётся без обязательного значения.
     */
    private readonly gear: GearService,
  ) {}

  /** Весь список вещей похода и вес утверждённых. Видят участники. */
  async list(userId: string, tripId: number): Promise<TripGearListDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);

    const rows = await manager.find(TripGear, {
      where: { tripId: trip.id },
      relations: { gearItem: { gearType: true, attributes: { gearTypeAttribute: true } } },
      order: { id: 'ASC' },
    });

    return this.toList(rows);
  }

  /**
   * Предложить предмет из своего каталога.
   *
   * Владелец — тот, кто прислал запрос: его предмет из его каталога.
   * Несущий по умолчанию — владелец, но только если он **идёт**: вещь
   * человека «пока не решил» не должна числиться в чьём-то рюкзаке,
   * поэтому она сразу ложится в «нераспределённые» (§6.6).
   *
   * Повторная попытка предложить тот же предмет — 409: строка одна,
   * и молча вернуть существующую значило бы соврать, что предмет
   * добавлен ещё раз.
   */
  async propose(
    userId: string,
    tripId: number,
    dto: ProposeTripGearDto,
  ): Promise<TripGearItemDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    const participant = await this.assertParticipant(manager, trip.id, userId);

    // Чужой предмет не существует (404, как в каталоге): перебирать
    // id чужих списков снаряжения нечего.
    const item = await manager.findOne(GearItem, {
      where: { id: String(dto.gearItemId), ownerUserId: userId },
      relations: { gearType: true, attributes: { gearTypeAttribute: true } },
    });
    if (!item) throw new NotFoundException('Предмет не найден');

    const existing = await manager.findOne(TripGear, {
      where: { tripId: trip.id, gearItemId: item.id },
    });
    if (existing) {
      throw new ConflictException('Этот предмет уже предложен в походе');
    }

    const saved = await manager.save(
      manager.create(TripGear, {
        tripId: trip.id,
        gearItemId: item.id,
        ownerUserId: userId,
        assignedUserId: participant.status === 'going' ? userId : null,
        status: 'proposed',
      }),
    );
    saved.gearItem = item;

    return TripGearItemDto.from(saved);
  }

  /**
   * Правка вещи: статус и/или несущий.
   *
   * Два поля — два права, и проверяются они оба: частично применить
   * запрос было бы нельзя, иначе ответ соврал бы о том, что сохранилось.
   * Присваиваем только присланное: `PATCH` без поля не меняет его,
   * а `assignedUserId: null` — осознанное «освободить».
   */
  async update(
    userId: string,
    tripId: number,
    id: number,
    dto: UpdateTripGearDto,
  ): Promise<TripGearItemDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);

    const row = await manager.findOne(TripGear, {
      where: { id: String(id), tripId: trip.id },
      relations: { gearItem: { gearType: true, attributes: { gearTypeAttribute: true } } },
    });
    if (!row) throw new NotFoundException('Вещь в снаряжении похода не найдена');

    if (dto.status !== undefined) {
      if (!(await this.trips.canEditTab(userId, trip, GEAR_TAB))) {
        throw new ForbiddenException(
          '«Берём / не берём» решает тот, кто ведёт снаряжение похода',
        );
      }
      row.status = dto.status;
    }

    if (dto.assignedUserId !== undefined) {
      await this.assertCarrier(manager, trip.id, dto.assignedUserId);
      row.assignedUserId = dto.assignedUserId;
    }

    return TripGearItemDto.from(await manager.save(row));
  }

  /**
   * Добавить вещь в поход вручную — второй путь заполнения снаряжения
   * (30.10.2026).
   *
   * Три случая, и все они — одна ручка:
   *
   * | хозяин | что получается |
   * |---|---|
   * | я сам, без `addToCatalog` | одноразовая вещь похода: «бутылка бензина на розжиг» |
   * | я сам, `addToCatalog: true` | вещь в моём каталоге + строка в походе |
   * | виртуальный участник (организатор) | одноразовая вещь: каталога у него нет |
   *
   * **Флаг «Регулярное» есть только у настоящего хозяина** — у человека
   * без аккаунта каталога нет вовсе, и `addToCatalog: true` при нём это
   * ошибка клиента (400), а не молчаливая одноразовая вещь.
   *
   * **Другому настоящему участнику вещь не добавляют** (решение заказчика
   * 31.10.2026): каждый добавляет своё сам, иначе чужой каталог заполнялся
   * бы за его спиной. Поэтому `ownerUserId` настоящего пользователя,
   * который не я, — 403.
   *
   * Статус новой строки — `proposed`, как у предложенной из каталога:
   * «берём» решает тот, кто ведёт снаряжение, а ручное добавление — это
   * предложение, а не решение.
   */
  async addManual(
    userId: string,
    tripId: number,
    dto: AddManualTripGearDto,
  ): Promise<TripGearItemDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);

    const owner = await this.resolveManualOwner(
      manager,
      trip,
      userId,
      dto.ownerUserId,
    );
    const addToCatalog = dto.addToCatalog === true;

    if (addToCatalog && owner.isVirtual) {
      throw new BadRequestException(
        'У человека без аккаунта нет каталога: «в список для регулярного использования» — только для настоящего владельца',
      );
    }

    const row = await this.dataSource.transaction(async (tx) => {
      const item = await this.gear.createItem(tx, owner.userId, {
        typeId: dto.typeId,
        attributes: dto.attributes,
        title: dto.title ?? null,
        weightGrams: dto.weightGrams ?? null,
        tripOnly: owner.isVirtual || !addToCatalog,
      });

      const ownerParticipant = await tx.findOne(TripParticipant, {
        where: { tripId: trip.id, userId: owner.userId },
      });

      // Несущий по умолчанию — владелец, но только если он **идёт**:
      // вещь человека «пока не решил» не числится в чьём-то рюкзаке
      // (то же правило, что у `propose`).
      const saved = await tx.save(
        tx.create(TripGear, {
          tripId: trip.id,
          gearItemId: item.id,
          ownerUserId: owner.userId,
          assignedUserId:
            ownerParticipant?.status === 'going' ? owner.userId : null,
          status: 'proposed',
        }),
      );
      saved.gearItem = item;

      return saved;
    });

    return TripGearItemDto.from(row);
  }

  /**
   * Убрать вещь из похода.
   *
   * Свою — владелец (передумал брать), чужую — тот, кто ведёт снаряжение
   * (решение по составу). Остальным нельзя: «перекинуть» можно
   * перетаскиванием, а «выкинуть чужую палатку» — нет.
   *
   * Предмет из каталога при этом не трогается: вещь остаётся у владельца,
   * из похода уходит только решение её взять.
   */
  async remove(userId: string, tripId: number, id: number): Promise<void> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);

    const row = await manager.findOne(TripGear, {
      where: { id: String(id), tripId: trip.id },
      relations: { gearItem: true },
    });
    if (!row) throw new NotFoundException('Вещь в снаряжении похода не найдена');

    if (row.ownerUserId !== userId) {
      if (!(await this.trips.canEditTab(userId, trip, GEAR_TAB))) {
        throw new ForbiddenException(
          'Чужую вещь убирает владелец или тот, кто ведёт снаряжение похода',
        );
      }
    }

    await this.dataSource.transaction(async (tx) => {
      await tx.delete(TripGear, { id: row.id });

      // Одноразовая вещь уходит вместе со строкой похода: каталогу она
      // не принадлежит, и, оставшись, висела бы в базе невидимой никому
      // (каталог одноразовые не отдаёт). Вещь из каталога не трогаем —
      // из похода уходит только решение её взять.
      if (row.gearItem.isTripOnly) {
        await tx.delete(GearItem, { id: row.gearItemId });
      }
    });
  }

  // ───────────────────────── внутреннее ─────────────────────────

  /**
   * Кому добавляем вещь «вручную».
   *
   * Три исхода:
   *
   * - хозяина в теле нет или это я — я сам (`isVirtual: false`);
   * - хозяин — человек без аккаунта из **этого** похода — только
   *   организатору: «виртуальные участники… он сам управляет ими»;
   * - хозяин — настоящий пользователь, который не я, — 403: вещь другому
   *   участнику не добавляют, каждый добавляет своё сам (заказчик
   *   31.10.2026).
   *
   * Проверки идут в этом порядке намеренно: «это чужой настоящий человек»
   * важнее «он не в походе», иначе организатор получил бы 400 про состав
   * вместо прямого «так нельзя». Несуществующий id — 404: перебирать
   * пользователей через эту ручку нечего.
   */
  private async resolveManualOwner(
    manager: EntityManager,
    trip: Trip,
    userId: string,
    ownerUserId: string | null | undefined,
  ): Promise<{ userId: string; isVirtual: boolean }> {
    if (!ownerUserId || ownerUserId === userId) {
      return { userId, isVirtual: false };
    }

    const owner = await manager.findOne(User, { where: { id: ownerUserId } });
    if (!owner || owner.deletedAt !== null) {
      throw new NotFoundException('Пользователь не найден');
    }

    if (!owner.isVirtual) {
      throw new ForbiddenException(
        'Другому участнику вещь не добавляют: каждый добавляет своё снаряжение сам',
      );
    }

    if (trip.organizerUserId !== userId) {
      throw new ForbiddenException(
        'За человека без аккаунта вещь добавляет организатор похода',
      );
    }

    const participant = await manager.findOne(TripParticipant, {
      where: { tripId: trip.id, userId: owner.id },
    });
    if (!participant || participant.status === 'declined') {
      throw new BadRequestException('Хозяин вещи — не участник этого похода');
    }

    return { userId: owner.id, isVirtual: true };
  }

  /**
   * Участник похода — или 403.
   *
   * `declined` не участник: он в подготовке не участвует (то же правило,
   * что у чек-листов и чатов). Гость (зарегистрированный не-участник)
   * вкладку «Снаряжение» не видит — у него только «Гостевая».
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
        'Снаряжение похода доступно только его участникам',
      );
    }

    return participant;
  }

  /**
   * Проверка несущего: `null` — освободить (это не ошибка), иначе —
   * участник, который **идёт**.
   *
   * «Пока не решил» ещё не несёт груз (решение заказчика в §5): в плитках
   * рюкзаков его нет, и назначить на него вещь значило бы спрятать вещь
   * с экрана. `declined` — тем более.
   */
  private async assertCarrier(
    manager: EntityManager,
    tripId: string,
    userId: string | null,
  ): Promise<void> {
    if (userId === null) return;

    const participant = await manager.findOne(TripParticipant, {
      where: { tripId, userId },
    });

    if (!participant || participant.status !== 'going') {
      throw new BadRequestException(
        'Груз можно назначить только участнику, который идёт',
      );
    }
  }

  /** Список с итогом: сумма только утверждённых весов. */
  private toList(rows: TripGear[]): TripGearListDto {
    let totalWeightGrams = 0;
    let itemsWithoutWeight = 0;

    for (const row of rows) {
      if (row.status !== 'approved') continue;

      if (row.gearItem.weightGrams === null) itemsWithoutWeight += 1;
      else totalWeightGrams += row.gearItem.weightGrams;
    }

    return {
      items: rows.map((row) => TripGearItemDto.from(row)),
      totalWeightGrams,
      itemsWithoutWeight,
    };
  }
}
