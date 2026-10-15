import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import type { GeoObject } from '../entities/geo-object.entity';

/**
 * Объект справочника наружу.
 *
 * `parentName` вкладывается, хотя наружу мог бы уйти один `parentId`:
 * у объектов региона имена повторяются («скальник Витязь» есть не только
 * на Олхинском плато), и выбирать цель в списке, где написано просто
 * «Витязь», невозможно — нужен родитель рядом с именем.
 */
export class GeoObjectDto {
  @ApiProperty({ description: 'Id объекта', example: '10' })
  id: string;

  @ApiProperty({ description: 'Имя объекта', example: 'Витязь' })
  name: string;

  @ApiProperty({ description: 'Тип объекта', example: 'скальник' })
  type: string;

  @ApiProperty({
    description: 'Ссылка на внешнюю страницу объекта',
    example: 'https://nature.baikal.ru/obj.shtml?obj=skala&id=vityaz',
    nullable: true,
  })
  url: string | null;

  @ApiProperty({
    description: 'Id родителя в иерархии справочника',
    example: '9',
    nullable: true,
  })
  parentId: string | null;

  @ApiProperty({
    description:
      'Имя родителя — чтобы различать одинаковые имена в разных районах',
    example: 'Олхинское плато',
    nullable: true,
  })
  parentName: string | null;

  static from(object: GeoObject): GeoObjectDto {
    return {
      id: object.id,
      name: object.name,
      type: object.type,
      url: object.url,
      parentId: object.parentId,
      parentName: object.parent?.name ?? null,
    };
  }
}

export class GeoObjectListDto {
  @ApiProperty({ description: 'Найденные объекты', type: [GeoObjectDto] })
  objects: GeoObjectDto[];
}

/**
 * Параметры `GET /api/objects`.
 *
 * `search` ищет подстроку в имени, а не только с начала: объект ищут
 * по слову, которое помнят («Витязь»), и требовать совпадения с начала
 * значило бы заставлять вспоминать, с чего имя начинается.
 */
export class GeoObjectQueryDto {
  @ApiProperty({
    description: 'Подстрока имени',
    example: 'Витязь',
    maxLength: 100,
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Поисковая строка должна быть строкой' })
  @MaxLength(100, {
    message: 'Поисковая строка не должна превышать 100 символов',
  })
  search?: string;

  @ApiProperty({
    description: 'Сколько объектов вернуть',
    example: 50,
    default: 50,
    maximum: 200,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Размер страницы должен быть целым числом' })
  @Min(1, { message: 'Размер страницы — от 1 до 200' })
  @Max(200, { message: 'Размер страницы — от 1 до 200' })
  limit?: number;
}
