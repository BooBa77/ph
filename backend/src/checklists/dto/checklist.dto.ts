import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

import type { ChecklistScope, TripChecklistScope } from '../checklist.types';
import { TRIP_CHECKLIST_SCOPES } from '../checklist.types';
import type { Checklist } from '../entities/checklist.entity';
import type { ChecklistItem } from '../entities/checklist-item.entity';

/**
 * Пункт чек-листа в ответе API.
 *
 * `doneByUserId` и `doneAt` — не служебные поля, а смысл общего списка:
 * по ним видно, **кто** уже взял палатку. Оба `null`, пока пункт не отмечен,
 * и CHECK базы держит их парой.
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
    enum: ['template', 'trip', 'personal'],
    example: 'trip',
  })
  scope: ChecklistScope;

  @ApiProperty({
    description: 'Заголовок. У списков похода обычно пустой',
    example: 'Снаряжение, лето',
  })
  title: string;

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
      title: checklist.title,
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
 * Чек-листы похода: общий и свой личный.
 *
 * Оба `null`, пока их не завели: «списка ещё нет» и «список пустой» —
 * разные вещи, и вкладке нужно различать их, чтобы предложить «создать»,
 * а не показать пустой блок.
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

/** Тело `POST /api/checklists/:id/items` — новый пункт. */
export class CreateChecklistItemDto {
  @ApiProperty({
    description: 'Текст пункта',
    example: 'Палатка на четверых',
    maxLength: 200,
  })
  @IsString({ message: 'Текст пункта должен быть строкой' })
  @MaxLength(200, { message: 'Текст пункта не должен превышать 200 символов' })
  title: string;
}

/**
 * Тело `PATCH /api/checklists/items/:id`.
 *
 * Отметка и правка текста — **разные права**: в общем списке отмечать может
 * любой участник, а переименовывать пункт — только организатор. Поэтому
 * в теле два независимых поля, и сервис проверяет права под каждое.
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
    message: 'Список бывает общим (trip) или личным (personal)',
  })
  scope: TripChecklistScope;

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
