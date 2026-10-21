import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

import type { GearKind } from '../gear.types';
import { GEAR_KINDS } from '../gear.types';
import { TRIP_GEAR_STATUSES, type TripGearStatus } from '../trip-gear.types';
import type { TripGear } from '../entities/trip-gear.entity';

/**
 * Вещь в общественном снаряжении похода — как её видит вкладка.
 *
 * Название, вид и вес приходят из каталога владельца: строка похода —
 * это ссылка на предмет (`gear_items`), а не копия. Поэтому одно и то же
 * поле веса правится в профиле и сразу видно в походе.
 *
 * Имён владельца и назначенного здесь нет: вкладка уже загрузила состав
 * (`GET /api/trips/:id/participants`) с именами и полом, и дублировать
 * их в каждой строке снаряжения значило бы держать два источника правды
 * об одном человеке.
 */
export class TripGearItemDto {
  @ApiProperty({ description: 'Id строки снаряжения похода', example: '12' })
  id: string;

  @ApiProperty({ description: 'Id предмета в каталоге владельца', example: '5' })
  gearItemId: string;

  @ApiProperty({ description: 'Вид снаряжения', enum: GEAR_KINDS, example: 'tent' })
  kind: GearKind;

  @ApiProperty({ description: 'Название', example: 'Палатка на четверых' })
  title: string;

  @ApiProperty({
    description: 'Вес в граммах. null — не указан и в сумму не входит',
    example: 2400,
    nullable: true,
  })
  weightGrams: number | null;

  @ApiProperty({
    description: 'Комментарий владельца из каталога',
    example: 'проклеена, течёт по шву',
    nullable: true,
  })
  note: string | null;

  @ApiProperty({
    description: 'Статус: предложена, берём или не берём',
    enum: TRIP_GEAR_STATUSES,
    example: 'approved',
  })
  status: TripGearStatus;

  @ApiProperty({
    description: 'Владелец предмета — участник похода',
    example: '90ca6b06-fb04-4c5e-8c49-36ef5d188c50',
  })
  ownerUserId: string;

  @ApiProperty({
    description: 'Кто несёт. null — не распределена',
    nullable: true,
    example: '1f0f5a52-6a55-4f4e-9f56-2f4b0b3f5a11',
  })
  assignedUserId: string | null;

  @ApiProperty({ description: 'Когда вещь предложили в поход' })
  createdAt: string;

  static from(row: TripGear): TripGearItemDto {
    return {
      id: row.id,
      gearItemId: row.gearItemId,
      kind: row.gearItem.kind,
      title: row.gearItem.title,
      weightGrams: row.gearItem.weightGrams,
      note: row.gearItem.note,
      status: row.status,
      ownerUserId: row.ownerUserId,
      assignedUserId: row.assignedUserId,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

/**
 * Общественное снаряжение похода и итог по весу.
 *
 * `totalWeightGrams` и `itemsWithoutWeight` считают **только утверждённые**
 * вещи: «не берём» в рюкзак не кладут, и включать её в вес значило бы
 * показать человеку цифру, которой нет. Предложенные ещё не решение —
 * их вес тоже не итог.
 */
export class TripGearListDto {
  @ApiProperty({ description: 'Вещи похода', type: [TripGearItemDto] })
  items: TripGearItemDto[];

  @ApiProperty({
    description: 'Сумма известных весов утверждённых вещей, граммы',
    example: 5400,
  })
  totalWeightGrams: number;

  @ApiProperty({
    description: 'Сколько утверждённых вещей без веса — они в сумму не входят',
    example: 2,
  })
  itemsWithoutWeight: number;
}

/**
 * Тело `POST /api/trips/:id/gear` — предложить предмет из своего каталога.
 *
 * Владельца в теле нет: он тот, кто прислал запрос. Чужой предмет
 * не найдётся (404, как и в каталоге) — предлагать чужое снаряжение
 * в поход нельзя, это решение владельца.
 */
export class ProposeTripGearDto {
  @ApiProperty({
    description: 'Id предмета из моего каталога снаряжения',
    example: 5,
  })
  @IsInt({ message: 'Предмет каталога должен быть указан числом' })
  @Min(1, { message: 'Некорректный предмет каталога' })
  gearItemId: number;
}

/**
 * Тело `PATCH /api/trips/:id/gear/:gearId`.
 *
 * Два поля — два разных права, и это не случайность:
 *
 * - `status` («берём» / «не берём») — тому, кому роль дала вкладку
 *   «Снаряжение» (завхоз, ремонтник, организатор);
 * - `assignedUserId` — **любому участнику**: перетаскивание вещи между
 *   рюкзаками заказчик разрешил всем, «люди взрослые и договорятся сами».
 *
 * `assignedUserId: null` — освободить вещь: «нераспределённая» — законное
 * состояние, мы не подставляем первого попавшегося.
 */
export class UpdateTripGearDto {
  @ApiProperty({
    description: 'Статус вещи: предложена, берём или не берём',
    enum: TRIP_GEAR_STATUSES,
    required: false,
  })
  @IsOptional()
  @IsIn(TRIP_GEAR_STATUSES, { message: 'Недопустимый статус вещи' })
  status?: TripGearStatus;

  @ApiProperty({
    description: 'Кому едет вещь. null — освободить',
    nullable: true,
    required: false,
    example: '1f0f5a52-6a55-4f4e-9f56-2f4b0b3f5a11',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Назначенному нужен корректный UUID пользователя' })
  assignedUserId?: string | null;
}
