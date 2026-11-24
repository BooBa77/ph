import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';

import { Checklist } from '../checklists/entities/checklist.entity';
import { ChecklistItem } from '../checklists/entities/checklist-item.entity';
import { TripParticipant } from '../trips/entities/trip-participant.entity';
import { TripMealPackage } from '../trips/entities/trip-meal-package.entity';
import { Trip } from '../trips/entities/trip.entity';
import { TripEventsService } from '../trips/trip-events.service';
import { TripMealsService } from '../trips/trip-meals.service';
import type { TripTab } from '../trips/trip-tabs';
import { SLEEPING_NIGHT_KINDS } from '../trips/trip-route.types';
import { TripsService } from '../trips/trips.service';
import { User } from '../users/entities/user.entity';
import { sqlValues } from '../users/sport-experience.types';
import {
  AddManualTripGearDto,
  AddTripGearPersonalDto,
  AssignTripGearPackageDto,
  CreateTripGearSectionDto,
  GearHolderDto,
  ProposeTripGearDto,
  TripGearItemDto,
  TripGearListDto,
  TripGearLoadBackpackDto,
  TripGearLoadDto,
  TripGearLoadPersonalDto,
  TripGearLoadPersonalPackageDto,
  TripGearLoadPersonalUnitDto,
  TripGearLoadUnitDto,
  TripGearPersonalDto,
  TripGearSectionDto,
  TripGearSleepingDto,
  UpdateTripGearDto,
  UpdateTripGearPersonalDto,
  UpdateTripGearSectionDto,
} from './dto/trip-gear.dto';
import { GearItem } from './entities/gear-item.entity';
import { GearType } from './entities/gear-type.entity';
import { TripGear } from './entities/trip-gear.entity';
import { TripGearSection } from './entities/trip-gear-section.entity';
import { TripPersonalGear } from './entities/trip-personal-gear.entity';
import {
  CAMP_SECTION_TYPE_CODES,
  FIRST_AID_TYPE_CODE,
  PERSONAL_FOOD_PACKAGE_ID,
} from './gear.types';
import {
  activeHolders,
  assertGearUidFree,
  gearTitleOf,
} from './gear-uid';
import { GearService } from './gear.service';
import {
  allocateLoad,
  loadUnitKey,
  type LoadPerson,
  type LoadUnit,
} from './trip-gear-load';

/** Вкладка, право на правку которой открывает «Берём / Не берём». */
const GEAR_TAB: TripTab = 'gear';

/**
 * Шаблоны разделов (06.11.2026: с кодом, а не только с названием).
 *
 * Заказчик назвал личные разделы в плане вкладки (`docs/ph/gear-tab.md` §3):
 * «Снаряга» и «Одежда». 06.11.2026 он объяснил, что такое личные вещи:
 * «то, что помимо общественного — одежда, каска, трекинговые палочки»,
 * и попросил раздел **«в палатку»** перед ними, если в «Ночёвках» есть
 * ночь не в гостинице. Туда автоматически попадает содержимое секции
 * «Спальник» — оно личное и раньше в «Берём» не попадало.
 *
 * Код хранится в разделе (`template_code`), потому что по нему ищется
 * шаблон после переименования: название человек меняет, и искать «Табор»
 * по слову значит терять раздел после первого же переименования.
 */
const SHARED_SECTION_TEMPLATES = [
  { code: 'camp', title: 'Табор' },
  { code: 'bikes', title: 'к Велосипедам' },
  { code: 'water', title: 'Вода' },
] as const;

const PERSONAL_SECTION_TEMPLATES = [
  { code: 'clothes', title: 'Одежда' },
  { code: 'gear', title: 'Снаряга' },
] as const;

/**
 * Личный раздел, который наполняется из «Ночёвок» (06.11.2026).
 *
 * Заказчик: «если эта секция есть (ночёвки не в гостинице), то также
 * создаём раздел „в палатку“ в секции … Взял (перед Одежда и Снаряга)».
 * В нём показываются строки секции «Спальник» смотрящего — спальник,
 * коврик и всё, что он туда добавил. Копий в снаряжении похода нет:
 * вещь остаётся личной и в распределение груза не входит.
 */
const TENT_INSIDE_SECTION_CODE = 'tent_inside';
const TENT_INSIDE_SECTION_TITLE = 'в палатку';

/** Код общего раздела «Табор» — в него автораскладка кладёт вещи «Ночёвок». */
const CAMP_SECTION_CODE = 'camp';

/** Шаблон раздела: код для поиска и название для человека. */
interface SectionTemplate {
  code: string;
  title: string;
}

/**
 * Строка личной вещи из «Спальника» — как её читает SQL.
 *
 * `gear_uid` и `deleted_at` нужны архиву (11.11.2026): по ключу ищутся живые
 * клоны мягко удалённой вещи, чтобы ответить «она есть у Анны», а не
 * «снаряжение недоступно».
 */
interface SleepingRow {
  id: string;
  gear_item_id: string;
  gear_uid: string;
  deleted_at: Date | null;
  type_code: string;
  type_name: string;
  title: string;
  weight_grams: number | null;
}

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
    /**
     * Канал «вкладка изменилась» (06.11.2026): второй участник видит
     * перетасовку вещей без перезагрузки страницы. Событие — сигнал
     * перечитать `GET /gear`; готовый DTO не рассылается, потому что он
     * зависит от смотрящего (чужие личные разделы в нём обнулены).
     */
    private readonly events: TripEventsService,
    /**
     * Пакеты еды — часть того же груза (06.11.2026). Вес пакета выводится
     * из раскладки «Питания», и считать его второй раз здесь значило бы
     * держать две формулы одного числа.
     */
    private readonly tripMeals: TripMealsService,
  ) {}

  /**
   * Кто вправе слушать поток изменений вкладки (06.11.2026).
   *
   * Правило то же, что у `GET /gear`: участник похода, но не отказавшийся.
   * Отдельный метод, а не проверка в контроллере: `declined` и приватность
   * считаются здесь, и вторая копия условия однажды открыла бы поток
   * постороннему. Разделы при этом не засеиваются — слушать можно и до
   * первого открытия вкладки.
   */
  async assertCanWatch(userId: string, tripId: number): Promise<void> {
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(this.dataSource.manager, trip.id, userId);
  }

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

    /**
     * Личное из «Ночёвок» (06.11.2026): раздел «в палатку» показывает
     * спальник, коврик и всё, что человек положил в свою секцию «Спальник».
     * Эти строки живут в `trip_route_sleeping`, в `trip_gear` их копий нет,
     * поэтому они приезжают отдельным массивом — экран не склеивает
     * две таблицы сам.
     */
    const sleepingRows = await this.sleepingRows(manager, trip.id, userId);
    const personalRows = await this.personalRows(manager, trip.id, userId);

    /**
     * Архив похода (11.11.2026): у мягко удалённой вещи ищем живые клоны
     * по `gear_uid`. Один запрос на весь ответ: строк с удалёнными вещами
     * в живом походе единицы, а по запросу на строку вкладка грузилась бы
     * заметно дольше.
     */
    const deletedUids = new Set<string>([
      ...rows
        .filter((row) => row.gearItem.deletedAt !== null)
        .map((row) => row.gearItem.gearUid),
      ...personalRows
        .filter((row) => row.gearItem.deletedAt !== null)
        .map((row) => row.gearItem.gearUid),
      ...sleepingRows
        .filter((row) => row.deleted_at !== null)
        .map((row) => row.gear_uid),
    ]);
    const holders = await activeHolders(manager, [...deletedUids]);
    const holdersOf = (gearUid: string) => holders.get(gearUid) ?? [];

    return this.toList(rows, sections, sleepingRows, personalRows, userId, {
      holdersOf,
    });
  }

  /**
   * Раскладка груза по рюкзакам — `GET /gear/load` (06.11.2026).
   *
   * «Снаряжение» — связующая вкладка: в рюкзаки едут вещи похода
   * и пакеты из «Питания», а палатки и котлы приходят из «Ночёвок» через
   * ту же таблицу `trip_gear`. Поэтому ответ собирается из трёх источников,
   * а не из одного списка.
   *
   * **Вещи только утверждённые.** «Не берём» и «предложено» в рюкзак
   * не кладут: это ещё не решение (`gear-distribution.md` §3–§4).
   *
   * **Личное не считается.** Личные вещи человека в доли не входят
   * и в чужих плитках не показываются — «твоя проблема» (§5). Здесь их
   * нет вовсе, и это правило, а не забытое поле.
   *
   * Доля (`targetWeightGrams`) и отклонение от неё считаются всегда, даже
   * без нажатия кнопки: человеку полезно видеть, куда он идёт. Сама
   * раскладка при чтении **не меняется** — иначе чужая правка терялась бы
   * от простого открытия вкладки.
   */
  async load(userId: string, tripId: number): Promise<TripGearLoadDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);

    await this.assertParticipant(manager, trip.id, userId);

    return this.buildLoad(manager, trip, userId);
  }

  /**
   * «Автоматически распределить груз» — `POST /gear/auto-distribute`.
   *
   * Решения заказчика 21.10.2026 (`gear-distribution.md` §4–§5):
   *
   * - **полный сброс.** Прежние назначения стираются: кнопка нужна, чтобы
   *   начать с чистого листа, а не чтобы доспорить с прошлым расчётом;
   * - раскладывает по захардкоженным принципам: своё — владельцу, тяжёлое
   *   вперёд, остаток и все пакеты — тому, у кого больше свободной доли;
   * - **аптечка закреплена** за медиком — единственное исключение;
   * - право — у того, кому роль дала вкладку «Снаряжение»: раскладка груза
   *   это решение по составу, как «берём / не берём». Перетаскивать
   *   отдельные вещи после этого может по-прежнему любой участник.
   *
   * Расчёт идёт по снимку данных в транзакции: между «прочитали вещи»
   * и «записали назначения» второй человек мог перетащить палатку, и без
   * общей транзакции кнопка затёрла бы его правку наполовину.
   */
  async autoDistribute(
    userId: string,
    tripId: number,
  ): Promise<TripGearLoadDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);

    await this.assertParticipant(manager, trip.id, userId);

    if (!(await this.trips.canEditTab(userId, trip, GEAR_TAB))) {
      throw new ForbiddenException(
        'Распределить груз автоматически может тот, кому открыта вкладка «Снаряжение»',
      );
    }

    const data = await this.collectLoad(manager, trip);
    const allocation = allocateLoad(data.units, data.people);

    await this.dataSource.transaction(async (tx) => {
      await tx.query(
        `UPDATE "trip_gear" SET "assigned_user_id" = NULL WHERE "trip_id" = $1`,
        [trip.id],
      );
      // Личные пакеты не трогаем: свою еду человек несёт сам.
      await tx.query(
        `UPDATE "trip_meal_packages" SET "assigned_user_id" = NULL
          WHERE "trip_id" = $1 AND "eater_user_id" IS NULL`,
        [trip.id],
      );

      const gearByUser = new Map<string, string[]>();
      const packagesByUser = new Map<string, string[]>();
      for (const unit of data.units) {
        const carrier = allocation.assignments.get(
          loadUnitKey(unit.kind, unit.id),
        );
        if (!carrier) continue;

        /**
         * Аптечка не хранится: её место у доктора и так, а писать
         * `trip_gear.assigned_user_id` некуда — строки нет. Поэтому
         * в сохранение она не попадает, но в ответе остаётся у доктора.
         */
        if (unit.kind === 'firstAid') continue;

        const bucket =
          unit.kind === 'gear' ? gearByUser : packagesByUser;
        const list = bucket.get(carrier) ?? [];
        list.push(unit.id);
        bucket.set(carrier, list);
      }

      for (const [carrier, ids] of gearByUser) {
        await tx.query(
          `UPDATE "trip_gear" SET "assigned_user_id" = $1
            WHERE "trip_id" = $2 AND "id" = ANY($3::bigint[])`,
          [carrier, trip.id, ids],
        );
      }
      for (const [carrier, ids] of packagesByUser) {
        await tx.query(
          `UPDATE "trip_meal_packages" SET "assigned_user_id" = $1
            WHERE "trip_id" = $2 AND "id" = ANY($3::bigint[])
              AND "eater_user_id" IS NULL`,
          [carrier, trip.id, ids],
        );
      }
    });

    // Второй участник должен увидеть новую раскладку, не перезагружая
    // вкладку: канал тот же, что у перетаскивания вещи.
    this.events.emitGear(trip.id, userId);

    return this.buildLoad(manager, trip, userId);
  }
  /**
   * Кто несёт пакет еды — `PATCH /gear/packages/:packageId` (06.11.2026).
   *
   * Права — как у перетаскивания вещи: **любой участник**. Заказчик:
   * люди взрослые и договариваются сами, «перекинь из рюкзака жены ко мне
   * обед пятого дня» не должно идти через организатора.
   *
   * Личный пакет автономного питания так назначить нельзя: `eater_user_id`
   * значит, что человек ест это сам, и «назначить» его другому — потерять
   * смысл личного слоя «Питания». Пакет общего котла нельзя отдать тому,
   * кто питается отдельно: его рюкзак в раскладке еды не участвует
   * (решение заказчика 06.11.2026).
   */
  async assignPackage(
    userId: string,
    tripId: number,
    packageId: number,
    dto: AssignTripGearPackageDto,
  ): Promise<TripGearLoadDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);

    const pack = await manager.findOne(TripMealPackage, {
      where: { id: String(packageId), tripId: trip.id },
    });
    if (!pack) throw new NotFoundException('Пакет не найден');
    if (pack.eaterUserId !== null) {
      throw new BadRequestException(
        'Личную еду участник несёт сам — общий пакет назначается, личный нет',
      );
    }

    const carrier = dto.assignedUserId ?? null;
    await this.assertCarrier(manager, trip.id, carrier);

    /**
     * Питается отдельно — общий котёл не несёт (06.11.2026).
     *
     * Заказчик: «Рюкзаки питающихся самостоятельно в этом не участвуют» —
     * речь о распределении общей еды. Свою человек несёт сам, и пакет
     * общего котла в его рюкзаке был бы грузом, который он не ест.
     */
    if (carrier !== null) {
      const participant = await manager.findOne(TripParticipant, {
        where: { tripId: trip.id, userId: carrier },
      });
      if (participant?.eatsSeparately) {
        throw new BadRequestException(
          'Участник питается отдельно — общую еду ему не назначают',
        );
      }
    }

    pack.assignedUserId = carrier;
    await manager.save(pack);

    this.events.emitGear(trip.id, userId);

    return this.buildLoad(manager, trip, userId);
  }

  /**
   * Предложить предмет в снаряжение похода.
   *
   * **Свой или родного (10.11.2026, вечер).** Заказчик: «у родных
   * снаряжение общее… В походе родные равноправно могут использовать
   * снаряжение». Поэтому предмет ищется в своём каталоге **и в каталогах
   * родных**; чужой (не родного) по-прежнему не существует (404).
   *
   * **Владелец строки — тот, кто выставил.** Слова заказчика: «Кто выставил
   * снарягу для общественных нужд, тот считается и владельцем». Поэтому
   * `owner_user_id` — автор запроса, даже если предмет лежит в каталоге
   * родного: с ним вещь едет в рюкзаке, он её убирает и он же отвечает
   * за неё в походе. Каталог при этом не меняется: `gear_items
   * .owner_user_id` остаётся настоящим хозяином вещи.
   *
   * Несущий по умолчанию — владелец строки, но только если он **идёт**:
   * вещь человека «пока не решил» не должна числиться в чьём-то рюкзаке,
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

    // Предмет ищется в своём каталоге (11.11.2026): у каждого родного
    // лежит свой клон вещи с тем же `gear_uid`, поэтому «вещь родного»
    // отдельным путём больше не берётся. Чужой предмет — 404, как в каталоге.
    const item = await this.gear.findCatalogItem(
      manager,
      userId,
      String(dto.gearItemId),
    );
    if (!item) throw new NotFoundException('Предмет не найден');

    const existing = await manager.findOne(TripGear, {
      where: { tripId: trip.id, gearItemId: item.id },
    });
    if (existing) {
      throw new ConflictException('Этот предмет уже предложен в походе');
    }

    /**
     * Занятость по ключу физической вещи (11.11.2026, шаг 2).
     *
     * Своя строка этого похода уже проверена выше, а здесь — второй клон
     * той же вещи в этом походе (у родных он свой) и живые решённые чужие
     * походы на пересекающихся датах. Без этой проверки одну палатку
     * ставили бы в два похода сразу, и «занято» выяснялось бы только
     * при выезде.
     */
    await assertGearUidFree(manager, trip, item.gearUid, gearTitleOf(item), item.id);

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

    // «Табор» — сразу, а не в корне (06.11.2026).
    await this.autoPlaceSection(
      manager,
      trip,
      participant,
      item.gearType.code,
      saved,
    );

    // Второй участник должен увидеть вещь, не перезагружая вкладку.
    this.events.emitGear(trip.id, userId);

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

    const saved = await manager.save(row);
    this.events.emitGear(trip.id, userId);

    return TripGearItemDto.from(saved, userId);
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
    const participant = await this.assertParticipant(manager, trip.id, userId);

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

    const gearType = await manager.findOne(GearType, {
      where: { id: dto.typeId },
    });
    if (gearType) {
      await this.autoPlaceSection(
        manager,
        trip,
        participant,
        gearType.code,
        row,
      );
    }

    this.events.emitGear(trip.id, userId);

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

    this.events.emitGear(trip.id, userId);
  }

  // ───────────────────────── личные вещи «Взял» (06.11.2026) ─────────────────────────

  /**
   * Добавить вещь в раздел «Взял».
   *
   * Заказчик: «Личные вещи — это то, что помимо общественного: одежда,
   * каска, трекинговые палочки», и у раздела нужны кнопки «Добавить
   * снаряжение в этот раздел».
   *
   * **Вещь своя или родного (10.11.2026, вечер).** «У родных снаряжение
   * общее… если один задействовал что-то, то второму нельзя, нельзя один
   * спальник обоим взять». Поэтому предмет берётся из своего каталога
   * **или из каталога родного**, а «чужой» (не родного) по-прежнему
   * не находится (404).
   *
   * **Одна вещь — один человек.** Раньше это вытекало из «только свой
   * каталог»; теперь проверяется явно, а в базе стоит уникальный индекс
   * `(trip_id, gear_item_id)`. Взятую родным вещь второй раз не взять:
   * 409 с человеческим текстом, а не «вещь исчезла из списка».
   *
   * Личные вещи — только 100% идущему: «пока не решил» и приглашённый
   * ещё не собирают рюкзак, а строка была бы вещью в чужом походе
   * без хозяина. То же правило, что у личной еды «Питания».
   *
   * `sectionId` не указан — вещь встанет в корень «Взял». Раздел обязан
   * быть личным разделом этого человека; чужой или общественный — 400.
   */
  async addPersonal(
    userId: string,
    tripId: number,
    dto: AddTripGearPersonalDto,
  ): Promise<TripGearPersonalDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    const participant = await this.assertParticipant(manager, trip.id, userId);

    if (participant.status !== 'going') {
      throw new BadRequestException(
        'Личные вещи собирает только тот, кто идёт в поход',
      );
    }

    const item = await this.gear.findCatalogItem(
      manager,
      userId,
      String(dto.gearItemId),
    );
    if (!item) throw new NotFoundException('Предмет не найден');

    /**
     * Одна вещь не может быть одновременно общественной и личной
     * (09.11.2026): в раскладке и в рюкзаке она весила бы дважды.
     * Используется и «Готовкой» для личной посуды («КЛМН»).
     */
    const shared = await manager.findOne(TripGear, {
      where: { tripId: trip.id, gearItemId: item.id },
    });
    if (shared) {
      throw new ConflictException(
        'Эта вещь уже в общественном снаряжении похода — личной она быть не может',
      );
    }

    /**
     * Та же вещь в «Спальнике» **у другого человека** (10.11.2026, вечер) —
     * двойное «я её взял» и двойной вес. Раньше эта пара была невозможна
     * только потому, что в «Спальник» и «Взял» попадали вещи одного
     * человека; с общим снаряжением родных проверка нужна явно.
     *
     * Своя же строка не мешает: «общественная вещь и её личная копия» —
     * решение 06.11.2026, и ломать его этим шагом незачем.
     */
    const sleeping = (await manager.query(
      `SELECT user_id::text AS "userId"
         FROM trip_route_sleeping
        WHERE trip_id = $1 AND gear_item_id = $2`,
      [trip.id, item.id],
    )) as Array<{ userId: string }>;
    if (sleeping[0] !== undefined && sleeping[0].userId !== userId) {
      throw new ConflictException(
        'Эту вещь уже взял родной в «Спальник» — второй раз её не взять',
      );
    }

    const sectionId = await this.resolvePersonalSection(
      manager,
      trip.id,
      userId,
      dto.sectionId ?? null,
    );

    const existing = await manager.findOne(TripPersonalGear, {
      where: { tripId: trip.id, gearItemId: item.id },
    });
    if (existing) {
      throw new ConflictException(
        existing.userId === userId
          ? 'Эта вещь уже в твоём личном снаряжении'
          : 'Эту вещь уже взял родной — одну вещь вдвоём не взять',
      );
    }

    /**
     * Занятость по `gear_uid` (11.11.2026, шаг 2): второй клон той же вещи
     * в этом походе и живые решённые чужие походы на пересекающихся датах.
     * Проверка стоит последней, чтобы точные тексты выше («уже в вашем
     * личном», «уже взял родной») не заменялись общим «уже в этом походе».
     */
    await assertGearUidFree(manager, trip, item.gearUid, gearTitleOf(item), item.id);

    const saved = await manager.save(
      manager.create(TripPersonalGear, {
        tripId: trip.id,
        userId,
        gearItemId: item.id,
        sectionId,
      }),
    );
    saved.gearItem = item;

    this.events.emitGear(trip.id, userId);

    return TripGearPersonalDto.from(saved);
  }

  /**
   * Перенести личную вещь в другой раздел «Взял» — путь для телефона, где
   * HTML5-drag не работает. Меняет только владелец: чужая строка не
   * находится (404), а не «видна без кнопок».
   */
  async updatePersonal(
    userId: string,
    tripId: number,
    personalId: number,
    dto: UpdateTripGearPersonalDto,
  ): Promise<TripGearPersonalDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);

    const row = await this.findPersonalRow(manager, trip.id, userId, personalId);

    if (dto.sectionId !== undefined) {
      row.sectionId = await this.resolvePersonalSection(
        manager,
        trip.id,
        userId,
        dto.sectionId,
      );
      await manager.save(row);
    }

    this.events.emitGear(trip.id, userId);

    return TripGearPersonalDto.from(row);
  }

  /** Убрать свою личную вещь из похода. Предмет каталога остаётся. */
  async removePersonal(
    userId: string,
    tripId: number,
    personalId: number,
  ): Promise<void> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);

    const row = await this.findPersonalRow(manager, trip.id, userId, personalId);
    await manager.delete(TripPersonalGear, { id: row.id });

    this.events.emitGear(trip.id, userId);
  }

  /** Личная строка этого человека или 404: чужое личное не существует. */
  private async findPersonalRow(
    manager: EntityManager,
    tripId: string,
    userId: string,
    personalId: number,
  ): Promise<TripPersonalGear> {
    const row = await manager.findOne(TripPersonalGear, {
      where: { id: String(personalId), tripId, userId },
      relations: { gearItem: { gearType: true, attributes: { gearTypeAttribute: true } } },
    });
    if (!row) throw new NotFoundException('Личная вещь не найдена');

    return row;
  }

  /**
   * Раздел для личной вещи: `null` — корень, иначе личный раздел этого
   * человека в этом походе. Общественный или чужой раздел — 400: личное
   * не должно попасть в общую структуру.
   */
  private async resolvePersonalSection(
    manager: EntityManager,
    tripId: string,
    userId: string,
    sectionId: number | null,
  ): Promise<string | null> {
    if (sectionId === null) return null;

    const section = await manager.findOne(TripGearSection, {
      where: { id: String(sectionId), tripId, scope: 'personal', ownerUserId: userId },
    });
    if (!section) {
      throw new BadRequestException('Личный раздел не найден у этого участника');
    }

    return section.id;
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

    this.events.emitGear(trip.id, userId);

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

    const saved = await manager.save(section);
    this.events.emitGear(trip.id, userId);

    return TripGearSectionDto.from(saved);
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
    this.events.emitGear(trip.id, userId);
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

    /**
     * За человека без аккаунта вещь добавляет организатор **или
     * соорганизатор** (20.11.2026): заказчик перевёл все проверки «только
     * организатор» на «организатор или соорганизатор», кроме пяти отличий
     * ([lifecycle.md](../docs/ph/lifecycle.md) §4.5). Правило живёт в
     * `TripsService`, поэтому проверка идёт через него — второй копии
     * здесь не будет.
     */
    if (!(await this.trips.isOrganizerOrCoOrganizer(manager, trip, userId))) {
      throw new ForbiddenException(
        'За человека без аккаунта вещь добавляет организатор или соорганизатор похода',
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

  // ───────────────────────── раскладка груза (06.11.2026) ─────────────────────────

  /**
   * Снимок данных для раскладки: люди, единицы груза и запомненные
   * назначения.
   *
   * Собирается один раз и на чтение, и на кнопку: два независимых сбора
   * однажды показали бы на одном экране разные числа. Назначения
   * запоминаются отдельно от расчёта — `GET` показывает то, что реально
   * лежит в базе, а не то, что алгоритм предложил бы.
   */
  private async collectLoad(
    manager: EntityManager,
    trip: Trip,
  ): Promise<{
    people: LoadPerson[];
    units: LoadUnit[];
    titles: Map<string, string>;
    stored: Map<string, string | null>;
    doctorUserId: string | null;
    itemsWithoutWeight: number;
    packagesWithoutWeight: number;
  }> {
    const participants = await manager.find(TripParticipant, {
      where: { tripId: trip.id, status: 'going' },
      relations: { user: true },
      order: { createdAt: 'ASC', userId: 'ASC' },
    });

    const doctorUserId = await this.findDoctorUserId(manager, trip.id);
    const people: LoadPerson[] = participants.map((participant) => ({
      userId: participant.userId,
      // Пол не заполнен — считаем мужским: то же правило, что у DEFAULT
      // в базе и у DTO состава.
      gender: participant.user?.gender ?? 'm',
      isDoctor: participant.userId === doctorUserId,
      // «Питается отдельно» — не несёт общий котёл (06.11.2026).
      eatsSeparately: participant.eatsSeparately,
    }));

    const rows = await manager.find(TripGear, {
      where: { tripId: trip.id, status: 'approved' },
      relations: { gearItem: { gearType: true } },
      order: { id: 'ASC' },
    });
    const packages = await this.tripMeals.listPackagesForLoad(trip.id);

    const units: LoadUnit[] = [];
    const titles = new Map<string, string>();
    const stored = new Map<string, string | null>();
    let itemsWithoutWeight = 0;
    let packagesWithoutWeight = 0;

    for (const row of rows) {
      const storedWeight = row.gearItem.weightGrams;
      /**
       * Вещь без веса всё равно едет в рюкзаке (24.11.2026): заказчик
       * просил подписывать её «вес не указан», а не прятать. В расчёт
       * она идёт нулём, и `itemsWithoutWeight` по-прежнему говорит,
       * сколько таких вещей, — иначе цифра «не взвешено» пропала бы
       * вместе со строкой.
       */
      const weightKnown = storedWeight !== null && storedWeight > 0;
      const weight = weightKnown ? storedWeight : 0;

      if (!weightKnown) itemsWithoutWeight += 1;

      const key = loadUnitKey('gear', row.id);
      const typeCode = row.gearItem.gearType?.code ?? '';
      units.push({
        kind: 'gear',
        id: row.id,
        weightGrams: weight,
        ownerUserId: row.ownerUserId,
        isFirstAid: typeCode === FIRST_AID_TYPE_CODE,
        weightKnown,
      });
      titles.set(
        key,
        row.gearItem.title?.trim()
          ? row.gearItem.title
          : (row.gearItem.gearType?.name ?? 'Снаряжение'),
      );
      stored.set(key, row.assignedUserId);
    }

    for (const pack of packages) {
      // Пустой пакет — законное состояние фасовки, но груза в нём нет.
      if (pack.weightGrams <= 0) {
        packagesWithoutWeight += 1;
        continue;
      }

      const key = loadUnitKey('package', pack.id);
      units.push({
        kind: 'package',
        id: pack.id,
        weightGrams: pack.weightGrams,
        // У общего пакета владельца нет: «своё — владельцу» здесь
        // не работает, пакет всегда идёт в уравнивание.
        ownerUserId: null,
      });
      titles.set(key, pack.name);
      stored.set(key, pack.assignedUserId);
    }

    /**
     * Общественная аптечка (09.11.2026). Это не строка `trip_gear`:
     * у неё нет вещи каталога, есть только список и итоговый вес в
     * `checklists`. В раскладку она входит, чтобы попасть в рюкзак
     * доктора и в его долю, — но назначение не хранится: место аптечки
     * одно и решается правилом, а не перетаскиванием.
     *
     * Без доктора единицы нет вовсе: по заказчику общественная секция
     * «Аптечки» появляется только когда доктор назначен, и везти её
     * некому. Вес `null` — «не взвесили»: идём нулём, экран цифру
     * не рисует.
     *
     * **Пустая аптечка — тоже в рюкзаке** (замечание 09.11.2026:
     * «Общественную аптечку отображаем даже пустую»). Поэтому единица
     * добавляется по одному наличию доктора, а не по наличию списка:
     * списки «Аптечки» заводятся при первом чтении её вкладки, и до
     * этого момента аптечки в рюкзаке врача не было бы вовсе. Нет списка —
     * значит нет и веса: 0 граммов, `weightKnown: false`.
     */
    if (doctorUserId !== null) {
      const firstAid = await manager.findOne(Checklist, {
        where: { tripId: trip.id, scope: 'trip', area: 'first_aid' },
      });

      const key = loadUnitKey('firstAid', 'public');
      units.push({
        kind: 'firstAid',
        id: 'public',
        weightGrams: firstAid?.weightGrams ?? 0,
        ownerUserId: null,
        isFirstAid: true,
        weightKnown: (firstAid?.weightGrams ?? null) !== null,
      });
      titles.set(key, 'Общественная аптечка');
    }

    return {
      people,
      units,
      titles,
      stored,
      doctorUserId,
      itemsWithoutWeight,
      packagesWithoutWeight,
    };
  }

  /** Рюкзаки для ответа: что в каждом, доля и отклонение от неё. */
  private async buildLoad(
    manager: EntityManager,
    trip: Trip,
    viewerId: string,
  ): Promise<TripGearLoadDto> {
    const data = await this.collectLoad(manager, trip);
    const allocation = allocateLoad(data.units, data.people);

    const backpacks: TripGearLoadBackpackDto[] = data.people.map((person) => ({
      userId: person.userId,
      gender: person.gender,
      targetWeightGrams: Math.round(allocation.targets.get(person.userId) ?? 0),
      gearWeightGrams: 0,
      packagesWeightGrams: 0,
      totalWeightGrams: 0,
      deviationGrams: 0,
      gear: [],
      packages: [],
    }));
    const byUser = new Map(
      backpacks.map((backpack) => [backpack.userId, backpack]),
    );

    /**
     * Рюкзаки «питающихся отдельно» в распределении общей еды не участвуют
     * (решение заказчика 06.11.2026). Назначение, оставшееся с тех пор,
     * как человек перешёл на своё питание, показывает нераспределённым —
     * иначе общий пакет висел бы в рюкзаке того, кто его не ест.
     */
    const separateEaters = new Set(
      data.people
        .filter((person) => person.eatsSeparately === true)
        .map((person) => person.userId),
    );

    const unassigned: TripGearLoadUnitDto[] = [];
    let totalWeightGrams = 0;

    for (const unit of data.units) {
      const key = loadUnitKey(unit.kind, unit.id);
      /**
       * У общественной аптечки назначение не хранится: её место —
       * у доктора, и его считает `allocateLoad` каждый раз. У вещей
       * и пакетов наоборот: в базе лежит решение человека, а расчёт
       * только предлагает — показывать предложенное как назначенное
       * значило бы врать о состоянии похода.
       */
      const assignedUserId =
        unit.kind === 'firstAid'
          ? (allocation.assignments.get(key) ?? null)
          : (data.stored.get(key) ?? null);
      const dto: TripGearLoadUnitDto = {
        kind: unit.kind,
        id: unit.id,
        title: data.titles.get(key) ?? '',
        weightGrams: unit.weightGrams,
        weightKnown: unit.weightKnown !== false,
        assignedUserId,
      };

      totalWeightGrams += unit.weightGrams;

      const backpack = assignedUserId
        ? byUser.get(assignedUserId)
        : undefined;
      // Назначение на «пока не решил» или на ушедшего — это
      // нераспределённый груз: в рюкзаках таких людей нет.
      if (!backpack) {
        unassigned.push(dto);
        continue;
      }

      if (unit.kind === 'package' && separateEaters.has(backpack.userId)) {
        unassigned.push(dto);
        continue;
      }

      if (unit.kind === 'package') {
        backpack.packages.push(dto);
        backpack.packagesWeightGrams += unit.weightGrams;
      } else {
        // Вещи и общественная аптечка — в «снаряжение» рюкзака: аптечка
        // не еда, и отдельная корзина ради одной строки не нужна.
        backpack.gear.push(dto);
        backpack.gearWeightGrams += unit.weightGrams;
      }
    }

    for (const backpack of backpacks) {
      backpack.totalWeightGrams =
        backpack.gearWeightGrams + backpack.packagesWeightGrams;
      backpack.deviationGrams =
        backpack.totalWeightGrams - backpack.targetWeightGrams;
    }

    return {
      totalWeightGrams,
      backpacks,
      unassigned,
      itemsWithoutWeight: data.itemsWithoutWeight,
      packagesWithoutWeight: data.packagesWithoutWeight,
      doctorUserId: data.doctorUserId,
      doctorMissing: allocation.doctorMissing,
      personal: await this.buildPersonalLoad(manager, trip, viewerId),
    };
  }

  /**
   * Личная половина «Моего рюкзака» (06.11.2026).
   *
   * Заказчик: «секция Личное снаряжение/Рюкзак должна быть разделена на две
   * секции „Общественное“ и „Личное“. В „Личном“ отображается личная еда
   * из Походы/Питание, фактический вес, а если нет, то расчётный».
   *
   * Поэтому здесь рядом лежат три источника, и все — только смотрящего:
   * личные вещи «Взял», строки «Спальника» «Ночёвок» и пакеты личной еды
   * «Питания». В общее распределение они не входят — это отображение.
   */
  private async buildPersonalLoad(
    manager: EntityManager,
    trip: Trip,
    viewerId: string,
  ): Promise<TripGearLoadPersonalDto> {
    const items = await manager.find(TripPersonalGear, {
      where: { tripId: trip.id, userId: viewerId },
      relations: { gearItem: true },
      order: { id: 'ASC' },
    });
    const sleeping = await this.sleepingRows(manager, trip.id, viewerId);
    /**
     * Личная аптечка (09.11.2026, уточнено 24.11.2026). Заказчик: «Личную
     * аптечку как „Мои продукты“ отображаем в Личном рюкзаке».
     *
     * Строка появляется, если аптечка **собрана** (есть хотя бы одна
     * отметка) или **взвешена**. Пустой только что заведённый список —
     * не груз, и в рюкзаке он не занимает строку. Если собрана, но не
     * взвешена, строка приходит с `weightGrams: null` и `weightKnown:
     * false`: экран подписывает её «вес не указан» и не считает в итог.
     * Раньше невзвешенная аптечка не отдавалась вовсе, и в «Личном»
     * у неё не было ни цифры, ни подписи.
     */
    const personalFirstAid = await manager.findOne(Checklist, {
      where: {
        tripId: trip.id,
        scope: 'personal',
        area: 'first_aid',
        ownerUserId: viewerId,
      },
    });
    const personalFirstAidDone =
      personalFirstAid === null
        ? 0
        : await manager.count(ChecklistItem, {
            where: { checklistId: personalFirstAid.id, isDone: true },
          });
    const personalFirstAidRow =
      personalFirstAid !== null &&
      (personalFirstAid.weightGrams !== null || personalFirstAidDone > 0)
        ? [
            {
              kind: 'firstAid' as const,
              id: personalFirstAid.id,
              title: 'Личная аптечка',
              weightGrams: personalFirstAid.weightGrams,
              weightKnown: personalFirstAid.weightGrams !== null,
            },
          ]
        : [];
    const personalLoad = await this.tripMeals.listPersonalPackagesForLoad(
      trip.id,
      viewerId,
    );

    const gear: TripGearLoadPersonalUnitDto[] = [
      ...items.map((row) => ({
        kind: 'personal' as const,
        id: row.id,
        title: row.gearItem.title,
        weightGrams: row.gearItem.weightGrams,
        weightKnown: row.gearItem.weightGrams !== null,
      })),
      ...sleeping.map((row) => ({
        kind: 'sleeping' as const,
        id: row.id,
        title: row.title,
        weightGrams:
          row.weight_grams === null ? null : Number(row.weight_grams),
        weightKnown: row.weight_grams !== null,
      })),
      ...personalFirstAidRow,
    ];

    const packageDtos: TripGearLoadPersonalPackageDto[] =
      personalLoad.packages.map((pack) => ({
        id: pack.id,
        name: pack.name,
        weightGrams: pack.weightGrams,
        isActual: pack.isActual,
      }));

    /**
     * «Мои продукты» (09.11.2026). В «Питании» это синяя карточка-сводка
     * по личным приёмам, а не пакет, — поэтому в рюкзаке она появляется,
     * только когда своих пакетов **с весом** нет. Если человек включил
     * кулёк, еда уже посчитана в нём, и вторая строка удвоила бы вес.
     * Пустой пакет (кулёк без содержимого) сводку не отменяет.
     */
    if (
      personalLoad.foodWeightGrams > 0 &&
      !packageDtos.some((pack) => pack.weightGrams > 0)
    ) {
      packageDtos.push({
        id: PERSONAL_FOOD_PACKAGE_ID,
        name: 'Мои продукты',
        weightGrams: personalLoad.foodWeightGrams,
        // Факт живёт в браузере человека: сервер считает только расчёт.
        isActual: false,
      });
    }

    const gearWeightGrams = gear.reduce(
      (sum, row) => sum + (row.weightGrams ?? 0),
      0,
    );
    const packagesWeightGrams = packageDtos.reduce(
      (sum, pack) => sum + pack.weightGrams,
      0,
    );

    return {
      gearWeightGrams,
      packagesWeightGrams,
      totalWeightGrams: gearWeightGrams + packagesWeightGrams,
      gear,
      packages: packageDtos,
    };
  }

  /**
   * Медик похода — первый по порядку состава (06.11.2026).
   *
   * Роль, а не участие: «медик» — это тот, кому дали роль `doctor`
   * в справочнике (`seed-roles`). Аптечку закрепляем за ним, потому что
   * она одна: раздавать её копиями нельзя (`gear-distribution.md` §4).
   */
  private async findDoctorUserId(
    manager: EntityManager,
    tripId: string,
  ): Promise<string | null> {
    const rows: Array<{ user_id: string }> = await manager.query(
      `SELECT p."user_id"
         FROM "trip_participants" p
         JOIN "trip_participant_roles" r
           ON r."trip_id" = p."trip_id" AND r."user_id" = p."user_id"
         JOIN "roles" ro ON ro."id" = r."role_id"
        WHERE p."trip_id" = $1
          AND p."status" = 'going'
          AND ro."code" = 'doctor'
        ORDER BY p."created_at" ASC, p."user_id" ASC
        LIMIT 1`,
      [tripId],
    );

    return rows[0]?.user_id ?? null;
  }

  // ───────────────────────── разделы: шаблоны и проверки ─────────────────────────

  /**
   * Куда вещь ложится сама: только «Табор» (06.11.2026).
   *
   * Правило заказчика: «снаряга для табора напрямую связана между
   * вкладками». Вещь, добавленная в «Ночёвках», — это та же строка
   * `trip_gear`, и раскладывать её по разделам вручную после каждого котла
   * человек не должен. Палатка, тент, посуда, костровое и горелки ложатся
   * в общественный «Табор», его видит весь состав.
   *
   * **Спальник и коврик сюда больше не попадают** (заказчик 06.11.2026):
   * «ты переносишь общественное снаряжение в раздел его личных вещей — это
   * не верно в корне». Вещь похода остаётся общественной, даже если её
   * принёс владелец: личное — это своя одежда и содержимое секции
   * «Спальник» «Ночёвок», а не `trip_gear`. Поэтому автораскладка здесь
   * знает ровно один раздел.
   *
   * Раздел ищется по коду шаблона `camp`, а если код пуст — по названию
   * «Табор»: разделы, заведённые до появления кода, продолжают находиться.
   * Переименованный шаблон тоже находится — код переживает переименование.
   * Удалённый раздел не находится, и вещь честно остаётся в корне.
   *
   * `ensureSections` вызывается здесь, а не ждёт первого открытия
   * вкладки: иначе палатка, добавленная в «Ночёвках» до первого захода
   * в «Снаряжение», легла бы в корень и там бы и осталась.
   */
  private async autoPlaceSection(
    manager: EntityManager,
    trip: Trip,
    actor: TripParticipant,
    typeCode: string,
    row: TripGear,
  ): Promise<void> {
    if (!CAMP_SECTION_TYPE_CODES.includes(typeCode)) return;

    await this.ensureSections(trip, actor, actor.userId);

    const section = await manager.findOne(TripGearSection, {
      where: [
        {
          tripId: trip.id,
          scope: 'shared',
          ownerUserId: IsNull(),
          parentId: IsNull(),
          templateCode: CAMP_SECTION_CODE,
        },
        {
          tripId: trip.id,
          scope: 'shared',
          ownerUserId: IsNull(),
          parentId: IsNull(),
          title: 'Табор',
        },
      ],
    });
    if (!section) return;

    row.sharedSectionId = section.id;
    await manager.update(
      TripGear,
      { id: row.id },
      { sharedSectionId: section.id },
    );
  }

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
          const templates = await this.sharedTemplates(tx, trip.id);
          await this.insertSections(tx, trip.id, 'shared', null, templates);
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
            await this.personalTemplates(tx, trip.id),
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
   * Личные шаблоны участника (06.11.2026).
   *
   * «в палатку» встаёт **первым** и только если в походе есть ночь
   * не в гостинице — то есть тогда же, когда в «Ночёвках» видна секция
   * «Спальник» (слова заказчика: «если эта секция есть»). Дальше «Одежда»
   * и «Снаряга»: личные вещи — это одежда, каска, палки, — и порядок
   * заказчик назвал сам.
   */
  private async personalTemplates(
    manager: EntityManager,
    tripId: string,
  ): Promise<SectionTemplate[]> {
    const sleeping = await manager.query(
      `SELECT 1
         FROM "trip_route_nights" n
        WHERE n."trip_id" = $1
          AND n."kind" IN (${sqlValues(SLEEPING_NIGHT_KINDS)})
        LIMIT 1`,
      [tripId],
    );

    const templates: SectionTemplate[] = [];
    if (sleeping.length > 0) {
      templates.push({
        code: TENT_INSIDE_SECTION_CODE,
        title: TENT_INSIDE_SECTION_TITLE,
      });
    }

    for (const template of PERSONAL_SECTION_TEMPLATES) {
      templates.push({ code: template.code, title: template.title });
    }

    return templates;
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
  private async sharedTemplates(
    manager: EntityManager,
    tripId: string,
  ): Promise<SectionTemplate[]> {
    const camping = await manager.query(
      `SELECT 1
         FROM "trip_route_nights" n
        WHERE n."trip_id" = $1
          AND (n."kind" IN (${sqlValues(SLEEPING_NIGHT_KINDS)}) OR n."cooking" IS NOT NULL)
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

    const templates: SectionTemplate[] = [];
    if (camping.length > 0) templates.push(SHARED_SECTION_TEMPLATES[0]);
    if (typeCodes.includes(CYCLING_TYPE_CODE)) templates.push(SHARED_SECTION_TEMPLATES[1]);
    if (typeCodes.some((code) => (WATER_TYPE_CODES as readonly string[]).includes(code))) {
      templates.push(SHARED_SECTION_TEMPLATES[2]);
    }

    return templates;
  }

  /** Шаблоны одного вида — корневыми разделами с шагом порядка 10. */
  private async insertSections(
    manager: EntityManager,
    tripId: string,
    scope: 'shared' | 'personal',
    ownerUserId: string | null,
    templates: SectionTemplate[],
  ): Promise<void> {
    if (templates.length === 0) return;

    await manager.insert(
      TripGearSection,
      templates.map((template, index) => ({
        tripId,
        scope,
        ownerUserId,
        parentId: null,
        title: template.title,
        templateCode: template.code,
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

  /**
   * Личные вещи смотрящего из «Ночёвок» (06.11.2026).
   *
   * Читаем ту же таблицу, что секция «Спальник»: `trip_route_sleeping`.
   * Сервер отдаёт только строки смотрящего — личное чужим не показывается
   * даже организатору, это правило «Ночёвок» и здесь оно не меняется.
   * Вес и название — из каталога: спальник взвешивают один раз.
   *
   * С 11.11.2026 сюда же приезжают `gear_uid` и `deleted_at`: по первому
   * ищутся живые клоны удалённой вещи, по второму экран понимает, что
   * каталог вещь уже не отдаёт («она есть у Анны»).
   */
  private async sleepingRows(
    manager: EntityManager,
    tripId: string,
    userId: string,
  ): Promise<SleepingRow[]> {
    return (await manager.query(
      `SELECT s.id::text AS id,
              s.gear_item_id::text AS gear_item_id,
              gi.gear_uid::text AS gear_uid,
              gi.deleted_at AS deleted_at,
              gt.code AS type_code,
              gt.name AS type_name,
              gi.title,
              gi.weight_grams
         FROM trip_route_sleeping s
         JOIN gear_items gi ON gi.id = s.gear_item_id
         JOIN gear_types gt ON gt.id = gi.gear_type_id
         JOIN users u ON u.id = s.user_id
        WHERE s.trip_id = $1
          AND s.user_id = $2
          AND u.is_virtual = false
        ORDER BY s.id ASC`,
      [tripId, userId],
    )) as SleepingRow[];
  }

  /**
   * Личные вещи смотрящего из раздела «Взял» (06.11.2026).
   *
   * Читаем `trip_personal_gear` только по своему человеку: личное не
   * показывается никому, включая организатора, — то же правило, что
   * у «Спальника» «Ночёвок». Название, тип и вес приходят из каталога.
   */
  private async personalRows(
    manager: EntityManager,
    tripId: string,
    userId: string,
  ): Promise<TripPersonalGear[]> {
    return manager.find(TripPersonalGear, {
      where: { tripId, userId },
      relations: { gearItem: { gearType: true, attributes: { gearTypeAttribute: true } } },
      order: { id: 'ASC' },
    });
  }

  /**
   * Список с итогом: сумма только утверждённых весов.
   *
   * `archive` — не данные, а подсказка для ответа (11.11.2026):
   * у мягко удалённой вещи `holdersOf` отдаёт живые клоны («есть у Анны»).
   * Считается в `list` заранее: у `TripGearItemDto.from` нет доступа
   * к базе, и делать его асинхронным ради двух полей значило бы переписать
   * все места, где DTO собирается при правке одной строки.
   */
  private toList(
    rows: TripGear[],
    sections: TripGearSection[],
    sleeping: SleepingRow[],
    personal: TripPersonalGear[],
    viewerId: string,
    archive: {
      holdersOf: (gearUid: string) => GearHolderDto[];
    },
  ): TripGearListDto {
    let totalWeightGrams = 0;
    let itemsWithoutWeight = 0;

    for (const row of rows) {
      if (row.status !== 'approved') continue;

      if (row.gearItem.weightGrams === null) itemsWithoutWeight += 1;
      else totalWeightGrams += row.gearItem.weightGrams;
    }

    return {
      items: rows.map((row) =>
        TripGearItemDto.from(
          row,
          viewerId,
          archive.holdersOf(row.gearItem.gearUid),
        ),
      ),
      sections: sections.map((section) => TripGearSectionDto.from(section)),
      totalWeightGrams,
      itemsWithoutWeight,
      sleeping: sleeping.map((row) =>
        TripGearSleepingDto.from(row, archive.holdersOf(row.gear_uid)),
      ),
      personalItems: personal.map((row) =>
        TripGearPersonalDto.from(
          row,
          archive.holdersOf(row.gearItem.gearUid),
        ),
      ),
    };
  }
}
