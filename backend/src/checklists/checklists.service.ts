import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
  In,
  Not,
} from 'typeorm';

import { GearItem } from '../gear/entities/gear-item.entity';
import { TripParticipant } from '../trips/entities/trip-participant.entity';
import type { Trip } from '../trips/entities/trip.entity';
import { TripEventsService } from '../trips/trip-events.service';
import { TripsService } from '../trips/trips.service';
import type { ChecklistArea, TripChecklistScope } from './checklist.types';
import {
  CHECKLIST_AREA_TABS,
  DEFAULT_CHECKLIST_AREA,
} from './checklist.types';
import {
  ChecklistDto,
  ChecklistItemDto,
  ChecklistListDto,
  CreateChecklistDto,
  CreateChecklistItemDto,
  CreateTripChecklistDto,
  FirstAidSectionDto,
  ImportChecklistItemsDto,
  RecommendationMarkDto,
  SetFirstAidWeightDto,
  SetRecommendationMarkDto,
  TripChecklistListDto,
  TripFirstAidDto,
  UpdateChecklistDto,
  UpdateChecklistItemDto,
} from './dto/checklist.dto';
import { ChecklistItem } from './entities/checklist-item.entity';
import { ChecklistRecommendationMark } from './entities/checklist-recommendation-mark.entity';
import { Checklist } from './entities/checklist.entity';

/**
 * Чек-листы: шаблоны пользователя, общий список похода и личный в походе.
 *
 * ## Почему один сервис на три области
 *
 * Список — это список: пункты, отметки, заголовок. Различаются только
 * **правила доступа**, и они записаны здесь ровно один раз на каждое
 * действие (`assertCanRead` / `assertCanEdit` / `assertCanTick`). Три
 * сервиса дали бы три копии проверок и три способа разойтись: в одном
 * «отмечать может участник», в другом — «только владелец».
 *
 * ## Кто что может
 *
 * | | шаблон | общий похода | личный | рекомендация |
 * |---|---|---|---|---|
 * | видеть | владелец | кто видит поход | владелец | кто видит поход |
 * | править список и пункты | владелец | ведущий «Снаряжения» | владелец | ведущий «Снаряжения» |
 * | ставить отметки | владелец | ведущий «Снаряжения» | владелец | каждый участник себе |
 *
 * «Ведущий снаряжения» — организатор или роль, которой матрица дала правку
 * вкладки `gear` (`TripsService.canEditTab`). Заказчик 05.11.2026: список
 * снаряжения правит и отмечает **тот, у кого есть доступ**, остальные
 * только видят.
 *
 * «Участник» — это `invited` / `going` / `maybe`, но **не** `declined`:
 * отказавшийся в подготовке не участвует (то же правило, что у чатов
 * в `ConversationsService`).
 *
 * ## Рекомендация — отдельная область
 *
 * С 05.11.2026 у похода есть третий список — рекомендация личных вещей
 * от организатора: «Рюкзак, Спальник, Коврик». Он один на поход и виден
 * всем, а его пункты попадают участникам в личный список.
 *
 * **Отметки живут отдельно** (`checklist_recommendation_marks`): пункт
 * рекомендации общий, а «взял» у каждого своё. Записывать отметку в пункт
 * значило бы, что первый отметивший сделал это за всех, — а заказчик прямо
 * сказал, что организатору отметки не возвращаются.
 *
 * ## Шаблон — копия, а не ссылка
 *
 * При создании списка в походе можно передать `fromTemplateId`: пункты
 * **копируются** в новую строку. Правка шаблона после этого поход
 * не трогает — иначе список снаряжения прошедшего похода менялся бы
 * задним числом. Ссылка на вещь каталога копируется вместе с пунктом:
 * походу нужен именно экземпляр, а не его название.
 *
 * ## Пункт — текст или вещь
 *
 * Пункт бывает свободным текстом и ссылкой на конкретную вещь личного
 * каталога (`gearItemId`, 31.10.2026). Привязать можно **только свою**
 * вещь и только не одноразовую: чужой id — 404, как и везде в проекте.
 * У пункта-ссылки `title` — снимок названия вещи; удаление вещи превращает
 * ссылку в текст имени типа, и это делает триггер базы (см. миграцию
 * `ChecklistGearRefs`), а не сервис: вещь уходит и каскадом тоже.
 *
 * ## Чего здесь нет
 *
 * Организатор пока **не может предлагать пункты в чужой личный список**:
 * это отдельное действие с отдельными правами (`trip-tabs.md`, «Снаряжение»),
 * и делать его «заодно» значило бы открыть личные списки организатору
 * без интерфейса, который объяснил бы, что это предложение, а не правка.
 */
@Injectable()
export class ChecklistsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly trips: TripsService,
    /**
     * «Список вкладки изменился» (06.11.2026). Список — часть «Снаряжения»,
     * и правка чужого пункта должна доезжать до второго участника так же,
     * как перетащенная вещь. Пока домен у чек-листов один; появится
     * «Питание» — событие получит ещё и домен.
     */
    private readonly events: TripEventsService,
  ) {}

  // ───────────────────────── шаблоны ─────────────────────────

  /** Мои шаблоны: списком, с пунктами. */
  async listTemplates(userId: string): Promise<ChecklistListDto> {
    const manager = this.dataSource.manager;

    const checklists = await manager.find(Checklist, {
      where: { scope: 'template', ownerUserId: userId },
      order: { id: 'ASC' },
    });

    return { checklists: await this.withItems(manager, checklists) };
  }

  /** Новый шаблон. Пункты добавляются отдельно: пустой шаблон — норма. */
  async createTemplate(
    userId: string,
    dto: CreateChecklistDto,
  ): Promise<ChecklistDto> {
    const title = dto.title.trim();
    if (title.length === 0) {
      throw new BadRequestException('У шаблона должен быть заголовок');
    }

    const saved = await this.dataSource.manager.save(
      this.dataSource.manager.create(Checklist, {
        scope: 'template',
        area: 'gear',
        ownerUserId: userId,
        tripId: null,
        title,
        weightGrams: null,
      }),
    );

    return ChecklistDto.from(saved, []);
  }

  /** Переименовать список. Права — как на правку пунктов. */
  async renameChecklist(
    userId: string,
    id: number,
    dto: UpdateChecklistDto,
  ): Promise<ChecklistDto> {
    const manager = this.dataSource.manager;
    const checklist = await this.findChecklist(manager, id);
    await this.assertCanEdit(manager, checklist, userId);

    if (dto.title !== undefined) {
      const title = dto.title.trim();

      // У шаблона пустое имя бессмысленно, у списков похода — допустимо:
      // там заголовок необязателен, и вкладка сама знает, что это за список.
      if (title.length === 0 && checklist.scope === 'template') {
        throw new BadRequestException('У шаблона должен быть заголовок');
      }

      checklist.title = title;
      await manager.save(checklist);
    }

    return (await this.withItems(manager, [checklist]))[0];
  }

  /** Удалить список вместе с пунктами (каскад в базе). */
  async deleteChecklist(userId: string, id: number): Promise<void> {
    const manager = this.dataSource.manager;
    const checklist = await this.findChecklist(manager, id);
    await this.assertCanEdit(manager, checklist, userId);

    await manager.delete(Checklist, { id: checklist.id });
  }

  // ───────────────────────── пункты ─────────────────────────

  /**
   * Добавить пункт: свободный текст или конкретную вещь каталога.
   *
   * Ровно одно из двух обязано быть: прислали `gearItemId` — текст берётся
   * из вещи (у ссылки нет отдельного имени), прислали только `title` —
   * это обычный текстовый пункт. Оба пусты — 400 с подсказкой, потому что
   * «пункт без текста» нечем показать в списке.
   */
  async addItem(
    userId: string,
    checklistId: number,
    dto: CreateChecklistItemDto,
  ): Promise<ChecklistItemDto> {
    const manager = this.dataSource.manager;
    const checklist = await this.findChecklist(manager, checklistId);
    await this.assertCanEdit(manager, checklist, userId);

    const gear =
      dto.gearItemId !== undefined
        ? await this.findOwnedGear(manager, userId, dto.gearItemId)
        : null;

    /**
     * В общем списке и рекомендации вещь становится **типом** — «Топор»,
     * а не «Топор Fixars 1243»: у похода общий топор, конкретный экземпляр
     * живёт в личном списке (`ImportChecklistItemsDto`). Текст без вещи
     * остаётся как есть.
     */
    const typeOnly =
      checklist.scope === 'trip' || checklist.scope === 'recommendation';
    const title = (
      gear ? (typeOnly ? gear.gearType.name : gear.title) : (dto.title ?? '')
    ).trim();
    if (title.length === 0) {
      throw new BadRequestException(
        'Пункт — свободный текст или вещь из снаряжения',
      );
    }

    const saved = await manager.save(
      manager.create(ChecklistItem, {
        checklistId: checklist.id,
        title,
        gearItemId: gear && !typeOnly ? gear.id : null,
        isDone: false,
        doneByUserId: null,
        doneAt: null,
        createdByUserId: userId,
      }),
    );

    this.notifyTripChecklist(checklist, userId);

    return ChecklistItemDto.from(await this.findItem(manager, saved.id));
  }

  /**
   * Отметка, правка текста и привязка вещи.
   *
   * Три поля — три права. В общем списке похода и правку, и отметку делает
   * ведущий «Снаряжения» (05.11.2026: «не имеющие доступа только видят»);
   * у рекомендации отметку через этот роут поставить нельзя вовсе — она
   * хранится у каждого участника отдельно (`setRecommendationMark`).
   * Прислали несколько полей — проверяются все права: частично применить
   * запрос было бы нельзя, иначе ответ соврал бы о том, что сохранилось.
   *
   * `gearItemId: null` — отвязать вещь, оставив пункт текстом с текущим
   * названием. `gearItemId: 5` — привязать другую свою вещь: текст снова
   * берётся из неё, а присланный `title` игнорируется.
   */
  async updateItem(
    userId: string,
    itemId: number,
    dto: UpdateChecklistItemDto,
  ): Promise<ChecklistItemDto> {
    const manager = this.dataSource.manager;

    const item = await this.findItem(manager, itemId);
    const checklist = await this.findChecklist(manager, Number(item.checklistId));

    if (dto.title !== undefined || dto.gearItemId !== undefined) {
      await this.assertCanEdit(manager, checklist, userId);
    }
    if (dto.isDone !== undefined) {
      await this.assertCanTick(manager, checklist, userId);
    }

    if (dto.gearItemId !== undefined && dto.gearItemId !== null) {
      const gear = await this.findOwnedGear(manager, userId, dto.gearItemId);
      const typeOnly =
        checklist.scope === 'trip' || checklist.scope === 'recommendation';

      if (typeOnly) {
        // Общий список и рекомендация хранят тип, а не экземпляр.
        item.gearItemId = null;
        item.gearItem = null;
        item.title = gear.gearType.name;
      } else {
        // Связь и колонку — вместе: `item` пришёл с загруженным `gearItem`
        // прежней вещи, и при сохранении TypeORM взял бы её, а не колонку.
        item.gearItemId = gear.id;
        item.gearItem = gear;
        item.title = gear.title;
      }
    } else {
      if (dto.gearItemId === null) {
        item.gearItemId = null;
        item.gearItem = null;
      }

      if (dto.title !== undefined) {
        const title = dto.title.trim();
        if (title.length === 0) {
          throw new BadRequestException('У пункта должен быть текст');
        }
        item.title = title;
      }
    }

    if (dto.isDone !== undefined) {
      // Отметка и её автор пишутся вместе: CHECK базы не пропустит
      // половину состояния, а «кто отметил» — смысл общего списка.
      item.isDone = dto.isDone;
      item.doneByUserId = dto.isDone ? userId : null;
      item.doneAt = dto.isDone ? new Date() : null;
    }

    const saved = await manager.save(item);
    this.notifyTripChecklist(checklist, userId);

    return ChecklistItemDto.from(await this.findItem(manager, saved.id));
  }

  /** Удалить пункт. */
  async deleteItem(userId: string, itemId: number): Promise<void> {
    const manager = this.dataSource.manager;

    const item = await this.findItem(manager, itemId);

    const checklist = await this.findChecklist(manager, Number(item.checklistId));
    await this.assertCanEdit(manager, checklist, userId);

    await manager.delete(ChecklistItem, { id: item.id });
    this.notifyTripChecklist(checklist, userId);
  }

  // ───────────────────────── поход ─────────────────────────

  /**
   * Чек-листы похода: общий, мой личный и рекомендация организатора.
   *
   * Все три `null`, пока их не завели: «списка ещё нет» и «список пустой» —
   * разные вещи, и вкладка должна предложить создать первый, а не показать
   * пустой блок. Личный список ищется по паре «поход + я», общий
   * и рекомендация — по походу: они одни.
   *
   * У рекомендации `isDone` **смотрящего**, а не пункта: отметки хранятся
   * отдельно (`withRecommendationMarks`), поэтому ответ зависит от того,
   * кто спросил.
   */
  async listForTrip(
    userId: string,
    tripId: number,
  ): Promise<TripChecklistListDto> {
    const manager = this.dataSource.manager;

    // Сначала видимость похода: приватный чужой — 404, как везде.
    await this.trips.getVisibleTrip(userId, tripId);

    const shared = await manager.findOne(Checklist, {
      where: { scope: 'trip', area: 'gear', tripId: String(tripId) },
    });
    const personal = await manager.findOne(Checklist, {
      where: {
        scope: 'personal',
        area: 'gear',
        tripId: String(tripId),
        ownerUserId: userId,
      },
    });
    const recommendation = await manager.findOne(Checklist, {
      where: { scope: 'recommendation', area: 'gear', tripId: String(tripId) },
    });

    return {
      shared: shared ? await this.one(manager, shared) : null,
      personal: personal ? await this.one(manager, personal) : null,
      recommendation: recommendation
        ? await this.withRecommendationMarks(manager, recommendation, userId)
        : null,
    };
  }

  /**
   * Добавить пункты из моих шаблонов в список похода (05.11.2026).
   *
   * Заказчик: «Чек-листы можно заполнять с нуля, а можно взять значения
   * из личных чек-листов». В отличие от `createForTrip` с `fromTemplateId`,
   * здесь копируется **не весь шаблон**, а выбранные пункты: из «Кострового
   * для малых групп» можно взять топор и пилу, а спички не брать.
   *
   * **Конкретная вещь превращается в тип, но не всегда.** В личный список
   * она переносится экземпляром («Топор Fixars 1243») и сохраняет ссылку
   * на каталог; в общий список и в рекомендацию — названием типа («Топор»),
   * без ссылки. Это ровно слова заказчика: «в чек-лист личных вещей похода
   * она переносится, а в чек-лист общественных вещей похода переносится
   * как тип».
   *
   * Повторный импорт не плодит одинаковые строки: пара «название + вещь»
   * проверяется по уже имеющимся пунктам. Два разных топора в личном списке
   * останутся двумя (у них разные ссылки), а «Топор» в общем — одним.
   */
  async importItems(
    userId: string,
    tripId: number,
    dto: ImportChecklistItemsDto,
  ): Promise<ChecklistDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    const area = dto.area ?? DEFAULT_CHECKLIST_AREA;

    await this.assertCanManageScope(manager, trip, dto.scope, userId, area);

    const target = await manager.findOne(Checklist, {
      where: this.scopeWhere(String(trip.id), dto.scope, userId, area),
    });
    if (!target) {
      throw new NotFoundException('Сначала заведите список в этом походе');
    }

    /**
     * Источник — только свои шаблоны. Чужой пункт отвечает 404, как чужой
     * шаблон: иначе перебором id можно было бы узнать, что у людей есть.
     */
    const source = await manager.find(ChecklistItem, {
      where: { id: In(dto.itemIds.map(String)) },
      relations: { gearItem: { gearType: true }, checklist: true },
    });
    const byId = new Map(source.map((item) => [item.id, item]));

    const ordered = dto.itemIds.map((id) => byId.get(String(id)));
    if (ordered.some((item) => item === undefined)) {
      throw new NotFoundException('Пункт не найден');
    }

    const existing = await manager.find(ChecklistItem, {
      where: { checklistId: target.id },
    });
    const seen = new Set(
      existing.map((item) => `${item.gearItemId ?? ''}|${item.title}`),
    );

    const typeOnly =
      dto.scope === 'trip' || dto.scope === 'recommendation';
    const rows: Array<Partial<ChecklistItem>> = [];

    for (const item of ordered as ChecklistItem[]) {
      if (
        item.checklist.scope !== 'template' ||
        item.checklist.ownerUserId !== userId
      ) {
        throw new NotFoundException('Пункт не найден');
      }

      const title = typeOnly
        ? (item.gearItem?.gearType.name ?? item.title)
        : (item.gearItem?.title ?? item.title);
      const gearItemId = typeOnly ? null : item.gearItemId;
      const key = `${gearItemId ?? ''}|${title}`;

      if (seen.has(key)) continue;
      seen.add(key);

      rows.push({
        checklistId: target.id,
        title,
        gearItemId,
        isDone: false,
        createdByUserId: userId,
      });
    }

    if (rows.length > 0) {
      await manager.insert(ChecklistItem, rows);
    }

    this.notifyTripChecklist(target, userId);

    return this.one(manager, target);
  }

  /**
   * Своя отметка на пункте рекомендации организатора (05.11.2026).
   *
   * Рекомендация одна на поход, отметки — у каждого свои. Отдельная ручка
   * нужна потому, что `PATCH /api/checklists/items/:id` пишет `isDone`
   * в сам пункт: в рекомендации это означало бы «отметил за всех».
   */
  async setRecommendationMark(
    userId: string,
    tripId: number,
    itemId: number,
    dto: SetRecommendationMarkDto,
  ): Promise<RecommendationMarkDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, String(trip.id), userId);

    const recommendation = await manager.findOne(Checklist, {
      where: { scope: 'recommendation', tripId: String(trip.id) },
    });
    if (!recommendation) {
      throw new NotFoundException('Рекомендация в этом походе не заведена');
    }

    const item = await this.findItem(manager, itemId);
    if (item.checklistId !== recommendation.id) {
      throw new NotFoundException('Пункт не найден');
    }

    const key = { itemId: item.id, userId };

    if (dto.isDone) {
      // Повторная галочка не должна падать: `ON CONFLICT DO NOTHING`.
      await manager
        .createQueryBuilder()
        .insert()
        .into(ChecklistRecommendationMark)
        .values({ ...key, doneAt: new Date() })
        .orIgnore()
        .execute();
    } else {
      await manager.delete(ChecklistRecommendationMark, key);
    }

    const mark = await manager.findOne(ChecklistRecommendationMark, {
      where: key,
    });

    return {
      itemId: item.id,
      isDone: mark !== null,
      doneAt: mark?.doneAt.toISOString() ?? null,
    };
  }

  /**
   * Один список по id — для шаблонов и личных списков.
   *
   * Нужен, когда интерфейс открывает список по ссылке, а не по походу:
   * у шаблона, кроме профиля, никакого «контекста» нет.
   */
  async findOne(userId: string, id: number): Promise<ChecklistDto> {
    const manager = this.dataSource.manager;
    const checklist = await this.findChecklist(manager, id);
    await this.assertCanRead(manager, checklist, userId);

    return this.one(manager, checklist);
  }

  // ───────────────────────── «Аптечка» (09.11.2026) ─────────────────────────

  /**
   * Состояние вкладки «Аптечка» глазами смотрящего (09.11.2026).
   *
   * Заказчик: «открываем закладку Аптечка… две секции — Общественная (если
   * назначен Доктор) и Личная + чат по аптечке. В секциях по одному
   * чек-листу». Поэтому ответ — ровно две секции:
   *
   * - **общественная** только когда в походе есть доктор: он и понесёт
   *   аптечку в раскладке, и список без хозяина был бы списком ни за кем;
   * - **личная** есть у каждого участника, как личный список «Снаряжения».
   *
   * Оба списка **заводятся при первом чтении** (`ensureFirstAidChecklist`):
   * «в секциях по одному чек-листу» — это состояние по умолчанию, а не
   * кнопка «создать». Повтор безопасен благодаря частичному уникальному
   * индексу и `ON CONFLICT DO NOTHING`.
   *
   * Права: общественную правит вкладка `firstAid` (доктор, организатор),
   * личную — её владелец. Вес хранится в самом списке.
   */
  async getFirstAid(userId: string, tripId: number): Promise<TripFirstAidDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    await this.assertParticipant(manager, trip.id, userId);

    const doctor = await this.findTripDoctor(manager, trip.id);
    const canEdit = await this.trips.canEditTab(userId, trip, 'firstAid');

    const personal = await this.ensureFirstAidChecklist(
      manager,
      trip.id,
      'personal',
      userId,
    );
    const shared = doctor
      ? await this.ensureFirstAidChecklist(manager, trip.id, 'trip', null)
      : null;

    return {
      doctorUserId: doctor?.userId ?? null,
      doctorName: doctor?.displayName ?? null,
      canEdit,
      shared: shared
        ? await this.firstAidSection(manager, shared, canEdit)
        : null,
      personal: await this.firstAidSection(manager, personal, true),
      chatKind: 'trip_first_aid',
    };
  }

  /**
   * Вес готовой аптечки — `PATCH /api/trips/:id/first-aid/weight`.
   *
   * Заказчик: «Итогом каждой секции поле для ввода веса получившейся
   * аптечки» и «если вес не известен, то в расчётах считай за 0, и не
   * отображай вес вообще». Поэтому `null` — законное значение: это «не
   * взвесили», а не ноль. В раскладке такая аптечка весит 0 и цифры
   * не показывает.
   *
   * Возвращается состояние вкладки целиком: экран после сохранения веса
   * не собирает его из двух ответов и не может показать половинку.
   */
  async setFirstAidWeight(
    userId: string,
    tripId: number,
    dto: SetFirstAidWeightDto,
  ): Promise<TripFirstAidDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);

    if (dto.scope === 'shared') {
      if (!(await this.trips.canEditTab(userId, trip, 'firstAid'))) {
        throw new ForbiddenException(
          'Общественную аптечку правит тот, кому доступна вкладка «Аптечка»',
        );
      }

      const doctor = await this.findTripDoctor(manager, trip.id);
      if (!doctor) {
        throw new BadRequestException(
          'Общественная аптечка появляется, когда в походе назначен доктор',
        );
      }

      const checklist = await this.ensureFirstAidChecklist(
        manager,
        trip.id,
        'trip',
        null,
      );
      checklist.weightGrams = dto.weightGrams ?? null;
      await manager.save(checklist);
    } else {
      await this.assertParticipant(manager, trip.id, userId);

      const checklist = await this.ensureFirstAidChecklist(
        manager,
        trip.id,
        'personal',
        userId,
      );
      checklist.weightGrams = dto.weightGrams ?? null;
      await manager.save(checklist);
    }

    return this.getFirstAid(userId, tripId);
  }

  /**
   * Список аптечки заводится при первом чтении вкладки.
   *
   * `ON CONFLICT DO NOTHING` + повторное чтение, а не «проверить и вставить»:
   * два участника могут открыть вкладку одновременно, и второй не должен
   * получить 500 из-за гонки. Возвращается уже существующая строка — своя
   * или только что созданная.
   */
  private async ensureFirstAidChecklist(
    manager: EntityManager,
    tripId: string,
    scope: 'trip' | 'personal',
    ownerUserId: string | null,
  ): Promise<Checklist> {
    await manager
      .createQueryBuilder()
      .insert()
      .into(Checklist)
      .values({
        scope,
        area: 'first_aid',
        tripId,
        ownerUserId,
        title: '',
      })
      .orIgnore()
      .execute();

    const where =
      scope === 'personal'
        ? {
            scope,
            area: 'first_aid' as const,
            tripId,
            ownerUserId: ownerUserId ?? '',
          }
        : { scope, area: 'first_aid' as const, tripId };
    const checklist = await manager.findOne(Checklist, { where });
    if (!checklist) {
      throw new ConflictException('Чек-лист аптечки не удалось завести');
    }

    return checklist;
  }

  /** Секция «Аптечки»: список целиком и его вес. */
  private async firstAidSection(
    manager: EntityManager,
    checklist: Checklist,
    canEdit: boolean,
  ): Promise<FirstAidSectionDto> {
    return {
      checklist: await this.one(manager, checklist),
      weightGrams: checklist.weightGrams,
      canEdit,
    };
  }

  /**
   * Доктор похода — первый по порядку состава (09.11.2026).
   *
   * То же правило, что у раскладки груза: аптечка одна, и едет она доктору.
   * Если докторов несколько, общественную аптечку правит и несёт первый —
   * «если их несколько, то любому» (слова заказчика). Роль, а не участие:
   * код `doctor` из справочника `seed-roles`.
   */
  private async findTripDoctor(
    manager: EntityManager,
    tripId: string,
  ): Promise<{ userId: string; displayName: string } | null> {
    const rows: Array<{ user_id: string; display_name: string }> =
      await manager.query(
        `SELECT p."user_id", u."display_name"
           FROM "trip_participants" p
           JOIN "trip_participant_roles" r
             ON r."trip_id" = p."trip_id" AND r."user_id" = p."user_id"
           JOIN "roles" ro ON ro."id" = r."role_id"
           JOIN "users" u ON u."id" = p."user_id"
          WHERE p."trip_id" = $1
            AND p."status" = 'going'
            AND ro."code" = 'doctor'
          ORDER BY p."created_at" ASC, p."user_id" ASC
          LIMIT 1`,
        [tripId],
      );

    const row = rows[0];
    return row ? { userId: row.user_id, displayName: row.display_name } : null;
  }

  /**
   * Завести список в походе.
   *
   * Общий список и рекомендацию заводит **ведущий «Снаряжения»** —
   * организатор или тот, кому матрица дала правку вкладки `gear`:
   * заказчик 05.11.2026 сказал «пользователь, имеющий доступ».
   *
   * Второй общий список («я тоже завёл») запрещён уникальным индексом,
   * поэтому повтор даёт 409, а не молчаливое «вернуть существующий»:
   * человек должен знать, что его список не создан.
   */
  async createForTrip(
    userId: string,
    tripId: number,
    dto: CreateTripChecklistDto,
  ): Promise<ChecklistDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);
    const area = dto.area ?? DEFAULT_CHECKLIST_AREA;

    await this.assertCanManageScope(manager, trip, dto.scope, userId, area);

    const existing = await manager.findOne(Checklist, {
      where: this.scopeWhere(String(trip.id), dto.scope, userId, area),
    });
    if (existing) {
      throw new ConflictException(this.duplicateMessage(dto.scope));
    }

    /**
     * Шаблон читается до транзакции: если его нет или он чужой, отказ
     * должен прийти без создания пустого списка. Копия — внутри
     * транзакции вместе со списком: половина пунктов в новом списке
     * хуже, чем ни одного.
     */
    const template = dto.fromTemplateId
      ? await this.findTemplate(manager, userId, dto.fromTemplateId)
      : null;
    const templateItems = template
      ? await manager.find(ChecklistItem, {
          where: { checklistId: template.id },
          order: { id: 'ASC' },
          relations: { gearItem: { gearType: true } },
        })
      : [];

    /**
     * В личный список вещь едет экземпляром, в общий и рекомендацию —
     * типом (`ImportChecklistItemsDto`). Шаблон чужой скопировать нельзя,
     * поэтому вещь в копии принадлежит тому же человеку.
     */
    const typeOnly = dto.scope !== 'personal';

    const created = await this.dataSource.transaction(async (tx) => {
      const checklist = await tx.save(
        tx.create(Checklist, {
          scope: dto.scope,
          area,
          ownerUserId: dto.scope === 'personal' ? userId : null,
          tripId: trip.id,
          title: dto.title?.trim() ?? template?.title ?? '',
        }),
      );
      if (templateItems.length > 0) {
        await tx.insert(
          ChecklistItem,
          templateItems.map((item) => ({
            checklistId: checklist.id,
            title: typeOnly
              ? (item.gearItem?.gearType.name ?? item.title)
              : (item.gearItem?.title ?? item.title),
            gearItemId: typeOnly ? null : item.gearItemId,
            isDone: false,
            createdByUserId: userId,
          })),
        );
      }

      const items = await tx.find(ChecklistItem, {
        where: { checklistId: checklist.id },
        order: { id: 'ASC' },
        relations: { gearItem: { gearType: true } },
      });

      return ChecklistDto.from(checklist, items);
    });

    // Список появился — вкладка у второго участника должна показать его тоже.
    this.events.emitChecklist(trip.id, userId);

    return created;
  }

  // ───────────────────────── внутреннее ─────────────────────────

  /**
   * «Список похода изменился» (06.11.2026).
   *
   * Шаблоны профиля сюда не попадают: у них нет `tripId`, и вкладке похода
   * нечего перечитывать. Отметки рекомендации событие не шлют намеренно:
   * они у каждого свои, и чужая галочка на экране смотрящего ничего
   * не меняет — перечитывать список ради неё значило бы дёргать вкладку
   * впустую.
   */
  private notifyTripChecklist(checklist: Checklist, userId: string): void {
    if (checklist.tripId === null) return;

    this.events.emitChecklist(checklist.tripId, userId);
  }

  /** Список по id или 404 — «не существует» и «не твой» неразличимы. */
  private async findChecklist(
    manager: EntityManager,
    id: number,
  ): Promise<Checklist> {
    const checklist = await manager.findOne(Checklist, {
      where: { id: String(id) },
    });
    if (!checklist) throw new NotFoundException('Чек-лист не найден');

    return checklist;
  }

  /**
   * Пункт по id — с вещью и её типом.
   *
   * Связи читаются сразу: ответ всегда отдаёт `gear`, и `null` там значил бы
   * «пункт без вещи», а не «поленились загрузить». Отдельный загрузчик
   * после каждой записи — цена одного join-а против врущего ответа.
   */
  private async findItem(
    manager: EntityManager,
    id: string | number,
  ): Promise<ChecklistItem> {
    const item = await manager.findOne(ChecklistItem, {
      where: { id: String(id) },
      relations: { gearItem: { gearType: true } },
    });
    if (!item) throw new NotFoundException('Пункт не найден');

    return item;
  }

  /**
   * Вещь каталога, которую можно привязать к пункту.
   *
   * Только своя и только не одноразовая: одноразовая вещь похода живёт
   * строкой `trip_gear` и каталогу не принадлежит, а чужая вещь — 404,
   * как любой чужой предмет в проекте (перебирать id нечего).
   */
  private async findOwnedGear(
    manager: EntityManager,
    userId: string,
    id: number,
  ): Promise<GearItem> {
    const gear = await manager.findOne(GearItem, {
      where: { id: String(id), ownerUserId: userId, isTripOnly: false },
      relations: { gearType: true },
    });
    if (!gear) throw new NotFoundException('Вещь не найдена');

    return gear;
  }

  /** Шаблон этого человека. Чужой шаблон — тоже 404: его как бы нет. */
  private async findTemplate(
    manager: EntityManager,
    userId: string,
    id: number,
  ): Promise<Checklist> {
    const template = await manager.findOne(Checklist, {
      where: { id: String(id), scope: 'template', ownerUserId: userId },
    });
    if (!template) throw new NotFoundException('Шаблон не найден');

    return template;
  }

  /**
   * Чтение: шаблон и личный список — только владельцу (404, чтобы id
   * чужих списков нельзя было перебирать), общий список и рекомендация —
   * всем, кому виден поход.
   */
  private async assertCanRead(
    _manager: EntityManager,
    checklist: Checklist,
    userId: string,
  ): Promise<void> {
    if (
      checklist.scope === 'trip' ||
      checklist.scope === 'recommendation'
    ) {
      await this.trips.getVisibleTrip(userId, Number(checklist.tripId));
      return;
    }

    if (checklist.ownerUserId !== userId) {
      throw new NotFoundException('Чек-лист не найден');
    }
  }

  /**
   * Правка списка и пунктов: владелец — у шаблона и личного, **ведущий
   * «Снаряжения»** — у общего списка и рекомендации (05.11.2026).
   *
   * Раньше общий список правил только организатор. Заказчик сказал:
   * «Пользователь (имеющий доступ) создаёт там чек-лист снаряжения…
   * Не имеющие доступа только видят», и матрица прав вкладки `gear` —
   * ровно этот «доступ». Участнику без роли править нечего: он видит
   * список, но галочек и кнопок у него нет.
   */
  private async assertCanEdit(
    _manager: EntityManager,
    checklist: Checklist,
    userId: string,
  ): Promise<void> {
    if (
      checklist.scope === 'trip' ||
      checklist.scope === 'recommendation'
    ) {
      const trip = await this.trips.getVisibleTrip(
        userId,
        Number(checklist.tripId),
      );
      if (
        !(await this.trips.canEditTab(
          userId,
          trip,
          CHECKLIST_AREA_TABS[checklist.area],
        ))
      ) {
        throw new ForbiddenException(
          `Список вкладки ${this.areaTitle(checklist.area)} правит тот, кому доступна эта вкладка`,
        );
      }
      return;
    }

    if (checklist.ownerUserId !== userId) {
      throw new NotFoundException('Чек-лист не найден');
    }
  }

  /**
   * Отметка исполнения: в общем списке — ведущему «Снаряжения» (он же его
   * и заполняет), в личном и шаблонном — владельцу.
   *
   * **У рекомендации отметок в пункте нет вовсе**: пункт общий, а «взял»
   * у каждого своё (`setRecommendationMark`). Прямой `PATCH` с `isDone`
   * отвечает 400, а не тихо пишет чужую галочку в общий пункт.
   */
  private async assertCanTick(
    _manager: EntityManager,
    checklist: Checklist,
    userId: string,
  ): Promise<void> {
    if (checklist.scope === 'trip') {
      const trip = await this.trips.getVisibleTrip(
        userId,
        Number(checklist.tripId),
      );
      if (
        !(await this.trips.canEditTab(
          userId,
          trip,
          CHECKLIST_AREA_TABS[checklist.area],
        ))
      ) {
        throw new ForbiddenException(
          `Отметки в списке вкладки ${this.areaTitle(checklist.area)} ставит тот, кому доступна эта вкладка`,
        );
      }
      return;
    }

    if (checklist.scope === 'recommendation') {
      throw new BadRequestException(
        'Отметки рекомендации хранятся у каждого участника отдельно',
      );
    }

    if (checklist.ownerUserId !== userId) {
      throw new NotFoundException('Чек-лист не найден');
    }
  }

  /**
   * Может ли человек заводить и править список этой области.
   *
   * Личный — участнику похода, общий и рекомендация — ведущему вкладки
   * «Снаряжение». Одно правило и на создание, и на импорт, чтобы две
   * ручки не разошлись в правах.
   */
  private async assertCanManageScope(
    manager: EntityManager,
    trip: Trip,
    scope: TripChecklistScope,
    userId: string,
    area: ChecklistArea = DEFAULT_CHECKLIST_AREA,
  ): Promise<void> {
    if (scope === 'personal') {
      await this.assertParticipant(manager, trip.id, userId);
      return;
    }

    if (
      !(await this.trips.canEditTab(
        userId,
        trip,
        CHECKLIST_AREA_TABS[area],
      ))
    ) {
      throw new ForbiddenException(
        `Список вкладки ${this.areaTitle(area)} заводит и правит тот, кому доступна эта вкладка`,
      );
    }
  }

  /** Условие поиска единственного списка этой области в походе. */
  private scopeWhere(
    tripId: string,
    scope: TripChecklistScope,
    userId: string,
    area: ChecklistArea = DEFAULT_CHECKLIST_AREA,
  ): FindOptionsWhere<Checklist> {
    return scope === 'personal'
      ? { scope, area, tripId, ownerUserId: userId }
      : { scope, area, tripId };
  }

  /** Название вкладки для текста ошибки: русские подписи — только здесь. */
  private areaTitle(area: ChecklistArea): string {
    return area === 'first_aid' ? '«Аптечка»' : '«Снаряжение»';
  }

  /** Почему второй такой список завести нельзя — словами для человека. */
  private duplicateMessage(scope: TripChecklistScope): string {
    if (scope === 'trip') return 'У похода уже есть общий чек-лист';
    if (scope === 'recommendation') {
      return 'В походе уже есть рекомендация личных вещей';
    }

    return 'У вас уже есть личный чек-лист в этом походе';
  }

  /** Участник похода: в составе и не отказался. */
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

  /** Пункты для нескольких списков — одним запросом, а не N+1. */
  private async withItems(
    manager: EntityManager,
    checklists: Checklist[],
  ): Promise<ChecklistDto[]> {
    if (checklists.length === 0) return [];

    const items = await manager.find(ChecklistItem, {
      where: { checklistId: In(checklists.map((checklist) => checklist.id)) },
      order: { checklistId: 'ASC', id: 'ASC' },
      // Вещь нужна каждой строке ответа: без связи `gear` всегда был бы
      // `null`, и фронт показывал бы ссылку обычным текстом.
      relations: { gearItem: { gearType: true } },
    });

    return checklists.map((checklist) =>
      ChecklistDto.from(
        checklist,
        items.filter((item) => item.checklistId === checklist.id),
      ),
    );
  }

  /** Один список с пунктами — обёртка над `withItems` для читаемости. */
  private async one(
    manager: EntityManager,
    checklist: Checklist,
  ): Promise<ChecklistDto> {
    return (await this.withItems(manager, [checklist]))[0];
  }

  /**
   * Рекомендация с **моими** отметками (05.11.2026).
   *
   * `isDone` пункта рекомендации — не свойство общего пункта, а состояние
   * смотрящего. Поэтому ответ собирается из двух источников: пункты
   * рекомендации и строки отметок этого человека. У организатора отметок
   * в этом ответе не будет, даже если участники уже всё взяли: ровно того
   * и просил заказчик.
   */
  private async withRecommendationMarks(
    manager: EntityManager,
    checklist: Checklist,
    userId: string,
  ): Promise<ChecklistDto> {
    const dto = await this.one(manager, checklist);
    if (dto.items.length === 0) return dto;

    const marks = await manager.find(ChecklistRecommendationMark, {
      where: {
        itemId: In(dto.items.map((item) => item.id)),
        userId,
      },
    });
    const byItem = new Map(marks.map((mark) => [mark.itemId, mark]));

    dto.items = dto.items.map((item) => {
      const mark = byItem.get(item.id);

      return {
        ...item,
        isDone: mark !== undefined,
        doneByUserId: mark ? userId : null,
        doneAt: mark?.doneAt.toISOString() ?? null,
      };
    });

    return dto;
  }
}
