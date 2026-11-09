import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import type { GearItem } from '../../gear/entities/gear-item.entity';
import type {
  ChecklistArea,
  ChecklistScope,
  TripChecklistScope,
} from '../checklist.types';
import { CHECKLIST_AREAS, TRIP_CHECKLIST_SCOPES } from '../checklist.types';
import type { Checklist } from '../entities/checklist.entity';
import type { ChecklistItem } from '../entities/checklist-item.entity';

/**
 * Вещь снаряжения, на которую ссылается пункт (31.10.2026).
 *
 * Урезанная проекция, а не `GearItemDto`: пункту чек-листа нужны подпись
 * («Палатка», название, вес), а группа, порядок и заметка каталога — нет.
 * Полный DTO заставлял бы читать чек-лист через три лишних join-а и отдавал
 * бы фронту поля, которых на экране нет.
 *
 * Название вещи живое: переименовали вещь в каталоге — пункт показывает
 * новое имя. Снимок названия лежит в `ChecklistItemDto.title` и нужен
 * только на случай, когда вещи уже нет.
 */
export class ChecklistItemGearDto {
  @ApiProperty({ description: 'Id вещи в личном каталоге', example: '5' })
  id: string;

  @ApiProperty({ description: 'Название вещи', example: 'Палатка на четверых' })
  title: string;

  @ApiProperty({ description: 'Код типа', example: 'tent' })
  typeCode: string;

  @ApiProperty({ description: 'Название типа', example: 'Палатка' })
  typeName: string;

  @ApiProperty({
    description: 'Вес в граммах. null — не указан',
    example: 2400,
    nullable: true,
  })
  weightGrams: number | null;

  static from(gear: GearItem): ChecklistItemGearDto {
    return {
      id: gear.id,
      title: gear.title,
      typeCode: gear.gearType.code,
      typeName: gear.gearType.name,
      weightGrams: gear.weightGrams,
    };
  }
}

/**
 * Пункт чек-листа в ответе API.
 *
 * `doneByUserId` и `doneAt` — не служебные поля, а смысл общего списка:
 * по ним видно, **кто** уже взял палатку. Оба `null`, пока пункт не отмечен,
 * и CHECK базы держит их парой.
 *
 * `gear` (31.10.2026) — конкретная вещь каталога, если пункт указывает
 * на экземпляр. `null` — обычный текстовый пункт; `title` у него и есть
 * весь текст. После удаления вещи пункт остаётся, но `gear` становится
 * `null`, а `title` — именем типа.
 */
export class ChecklistItemDto {
  @ApiProperty({ description: 'Id пункта', example: '12' })
  id: string;

  @ApiProperty({ description: 'Текст пункта', example: 'Палатка на четверых' })
  title: string;

  @ApiProperty({ description: 'Отмечен ли пункт', example: false })
  isDone: boolean;

  @ApiProperty({
    description: 'Кто отметил',
    example: '90ca6b06-fb04-4c5e-8c49-36ef5d188c50',
    nullable: true,
  })
  doneByUserId: string | null;

  @ApiProperty({
    description: 'Когда отмечен',
    example: '2026-10-21T09:00:00.000Z',
    nullable: true,
  })
  doneAt: string | null;

  @ApiProperty({
    description: 'Кто добавил пункт',
    nullable: true,
  })
  createdByUserId: string | null;

  @ApiProperty({
    description: 'Вещь снаряжения, на которую ссылается пункт. null — текст',
    type: () => ChecklistItemGearDto,
    nullable: true,
  })
  gear: ChecklistItemGearDto | null;

  @ApiProperty({ description: 'Создан', example: '2026-10-21T08:00:00.000Z' })
  createdAt: string;

  static from(item: ChecklistItem): ChecklistItemDto {
    return {
      id: item.id,
      title: item.title,
      isDone: item.isDone,
      doneByUserId: item.doneByUserId,
      doneAt: item.doneAt?.toISOString() ?? null,
      createdByUserId: item.createdByUserId,
      gear: item.gearItem ? ChecklistItemGearDto.from(item.gearItem) : null,
      createdAt: item.createdAt.toISOString(),
    };
  }
}

/**
 * Чек-лист целиком — с пунктами.
 *
 * Пункты вкладываются в ответ, а не запрашиваются отдельно: вкладке нужен
 * список сразу, а пунктов у него единицы. Отдельный роут был бы вторым
 * кругом до базы на каждое открытие вкладки.
 */
export class ChecklistDto {
  @ApiProperty({ description: 'Id списка', example: '3' })
  id: string;

  @ApiProperty({
    description: 'Где живёт список',
    enum: ['template', 'trip', 'personal', 'recommendation'],
    example: 'trip',
  })
  scope: ChecklistScope;

  @ApiProperty({
    description: 'Вкладка похода: снаряжение или аптечка',
    enum: CHECKLIST_AREAS,
    example: 'gear',
  })
  area: ChecklistArea;

  @ApiProperty({
    description: 'Заголовок. У списков похода обычно пустой',
    example: 'Снаряжение, лето',
  })
  title: string;

  @ApiProperty({
    description: 'Вес аптечки в граммах. null — не взвешена',
    example: 1200,
    nullable: true,
  })
  weightGrams: number | null;

  @ApiProperty({ description: 'Поход, в котором живёт список', nullable: true })
  tripId: string | null;

  @ApiProperty({ description: 'Владелец списка', nullable: true })
  ownerUserId: string | null;

  @ApiProperty({ description: 'Пункты списка', type: [ChecklistItemDto] })
  items: ChecklistItemDto[];

  @ApiProperty({ description: 'Создан', example: '2026-10-21T08:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ description: 'Изменён', example: '2026-10-21T09:00:00.000Z' })
  updatedAt: string;

  static from(checklist: Checklist, items: ChecklistItem[]): ChecklistDto {
    return {
      id: checklist.id,
      scope: checklist.scope,
      // У старых строк и свежих сущностей до перечитывания значение может
      // быть `undefined`: база подставила 'gear' или NULL, а DTO — нет.
      area: checklist.area ?? 'gear',
      title: checklist.title,
      weightGrams: checklist.weightGrams ?? null,
      tripId: checklist.tripId,
      ownerUserId: checklist.ownerUserId,
      items: items.map((item) => ChecklistItemDto.from(item)),
      createdAt: checklist.createdAt.toISOString(),
      updatedAt: checklist.updatedAt.toISOString(),
    };
  }
}

/** Мои шаблоны: список целиком, с пунктами. */
export class ChecklistListDto {
  @ApiProperty({ description: 'Шаблоны', type: [ChecklistDto] })
  checklists: ChecklistDto[];
}

/**
 * Чек-листы похода: общий, рекомендация и свой личный.
 *
 * Все три `null`, пока их не завели: «списка ещё нет» и «список пустой» —
 * разные вещи, и вкладке нужно различать их, чтобы предложить «создать»,
 * а не показать пустой блок.
 *
 * **`recommendation` — с отметками смотрящего** (05.11.2026): пункты одни
 * на всех, а `isDone` у каждого свой. Поэтому ответ зависит от того, кто
 * спросил, и вкладка может показать участнику его галочки, не открывая
 * чужих.
 */
export class TripChecklistListDto {
  @ApiProperty({
    description: 'Общий чек-лист похода',
    type: () => ChecklistDto,
    nullable: true,
  })
  shared: ChecklistDto | null;

  @ApiProperty({
    description: 'Мой личный чек-лист в этом походе',
    type: () => ChecklistDto,
    nullable: true,
  })
  personal: ChecklistDto | null;

  @ApiProperty({
    description: 'Рекомендация личных вещей от организатора, с моими отметками',
    type: () => ChecklistDto,
    nullable: true,
  })
  recommendation: ChecklistDto | null;
}

/** Тело `POST /api/checklists` — новый шаблон. */
export class CreateChecklistDto {
  @ApiProperty({
    description: 'Заголовок шаблона: «Снаряжение, лето»',
    example: 'Снаряжение, лето',
    maxLength: 120,
  })
  @IsString({ message: 'Заголовок должен быть строкой' })
  @MaxLength(120, { message: 'Заголовок не должен превышать 120 символов' })
  title: string;
}

/** Тело `PATCH /api/checklists/:id` — переименование. */
export class UpdateChecklistDto {
  @ApiProperty({ description: 'Новый заголовок', maxLength: 120, required: false })
  @IsOptional()
  @IsString({ message: 'Заголовок должен быть строкой' })
  @MaxLength(120, { message: 'Заголовок не должен превышать 120 символов' })
  title?: string;
}

/**
 * Тело `POST /api/checklists/:id/items` — новый пункт.
 *
 * Два способа задать пункт, и ровно один из них обязателен:
 *
 * - `title` — свободный текст («спички», «бинт»);
 * - `gearItemId` — конкретная вещь личного каталога (31.10.2026). Тогда
 *   `title` подписывается названием вещи на сервере: у пункта-ссылки
 *   человек не придумывает текст, он выбирает экземпляр.
 *
 * Прислали оба — побеждает вещь. Ни одного — 400.
 */
export class CreateChecklistItemDto {
  @ApiProperty({
    description: 'Текст пункта',
    example: 'Палатка на четверых',
    maxLength: 200,
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Текст пункта должен быть строкой' })
  @MaxLength(200, { message: 'Текст пункта не должен превышать 200 символов' })
  title?: string;

  @ApiProperty({
    description: 'Id вещи из личного каталога',
    example: 5,
    required: false,
  })
  @IsOptional()
  @IsInt({ message: 'Вещь должна быть id из каталога' })
  @Min(1, { message: 'Вещь должна быть id из каталога' })
  gearItemId?: number;
}

/**
 * Тело `PATCH /api/checklists/items/:id`.
 *
 * Отметка, текст и ссылка на вещь — **разные права**: в общем списке
 * отмечать может любой участник, а переименовывать пункт и менять ссылку —
 * только организатор. Поэтому в теле независимые поля, и сервис проверяет
 * права под каждое.
 *
 * `gearItemId: null` — **отвязать вещь**: пункт остаётся текстом со своим
 * текущим `title`. Прислали `title` и `gearItemId` вместе — текст берётся
 * из вещи: у ссылки нет отдельного имени.
 */
export class UpdateChecklistItemDto {
  @ApiProperty({
    description: 'Новый текст пункта',
    maxLength: 200,
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Текст пункта должен быть строкой' })
  @MaxLength(200, { message: 'Текст пункта не должен превышать 200 символов' })
  title?: string;

  @ApiProperty({
    description: 'Отметить или снять отметку',
    required: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'Отметка должна быть true или false' })
  isDone?: boolean;

  @ApiProperty({
    description: 'Привязать вещь из каталога или отвязать (null)',
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsInt({ message: 'Вещь должна быть id из каталога' })
  @Min(1, { message: 'Вещь должна быть id из каталога' })
  gearItemId?: number | null;
}

/**
 * Тело `POST /api/trips/:id/checklists` — завести список в походе.
 *
 * `scope` — `trip` (общий) или `personal` (личный); шаблон в походе
 * не создаётся. `fromTemplateId` копирует пункты шаблона: **копия, а не
 * ссылка** — правка шаблона не переписывает поход.
 */
export class CreateTripChecklistDto {
  @ApiProperty({
    description: 'Какой список заводим',
    enum: TRIP_CHECKLIST_SCOPES,
    example: 'trip',
  })
  @IsIn(TRIP_CHECKLIST_SCOPES, {
    message:
      'Список бывает общим (trip), личным (personal) или рекомендацией (recommendation)',
  })
  scope: TripChecklistScope;

  @ApiProperty({
    description: 'Вкладка похода: снаряжение (по умолчанию) или аптечка',
    enum: CHECKLIST_AREAS,
    example: 'gear',
    required: false,
  })
  @IsOptional()
  @IsIn(CHECKLIST_AREAS, {
    message: 'Область списка бывает снаряжением (gear) или аптечкой (first_aid)',
  })
  area?: ChecklistArea;

  @ApiProperty({
    description: 'Заголовок списка. Пустой — по умолчанию',
    maxLength: 120,
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Заголовок должен быть строкой' })
  @MaxLength(120, { message: 'Заголовок не должен превышать 120 символов' })
  title?: string;

  @ApiProperty({
    description: 'Скопировать пункты из моего шаблона',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsInt({ message: 'Шаблон должен быть id из справочника' })
  @Min(1, { message: 'Шаблон должен быть id из справочника' })
  fromTemplateId?: number | null;
}

/**
 * Тело `POST /api/trips/:id/checklists/import` — добавить пункты
 * из моих шаблонов (05.11.2026).
 *
 * Передаются **пункты**, а не шаблон целиком: из «Кострового для малых
 * групп» можно взять топор и пилу, а спички не брать. `itemIds` приходят
 * из модалки выбора; принадлежность шаблона проверяет сервис — чужой
 * пункт так же неотличим от несуществующего, как и везде в проекте.
 *
 * **Преобразование зависит от цели:**
 *
 * - в личный список вещь переносится конкретным экземпляром
 *   («Топор Fixars 1243») вместе со ссылкой на каталог;
 * - в общий список и в рекомендацию — типом («Топор»), без ссылки:
 *   у похода общий топор, а не топор организатора.
 */
export class ImportChecklistItemsDto {
  @ApiProperty({
    description: 'В какой список похода добавляем',
    enum: TRIP_CHECKLIST_SCOPES,
    example: 'personal',
  })
  @IsIn(TRIP_CHECKLIST_SCOPES, {
    message: 'Список бывает общим (trip), личным (personal) или рекомендацией (recommendation)',
  })
  scope: TripChecklistScope;

  @ApiProperty({
    description: 'Вкладка похода: снаряжение (по умолчанию) или аптечка',
    enum: CHECKLIST_AREAS,
    example: 'personal',
    required: false,
  })
  @IsOptional()
  @IsIn(CHECKLIST_AREAS, {
    message: 'Область списка бывает снаряжением (gear) или аптечкой (first_aid)',
  })
  area?: ChecklistArea;

  @ApiProperty({
    description: 'Пункты моих шаблонов',
    type: [Number],
    example: [111, 112],
  })
  @IsArray({ message: 'Пункты должны быть списком id' })
  @ArrayNotEmpty({ message: 'Выберите хотя бы один пункт' })
  @IsInt({ each: true, message: 'Пункт должен быть id из справочника' })
  @Min(1, { each: true, message: 'Пункт должен быть id из справочника' })
  itemIds: number[];
}

/**
 * Тело `PATCH /api/trips/:id/checklists/recommendation/items/:itemId` —
 * поставить или снять **свою** отметку на пункте рекомендации.
 *
 * Пункт остаётся общим, отметка — личная. Поэтому это отдельная ручка,
 * а не `PATCH /api/checklists/items/:id`: там `isDone` пишется в сам пункт,
 * и чужой человек увидел бы мой «взял».
 */
export class SetRecommendationMarkDto {
  @ApiProperty({ description: 'Отметить или снять отметку' })
  @IsBoolean({ message: 'Отметка должна быть true или false' })
  isDone: boolean;
}

/** Отметка участника на пункте рекомендации. */
export class RecommendationMarkDto {
  @ApiProperty({ description: 'Id пункта рекомендации' })
  itemId: string;

  @ApiProperty({ description: 'Отмечен ли пункт этим участником' })
  isDone: boolean;

  @ApiProperty({
    description: 'Когда отмечен. null — не отмечен',
    nullable: true,
  })
  doneAt: string | null;
}

/**
 * Область веса в «Аптечке»: общественная или личная (09.11.2026).
 *
 * `shared` — та, что лежит у доктора; `personal` — своя у каждого.
 * Отдельный словарь, а не `scope` чек-листа: снаружи это поле экрана,
 * а `scope` — устройство списка.
 */
export const FIRST_AID_WEIGHT_SCOPES = ['shared', 'personal'] as const;

export type FirstAidWeightScope = (typeof FIRST_AID_WEIGHT_SCOPES)[number];

/**
 * Тело `PATCH /api/trips/:id/first-aid/weight`.
 *
 * `weightGrams: null` — «вес неизвестен»: в раскладке такая аптечка весит 0,
 * а на экране цифры нет. Ноль не принимается: он означал бы пустую аптечку,
 * а не «ещё не взвесили» (тот же CHECK в базе).
 */
export class SetFirstAidWeightDto {
  @ApiProperty({
    description: 'Чей вес меняем',
    enum: FIRST_AID_WEIGHT_SCOPES,
    example: 'shared',
  })
  @IsIn(FIRST_AID_WEIGHT_SCOPES, {
    message: 'Вес бывает у общественной (shared) или личной (personal) аптечки',
  })
  scope: FirstAidWeightScope;

  @ApiProperty({
    description: 'Вес аптечки в граммах. null — не взвешена',
    example: 1200,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsInt({ message: 'Вес аптечки должен быть целым числом граммов' })
  @Min(1, { message: 'Вес аптечки должен быть больше нуля' })
  @Max(100000, { message: 'Вес аптечки не должен превышать 100 кг' })
  weightGrams?: number | null;
}

/**
 * Одна секция «Аптечки»: список и его итоговый вес.
 *
 * Вес лежит и в чек-листе (`checklist.weightGrams`), и здесь — чтобы экран
 * не искал его по вложенному объекту и мог показать поле, даже если список
 * ещё не загрузился. Источник один: `checklists.weight_grams`.
 */
export class FirstAidSectionDto {
  @ApiProperty({
    description: 'Чек-лист аптечки. null — секции нет',
    type: () => ChecklistDto,
    nullable: true,
  })
  checklist: ChecklistDto | null;

  @ApiProperty({
    description: 'Вес аптечки в граммах. null — не взвешена',
    example: 1200,
    nullable: true,
  })
  weightGrams: number | null;

  @ApiProperty({ description: 'Можно ли править список и вес' })
  canEdit: boolean;
}

/**
 * Ответ `GET /api/trips/:id/first-aid` (09.11.2026).
 *
 * Две секции, как у «Снаряжения»: общественная — только когда в походе
 * назначен доктор (заказчик: «общественная, если назначен Доктор»), личная
 * есть у каждого участника. `chatKind` фиксирован строкой, чтобы экран
 * не собирал его сам и не разошёлся с сервером.
 */
export class TripFirstAidDto {
  @ApiProperty({
    description: 'Доктор похода: ему едет общественная аптечка. null — не назначен',
    nullable: true,
  })
  doctorUserId: string | null;

  @ApiProperty({
    description: 'Имя доктора для подписи секции. null — не назначен',
    nullable: true,
  })
  doctorName: string | null;

  @ApiProperty({ description: 'Можно ли править общественную аптечку' })
  canEdit: boolean;

  @ApiProperty({
    description: 'Общественная аптечка. null — доктора нет, секции тоже',
    type: () => FirstAidSectionDto,
    nullable: true,
  })
  shared: FirstAidSectionDto | null;

  @ApiProperty({
    description: 'Личная аптечка смотрящего',
    type: () => FirstAidSectionDto,
  })
  personal: FirstAidSectionDto;

  @ApiProperty({
    description: 'Вид чата вкладки',
    example: 'trip_first_aid',
  })
  chatKind: 'trip_first_aid';
}
