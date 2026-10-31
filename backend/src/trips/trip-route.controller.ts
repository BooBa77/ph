import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import {
  LodgeRouteDto,
  SaveRouteNightsDto,
  TripRouteDto,
} from './dto/trip-route.dto';
import { TripRouteService } from './trip-route.service';

/**
 * «Ночёвки» похода: таблица ночей, варианты и кто где живёт.
 *
 * **Таблица правится целиком** (`PUT .../route/nights`): экран — сетка
 * ночей, и половина правил проверяется только на ночи целиком (место есть
 * лишь у ночи с ночлегом, «идём всю ночь» не смешивается с палаткой, одна
 * палатка — одна строка). Клиент присылает номера ночей, а не id: помнить,
 * что удалять, а что править, он не должен.
 *
 * **Люди — отдельными ручками.** «Кто где живёт» — одно место на весь поход
 * (ответ заказчика 31.10.2026), поэтому посадка не привязана к ночи
 * и не сбрасывается, когда переставляют ночи.
 *
 * **Все ручки отвечают вкладкой целиком** (`TripRouteDto`), включая
 * удаления: на экране ночи, варианты и занятые места — числа от трёх
 * таблиц, и собрать их из частичного ответа значит однажды показать
 * неправду. Поэтому у `PUT`, `POST` и `DELETE` стоит 200, а не 201/204.
 */
@ApiTags('trip-route')
@Controller('trips')
export class TripRouteController {
  constructor(private readonly route: TripRouteService) {}

  /** Вкладка целиком. Видят участники похода. */
  @Get(':id/route')
  @ApiOperation({ summary: 'Ночёвки похода: ночи, варианты и кто где живёт' })
  @ApiOkResponse({ type: TripRouteDto })
  async getPlan(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripRouteDto> {
    return this.route.getPlan(authUser.id, id);
  }

  /** Сохранить таблицу ночей: ночи, место, даты и варианты. */
  @Put(':id/route/nights')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Сохранить таблицу ночёвок' })
  @ApiOkResponse({ type: TripRouteDto })
  async saveNights(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveRouteNightsDto,
  ): Promise<TripRouteDto> {
    return this.route.saveNights(authUser.id, id, dto);
  }

  /** Посадить в палатку себя или другого: в чужую — заявкой. */
  @Put(':id/route/lodgers/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Поселить человека в палатку' })
  @ApiOkResponse({ type: TripRouteDto })
  async lodge(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: LodgeRouteDto,
  ): Promise<TripRouteDto> {
    return this.route.lodge(authUser.id, id, userId, dto);
  }

  /** Принять заявку: хозяин палатки или тот, кто ведёт вкладку. */
  @Post(':id/route/lodgers/:userId/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Принять заявку в палатку' })
  @ApiOkResponse({ type: TripRouteDto })
  async acceptLodger(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<TripRouteDto> {
    return this.route.acceptLodger(authUser.id, id, userId);
  }

  /** Уйти самому, выселить хозяину палатки или ведущему вкладку. */
  @Delete(':id/route/lodgers/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Освободить место в палатке' })
  @ApiOkResponse({ type: TripRouteDto })
  async releaseLodger(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<TripRouteDto> {
    return this.route.releaseLodger(authUser.id, id, userId);
  }
}
