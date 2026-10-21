import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In, Not } from 'typeorm';

import { TripParticipant } from '../trips/entities/trip-participant.entity';
import { TripsService } from '../trips/trips.service';
import {
  ChecklistDto,
  ChecklistItemDto,
  ChecklistListDto,
  CreateChecklistDto,
  CreateChecklistItemDto,
  CreateTripChecklistDto,
  TripChecklistListDto,
  UpdateChecklistDto,
  UpdateChecklistItemDto,
} from './dto/checklist.dto';
import { ChecklistItem } from './entities/checklist-item.entity';
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
 * | | шаблон | общий похода | личный |
 * |---|---|---|---|
 * | видеть | владелец | кто видит поход | владелец |
 * | править список и пункты | владелец | организатор | владелец |
 * | ставить отметки | владелец | участник похода | владелец |
 *
 * «Участник» — это `invited` / `going` / `maybe`, но **не** `declined`:
 * отказавшийся в подготовке не участвует (то же правило, что у чатов
 * в `ConversationsService`).
 *
 * ## Шаблон — копия, а не ссылка
 *
 * При создании списка в походе можно передать `fromTemplateId`: пункты
 * **копируются** в новую строку. Правка шаблона после этого поход
 * не трогает — иначе список снаряжения прошедшего похода менялся бы
 * задним числом.
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
        ownerUserId: userId,
        tripId: null,
        title,
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

  /** Добавить пункт. */
  async addItem(
    userId: string,
    checklistId: number,
    dto: CreateChecklistItemDto,
  ): Promise<ChecklistItemDto> {
    const manager = this.dataSource.manager;
    const checklist = await this.findChecklist(manager, checklistId);
    await this.assertCanEdit(manager, checklist, userId);

    const title = dto.title.trim();
    if (title.length === 0) {
      throw new BadRequestException('У пункта должен быть текст');
    }

    const saved = await manager.save(
      manager.create(ChecklistItem, {
        checklistId: checklist.id,
        title,
        isDone: false,
        doneByUserId: null,
        doneAt: null,
        createdByUserId: userId,
      }),
    );

    return ChecklistItemDto.from(saved);
  }

  /**
   * Отметка и/или правка текста.
   *
   * Два поля — два права. В общем списке похода отметку ставит любой
   * участник («Ваня взял газ» — это факт, а не административное решение),
   * а переименовать пункт может только организатор. Прислали оба поля —
   * проверяются оба права: частично применить запрос было бы нельзя,
   * иначе ответ соврал бы о том, что сохранилось.
   */
  async updateItem(
    userId: string,
    itemId: number,
    dto: UpdateChecklistItemDto,
  ): Promise<ChecklistItemDto> {
    const manager = this.dataSource.manager;

    const item = await manager.findOne(ChecklistItem, {
      where: { id: String(itemId) },
    });
    if (!item) throw new NotFoundException('Пункт не найден');

    const checklist = await this.findChecklist(manager, Number(item.checklistId));

    if (dto.title !== undefined) {
      await this.assertCanEdit(manager, checklist, userId);
    }
    if (dto.isDone !== undefined) {
      await this.assertCanTick(manager, checklist, userId);
    }

    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (title.length === 0) {
        throw new BadRequestException('У пункта должен быть текст');
      }
      item.title = title;
    }

    if (dto.isDone !== undefined) {
      // Отметка и её автор пишутся вместе: CHECK базы не пропустит
      // половину состояния, а «кто отметил» — смысл общего списка.
      item.isDone = dto.isDone;
      item.doneByUserId = dto.isDone ? userId : null;
      item.doneAt = dto.isDone ? new Date() : null;
    }

    return ChecklistItemDto.from(await manager.save(item));
  }

  /** Удалить пункт. */
  async deleteItem(userId: string, itemId: number): Promise<void> {
    const manager = this.dataSource.manager;

    const item = await manager.findOne(ChecklistItem, {
      where: { id: String(itemId) },
    });
    if (!item) throw new NotFoundException('Пункт не найден');

    const checklist = await this.findChecklist(manager, Number(item.checklistId));
    await this.assertCanEdit(manager, checklist, userId);

    await manager.delete(ChecklistItem, { id: item.id });
  }

  // ───────────────────────── поход ─────────────────────────

  /**
   * Чек-листы похода: общий и мой личный.
   *
   * Оба `null`, пока их не завели: «списка ещё нет» и «список пустой» —
   * разные вещи, и вкладка должна предложить создать первый, а не показать
   * пустой блок. Личный список ищется по паре «поход + я», общий — по
   * походу: он один.
   */
  async listForTrip(
    userId: string,
    tripId: number,
  ): Promise<TripChecklistListDto> {
    const manager = this.dataSource.manager;

    // Сначала видимость похода: приватный чужой — 404, как везде.
    await this.trips.getVisibleTrip(userId, tripId);

    const shared = await manager.findOne(Checklist, {
      where: { scope: 'trip', tripId: String(tripId) },
    });
    const personal = await manager.findOne(Checklist, {
      where: { scope: 'personal', tripId: String(tripId), ownerUserId: userId },
    });

    return {
      shared: shared ? await this.one(manager, shared) : null,
      personal: personal ? await this.one(manager, personal) : null,
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

  /**
   * Завести список в походе.
   *
   * Общий — только организатор: это список похода, и второй («я тоже
   * завёл») запрещён уникальным индексом, поэтому повтор даёт 409,
   * а не молчаливое «вернуть существующий»: человек должен знать,
   * что его список не создан.
   */
  async createForTrip(
    userId: string,
    tripId: number,
    dto: CreateTripChecklistDto,
  ): Promise<ChecklistDto> {
    const manager = this.dataSource.manager;
    const trip = await this.trips.getVisibleTrip(userId, tripId);

    if (dto.scope === 'trip') {
      if (trip.organizerUserId !== userId) {
        throw new ForbiddenException('Общий чек-лист заводит организатор похода');
      }
    } else {
      await this.assertParticipant(manager, trip.id, userId);
    }

    const existing = await manager.findOne(Checklist, {
      where:
        dto.scope === 'trip'
          ? { scope: 'trip', tripId: trip.id }
          : { scope: 'personal', tripId: trip.id, ownerUserId: userId },
    });
    if (existing) {
      throw new ConflictException(
        dto.scope === 'trip'
          ? 'У похода уже есть общий чек-лист'
          : 'У вас уже есть личный чек-лист в этом походе',
      );
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
        })
      : [];

    return this.dataSource.transaction(async (tx) => {
      const checklist = await tx.save(
        tx.create(Checklist, {
          scope: dto.scope,
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
            title: item.title,
            isDone: false,
            createdByUserId: userId,
          })),
        );
      }

      const items = await tx.find(ChecklistItem, {
        where: { checklistId: checklist.id },
        order: { id: 'ASC' },
      });

      return ChecklistDto.from(checklist, items);
    });
  }

  // ───────────────────────── внутреннее ─────────────────────────

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
   * чужих списков нельзя было перебирать), общий — всем, кому виден поход.
   */
  private async assertCanRead(
    _manager: EntityManager,
    checklist: Checklist,
    userId: string,
  ): Promise<void> {
    if (checklist.scope === 'trip') {
      await this.trips.getVisibleTrip(userId, Number(checklist.tripId));
      return;
    }

    if (checklist.ownerUserId !== userId) {
      throw new NotFoundException('Чек-лист не найден');
    }
  }

  /**
   * Правка списка и пунктов: владелец — у шаблона и личного, организатор
   * похода — у общего. Участнику править общий список нечего: его дело —
   * ставить отметки, а состав списка — решение организатора.
   */
  private async assertCanEdit(
    manager: EntityManager,
    checklist: Checklist,
    userId: string,
  ): Promise<void> {
    if (checklist.scope === 'trip') {
      const trip = await this.trips.getVisibleTrip(
        userId,
        Number(checklist.tripId),
      );
      if (trip.organizerUserId !== userId) {
        throw new ForbiddenException('Общий чек-лист правит организатор похода');
      }
      return;
    }

    if (checklist.ownerUserId !== userId) {
      throw new NotFoundException('Чек-лист не найден');
    }
  }

  /**
   * Отметка исполнения: в общем списке — любому участнику похода
   * (`declined` не считается: он в подготовке не участвует), в личном
   * и шаблонном — только владельцу.
   */
  private async assertCanTick(
    manager: EntityManager,
    checklist: Checklist,
    userId: string,
  ): Promise<void> {
    if (checklist.scope === 'trip') {
      await this.trips.getVisibleTrip(userId, Number(checklist.tripId));
      await this.assertParticipant(manager, checklist.tripId!, userId);
      return;
    }

    if (checklist.ownerUserId !== userId) {
      throw new NotFoundException('Чек-лист не найден');
    }
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
}
