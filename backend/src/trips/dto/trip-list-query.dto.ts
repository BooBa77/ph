import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

import {
  TRIP_STATUSES,
  TRIP_WHEN_VALUES,
  type TripStatus,
  type TripWhen,
} from '../trip.types';

/**
 * Булев параметр строки запроса.
 *
 * В URL всё строки, поэтому `?mine=true` приезжает как `'true'`, и без
 * преобразования `@IsBoolean` отверг бы его. Неверное значение **не
 * превращается в `false` молча** — оно остаётся как есть, и валидатор
 * отдаёт 400: «`?mine=yes`» это опечатка клиента, а не «нет».
 */
const queryBoolean = () =>
  Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  });

/**
 * Фильтры списка походов.
 *
 * Все необязательны: без параметров это лента — публичные нескончаемые
 * походы, сначала ближайшие. Видимость учитывается всегда и параметром
 * не управляется: приватный поход постороннему не показывается ни при
 * каком наборе фильтров.
 */
export class TripListQueryDto {
  @ApiProperty({
    description: 'Походы на этот объект справочника',
    example: 10,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Цель должна быть id из справочника' })
  @Min(1, { message: 'Цель должна быть id из справочника' })
  goalObjectId?: number;

  @ApiProperty({
    description: 'Походы с этой активностью',
    example: 1,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Активность должна быть id из справочника' })
  @Min(1, { message: 'Активность должна быть id из справочника' })
  activityTypeId?: number;

  @ApiProperty({
    description: 'Стадия подготовки',
    enum: TRIP_STATUSES,
    required: false,
  })
  @IsOptional()
  @IsIn(TRIP_STATUSES, { message: 'Недопустимый статус похода' })
  status?: TripStatus;

  @ApiProperty({
    description: 'Только коммерческие или только некоммерческие',
    example: true,
    required: false,
  })
  @IsOptional()
  @queryBoolean()
  @IsBoolean({ message: 'Признак коммерции должен быть true или false' })
  isCommercial?: boolean;

  @ApiProperty({
    description: 'Только спортивные или только неспортивные',
    example: true,
    required: false,
  })
  @IsOptional()
  @queryBoolean()
  @IsBoolean({ message: 'Признак спортивного похода должен быть true или false' })
  isSport?: boolean;

  @ApiProperty({
    description:
      'Когда: upcoming — впереди, ongoing — идёт, past — прошёл, undated — без дат',
    enum: TRIP_WHEN_VALUES,
    required: false,
  })
  @IsOptional()
  @IsIn(TRIP_WHEN_VALUES, { message: 'Недопустимое значение «когда»' })
  when?: TripWhen;

  @ApiProperty({
    description:
      'true — только походы, где я участник (в том числе организатор); ' +
      'false — только чужие, где меня нет; без параметра — все видимые',
    example: true,
    required: false,
  })
  @IsOptional()
  @queryBoolean()
  @IsBoolean({ message: 'Признак «мои походы» должен быть true или false' })
  mine?: boolean;

  @ApiProperty({
    description: 'Только походы этого организатора',
    example: '90ca6b06-fb04-4c5e-8c49-36ef5d188c50',
    required: false,
  })
  @IsOptional()
  @IsUUID('4', { message: 'Организатор должен быть UUID пользователя' })
  organizerUserId?: string;

  @ApiProperty({
    description: 'Сколько походов вернуть',
    example: 20,
    default: 20,
    maximum: 50,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Размер страницы должен быть целым числом' })
  @Min(1, { message: 'Размер страницы — от 1 до 50' })
  @Max(50, { message: 'Размер страницы — от 1 до 50' })
  limit?: number;

  @ApiProperty({
    description: 'Сколько походов пропустить',
    example: 0,
    default: 0,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Смещение должно быть целым числом' })
  @Min(0, { message: 'Смещение не может быть отрицательным' })
  offset?: number;
}
