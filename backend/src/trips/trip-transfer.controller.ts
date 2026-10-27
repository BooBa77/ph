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
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import {
  AddTransferPassengerDto,
  CreateTransferLegDto,
  TripTransferDto,
  UpdateTransferLegDto,
} from './dto/trip-transfer.dto';
import { TripTransferService } from './trip-transfer.service';

/**
 * «Трансфер» похода: карточки перемещений и пассажиры.
 *
 * Вторая редакция (27.10.2026): одна карточка — одно перемещение одной
 * части группы. Сторона (`there` / `back`) — параметр карточки, поэтому
 * и ручка создания одна: область на экране задаёт, в какой список попадёт
 * карточка.
 *
 * **Все ручки отвечают вкладкой целиком** (`TripTransferDto`), включая
 * удаления: на экране занятые места, заявки и состав — числа от двух
 * таблиц, и собрать их из частичного ответа значит однажды показать
 * неправду. Поэтому и у `POST`, и у `DELETE` стоит 200, а не 201/204.
 */
@ApiTags('trip-transfer')
@Controller('trips')
export class TripTransferController {
  constructor(private readonly transfer: TripTransferService) {}

  /** Вкладка целиком. Видят участники похода. */
  @Get(':id/transfer')
  @ApiOperation({ summary: 'Трансфер похода: карточки и пассажиры' })
  @ApiOkResponse({ type: TripTransferDto })
  async getPlan(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripTransferDto> {
    return this.transfer.getPlan(authUser.id, id);
  }

  /** Новая карточка: свой транспорт — с флагом, рейс — без. */
  @Post(':id/transfer/legs')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Добавить перемещение' })
  @ApiOkResponse({ type: TripTransferDto })
  async createLeg(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateTransferLegDto,
  ): Promise<TripTransferDto> {
    return this.transfer.createLeg(authUser.id, id, dto);
  }

  /** Правка карточки: право вкладки или владелец этого ТС. */
  @Patch(':id/transfer/legs/:legId')
  @ApiOperation({ summary: 'Изменить перемещение' })
  @ApiOkResponse({ type: TripTransferDto })
  async updateLeg(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('legId', ParseIntPipe) legId: number,
    @Body() dto: UpdateTransferLegDto,
  ): Promise<TripTransferDto> {
    return this.transfer.updateLeg(authUser.id, id, legId, dto);
  }

  /** Убрать карточку вместе с пассажирами. */
  @Delete(':id/transfer/legs/:legId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Убрать перемещение' })
  @ApiOkResponse({ type: TripTransferDto })
  async removeLeg(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('legId', ParseIntPipe) legId: number,
  ): Promise<TripTransferDto> {
    return this.transfer.removeLeg(authUser.id, id, legId);
  }

  /**
   * Присоединиться: на рейс — сразу, на чужое ТС — заявкой владельцу.
   *
   * Отдельная ручка без тела, потому что сажает человек всегда себя:
   * посадить другого — это `POST .../passengers`.
   */
  @Post(':id/transfer/legs/:legId/join')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Присоединиться к перемещению' })
  @ApiOkResponse({ type: TripTransferDto })
  async join(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('legId', ParseIntPipe) legId: number,
  ): Promise<TripTransferDto> {
    return this.transfer.join(authUser.id, id, legId);
  }

  /** Посадить человека: владелец ТС или право вкладки. */
  @Post(':id/transfer/legs/:legId/passengers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Добавить пассажира' })
  @ApiOkResponse({ type: TripTransferDto })
  async addPassenger(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('legId', ParseIntPipe) legId: number,
    @Body() dto: AddTransferPassengerDto,
  ): Promise<TripTransferDto> {
    return this.transfer.addPassenger(authUser.id, id, legId, dto);
  }

  /** Принять заявку: место проверяется здесь, при посадке. */
  @Post(':id/transfer/legs/:legId/passengers/:userId/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Принять заявку пассажира' })
  @ApiOkResponse({ type: TripTransferDto })
  async acceptPassenger(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('legId', ParseIntPipe) legId: number,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<TripTransferDto> {
    return this.transfer.acceptPassenger(authUser.id, id, legId, userId);
  }

  /** Уйти самому (в любом статусе) или убрать человека владельцем. */
  @Delete(':id/transfer/legs/:legId/passengers/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Уйти из перемещения или убрать пассажира' })
  @ApiOkResponse({ type: TripTransferDto })
  async removePassenger(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('legId', ParseIntPipe) legId: number,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<TripTransferDto> {
    return this.transfer.removePassenger(authUser.id, id, legId, userId);
  }
}
