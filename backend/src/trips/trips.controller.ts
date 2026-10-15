import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { CreateTripDto } from './dto/create-trip.dto';
import { TripResponseDto } from './dto/trip-response.dto';
import { TripsService } from './trips.service';

/**
 * Походы.
 *
 * Как и календарь, контроллер работает «от токена»: организатором
 * становится владелец токена, а не тот, кого назвали в теле запроса.
 * Все роуты закрыты глобальным `JwtAuthGuard`.
 */
@ApiTags('trips')
@Controller('trips')
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  /**
   * Создать поход. Организатор, его роль в справочнике и оба чата
   * (`trip_guest` и `trip_members`) появляются в одной транзакции —
   * поход не может «частично создаться».
   */
  @Post()
  @ApiOperation({ summary: 'Создать поход' })
  @ApiCreatedResponse({ type: TripResponseDto })
  async create(
    @CurrentUser() authUser: AuthUser,
    @Body() dto: CreateTripDto,
  ): Promise<TripResponseDto> {
    return this.tripsService.create(authUser.id, dto);
  }

  /**
   * Поход по id.
   *
   * Приватный поход для постороннего не существует: ответ — 404, а не 403,
   * чтобы перебором id нельзя было узнать, кто и куда собирается.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Поход по id' })
  @ApiOkResponse({ type: TripResponseDto })
  async findOne(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripResponseDto> {
    return this.tripsService.findOne(authUser.id, id);
  }
}
