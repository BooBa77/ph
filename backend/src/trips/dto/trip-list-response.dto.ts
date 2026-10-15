import { ApiProperty } from '@nestjs/swagger';

import { TripResponseDto } from './trip-response.dto';

/**
 * Ответ `GET /api/trips` — страница ленты и общее число подходящих походов.
 *
 * `total` считается тем же запросом (`getManyAndCount`), а не отдельным:
 * два запроса разошлись бы, если между ними кто-то создал поход, и «страница
 * 3 из 2» показывалась бы на живом сайте.
 */
export class TripListResponseDto {
  @ApiProperty({ description: 'Походы страницы', type: [TripResponseDto] })
  trips: TripResponseDto[];

  @ApiProperty({
    description: 'Сколько всего походов подходит под фильтр',
    example: 42,
  })
  total: number;
}
