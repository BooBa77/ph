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
  AddSleepingDto,
  LodgeRouteDto,
  SaveRouteNightsDto,
  TripRouteDto,
} from './dto/trip-route.dto';
import { TripRouteService } from './trip-route.service';

/**
 * «Ночёвки» похода: таблица ночей, личные спальники и кто где живёт.
 *
 * **Таблица правится целиком** (`PUT .../route/nights`): экран — сетка
 * ночей, а правила проверяются на ночи целиком (место есть лишь у ночи
 * с ночлегом, готовка — только у палатки, избы и машины). Клиент присылает
 * номера ночей, а не id: помнить, что удалять, а что править, он не должен.
 * С 01.11.2026 у ночи **один вариант**, и экран применяет правку на лету —
 * каждая правка уходит этим же `PUT`.
 *
 * **Люди — отдельными ручками.** «Кто где живёт» — одно место на весь поход
 * (ответ заказчика 31.10.2026), поэтому посадка не привязана к ночи
 * и не сбрасывается, когда переставляют ночи.
 *
 * **Спальник и коврик — личные ручки** (01.11.2026): добавить и убрать
 * может только сам человек, и `GET /route` отдаёт только его строки.
 *
 * **Все ручки отвечают вкладкой целиком** (`TripRouteDto`), включая
 * удаления: на экране ночи, личные вещи и занятые места — числа от трёх
 * таблиц, и собрать их из частичного ответа значит однажды показать
 * неправду. Поэтому у `PUT`, `POST` и `DELETE` стоит 200, а не 201/204.
 */
@ApiTags('trip-route')
@Controller('trips')
export class TripRouteController {
  constructor(private readonly route: TripRouteService) {}

  /** Вкладка целиком. Видят участники похода. */
  @Get(':id/route')
  @ApiOperation({ summary: 'Ночёвки похода: ночи, личные вещи и кто где живёт' })
  @ApiOkResponse({ type: TripRouteDto })
  async getPlan(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripRouteDto> {
    return this.route.getPlan(authUser.id, id);
  }

  /** Сохранить таблицу ночей: ночи, место, даты и вариант. */
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

  /** Добавить себе спальник или коврик из личного каталога. */
  @Post(':id/route/sleeping')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Добавить спальник или коврик в ночёвку' })
  @ApiOkResponse({ type: TripRouteDto })
  async addSleeping(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddSleepingDto,
  ): Promise<TripRouteDto> {
    return this.route.addSleeping(authUser.id, id, dto);
  }

  /** Убрать свою вещь из ночёвки. Чужую строку этим путём не убрать. */
  @Delete(':id/route/sleeping/:sleepingId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Убрать спальник или коврик из ночёвки' })
  @ApiOkResponse({ type: TripRouteDto })
  async removeSleeping(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('sleepingId', ParseIntPipe) sleepingId: number,
  ): Promise<TripRouteDto> {
    return this.route.removeSleeping(authUser.id, id, String(sleepingId));
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
