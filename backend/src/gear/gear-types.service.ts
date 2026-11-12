import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { isAdminUser } from '../calendar/admin';
import {
  CreateGearAttributeOptionDto,
  CreateGearTypeAttributeDto,
  CreateGearTypeDto,
  GearAdminAttributeOptionDto,
  GearAdminTypeAttributeDto,
  GearAdminTypeDto,
  GearAdminTypeListDto,
  GearTypeDto,
  GearTypeListDto,
  SaveGearAttributeOptionDto,
  UpdateGearAttributeOptionDto,
  UpdateGearTypeAttributeDto,
  UpdateGearTypeDto,
} from './dto/gear-type.dto';
import { GearAttributeOption } from './entities/gear-attribute-option.entity';
import { GearGroupTemplate } from './entities/gear-group-template.entity';
import { GearType } from './entities/gear-type.entity';
import { GearTypeAttribute } from './entities/gear-type-attribute.entity';
import { parseAttributeValue } from './gear-attribute-values';
import { GEAR_CODE_PATTERN, GEAR_OPTIONS_MAX } from './gear.types';
import type { GearValueKind } from './gear.types';

/** Нормализованный вариант из тела запроса: код и имя уже обрезаны. */
interface NormalizedOption {
  code: string;
  name: string;
  sortOrder: number;
}

/**
 * Справочник типов снаряжения и их характеристик (Stage A).
 *
 * Два контракта в одном сервисе, и это осознанно: **публичный** список
 * (только активное) — то, на что будет опираться Stage B, а **админский**
 * (всё, включая архив) — то, чем правит админ. Логика у них общая, разница
 * только в выборке и в флаге `isActive`, поэтому отдельные сервисы
 * разошлись бы копией правил валидации.
 *
 * **Права — `isAdminUser`** (захардкоженный UUID, как в календаре): не-админ
 * получает 403, без токена отвечает глобальный guard 401-м. Таблица
 * `admin_users` в базе — приманка, код в неё не смотрит.
 *
 * **Удаления нет, есть архив.** `DELETE` ставит `is_active = false` и
 * идемпотентен: повторный ответ — снова 204. Физическое удаление выдернуло
 * бы в Stage B вещи, которые на этот тип ссылаются, и значения
 * характеристик.
 *
 * **`code` и `valueKind` неизменяемы.** Код — контракт для фильтров
 * и фронта, вид — тип колонки, в которую ляжет значение в Stage B.
 * Исправление ошибки — архив и новая строка с новым кодом.
 *
 * **Список вариантов (30.10.2026).** Четвёртый вид значения `select` держит
 * варианты отдельной таблицей (`gear_attribute_options`), потому что их
 * переименовывают, добавляют и архивируют, а массиву в характеристике нечем
 * держать ни стабильный код, ни архив, ни порядок. Варианты создаются
 * **вместе с характеристикой** (`options` в `POST attributes`) — чтобы админ
 * не получал мёртвый список, в котором нечего выбирать; добавлять по одному
 * после тоже можно. Правила вида:
 *
 * - `allowCustomValue` включается только у `select` (иначе 400 — и CHECK
 *   в базе держит то же правило);
 * - у `select` должен быть хотя бы один активный вариант **или** разрешённое
 *   своё значение, иначе 400 на создание и 409 на попытку убрать последний
 *   вариант;
 * - имена вариантов внутри списка не повторяются: в Stage B значение хранится
 *   текстом имени, и два одинаковых имени сделали бы фильтр неоднозначным.
 */
@Injectable()
export class GearTypesService {
  constructor(private readonly dataSource: DataSource) {}

  /** Публичный справочник: активные типы с активными характеристиками. */
  async listPublic(): Promise<GearTypeListDto> {
    const types = await this.findTypes(true);

    return { items: types.map((type) => GearTypeDto.from(type)) };
  }

  /** Админский справочник: архивные типы и характеристики тоже. */
  async listAdmin(userId: string): Promise<GearAdminTypeListDto> {
    this.assertAdmin(userId);
    const types = await this.findTypes(false);

    return { items: types.map((type) => GearAdminTypeDto.fromAdmin(type)) };
  }

  /** Новый тип. Код занимается навсегда, даже если тип потом уйдёт в архив. */
  async createType(
    userId: string,
    dto: CreateGearTypeDto,
  ): Promise<GearAdminTypeDto> {
    this.assertAdmin(userId);

    const code = this.normalizeCode(dto.code);
    const name = this.normalizeName(dto.name);
    const manager = this.dataSource.manager;

    const taken = await manager.findOne(GearType, { where: { code } });
    if (taken) throw this.duplicateType(code);

    const recommended = await this.resolveRecommendedGroup(
      manager,
      dto.recommendedGroupId,
    );

    try {
      const saved = await manager.save(
        manager.create(GearType, {
          code,
          name,
          isActive: true,
          sortOrder: dto.sortOrder ?? 0,
          recommendedGroupId: recommended?.id ?? null,
          attributes: [],
        }),
      );

      return GearAdminTypeDto.fromAdmin(saved);
    } catch (error) {
      // Между проверкой и вставкой код мог занять другой запрос: unique
      // в базе остаётся последним словом, и ответ должен быть тот же 409.
      if (this.isUniqueViolation(error)) throw this.duplicateType(code);
      throw error;
    }
  }

  /**
   * Правка типа: имя, порядок, активность.
   *
   * `code` меняться не может — в Stage B на него опираются фильтры.
   * Если поле пришло, отвечаем 400 с причиной, а не молча игнорируем.
   */
  async updateType(
    userId: string,
    id: number,
    dto: UpdateGearTypeDto,
  ): Promise<GearAdminTypeDto> {
    this.assertAdmin(userId);

    if (dto.code !== undefined) {
      throw new BadRequestException(
        'Код типа менять нельзя: ошибку исправляют архивом и новым кодом',
      );
    }

    const manager = this.dataSource.manager;
    const type = await this.findType(manager, id);

    if (dto.name !== undefined) type.name = this.normalizeName(dto.name);
    if (dto.sortOrder !== undefined) type.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) type.isActive = dto.isActive;

    if (dto.recommendedGroupId !== undefined) {
      // Архивную рекомендацию, которая уже стоит у типа, разрешаем оставить:
      // иначе правка имени типа падала бы 400 из-за архива, к которому
      // админ отношения не имеет. Новую архивную выбрать нельзя.
      if (dto.recommendedGroupId !== type.recommendedGroupId) {
        const recommended = await this.resolveRecommendedGroup(
          manager,
          dto.recommendedGroupId,
        );
        type.recommendedGroupId = recommended?.id ?? null;
      }
    }

    await manager.save(type);

    return this.adminType(manager, type.id);
  }

  /**
   * Архив типа. Ответ 204 и никакого тела — как у удаления.
   *
   * Характеристики типа архив не трогает: у них свой флаг, и вернуть тип
   * из архива должно быть достаточно, чтобы справочник стал прежним.
   */
  async archiveType(userId: string, id: number): Promise<void> {
    this.assertAdmin(userId);

    const manager = this.dataSource.manager;
    const type = await this.findType(manager, id);

    if (type.isActive) {
      type.isActive = false;
      await manager.save(type);
    }
  }

  /**
   * Новая характеристика типа — при желании сразу со списком вариантов.
   *
   * `options` и `allowCustomValue` осмысленны только у `valueKind = 'select'`:
   * у числа, строки и галочки вариантов быть не может, а «своё значение» и так
   * единственное. Поэтому оба поля при другом виде — 400, а не молчаливое
   * игнорирование.
   *
   * Характеристика и её варианты пишутся **одной транзакцией**: иначе сбой
   * на втором шаге оставил бы характеристику без вариантов, то есть ровно то
   * «мёртвое» состояние, которого заказчик просил избежать.
   */
  async createAttribute(
    userId: string,
    typeId: number,
    dto: CreateGearTypeAttributeDto,
  ): Promise<GearAdminTypeAttributeDto> {
    this.assertAdmin(userId);

    const manager = this.dataSource.manager;
    const type = await this.findType(manager, typeId);

    const code = this.normalizeCode(dto.code);
    const name = this.normalizeName(dto.name);
    const isRequired = dto.isRequired ?? false;
    const allowCustomValue = dto.allowCustomValue ?? false;

    if (allowCustomValue && dto.valueKind !== 'select') {
      throw new BadRequestException(
        'Своё значение можно разрешить только у списка вариантов',
      );
    }

    const options = this.normalizeOptions(dto.valueKind, dto.options ?? []);
    this.assertSelectUsable(
      dto.valueKind,
      allowCustomValue,
      options.length,
    );

    // `fillMissing` в Stage A проверяется и отбрасывается: таблицы значений
    // (`gear_item_attributes`) ещё нет, заполнять нечего. В Stage B тот же
    // вызов начнёт писать его пустым значениям.
    if (isRequired || this.hasFillMissing(dto.fillMissing)) {
      this.assertFillMissing(dto.valueKind, dto.fillMissing, {
        allowCustom: allowCustomValue,
        optionNames: options.map((option) => option.name),
      });
    }

    const taken = await manager.findOne(GearTypeAttribute, {
      where: { gearTypeId: type.id, code },
    });
    if (taken) throw this.duplicateAttribute(code);

    try {
      const attributeId = await this.dataSource.transaction(async (tx) => {
        const saved = await tx.save(
          tx.create(GearTypeAttribute, {
            gearTypeId: type.id,
            code,
            name,
            valueKind: dto.valueKind,
            unit: this.normalizeUnit(dto.unit),
            placeholder: this.normalizePlaceholder(dto.placeholder),
            allowCustomValue,
            isRequired,
            isActive: true,
            sortOrder: dto.sortOrder ?? 0,
          }),
        );

        if (options.length > 0) {
          await tx.save(
            options.map((option) =>
              tx.create(GearAttributeOption, {
                gearTypeAttributeId: saved.id,
                code: option.code,
                name: option.name,
                isActive: true,
                sortOrder: option.sortOrder,
              }),
            ),
          );
        }

        // Обязательная характеристика сразу заполняет пустые значения
        // у существующих вещей: иначе она была бы обязательной только
        // на словах, а старые вещи остались бы с дырой.
        if (saved.isRequired) {
          await this.backfillValues(
            tx,
            type.id,
            saved,
            dto.fillMissing,
            allowCustomValue,
            options.map((option) => option.name),
          );
        }

        return saved.id;
      });

      return this.adminAttribute(manager, type.id, attributeId);
    } catch (error) {
      // Между проверкой и вставкой код мог занять другой запрос: unique
      // в базе остаётся последним словом, и ответ должен быть тот же 409.
      if (this.isOptionUniqueViolation(error)) {
        throw new ConflictException(
          'Вариант с таким кодом уже есть у этой характеристики',
        );
      }
      if (this.isUniqueViolation(error)) throw this.duplicateAttribute(code);
      throw error;
    }
  }

  /**
   * Правка характеристики: имя, единица, плейсхолдер, обязательность,
   * порядок, архив, «разрешить своё значение» и варианты списка.
   *
   * `valueKind` не меняется даже на «тот же самый»: 409. Смена вида
   * означала бы перенос уже записанных в Stage B значений, а правило
   * ставят сразу, чтобы контракт не менялся между шагами.
   *
   * **Варианты — полным набором** (03.11.2026). Заказчик: «редактирование
   * характеристики не даёт изменять варианты… не удобно. Есть ещё варианты
   * кроме „по-новой“?» — теперь в карточке характеристики правятся и они:
   * добавить, переименовать, переставить и убрать в архив одним сохранением,
   * в той же транзакции. Отдельные ручки вариантов продолжают работать:
   * ими пользуются чипы в строке. Существующий вариант, которого нет в теле,
   * не трогается — архивирует только явный `isActive: false`.
   */
  async updateAttribute(
    userId: string,
    typeId: number,
    attributeId: number,
    dto: UpdateGearTypeAttributeDto,
  ): Promise<GearAdminTypeAttributeDto> {
    this.assertAdmin(userId);

    if (dto.code !== undefined) {
      throw new BadRequestException(
        'Код характеристики менять нельзя: ошибку исправляют архивом и новым кодом',
      );
    }
    if (dto.valueKind !== undefined) {
      throw new ConflictException(
        'Вид характеристики менять нельзя: заведи в архив и новую характеристику с новым кодом',
      );
    }

    const manager = this.dataSource.manager;
    await this.findType(manager, typeId);
    const attribute = await this.findAttribute(manager, typeId, attributeId);

    if (
      dto.options !== undefined &&
      dto.options.length > 0 &&
      attribute.valueKind !== 'select'
    ) {
      throw new BadRequestException(
        'Варианты бывают только у характеристики-списка',
      );
    }

    const activeOptionNames =
      dto.options === undefined
        ? await this.activeOptionNames(manager, attribute.id)
        : await this.optionNamesAfter(manager, attribute.id, dto.options);
    const allowCustomValue =
      dto.allowCustomValue ?? attribute.allowCustomValue;

    if (dto.allowCustomValue === true && attribute.valueKind !== 'select') {
      throw new BadRequestException(
        'Своё значение можно разрешить только у списка вариантов',
      );
    }
    // Запретить своё значение, не оставив ни одного варианта, — значит
    // сделать характеристику невыбираемой. Разрешаем только при живом списке.
    // Если в этом же запросе пришёл набор вариантов, проверку сделает
    // `replaceOptions` по итоговому состоянию — иначе она смотрела бы
    // на старый список и запрещала бы законную правку.
    if (
      dto.options === undefined &&
      dto.allowCustomValue === false &&
      attribute.valueKind === 'select' &&
      activeOptionNames.length === 0
    ) {
      throw new BadRequestException(
        'Нельзя запретить своё значение: у списка нет ни одного варианта',
      );
    }

    // Обязательность включается — нужно замещающее значение: иначе в Stage B
    // старые вещи без значения станут невалидными молча.
    if (dto.isRequired === true && !attribute.isRequired) {
      this.assertFillMissing(attribute.valueKind, dto.fillMissing, {
        allowCustom: allowCustomValue,
        optionNames: activeOptionNames,
      });
    } else if (this.hasFillMissing(dto.fillMissing)) {
      this.assertFillMissing(attribute.valueKind, dto.fillMissing, {
        allowCustom: allowCustomValue,
        optionNames: activeOptionNames,
      });
    }

    if (dto.name !== undefined) attribute.name = this.normalizeName(dto.name);
    if (dto.unit !== undefined) attribute.unit = this.normalizeUnit(dto.unit);
    if (dto.placeholder !== undefined) {
      attribute.placeholder = this.normalizePlaceholder(dto.placeholder);
    }
    if (dto.allowCustomValue !== undefined) {
      attribute.allowCustomValue = dto.allowCustomValue;
    }
    if (dto.isRequired !== undefined) attribute.isRequired = dto.isRequired;
    if (dto.isActive !== undefined) attribute.isActive = dto.isActive;
    if (dto.sortOrder !== undefined) attribute.sortOrder = dto.sortOrder;

    // Характеристика, её варианты и замещающее значение пишутся вместе:
    // один запрос — одно состояние справочника.
    await this.dataSource.transaction(async (tx) => {
      await tx.save(attribute);

      if (dto.options !== undefined) {
        await this.replaceOptions(tx, attribute, dto.options);
      }

      if (
        attribute.isRequired &&
        attribute.isActive &&
        this.hasFillMissing(dto.fillMissing)
      ) {
        await this.backfillValues(
          tx,
          typeId,
          attribute,
          dto.fillMissing,
          allowCustomValue,
          activeOptionNames,
        );
      }
    });

    return this.adminAttribute(manager, typeId, attribute.id);
  }

  /** Архив характеристики. Повторный вызов — снова 204. */
  async archiveAttribute(
    userId: string,
    typeId: number,
    attributeId: number,
  ): Promise<void> {
    this.assertAdmin(userId);

    const manager = this.dataSource.manager;
    await this.findType(manager, typeId);
    const attribute = await this.findAttribute(manager, typeId, attributeId);

    if (attribute.isActive) {
      attribute.isActive = false;
      await manager.save(attribute);
    }
  }

  // ─────────────────────── варианты списка (select) ───────────────────────

  /**
   * Новый вариант к уже существующему списку.
   *
   * Создавать варианты вместе с характеристикой можно и удобнее
   * (`options` в `POST attributes`), но добавлять по одному после — тоже:
   * админ возвращается к списку, когда вспомнил ещё одно соединение.
   */
  async createOption(
    userId: string,
    typeId: number,
    attributeId: number,
    dto: CreateGearAttributeOptionDto,
  ): Promise<GearAdminAttributeOptionDto> {
    this.assertAdmin(userId);

    const manager = this.dataSource.manager;
    await this.findType(manager, typeId);
    const attribute = await this.findAttribute(manager, typeId, attributeId);
    this.assertListAttribute(attribute);

    const code = this.normalizeCode(dto.code);
    const name = this.normalizeName(dto.name);

    const taken = await manager.findOne(GearAttributeOption, {
      where: { gearTypeAttributeId: attribute.id, code },
    });
    if (taken) throw this.duplicateOption(code);
    await this.assertOptionNameFree(manager, attribute.id, name);

    try {
      const saved = await manager.save(
        manager.create(GearAttributeOption, {
          gearTypeAttributeId: attribute.id,
          code,
          name,
          isActive: true,
          sortOrder: dto.sortOrder ?? 0,
        }),
      );

      return GearAdminAttributeOptionDto.fromAdmin(saved);
    } catch (error) {
      if (this.isOptionUniqueViolation(error)) throw this.duplicateOption(code);
      throw error;
    }
  }

  /**
   * Правка варианта: имя, порядок, архив.
   *
   * `code` неизменяем (400), как у типов и характеристик: на него будут
   * опираться фильтры, а имя переименовывается свободно. Переименование
   * одной транзакцией обновляет и сохранённые значения вещей: в Stage B
   * `text_value` хранит **имя** варианта.
   */
  async updateOption(
    userId: string,
    typeId: number,
    attributeId: number,
    optionId: number,
    dto: UpdateGearAttributeOptionDto,
  ): Promise<GearAdminAttributeOptionDto> {
    this.assertAdmin(userId);

    if (dto.code !== undefined) {
      throw new BadRequestException(
        'Код варианта менять нельзя: ошибку исправляют архивом и новым вариантом с новым кодом',
      );
    }

    const manager = this.dataSource.manager;
    await this.findType(manager, typeId);
    const attribute = await this.findAttribute(manager, typeId, attributeId);
    const option = await this.findOption(manager, attributeId, optionId);

    let renamedFrom: string | null = null;

    if (dto.name !== undefined) {
      const name = this.normalizeName(dto.name);
      await this.assertOptionNameFree(manager, attribute.id, name, option.id);
      if (name !== option.name) renamedFrom = option.name;
      option.name = name;
    }
    if (dto.sortOrder !== undefined) option.sortOrder = dto.sortOrder;
    if (dto.isActive === false && option.isActive) {
      await this.assertNotLastOption(manager, attribute);
    }
    if (dto.isActive !== undefined) option.isActive = dto.isActive;

    const saved = await manager.save(option);
    if (renamedFrom !== null) {
      await this.renameOptionValues(
        manager,
        attribute.id,
        renamedFrom,
        option.name,
      );
    }

    return GearAdminAttributeOptionDto.fromAdmin(saved);
  }

  /**
   * Архив варианта. Повторный вызов — снова 204.
   *
   * Убрать последний активный вариант у списка без разрешённого своего
   * значения нельзя (409): характеристика осталась бы «выбирать не из чего».
   * У архивной характеристики такого запрета нет — она и так не предлагается.
   */
  async archiveOption(
    userId: string,
    typeId: number,
    attributeId: number,
    optionId: number,
  ): Promise<void> {
    this.assertAdmin(userId);

    const manager = this.dataSource.manager;
    await this.findType(manager, typeId);
    const attribute = await this.findAttribute(manager, typeId, attributeId);
    const option = await this.findOption(manager, attributeId, optionId);

    if (!option.isActive) return;

    await this.assertNotLastOption(manager, attribute);
    option.isActive = false;
    await manager.save(option);
  }

  /**
   * Полный набор вариантов из карточки характеристики (03.11.2026).
   *
   * Пришедшие строки — это то, что админ видит в форме: у существующего
   * варианта есть `id`, новый приходит без него. Существующий, которого нет
   * в списке, остаётся как был: убрать вариант можно только явной снятой
   * галочкой (`isActive: false`), поэтому «полная замена» никого не теряет
   * молча. Так же, как у отдельных ручек: код неизменяем, имена не
   * повторяются, а последний активный вариант у списка без своего значения
   * убрать нельзя — иначе выбирать станет не из чего.
   *
   * **Переименование правит и значения вещей.** В Stage B имя варианта
   * лежит в `gear_item_attributes.text_value`, поэтому переименование
   * одной транзакцией обновляет и старые значения. Раньше это было записано
   * в документации, но не сделано; правка набора сделала ошибку легкодостижимой
   * — теперь она закрыта и здесь, и в одиночной ручке (`updateOption`).
   */
  private async replaceOptions(
    manager: EntityManager,
    attribute: GearTypeAttribute,
    incoming: SaveGearAttributeOptionDto[],
  ): Promise<void> {
    if (attribute.valueKind !== 'select') {
      if (incoming.length === 0) return;

      throw new BadRequestException(
        'Варианты бывают только у характеристики-списка',
      );
    }

    const existing = await manager.find(GearAttributeOption, {
      where: { gearTypeAttributeId: attribute.id },
    });
    const byId = new Map(existing.map((option) => [option.id, option]));
    const touched = new Set<number>();

    // Имена занятых вариантов, которых нет в теле: они не меняются и своё
    // имя держат. Коды тоже заняты все — включая архивные.
    const names = new Set(
      existing
        .filter((option) => !incoming.some((row) => row.id === option.id))
        .map((option) => option.name.toLowerCase()),
    );
    const codes = new Set(existing.map((option) => option.code));

    /** Что делать по каждой строке: правка существующего или новый вариант. */
    const plan: Array<{
      option: GearAttributeOption | null;
      code: string;
      name: string;
      sortOrder?: number;
      isActive?: boolean;
    }> = [];

    for (const row of incoming) {
      if (row.id !== undefined) {
        const option = byId.get(row.id);
        if (option === undefined) {
          throw new BadRequestException(
            'Такого варианта у характеристики нет',
          );
        }
        if (touched.has(row.id)) {
          throw new BadRequestException('Вариант указан в списке дважды');
        }
        if (row.code !== undefined && row.code.trim() !== option.code) {
          throw new BadRequestException(
            'Код варианта менять нельзя: ошибку исправляют архивом и новым вариантом с новым кодом',
          );
        }

        // Имя можно не повторять: пришёл только архив — вариант его сохраняет.
        const name =
          row.name === undefined ? option.name : this.normalizeName(row.name);

        if (names.has(name.toLowerCase())) {
          throw new ConflictException(
            `Вариант с названием «${name}» повторяется: значения хранятся текстом, два одинаковых имени неразличимы`,
          );
        }

        names.add(name.toLowerCase());
        touched.add(row.id);
        plan.push({
          option,
          code: option.code,
          name,
          sortOrder: row.sortOrder,
          isActive: row.isActive,
        });
      } else {
        if (row.code === undefined || row.name === undefined) {
          throw new BadRequestException(
            'Новому варианту нужны код и название: код — латиница, начиная с буквы',
          );
        }

        const code = this.normalizeCode(row.code);
        const name = this.normalizeName(row.name);
        if (codes.has(code)) throw this.duplicateOption(code);
        if (names.has(name.toLowerCase())) {
          throw new ConflictException(
            `Вариант с названием «${name}» повторяется: значения хранятся текстом, два одинаковых имени неразличимы`,
          );
        }

        codes.add(code);
        names.add(name.toLowerCase());
        plan.push({
          option: null,
          code,
          name,
          sortOrder: row.sortOrder,
          isActive: row.isActive,
        });
      }
    }

    // Итоговое число активных: нетронутые + пришедшие со своим состоянием.
    let active = existing.filter(
      (option) => option.isActive && !touched.has(option.id),
    ).length;
    for (const item of plan) {
      const state = item.isActive ?? item.option?.isActive ?? true;
      if (state) active += 1;
    }

    if (active > GEAR_OPTIONS_MAX) {
      throw new BadRequestException(
        `Вариантов не может быть больше ${GEAR_OPTIONS_MAX}`,
      );
    }
    if (attribute.isActive && !attribute.allowCustomValue && active === 0) {
      throw new ConflictException(
        'Нельзя убрать последний вариант: выбирать будет не из чего. Разреши своё значение или убери характеристику в архив',
      );
    }

    for (const item of plan) {
      const option = item.option;

      if (option === null) {
        await manager.save(
          manager.create(GearAttributeOption, {
            gearTypeAttributeId: attribute.id,
            code: item.code,
            name: item.name,
            isActive: item.isActive ?? true,
            sortOrder: item.sortOrder ?? 0,
          }),
        );

        continue;
      }

      const oldName = option.name;
      option.name = item.name;
      if (item.sortOrder !== undefined) option.sortOrder = item.sortOrder;
      if (item.isActive !== undefined) option.isActive = item.isActive;

      await manager.save(option);

      if (oldName !== option.name) {
        await this.renameOptionValues(
          manager,
          attribute.id,
          oldName,
          option.name,
        );
      }
    }
  }

  /**
   * Переименование варианта догоняет значения вещей.
   *
   * У списка в `text_value` лежит **имя**, а не код: без этого `UPDATE`
   * старая вещь осталась бы со снятым с учёта именем и выпала из фильтра.
   */
  private async renameOptionValues(
    manager: EntityManager,
    attributeId: number,
    from: string,
    to: string,
  ): Promise<void> {
    await manager.query(
      `UPDATE gear_item_attributes
          SET text_value = $1
        WHERE gear_type_attribute_id = $2
          AND text_value = $3`,
      [to, attributeId, from],
    );
  }

  /**
   * Типы со связью характеристик и вариантов, в порядке показа.
   *
   * Атрибуты и варианты сортируются здесь, а не вложенным `order`: их единицы
   * на тип и на характеристику, а порядок «активные сверху, потом sort_order,
   * потом id» проще прочитать в одном месте, чем в опциях запроса.
   */
  private async findTypes(activeOnly: boolean): Promise<GearType[]> {
    const manager = this.dataSource.manager;
    const types = await manager.find(GearType, {
      where: activeOnly ? { isActive: true } : {},
      relations: { attributes: { options: true } },
      order: { isActive: 'DESC', sortOrder: 'ASC', name: 'ASC' },
    });

    for (const type of types) {
      type.attributes = this.sortAttributes(type.attributes ?? [], activeOnly);
      for (const attribute of type.attributes) {
        attribute.options = this.sortOptions(attribute.options ?? [], activeOnly);
      }
    }

    return types;
  }

  /** Тип с характеристиками в порядке показа — ответ админской ручки. */
  private async adminType(
    manager: EntityManager,
    id: number,
  ): Promise<GearAdminTypeDto> {
    const type = await manager.findOne(GearType, {
      where: { id },
      relations: { attributes: { options: true } },
    });
    if (!type) throw new NotFoundException('Тип снаряжения не найден');

    type.attributes = this.sortAttributes(type.attributes ?? [], false);
    for (const attribute of type.attributes) {
      attribute.options = this.sortOptions(attribute.options ?? [], false);
    }

    return GearAdminTypeDto.fromAdmin(type);
  }

  /** Одна характеристика в порядке показа — ответ ручек характеристик и вариантов. */
  private async adminAttribute(
    manager: EntityManager,
    typeId: number,
    attributeId: number,
  ): Promise<GearAdminTypeAttributeDto> {
    const attribute = await manager.findOne(GearTypeAttribute, {
      where: { id: attributeId, gearTypeId: typeId },
      relations: { options: true },
    });
    if (!attribute) throw new NotFoundException('Характеристика не найдена');

    attribute.options = this.sortOptions(attribute.options ?? [], false);

    return GearAdminTypeAttributeDto.fromAdmin(attribute);
  }

  private sortAttributes(
    attributes: GearTypeAttribute[],
    activeOnly: boolean,
  ): GearTypeAttribute[] {
    return [...attributes]
      .filter((attribute) => !activeOnly || attribute.isActive)
      .sort((left, right) => {
        if (!activeOnly && left.isActive !== right.isActive) {
          return left.isActive ? -1 : 1;
        }
        if (left.sortOrder !== right.sortOrder) {
          return left.sortOrder - right.sortOrder;
        }
        return left.id - right.id;
      });
  }

  /** Варианты: у публичного ответа архивные отбрасываются, у админского — нет. */
  private sortOptions(
    options: GearAttributeOption[],
    activeOnly: boolean,
  ): GearAttributeOption[] {
    return [...options]
      .filter((option) => !activeOnly || option.isActive)
      .sort((left, right) => {
        if (!activeOnly && left.isActive !== right.isActive) {
          return left.isActive ? -1 : 1;
        }
        if (left.sortOrder !== right.sortOrder) {
          return left.sortOrder - right.sortOrder;
        }
        return left.id - right.id;
      });
  }

  private async findType(
    manager: EntityManager,
    id: number,
  ): Promise<GearType> {
    const type = await manager.findOne(GearType, { where: { id } });
    if (!type) throw new NotFoundException('Тип снаряжения не найден');

    return type;
  }

  /**
   * Рекомендуемая группа типа: шаблон, в который тип придёт человеку.
   *
   * `null` — «Прочее». Архивный шаблон выбрать нельзя: он не приходит новым
   * пользователям, и тип молча уехал бы в «Прочее» вместо указанной группы.
   */
  private async resolveRecommendedGroup(
    manager: EntityManager,
    id: number | null | undefined,
  ): Promise<GearGroupTemplate | null> {
    if (id === null || id === undefined) return null;

    const template = await manager.findOne(GearGroupTemplate, {
      where: { id },
    });
    if (!template) {
      throw new BadRequestException('Рекомендуемая группа не найдена');
    }
    if (!template.isActive) {
      throw new BadRequestException(
        'Рекомендуемая группа в архиве — выбери действующую',
      );
    }

    return template;
  }

  /**
   * Характеристика внутри типа.
   *
   * Внешний id проверяется тоже: `/types/1/attributes/7` для атрибута типа 2
   * — это 404, а не «поменяли что-то не то». Иначе админка с перепутанным
   * id правила бы чужую характеристику.
   */
  private async findAttribute(
    manager: EntityManager,
    typeId: number,
    attributeId: number,
  ): Promise<GearTypeAttribute> {
    const attribute = await manager.findOne(GearTypeAttribute, {
      where: { id: attributeId, gearTypeId: typeId },
    });
    if (!attribute) throw new NotFoundException('Характеристика не найдена');

    return attribute;
  }

  /** Вариант внутри характеристики: чужой id — 404, а не правка не того. */
  private async findOption(
    manager: EntityManager,
    attributeId: number,
    optionId: number,
  ): Promise<GearAttributeOption> {
    const option = await manager.findOne(GearAttributeOption, {
      where: { id: optionId, gearTypeAttributeId: attributeId },
    });
    if (!option) throw new NotFoundException('Вариант не найден');

    return option;
  }

  private assertAdmin(userId: string): void {
    if (!isAdminUser(userId)) {
      throw new ForbiddenException('Раздел только для администратора');
    }
  }

  /** Код: латиница по регулярке, до 40 символов. */
  private normalizeCode(raw: string): string {
    const code = raw.trim();
    if (!GEAR_CODE_PATTERN.test(code) || code.length > 40) {
      throw new BadRequestException(
        'Код — латиница, начиная с буквы: ^[a-z][a-z0-9_]*$, до 40 символов',
      );
    }

    return code;
  }

  /** Название: непустое после `btrim`, до 100 символов. */
  private normalizeName(raw: string): string {
    const name = raw.trim();
    if (name.length === 0) {
      throw new BadRequestException('Название не может быть пустым');
    }
    if (name.length > 100) {
      throw new BadRequestException('Название не должно превышать 100 символов');
    }

    return name;
  }

  /**
   * Единица: пустая строка — это «нет единицы», а не пустая строка в базе.
   *
   * CHECK в базе запрещает `''` (он неотличим от случайной пробелки),
   * поэтому `''` и `null` сходятся в `NULL`: форма приходит с пустым полем,
   * и это осознанное стирание.
   */
  private normalizeUnit(unit: string | null | undefined): string | null {
    if (unit === undefined || unit === null) return null;

    const trimmed = unit.trim();

    return trimmed.length === 0 ? null : trimmed;
  }

  /**
   * Плейсхолдер: как единица — пустое значение это «нет подсказки», а не `''`.
   *
   * Длина ограничена CHECK-ом в базе и DTO: это короткий пример в поле,
   * а не описание характеристики.
   */
  private normalizePlaceholder(
    placeholder: string | null | undefined,
  ): string | null {
    if (placeholder === undefined || placeholder === null) return null;

    const trimmed = placeholder.trim();

    return trimmed.length === 0 ? null : trimmed;
  }

  private hasFillMissing(value: unknown): boolean {
    return value !== undefined && value !== null;
  }

  /**
   * Замещающее значение по виду характеристики.
   *
   * В Stage A оно никуда не пишется — таблицы значений ещё нет. Проверяем
   * его сейчас, чтобы правило не появилось впервые в Stage B вместе
   * с записью: `0` для числа, непустая строка для текста, `true`/`false`
   * для галочки, **название варианта для списка**.
   *
   * У списка значение — имя варианта, потому что именно имя в Stage B ляжет
   * в `text_value`. Если своё значение разрешено (`allowCustom`), подойдёт
   * любая непустая строка; если нет — только одно из названий активных
   * вариантов, иначе фильтр по этому значению разошёлся бы со списком.
   */
  private assertFillMissing(
    valueKind: GearValueKind,
    value: unknown,
    options: {
      allowCustom?: boolean;
      optionNames?: readonly string[];
    } = {},
  ): void {
    if (valueKind === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new BadRequestException(
          'Для числовой характеристики замещающее значение — число, например 0',
        );
      }

      return;
    }

    if (valueKind === 'text') {
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new BadRequestException(
          'Для текстовой характеристики замещающее значение — непустая строка',
        );
      }

      return;
    }

    if (valueKind === 'bool') {
      if (typeof value !== 'boolean') {
        throw new BadRequestException(
          'Для характеристики-галочки замещающее значение — true или false',
        );
      }

      return;
    }

    // select: имя варианта либо своё значение, если оно разрешено.
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(
        'Для списка замещающее значение — название варианта или своё значение',
      );
    }
    if (options.allowCustom === true) return;

    const names = options.optionNames ?? [];
    const trimmed = value.trim();
    if (!names.includes(trimmed)) {
      const list = names.map((name) => `«${name}»`).join(', ');
      throw new BadRequestException(
        names.length === 0
          ? 'У списка нет вариантов: сначала добавь вариант или разреши своё значение'
          : `Для списка замещающее значение — один из вариантов: ${list}. Своё значение не разрешено`,
      );
    }
  }

  /**
   * «Замещающее значение» в дело (Stage B, 30.10.2026).
   *
   * В Stage A значение проверялось и **отбрасывалось**: таблицы значений
   * ещё не было. Теперь она есть, и момент применения один — когда
   * характеристика становится обязательной: у существующих вещей этого типа
   * пустое значение заполняется замещающим. Так «Вместимость» палатки
   * получает «3» у всех, кто завёл палатку до появления обязательности,
   * и вещь не остаётся полупустой.
   *
   * Заполняются **только пустые** значения: если у вещи уже стоит своё
   * «4 места», замещающее её не тронет. Второй прогон тоже ничего не
   * меняет — вставка идёт `WHERE NOT EXISTS` и `ON CONFLICT DO NOTHING`,
   * поэтому повторная отправка того же `fillMissing` безопасна.
   *
   * Один `INSERT ... SELECT`: вещей у типа может быть много, а по одной
   * в цикле — это N запросов в транзакции админки.
   */
  private async backfillValues(
    manager: EntityManager,
    typeId: number,
    attribute: GearTypeAttribute,
    fillMissing: unknown,
    allowCustom: boolean,
    optionNames: readonly string[],
  ): Promise<number> {
    const columns = parseAttributeValue(
      {
        valueKind: attribute.valueKind,
        allowCustomValue: allowCustom,
        name: attribute.name,
      },
      fillMissing,
      optionNames,
    );
    // `null` — «стереть», а не «заполнить»: замещающего значения нет.
    if (columns === null) return 0;

    const inserted: Array<{ id: number }> = await manager.query(
      `INSERT INTO gear_item_attributes
         (gear_item_id, gear_type_attribute_id, number_value, text_value, bool_value)
       SELECT i.id, $1, $2::numeric, $3, $4::boolean
         FROM gear_items i
        WHERE i.gear_type_id = $5
          AND NOT EXISTS (
            SELECT 1 FROM gear_item_attributes v
             WHERE v.gear_item_id = i.id AND v.gear_type_attribute_id = $1)
       ON CONFLICT (gear_item_id, gear_type_attribute_id) DO NOTHING
       RETURNING id`,
      [
        attribute.id,
        columns.numberValue,
        columns.textValue,
        columns.boolValue,
        typeId,
      ],
    );

    return inserted.length;
  }

  /**
   * Варианты из тела запроса: только у списка, без повторов кода и имени.
   *
   * Имена сравниваются без учёта регистра и пробелов по краям: в Stage B
   * значение хранится текстом имени, и «Резьбовой» рядом с «резьбовой» —
   * это два неразличимых для фильтра варианта.
   */
  private normalizeOptions(
    valueKind: GearValueKind,
    raw: readonly CreateGearAttributeOptionDto[],
  ): NormalizedOption[] {
    if (raw.length > GEAR_OPTIONS_MAX) {
      throw new BadRequestException(
        `Вариантов не может быть больше ${GEAR_OPTIONS_MAX}`,
      );
    }
    if (raw.length > 0 && valueKind !== 'select') {
      throw new BadRequestException(
        'Варианты бывают только у характеристики-списка',
      );
    }

    const result: NormalizedOption[] = [];
    const codes = new Set<string>();
    const names = new Set<string>();

    for (const option of raw) {
      const code = this.normalizeCode(option.code);
      const name = this.normalizeName(option.name);

      if (codes.has(code)) throw this.duplicateOption(code);
      if (names.has(name.toLowerCase())) {
        throw new ConflictException(
          `Вариант с названием «${name}» повторяется: значения хранятся текстом, два одинаковых имени неразличимы`,
        );
      }

      codes.add(code);
      names.add(name.toLowerCase());
      result.push({ code, name, sortOrder: option.sortOrder ?? 0 });
    }

    return result;
  }

  /**
   * У списка должно быть из чего выбирать: вариант или разрешённое своё.
   *
   * Характеристика без вариантов и без своего значения — «мёртвая»: выбрать
   * нельзя ничего. Заказчик просил не допускать этого на создании, поэтому
   * проверка стоит здесь; попытка убрать последний вариант ловится отдельно
   * (`assertNotLastOption`).
   */
  private assertSelectUsable(
    valueKind: GearValueKind,
    allowCustomValue: boolean,
    activeOptions: number,
  ): void {
    if (valueKind !== 'select') return;
    if (allowCustomValue) return;
    if (activeOptions > 0) return;

    throw new BadRequestException(
      'У списка должен быть хотя бы один вариант или разрешённое своё значение — иначе выбирать не из чего',
    );
  }

  /** Варианты бывают только у списка: у числа и строки их некуда девать. */
  private assertListAttribute(attribute: GearTypeAttribute): void {
    if (attribute.valueKind !== 'select') {
      throw new BadRequestException(
        'Варианты бывают только у характеристики-списка',
      );
    }
  }

  /** Названия активных вариантов — по ним проверяется замещающее значение. */
  private async activeOptionNames(
    manager: EntityManager,
    attributeId: number,
  ): Promise<string[]> {
    const options = await manager.find(GearAttributeOption, {
      where: { gearTypeAttributeId: attributeId, isActive: true },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });

    return options.map((option) => option.name);
  }

  /**
   * Названия активных вариантов **после** правки набора из того же запроса.
   *
   * Замещающее значение проверяется по новому списку, а не по старому:
   * иначе переименование варианта и включение обязательности одним
   * сохранением упирались бы в 400 «такого варианта нет». Сами варианты
   * проверит `replaceOptions` — здесь нужны только их имена.
   */
  private async optionNamesAfter(
    manager: EntityManager,
    attributeId: number,
    incoming: SaveGearAttributeOptionDto[],
  ): Promise<string[]> {
    const existing = await manager.find(GearAttributeOption, {
      where: { gearTypeAttributeId: attributeId },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
    const touched = new Set(
      incoming
        .map((row) => row.id)
        .filter((id): id is number => id !== undefined),
    );

    const names = existing
      .filter((option) => option.isActive && !touched.has(option.id))
      .map((option) => option.name);

    for (const row of incoming) {
      const previous = existing.find((option) => option.id === row.id);
      const active = row.isActive ?? previous?.isActive ?? true;
      const name = (row.name ?? previous?.name ?? '').trim();
      if (active && name !== '') names.push(name);
    }

    return names;
  }

  /** Два варианта с одинаковым именем сделали бы значение неоднозначным. */
  private async assertOptionNameFree(
    manager: EntityManager,
    attributeId: number,
    name: string,
    exceptId?: number,
  ): Promise<void> {
    const existing = await manager.find(GearAttributeOption, {
      where: { gearTypeAttributeId: attributeId },
    });
    const clash = existing.find(
      (option) =>
        option.id !== exceptId &&
        option.name.toLowerCase() === name.toLowerCase(),
    );
    if (clash) {
      throw new ConflictException(
        `Вариант с названием «${name}» уже есть у этой характеристики`,
      );
    }
  }

  /**
   * Последний активный вариант списка убирать нельзя, пока не разрешено своё
   * значение: иначе выбирать станет не из чего. У архивной характеристики
   * запрета нет — она и так не предлагается.
   */
  private async assertNotLastOption(
    manager: EntityManager,
    attribute: GearTypeAttribute,
  ): Promise<void> {
    if (!attribute.isActive || attribute.allowCustomValue) return;

    const active = await manager.count(GearAttributeOption, {
      where: { gearTypeAttributeId: attribute.id, isActive: true },
    });
    if (active <= 1) {
      throw new ConflictException(
        'Нельзя убрать последний вариант: выбирать будет не из чего. Разреши своё значение или убери характеристику в архив',
      );
    }
  }

  private duplicateType(code: string): ConflictException {
    return new ConflictException(`Тип с кодом «${code}» уже есть`);
  }

  private duplicateAttribute(code: string): ConflictException {
    return new ConflictException(
      `Характеристика с кодом «${code}» у этого типа уже есть`,
    );
  }

  private duplicateOption(code: string): ConflictException {
    return new ConflictException(
      `Вариант с кодом «${code}» у этой характеристики уже есть`,
    );
  }

  /**
   * Гонка на уникальном индексе — это 409, остальное пробрасываем.
   *
   * Предварительная проверка закрывает обычный путь, но два запроса могут
   * пройти её одновременно; тогда ответ базы `23505` должен дать тот же 409,
   * а не 500.
   */
  private isUniqueViolation(error: unknown): boolean {
    const code =
      (error as { driverError?: { code?: string } })?.driverError?.code ??
      (error as { code?: string })?.code;

    return code === '23505';
  }

  /**
   * Уникальность именно вариантов: в `POST attributes` транзакция пишет
   * и характеристику, и варианты, и 409 должен говорить о варианте,
   * а не о характеристике.
   */
  private isOptionUniqueViolation(error: unknown): boolean {
    const driverError = (
      error as { driverError?: { code?: string; constraint?: string } }
    )?.driverError;

    return (
      (driverError?.code ?? (error as { code?: string })?.code) === '23505' &&
      driverError?.constraint === 'UQ_gear_attribute_options_code'
    );
  }
}
