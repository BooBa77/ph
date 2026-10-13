import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsOptional, ValidateNested } from 'class-validator';

import {
  ALPINISM_RANKS,
  MOUNTAIN_CATEGORIES,
  SPORT_RANKS,
  TOURISM_CATEGORIES,
  TOURISM_DISCIPLINE_RESULTS,
  type AlpinismRank,
  type MountainCategory,
  type SportRank,
  type TourismCategory,
  type TourismDisciplineResult,
} from '../sport-experience.types';

/**
 * Спортивный опыт — часть тела PATCH /api/users/me.
 *
 * Вложенная структура повторяет то, как опыт показывается в профиле:
 * альпинизм (со скайраннингом — это дисциплина альпинизма) и спортивный
 * туризм со своими категориями по видам.
 *
 * Все поля опциональны на любом уровне: PATCH присылает только изменённое
 * («поменял разряд по альпинизму» — остальное не трогается). `null`
 * в поле — осознанная очистка, отсутствие поля — «не трогать».
 *
 * Значения проверяются `@IsIn` по спискам из `sport-experience.types.ts`;
 * те же списки стоят CHECK-ами в базе, так что обойти валидацию не выйдет
 * даже прямым запросом в обход приложения.
 */
export class AlpinismExperienceDto {
  @ApiProperty({
    description: 'Спортивный разряд или звание по виду спорта «альпинизм»',
    enum: ALPINISM_RANKS,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsIn(ALPINISM_RANKS)
  rank?: AlpinismRank | null;

  @ApiProperty({
    description:
      'Максимальная категория сложности вершины (маршрута), пройденной в качестве участника',
    enum: MOUNTAIN_CATEGORIES,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsIn(MOUNTAIN_CATEGORIES)
  maxParticipation?: MountainCategory | null;

  @ApiProperty({
    description:
      'Максимальная категория сложности вершины (маршрута), пройденной в качестве руководителя',
    enum: MOUNTAIN_CATEGORIES,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsIn(MOUNTAIN_CATEGORIES)
  maxLeadership?: MountainCategory | null;
}

export class SkyrunningExperienceDto {
  @ApiProperty({
    description: 'Выполненный норматив по скайраннингу',
    enum: SPORT_RANKS,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsIn(SPORT_RANKS)
  rank?: SportRank | null;
}

export class TourismMaxCategoriesDto {
  @ApiProperty({
    description: 'Пешеходный туризм: максимальная категория сложности похода',
    enum: TOURISM_CATEGORIES,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsIn(TOURISM_CATEGORIES)
  hiking?: TourismCategory | null;

  @ApiProperty({
    description: 'Горный туризм: максимальная категория сложности похода',
    enum: TOURISM_CATEGORIES,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsIn(TOURISM_CATEGORIES)
  mountain?: TourismCategory | null;

  @ApiProperty({
    description: 'Лыжный туризм: максимальная категория сложности похода',
    enum: TOURISM_CATEGORIES,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsIn(TOURISM_CATEGORIES)
  ski?: TourismCategory | null;

  @ApiProperty({
    description: 'Водный туризм: максимальная категория сложности похода',
    enum: TOURISM_CATEGORIES,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsIn(TOURISM_CATEGORIES)
  water?: TourismCategory | null;

  @ApiProperty({
    description: 'Спелеотуризм: максимальная категория сложности похода',
    enum: TOURISM_CATEGORIES,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsIn(TOURISM_CATEGORIES)
  caving?: TourismCategory | null;

  @ApiProperty({
    description: 'Велосипедный туризм: максимальная категория сложности похода',
    enum: TOURISM_CATEGORIES,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsIn(TOURISM_CATEGORIES)
  bicycle?: TourismCategory | null;

  @ApiProperty({
    description: 'Конный туризм: максимальная категория сложности похода',
    enum: TOURISM_CATEGORIES,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsIn(TOURISM_CATEGORIES)
  horse?: TourismCategory | null;

  @ApiProperty({
    description: 'Парусный туризм: максимальная категория сложности похода',
    enum: TOURISM_CATEGORIES,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsIn(TOURISM_CATEGORIES)
  sailing?: TourismCategory | null;

  @ApiProperty({
    description: 'Авто-мото туризм: максимальная категория сложности похода',
    enum: TOURISM_CATEGORIES,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsIn(TOURISM_CATEGORIES)
  autoMoto?: TourismCategory | null;
}

export class TourismDisciplinesDto {
  @ApiProperty({
    description: 'Северная ходьба: выполненный норматив',
    enum: TOURISM_DISCIPLINE_RESULTS,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsIn(TOURISM_DISCIPLINE_RESULTS)
  nordicWalking?: TourismDisciplineResult | null;

  @ApiProperty({
    description: 'Дистанция пешеходная: выполненный норматив',
    enum: TOURISM_DISCIPLINE_RESULTS,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsIn(TOURISM_DISCIPLINE_RESULTS)
  distanceHiking?: TourismDisciplineResult | null;

  @ApiProperty({
    description: 'Дистанция лыжная: выполненный норматив',
    enum: TOURISM_DISCIPLINE_RESULTS,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsIn(TOURISM_DISCIPLINE_RESULTS)
  distanceSki?: TourismDisciplineResult | null;

  @ApiProperty({
    description: 'Дистанция водная: выполненный норматив',
    enum: TOURISM_DISCIPLINE_RESULTS,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsIn(TOURISM_DISCIPLINE_RESULTS)
  distanceWater?: TourismDisciplineResult | null;

  @ApiProperty({
    description: 'Дистанция спелео: выполненный норматив',
    enum: TOURISM_DISCIPLINE_RESULTS,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsIn(TOURISM_DISCIPLINE_RESULTS)
  distanceCaving?: TourismDisciplineResult | null;
}

export class SportTourismExperienceDto {
  @ApiProperty({
    description:
      'Спортивный разряд или звание по виду спорта «спортивный туризм»',
    enum: SPORT_RANKS,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsIn(SPORT_RANKS)
  rank?: SportRank | null;

  @ApiProperty({
    description:
      'Максимальные категории сложности (к.с.) пройденных маршрутов по видам туризма',
    type: () => TourismMaxCategoriesDto,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TourismMaxCategoriesDto)
  maxCategories?: TourismMaxCategoriesDto;

  @ApiProperty({
    description: 'Выполненные нормативы в дисциплинах группы «дистанция»',
    type: () => TourismDisciplinesDto,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TourismDisciplinesDto)
  disciplines?: TourismDisciplinesDto;
}

export class SportExperienceDto {
  @ApiProperty({
    description: 'Альпинизм',
    type: () => AlpinismExperienceDto,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AlpinismExperienceDto)
  alpinism?: AlpinismExperienceDto;

  @ApiProperty({
    description: 'Скайраннинг — дисциплина вида спорта «альпинизм»',
    type: () => SkyrunningExperienceDto,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SkyrunningExperienceDto)
  skyrunning?: SkyrunningExperienceDto;

  @ApiProperty({
    description: 'Спортивный туризм',
    type: () => SportTourismExperienceDto,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SportTourismExperienceDto)
  sportTourism?: SportTourismExperienceDto;
}
