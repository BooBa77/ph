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
import { sqlValues } from '../users/sport-experience.types';
import {
  AddManualTripGearDto,
  CreateTripGearSectionDto,
  ProposeTripGearDto,
  TripGearItemDto,
  TripGearListDto,
  TripGearSectionDto,
  UpdateTripGearDto,
  UpdateTripGearSectionDto,
} from './dto/trip-gear.dto';
import { GearItem } from './entities/gear-item.entity';
import { TripGear } from './entities/trip-gear.entity';
import { TripGearSection } from './entities/trip-gear-section.entity';
import { GearService } from './gear.service';

/** Вкладка, право на правку которой открывает «Берём / Не берём». */
const GEAR_TAB: TripTab = 'gear';

/**
 * Личные разделы «Взял» по шаблону (05.11.2026).
 *
 * Заказчик назвал их в плане вкладки (`docs/ph/gear-tab.md` §3): «Снаряга»
 * и «Одежда». Это стартовый набор, а не ограничение: человек переименует,
 * удалит или добавит свои — «Альпинизм», «Пешка».
 */
const PERSONAL_SECTION_TEMPLATES = ['Снаряга', 'Одежда'] as const;

/**
 * Общественные шаблоны. «Табор» — если в «Ночёвках» есть стоянка или
 * готовка либо в походе есть палатка/тент: заказчик просил именно так.
 */
const TENT_TYPE_CODES = ['tent', 'shelter'] as const;

/** Коды типов похода, под которые план вкладки просил раздел. */
const CYCLING_TYPE_CODE = 'trip_cycling';
const WATER_TYPE_CODES = ['trip_water', 'trip_kayak', 'trip_rafting'] as const;

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

  /** Весь список вещей похода и разделы. Видят участники. */
  async list(userId: string, tripId: number): Promise<TripGearListDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    const participant = await this.assertParticipant(manager, trip.id, userId);

    /**
     * Шаблоны разделов заводятся при первом открытии вкладки — как группы
     * каталога, а не отдельной кнопкой. Отметка «уже сеяли» лежит в походе
     * и в участии, поэтому удалённый шаблон не возвращается.
     */
    await this.ensureSections(trip, participant, userId);

    const rows = await manager.find(TripGear, {
      where: { tripId: trip.id },
      relations: { gearItem: { gearType: true, attributes: { gearTypeAttribute: true } } },
      order: { id: 'ASC' },
    });

    const sections = await manager.find(TripGearSection, {
      where: [
        { tripId: trip.id, scope: 'shared' },
        { tripId: trip.id, scope: 'personal', ownerUserId: userId },
      ],
      order: { sortOrder: 'ASC', id: 'ASC' },
    });

    return this.toList(rows, sections, userId);
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
        // Секцию пишет только «Добавить ещё»: обычная вещь показывается
        // по типу, и пометка ей не нужна (01.11.2026).
        routeSection: dto.routeSection ?? null,
      }),
    );
    saved.gearItem = item;

    return TripGearItemDto.from(saved, userId);
  }

  /**
   * Правка вещи: статус, несущий и разделы.
   *
   * Поля — разные права, и проверяются они все: частично применить запрос
   * было бы нельзя, иначе ответ соврал бы о том, что сохранилось.
   * Присваиваем только присланное: `PATCH` без поля не меняет его,
   * а `assignedUserId: null` — осознанное «освободить».
   *
   * **Разделы (05.11.2026).** Общественный раздел — право вкладки, как
   * у статуса: разложить снаряжение по разделам — часть решения по составу.
   * Личный раздел — только тому, кому вещь назначена: чужой «Взял» —
   * не моя раскладка. При смене несущего личный раздел обнуляется: вещь
   * уехала в чужой рюкзак и там начнёт с корня.
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

      if (row.assignedUserId !== dto.assignedUserId) {
        // Вещь уехала другому — её место в моём «Взял» больше не моё.
        row.personalSectionId = null;
      }
      row.assignedUserId = dto.assignedUserId;
    }

    if (dto.sharedSectionId !== undefined) {
      if (!(await this.trips.canEditTab(userId, trip, GEAR_TAB))) {
        throw new ForbiddenException(
          'Разделы общественного снаряжения раскладывает тот, кто ведёт снаряжение похода',
        );
      }

      if (dto.sharedSectionId === null) {
        row.sharedSectionId = null;
      } else {
        const section = await this.findSection(manager, trip.id, dto.sharedSectionId);
        if (section.scope !== 'shared') {
          throw new BadRequestException(
            'В «Берём» можно положить вещь только в общественный раздел',
          );
        }
        row.sharedSectionId = section.id;
      }
    }

    if (dto.personalSectionId !== undefined) {
      if (dto.personalSectionId === null) {
        row.personalSectionId = null;
      } else {
        const section = await this.findSection(
          manager,
          trip.id,
          dto.personalSectionId,
        );

        // Чужой личный раздел не существует (404): перебирать чужие
        // раскладки через эту ручку нечего.
        if (section.scope !== 'personal' || section.ownerUserId !== userId) {
          throw new NotFoundException('Раздел снаряжения не найден');
        }

        if (row.assignedUserId !== userId) {
          throw new ForbiddenException(
            'В личный раздел кладут только вещь, которая едет в моём рюкзаке',
          );
        }
        row.personalSectionId = section.id;
      }
    }

    return TripGearItemDto.from(await manager.save(row), userId);
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
          routeSection: dto.routeSection ?? null,
        }),
      );
      saved.gearItem = item;

      return saved;
    });

    return TripGearItemDto.from(row, userId);
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

  // ───────────────────────── разделы «Берём» и «Взял» ─────────────────────────

  /**
   * Новый раздел (05.11.2026).
   *
   * Общественный создаёт тот, кому дали вкладку: «Пешая часть» — структура
   * похода, а не личная полка. Личный — любой участник, и владельцем
   * становится он сам: остальным этот раздел не виден.
   *
   * `parentId` — вложенность. Родитель обязан быть из того же похода,
   * того же вида и с тем же владельцем: личный раздел не должен оказаться
   * внутри общественного, иначе один человек правил бы общую структуру.
   */
  async createSection(
    userId: string,
    tripId: number,
    dto: CreateTripGearSectionDto,
  ): Promise<TripGearSectionDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);

    const title = dto.title.trim();
    if (title.length === 0) {
      throw new BadRequestException('Название раздела не может быть пустым');
    }

    const ownerUserId = dto.scope === 'personal' ? userId : null;

    if (dto.scope === 'shared' && !(await this.trips.canEditTab(userId, trip, GEAR_TAB))) {
      throw new ForbiddenException(
        'Общественные разделы создаёт тот, кто ведёт снаряжение похода',
      );
    }

    const parent = await this.resolveParent(
      manager,
      trip.id,
      dto.parentId ?? null,
      dto.scope,
      ownerUserId,
    );

    const sortOrder = await this.nextSortOrder(
      manager,
      trip.id,
      dto.scope,
      ownerUserId,
      parent?.id ?? null,
    );

    const saved = await manager.save(
      manager.create(TripGearSection, {
        tripId: trip.id,
        scope: dto.scope,
        ownerUserId,
        parentId: parent?.id ?? null,
        title,
        sortOrder,
      }),
    );

    return TripGearSectionDto.from(saved);
  }

  /**
   * Переименовать, переставить или переложить раздел.
   *
   * Перенос в себя или в своего потомка — 400: иначе раздел исчез бы
   * из дерева, и вернуть его было бы нечем.
   */
  async updateSection(
    userId: string,
    tripId: number,
    sectionId: number,
    dto: UpdateTripGearSectionDto,
  ): Promise<TripGearSectionDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);

    const section = await this.findSection(manager, trip.id, sectionId);
    await this.assertSectionManage(trip, section, userId);

    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (title.length === 0) {
        throw new BadRequestException('Название раздела не может быть пустым');
      }
      section.title = title;
    }

    if (dto.sortOrder !== undefined) {
      section.sortOrder = dto.sortOrder;
    }

    if (dto.parentId !== undefined) {
      const parent = await this.resolveParent(
        manager,
        trip.id,
        dto.parentId,
        section.scope,
        section.ownerUserId,
      );

      if (parent?.id === section.id) {
        throw new BadRequestException('Раздел не может быть вложен в себя');
      }

      await this.assertNotDescendant(manager, section, parent?.id ?? null);
      section.parentId = parent?.id ?? null;
    }

    return TripGearSectionDto.from(await manager.save(section));
  }

  /**
   * Удалить раздел. Вещи не теряются: они остаются в походе и оказываются
   * в корне большой секции — за это отвечает `ON DELETE SET NULL`.
   * Дочерние разделы уходят каскадом, и их вещи освобождаются так же.
   */
  async removeSection(
    userId: string,
    tripId: number,
    sectionId: number,
  ): Promise<void> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);

    const section = await this.findSection(manager, trip.id, sectionId);
    await this.assertSectionManage(trip, section, userId);

    await manager.delete(TripGearSection, { id: section.id });
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

  // ───────────────────────── разделы: шаблоны и проверки ─────────────────────────

  /**
   * Шаблоны разделов при первом открытии вкладки (05.11.2026).
   *
   * Отметки живут в `trips.gear_sections_seeded_at` и
   * `trip_participants.gear_sections_seeded_at`. Второй раз не сеем:
   * удалённый «Табор» иначе возвращался бы при каждом открытии, а заказчик
   * просил именно возможность удалять.
   *
   * Строки похода блокируются на время засева: два первых открытия
   * одновременно иначе завели бы по два «Табора». Случай редкий, но
   * дубликат шаблона — это не «два раздела», а ошибка, которую человек
   * увидит сразу.
   */
  private async ensureSections(
    trip: Trip,
    participant: TripParticipant,
    userId: string,
  ): Promise<void> {
    if (trip.gearSectionsSeededAt && participant.gearSectionsSeededAt) return;

    await this.dataSource.transaction(async (tx) => {
      const lockedTrip = await tx.findOne(Trip, {
        where: { id: trip.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedTrip) throw new NotFoundException('Поход не найден');

      if (!lockedTrip.gearSectionsSeededAt) {
        // Разделы могли остаться от прошлой жизни похода (шаблон завели
        // до сброса отметки) — второй «Табор» не нужен.
        const existing = await tx.count(TripGearSection, {
          where: { tripId: trip.id, scope: 'shared' },
        });
        if (existing === 0) {
          const titles = await this.sharedTemplateTitles(tx, trip.id);
          await this.insertSections(tx, trip.id, 'shared', null, titles);
        }

        await tx.update(
          Trip,
          { id: trip.id },
          { gearSectionsSeededAt: new Date() },
        );
      }

      const lockedParticipant = await tx.findOne(TripParticipant, {
        where: { tripId: trip.id, userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (lockedParticipant && !lockedParticipant.gearSectionsSeededAt) {
        // Участник мог выйти и вернуться: его личные разделы остались
        // (владелец — пользователь, а не участие), и второй «Снаряга»
        // рядом с первым был бы мусором.
        const existing = await tx.count(TripGearSection, {
          where: { tripId: trip.id, scope: 'personal', ownerUserId: userId },
        });
        if (existing === 0) {
          await this.insertSections(
            tx,
            trip.id,
            'personal',
            userId,
            [...PERSONAL_SECTION_TEMPLATES],
          );
        }

        await tx.update(
          TripParticipant,
          { tripId: trip.id, userId },
          { gearSectionsSeededAt: new Date() },
        );
      }
    });
  }

  /**
   * Какие общественные разделы положены походу по его данным.
   *
   * «Табор» — если в «Ночёвках» есть стоянка (палатка, изба, машина) или
   * готовка, либо в снаряжении похода есть палатка/тент: слова заказчика —
   * «если есть ночёвки и/или Готовка». «к Велосипедам» и «Вода» — по типу
   * похода; водного типа в справочнике пока нет, но список кодов готов,
   * чтобы раздел появился сам, когда тип заведут.
   */
  private async sharedTemplateTitles(
    manager: EntityManager,
    tripId: string,
  ): Promise<string[]> {
    const camping = await manager.query(
      `SELECT 1
         FROM "trip_route_nights" n
        WHERE n."trip_id" = $1
          AND (n."kind" IN ('tent', 'hut', 'car') OR n."cooking" IS NOT NULL)
        UNION ALL
       SELECT 1
         FROM "trip_gear" tg
         JOIN "gear_items" gi ON gi."id" = tg."gear_item_id"
         JOIN "gear_types" gt ON gt."id" = gi."gear_type_id"
        WHERE tg."trip_id" = $1
          AND gt."code" IN (${sqlValues(TENT_TYPE_CODES)})
        LIMIT 1`,
      [tripId],
    );

    const typeCodes: string[] = (
      await manager.query(
        `SELECT a."code"
           FROM "trip_types" tt
           JOIN "calendar_activity_types" a ON a."id" = tt."activity_type_id"
          WHERE tt."trip_id" = $1`,
        [tripId],
      )
    ).map((row: { code: string }) => row.code);

    const titles: string[] = [];
    if (camping.length > 0) titles.push('Табор');
    if (typeCodes.includes(CYCLING_TYPE_CODE)) titles.push('к Велосипедам');
    if (typeCodes.some((code) => (WATER_TYPE_CODES as readonly string[]).includes(code))) {
      titles.push('Вода');
    }

    return titles;
  }

  /** Шаблоны одного вида — корневыми разделами с шагом порядка 10. */
  private async insertSections(
    manager: EntityManager,
    tripId: string,
    scope: 'shared' | 'personal',
    ownerUserId: string | null,
    titles: string[],
  ): Promise<void> {
    if (titles.length === 0) return;

    await manager.insert(
      TripGearSection,
      titles.map((title, index) => ({
        tripId,
        scope,
        ownerUserId,
        parentId: null,
        title,
        sortOrder: (index + 1) * 10,
      })),
    );
  }

  /** Следующий порядок среди соседей: новый раздел встаёт последним. */
  private async nextSortOrder(
    manager: EntityManager,
    tripId: string,
    scope: 'shared' | 'personal',
    ownerUserId: string | null,
    parentId: string | null,
  ): Promise<number> {
    const rows: Array<{ max: number | string | null }> = await manager.query(
      `SELECT COALESCE(MAX("sort_order"), 0) AS "max"
         FROM "trip_gear_sections"
        WHERE "trip_id" = $1
          AND "scope" = $2
          AND "owner_user_id" IS NOT DISTINCT FROM $3
          AND "parent_id" IS NOT DISTINCT FROM $4`,
      [tripId, scope, ownerUserId, parentId],
    );

    return Number(rows[0]?.max ?? 0) + 10;
  }

  /** Раздел этого похода или 404. */
  private async findSection(
    manager: EntityManager,
    tripId: string,
    sectionId: number | string,
  ): Promise<TripGearSection> {
    const section = await manager.findOne(TripGearSection, {
      where: { id: String(sectionId), tripId },
    });
    if (!section) throw new NotFoundException('Раздел снаряжения не найден');

    return section;
  }

  /**
   * Родитель для раздела: из этого же похода, того же вида и с тем же
   * владельцем. `null` — корень большой секции.
   */
  private async resolveParent(
    manager: EntityManager,
    tripId: string,
    parentId: number | null,
    scope: 'shared' | 'personal',
    ownerUserId: string | null,
  ): Promise<TripGearSection | null> {
    if (parentId === null) return null;

    const parent = await this.findSection(manager, tripId, parentId);

    if (parent.scope !== scope || parent.ownerUserId !== ownerUserId) {
      throw new BadRequestException(
        'Родительский раздел должен быть того же вида и владельца',
      );
    }

    return parent;
  }

  /**
   * Нельзя переложить раздел в собственного потомка: дерево потеряло бы
   * корень. Идём от нового родителя вверх до корня — цепочка короткая,
   * глубина разделов измеряется единицами.
   */
  private async assertNotDescendant(
    manager: EntityManager,
    section: TripGearSection,
    parentId: string | null,
  ): Promise<void> {
    let currentId = parentId;
    let depth = 0;

    while (currentId !== null) {
      if (currentId === section.id) {
        throw new BadRequestException(
          'Раздел нельзя вложить в себя или в свой подраздел',
        );
      }

      if (++depth > 100) break;

      const current = await manager.findOne(TripGearSection, {
        where: { id: currentId, tripId: section.tripId },
      });
      currentId = current?.parentId ?? null;
    }
  }

  /**
   * Право на правку раздела. Личный — только владельцу, и чужой личный
   * раздел не существует (404): остальным он не виден даже по id.
   * Общественный — тому, кому роль дала вкладку.
   */
  private async assertSectionManage(
    trip: Trip,
    section: TripGearSection,
    userId: string,
  ): Promise<void> {
    if (section.scope === 'personal') {
      if (section.ownerUserId !== userId) {
        throw new NotFoundException('Раздел снаряжения не найден');
      }
      return;
    }

    if (!(await this.trips.canEditTab(userId, trip, GEAR_TAB))) {
      throw new ForbiddenException(
        'Общественные разделы правит тот, кто ведёт снаряжение похода',
      );
    }
  }

  /** Список с итогом: сумма только утверждённых весов. */
  private toList(
    rows: TripGear[],
    sections: TripGearSection[],
    viewerId: string,
  ): TripGearListDto {
    let totalWeightGrams = 0;
    let itemsWithoutWeight = 0;

    for (const row of rows) {
      if (row.status !== 'approved') continue;

      if (row.gearItem.weightGrams === null) itemsWithoutWeight += 1;
      else totalWeightGrams += row.gearItem.weightGrams;
    }

    return {
      items: rows.map((row) => TripGearItemDto.from(row, viewerId)),
      sections: sections.map((section) => TripGearSectionDto.from(section)),
      totalWeightGrams,
      itemsWithoutWeight,
    };
  }
}
