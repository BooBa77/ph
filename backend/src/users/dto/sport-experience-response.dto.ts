import { ApiProperty } from '@nestjs/swagger';

import { SportExperience } from '../entities/sport-experience.entity';
import {
  ALPINISM_RANKS,
  MOUNTAIN_CATEGORIES,
  SKYRUNNING_RANKS,
  TOURISM_CATEGORIES,
  TOURISM_DISCIPLINE_RESULTS,
  TOURISM_RANKS,
  type AlpinismRank,
  type MountainCategory,
  type SkyrunningRank,
  type TourismCategory,
  type TourismDisciplineResult,
  type TourismRank,
} from '../sport-experience.types';

/**
 * Спортивный опыт в ответе API.
 *
 * Форма повторяет запрос (`SportExperienceDto`), но здесь все поля
 * присутствуют всегда: если строка опыта есть, фронт получает полный
 * объект с `null` в незаполненных полях и не должен сам достраивать
 * структуру. Если строки нет вовсе — `sportExperience: null`.
 */
export class AlpinismExperienceResponseDto {
  @ApiProperty({ enum: ALPINISM_RANKS, nullable: true })
  rank: AlpinismRank | null;

  @ApiProperty({ enum: MOUNTAIN_CATEGORIES, nullable: true })
  maxParticipation: MountainCategory | null;

  @ApiProperty({ enum: MOUNTAIN_CATEGORIES, nullable: true })
  maxLeadership: MountainCategory | null;

  @ApiProperty({
    description: 'Жетон «Спасение в горах»',
    example: false,
  })
  rescueToken: boolean;
}

export class SkyrunningExperienceResponseDto {
  @ApiProperty({ enum: SKYRUNNING_RANKS, nullable: true })
  rank: SkyrunningRank | null;
}

export class TourismMaxCategoriesResponseDto {
  @ApiProperty({ enum: TOURISM_CATEGORIES, nullable: true })
  hiking: TourismCategory | null;

  @ApiProperty({ enum: TOURISM_CATEGORIES, nullable: true })
  mountain: TourismCategory | null;

  @ApiProperty({ enum: TOURISM_CATEGORIES, nullable: true })
  ski: TourismCategory | null;

  @ApiProperty({ enum: TOURISM_CATEGORIES, nullable: true })
  water: TourismCategory | null;

  @ApiProperty({ enum: TOURISM_CATEGORIES, nullable: true })
  caving: TourismCategory | null;

  @ApiProperty({ enum: TOURISM_CATEGORIES, nullable: true })
  bicycle: TourismCategory | null;

  @ApiProperty({ enum: TOURISM_CATEGORIES, nullable: true })
  horse: TourismCategory | null;

  @ApiProperty({ enum: TOURISM_CATEGORIES, nullable: true })
  sailing: TourismCategory | null;

  @ApiProperty({ enum: TOURISM_CATEGORIES, nullable: true })
  autoMoto: TourismCategory | null;
}

export class TourismDisciplinesResponseDto {
  @ApiProperty({ enum: TOURISM_DISCIPLINE_RESULTS, nullable: true })
  nordicWalking: TourismDisciplineResult | null;

  @ApiProperty({ enum: TOURISM_DISCIPLINE_RESULTS, nullable: true })
  distanceHiking: TourismDisciplineResult | null;

  @ApiProperty({ enum: TOURISM_DISCIPLINE_RESULTS, nullable: true })
  distanceSki: TourismDisciplineResult | null;

  @ApiProperty({ enum: TOURISM_DISCIPLINE_RESULTS, nullable: true })
  distanceWater: TourismDisciplineResult | null;

  @ApiProperty({ enum: TOURISM_DISCIPLINE_RESULTS, nullable: true })
  distanceCaving: TourismDisciplineResult | null;
}

export class SportTourismExperienceResponseDto {
  @ApiProperty({ enum: TOURISM_RANKS, nullable: true })
  rank: TourismRank | null;

  @ApiProperty({ type: () => TourismMaxCategoriesResponseDto })
  maxCategories: TourismMaxCategoriesResponseDto;

  @ApiProperty({ type: () => TourismDisciplinesResponseDto })
  disciplines: TourismDisciplinesResponseDto;
}

export class SportExperienceResponseDto {
  @ApiProperty({ type: () => AlpinismExperienceResponseDto })
  alpinism: AlpinismExperienceResponseDto;

  @ApiProperty({ type: () => SkyrunningExperienceResponseDto })
  skyrunning: SkyrunningExperienceResponseDto;

  @ApiProperty({ type: () => SportTourismExperienceResponseDto })
  sportTourism: SportTourismExperienceResponseDto;

  /**
   * Собрать ответ из entity.
   *
   * Явный маппинг колонок в поля — как в `UserResponseDto.from`: если
   * в таблице появится колонка, наружу она сама не уедет.
   *
   * @returns null, если спортивный опыт пользователь не заполнял
   */
  static from(
    entity: SportExperience | null,
  ): SportExperienceResponseDto | null {
    if (!entity) return null;

    const alpinism = new AlpinismExperienceResponseDto();
    alpinism.rank = entity.alpinismRank;
    alpinism.maxParticipation = entity.alpinismMaxParticipation;
    alpinism.maxLeadership = entity.alpinismMaxLeadership;
    alpinism.rescueToken = entity.alpinismRescueToken;

    const skyrunning = new SkyrunningExperienceResponseDto();
    skyrunning.rank = entity.skyrunningRank;

    const maxCategories = new TourismMaxCategoriesResponseDto();
    maxCategories.hiking = entity.tourismMaxHiking;
    maxCategories.mountain = entity.tourismMaxMountain;
    maxCategories.ski = entity.tourismMaxSki;
    maxCategories.water = entity.tourismMaxWater;
    maxCategories.caving = entity.tourismMaxCaving;
    maxCategories.bicycle = entity.tourismMaxBicycle;
    maxCategories.horse = entity.tourismMaxHorse;
    maxCategories.sailing = entity.tourismMaxSailing;
    maxCategories.autoMoto = entity.tourismMaxAutoMoto;

    const disciplines = new TourismDisciplinesResponseDto();
    disciplines.nordicWalking = entity.tourismNormNordicWalking;
    disciplines.distanceHiking = entity.tourismNormDistanceHiking;
    disciplines.distanceSki = entity.tourismNormDistanceSki;
    disciplines.distanceWater = entity.tourismNormDistanceWater;
    disciplines.distanceCaving = entity.tourismNormDistanceCaving;

    const sportTourism = new SportTourismExperienceResponseDto();
    sportTourism.rank = entity.tourismRank;
    sportTourism.maxCategories = maxCategories;
    sportTourism.disciplines = disciplines;

    const dto = new SportExperienceResponseDto();
    dto.alpinism = alpinism;
    dto.skyrunning = skyrunning;
    dto.sportTourism = sportTourism;
    return dto;
  }
}
