import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  COOKING_KINDS,
  MAX_ROUTE_NIGHTS,
  NIGHT_KINDS,
  PLACE_MAX_LENGTH,
  ROUTE_LODGER_STATUSES,
  type CookingKind,
  type NightKind,
  type RouteLodgerStatus,
} from '../trip-route.types';

/**
 * Ответы и тела запросов вкладки «Ночёвки».
 *
 * **Все ручки вкладки возвращают её состояние целиком** (`TripRouteDto`) —
 * тот же контракт, что у «Трансфера»: на экране ночи, личные вещи и кто где
 * живёт, и собрать их из частичного ответа значит однажды показать неправду.
 *
 * **Ночь приходит без id и опознаётся по `position`.** Таблица правится
 * целиком (`PUT`), потому что экран — это сетка ночей: клиент присылает
 * «ночь 1, ночь 2, …», а сервер заменяет набор в одной транзакции. Id
 * в ответе остаются для чтения, но присылать их обратно не нужно — иначе
 * клиент должен был бы помнить, что удалять, а что править.
 *
 * **У ночи один вариант** (01.11.2026): `kind` и `cooking` — поля самой
 * ночи, а не список. `kind = null` — вариант не выбрали.
 *
 * Id — строками, как везде в проекте, где ключ `bigint`.
 */

/** Кого можно распределять: участник, который идёт. */
export class RouteTravelerDto {
  @ApiProperty({ description: 'Id участника', example: '90ca6b06-…' })
  userId: string;

  @ApiProperty({ description: 'Имя для человека', example: 'Пётр' })
  displayName: string;
}

/**
 * Кто где живёт — **одно место на весь поход**.
 *
 * `requested` — попросился в чужую палатку и ждёт хозяина, `accepted` —
 * живёт. Ночей здесь нет намеренно: человек не переезжает каждую ночь,
 * и таблица ночёвок показывает это же место в каждой ночи.
 */
export class RouteLodgerDto {
  @ApiProperty({ description: 'Id участника' })
  userId: string;

  @ApiProperty({ description: 'Имя для человека' })
  displayName: string;

  @ApiProperty({ description: 'Палатка, в которой живёт', example: '12' })
  tentGearId: string;

  @ApiProperty({
    description: 'Заявка или уже живёт',
    enum: ROUTE_LODGER_STATUSES,
    example: 'accepted',
  })
  status: RouteLodgerStatus;
}

/**
 * Личная вещь ночёвки — только для смотрящего (01.11.2026).
 *
 * Спальник и коврик личные: `GET /route` отдаёт строки **только того, кто
 * спросил**. Виртуальных участников здесь быть не может по построению —
 * у них нет входа, а их вещи организатору не показываются.
 */
export class RouteSleepingDto {
  @ApiProperty({ description: 'Id строки', example: '4' })
  id: string;

  @ApiProperty({
    description: 'Предмет личного каталога',
    example: '17',
  })
  gearItemId: string;

  @ApiProperty({
    description: 'Код типа: спальник или коврик',
    example: 'sleeping_bag',
  })
  typeCode: string;

  @ApiProperty({ description: 'Название вещи', example: 'Спальник зимний' })
  title: string;

  @ApiProperty({
    description: 'Вес в граммах; null — не указан',
    nullable: true,
    example: 900,
  })
  weightGrams: number | null;
}

/** Ночь похода: номер, район, дата и один вариант. */
export class RouteNightDto {
  @ApiProperty({ description: 'Id ночи', example: '3' })
  id: string;

  @ApiProperty({ description: 'Номер ночи с 1', example: 1 })
  position: number;

  @ApiProperty({
    description: 'Дата ночи (YYYY-MM-DD); null — дат у похода нет',
    nullable: true,
    example: '2026-10-29',
  })
  date: string | null;

  @ApiProperty({
    description: 'Район ночёвки; null — не записали',
    nullable: true,
    example: 'Олхинское плато, у Витязя',
  })
  place: string | null;

  @ApiProperty({
    description: 'Как ночуем; null — не выбрали',
    enum: NIGHT_KINDS,
    nullable: true,
    example: 'tent',
  })
  kind: NightKind | null;

  @ApiProperty({
    description: 'Способ готовки: костёр, горелка или оба',
    enum: COOKING_KINDS,
    nullable: true,
    example: 'fire',
  })
  cooking: CookingKind | null;
}

/** Вкладка «Ночёвки» целиком. */
export class TripRouteDto {
  @ApiProperty({ description: 'Можно ли править эту вкладку смотрящему' })
  canEdit: boolean;

  @ApiProperty({ description: 'Ночи похода по порядку', type: [RouteNightDto] })
  nights: RouteNightDto[];

  @ApiProperty({
    description: 'Личные вещи смотрящего: спальники и коврики',
    type: [RouteSleepingDto],
  })
  sleeping: RouteSleepingDto[];

  @ApiProperty({
    description: 'Кто где живёт — одно место на весь поход',
    type: [RouteLodgerDto],
  })
  lodgers: RouteLodgerDto[];

  @ApiProperty({
    description: 'Кого можно распределить: участники, которые идут',
    type: [RouteTravelerDto],
  })
  travelers: RouteTravelerDto[];
}

/** Ночь в запросе: опознаётся по номеру, а не по id. */
export class RouteNightInputDto {
  @ApiProperty({ description: 'Номер ночи с 1', example: 1 })
  @IsInt({ message: 'Номер ночи — целое число' })
  @Min(1, { message: 'Нумерация ночей начинается с 1' })
  @Max(MAX_ROUTE_NIGHTS, { message: 'Слишком много ночей' })
  position: number;

  @ApiProperty({
    description: 'Дата ночи (YYYY-MM-DD)',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Дата ночи — ГГГГ-ММ-ДД' })
  date?: string | null;

  @ApiProperty({
    description: 'Район ночёвки',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @Length(0, PLACE_MAX_LENGTH, { message: 'Место — не длиннее 120 знаков' })
  place?: string | null;

  @ApiProperty({
    description: 'Как ночуем; не задано — «идём всю ночь»',
    enum: NIGHT_KINDS,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsIn(NIGHT_KINDS, { message: 'Так ночевать нельзя — выберите вариант' })
  kind?: NightKind | null;

  @ApiProperty({
    description: 'Способ готовки',
    enum: COOKING_KINDS,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsIn(COOKING_KINDS, { message: 'Готовка — костёр, горелка или оба' })
  cooking?: CookingKind | null;
}

/** Вся таблица ночёвок: экран правится целиком. */
export class SaveRouteNightsDto {
  @ApiProperty({
    description: 'Ночи похода по порядку; пустой список — ночей нет',
    type: [RouteNightInputDto],
  })
  @IsArray({ message: 'Ночи — список' })
  @ArrayMaxSize(MAX_ROUTE_NIGHTS, { message: 'Слишком много ночей' })
  @ValidateNested({ each: true })
  @Type(() => RouteNightInputDto)
  nights: RouteNightInputDto[];
}

/** Посадить человека в палатку (или переехать в другую). */
export class LodgeRouteDto {
  @ApiProperty({
    description: 'Палатка из снаряжения похода',
    example: '12',
  })
  @IsString()
  @Matches(/^\d{1,19}$/, { message: 'Палатка — id строкой из снаряжения' })
  tentGearId: string;
}

/** Добавить личную вещь в ночёвку: спальник или коврик из каталога. */
export class AddSleepingDto {
  @ApiProperty({
    description: 'Предмет личного каталога типа «Спальник» или «Коврик»',
    example: '17',
  })
  @IsString()
  @Matches(/^\d{1,19}$/, { message: 'Вещь — id строкой из снаряжения' })
  gearItemId: string;
}
