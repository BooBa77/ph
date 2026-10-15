import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
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
import { TripListQueryDto } from './dto/trip-list-query.dto';
import { TripListResponseDto } from './dto/trip-list-response.dto';
import { TripResponseDto } from './dto/trip-response.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { TripsService } from './trips.service';

/**
 * Походы.
 *
 * Как и календарь, контроллер работает «от токена»: организатором
 * становится владелец токена, а не тот, кого назвали в теле запроса.
 * Все роуты закрыты глобальным `JwtAuthGuard`.
 *
 * Правка, отмена и работа с составом — только для организатора: это
 * проверяет сервис и отвечает 403 (для публичного похода скрывать нечего,
 * он и так виден). Приватный поход постороннему не виден вовсе — 404.
 */
@ApiTags('trips')
@Controller('trips')
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  /**
   * Создать поход. Организатор, его роль в справочнике, оба чата
   * (`trip_guest` и `trip_members`), варианты дат и индекс упоминаний
   * объектов появляются в одной транзакции — поход не может «частично
   * создаться».
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
   * Лента походов с фильтрами.
   *
   * Приватные походы видны только участникам, отменённые в ленту
   * не попадают — и то и другое без возможности отключить параметром.
   */
  @Get()
  @ApiOperation({ summary: 'Список походов' })
  @ApiOkResponse({ type: TripListResponseDto })
  async list(
    @CurrentUser() authUser: AuthUser,
    @Query() query: TripListQueryDto,
  ): Promise<TripListResponseDto> {
    return this.tripsService.list(authUser.id, query);
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

  /**
   * Изменить поход. Присланные поля перезаписываются, отсутствующие
   * не трогаются, `null` — осознанная очистка. Если меняется маршрут,
   * индекс упоминаний объектов пересобирается.
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Изменить поход' })
  @ApiOkResponse({ type: TripResponseDto })
  async update(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTripDto,
  ): Promise<TripResponseDto> {
    return this.tripsService.update(authUser.id, id, dto);
  }

  /**
   * Отменить поход. Отмена — отдельная ось: статус подготовки она
   * не затирает, поход остаётся в базе для истории.
   */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Отменить поход' })
  @ApiOkResponse({ type: TripResponseDto })
  async cancel(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripResponseDto> {
    return this.tripsService.cancel(authUser.id, id);
  }

  /** Снять отмену: «решили всё-таки идти». */
  @Delete(':id/cancel')
  @ApiOperation({ summary: 'Вернуть отменённый поход' })
  @ApiOkResponse({ type: TripResponseDto })
  async restore(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripResponseDto> {
    return this.tripsService.restore(authUser.id, id);
  }
}
