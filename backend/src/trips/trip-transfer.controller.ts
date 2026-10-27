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
  Put,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import {
  AddTransferPassengerDto,
  CreateTransferCarDto,
  CreateTransferLegDto,
  SeatTransferPassengerDto,
  TripTransferDto,
  UpdateTransferCarDto,
  UpdateTransferLegDto,
} from './dto/trip-transfer.dto';
import { TripTransferService } from './trip-transfer.service';

/**
 * «Трансфер» похода: строки заброски, машины и пассажиры.
 *
 * Отдельный контроллер, а не методы в `TripsController`: походы не должны
 * знать, как устроен трансфер (та же причина, что у «Питания», чек-листов
 * и снаряжения). Видимость похода и права на вкладку спрашиваются
 * у `TripsService` — матрицу ролей здесь не пересказывают.
 *
 * **Все ручки отвечают вкладкой целиком** (`TripTransferDto`), включая
 * удаления: на экране места в машине, «без машины» и состав строки —
 * это три числа от двух таблиц, и собрать их из частичного ответа значит
 * однажды показать неправду. Поэтому и у `POST`, и у `DELETE` стоит 200,
 * а не 201/204: тело у них есть всегда.
 */
@ApiTags('trip-transfer')
@Controller('trips')
export class TripTransferController {
  constructor(private readonly transfer: TripTransferService) {}

  /** Вкладка целиком. Видят участники похода. */
  @Get(':id/transfer')
  @ApiOperation({ summary: 'Трансфер похода: строки, машины, пассажиры' })
  @ApiOkResponse({ type: TripTransferDto })
  async getPlan(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripTransferDto> {
    return this.transfer.getPlan(authUser.id, id);
  }

  /** Новая строка заброски. */
  @Post(':id/transfer/legs')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Добавить строку заброски' })
  @ApiOkResponse({ type: TripTransferDto })
  async createLeg(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateTransferLegDto,
  ): Promise<TripTransferDto> {
    return this.transfer.createLeg(authUser.id, id, dto);
  }

  /** Поправить строку: вид, точки, время, заметку. */
  @Patch(':id/transfer/legs/:legId')
  @ApiOperation({ summary: 'Изменить строку заброски' })
  @ApiOkResponse({ type: TripTransferDto })
  async updateLeg(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('legId', ParseIntPipe) legId: number,
    @Body() dto: UpdateTransferLegDto,
  ): Promise<TripTransferDto> {
    return this.transfer.updateLeg(authUser.id, id, legId, dto);
  }

  /** Убрать строку вместе с машинами и пассажирами. */
  @Delete(':id/transfer/legs/:legId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Убрать строку заброски' })
  @ApiOkResponse({ type: TripTransferDto })
  async removeLeg(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('legId', ParseIntPipe) legId: number,
  ): Promise<TripTransferDto> {
    return this.transfer.removeLeg(authUser.id, id, legId);
  }

  /**
   * «Вернуться так же»: копия строки с обратными точками, машинами
   * и людьми, но без даты.
   */
  @Post(':id/transfer/legs/:legId/return')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Скопировать строку обратно' })
  @ApiOkResponse({ type: TripTransferDto })
  async returnSameWay(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('legId', ParseIntPipe) legId: number,
  ): Promise<TripTransferDto> {
    return this.transfer.returnSameWay(authUser.id, id, legId);
  }

  /** Поставить человека в строку: себя — можно всегда, других — ведущему. */
  @Post(':id/transfer/legs/:legId/passengers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Добавить пассажира в строку заброски' })
  @ApiOkResponse({ type: TripTransferDto })
  async addPassenger(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('legId', ParseIntPipe) legId: number,
    @Body() dto: AddTransferPassengerDto,
  ): Promise<TripTransferDto> {
    return this.transfer.addPassenger(authUser.id, id, legId, dto);
  }

  /**
   * Место в машине или `null` — «без машины».
   *
   * `PUT`, а не `PATCH`: место в машине — одно поле, и его состояние
   * задают целиком. Снять человека со строки — отдельный `DELETE`.
   */
  @Put(':id/transfer/legs/:legId/passengers/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Посадить пассажира в машину строки' })
  @ApiOkResponse({ type: TripTransferDto })
  async seatPassenger(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('legId', ParseIntPipe) legId: number,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SeatTransferPassengerDto,
  ): Promise<TripTransferDto> {
    return this.transfer.seatPassenger(authUser.id, id, legId, userId, dto);
  }

  /** Снять человека со строки: он ею больше не едет. */
  @Delete(':id/transfer/legs/:legId/passengers/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Снять пассажира со строки заброски' })
  @ApiOkResponse({ type: TripTransferDto })
  async removePassenger(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('legId', ParseIntPipe) legId: number,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<TripTransferDto> {
    return this.transfer.removePassenger(authUser.id, id, legId, userId);
  }

  /** Машина в строке: своя — сам водитель, наёмная — ведущий вкладку. */
  @Post(':id/transfer/legs/:legId/cars')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Добавить машину в строку заброски' })
  @ApiOkResponse({ type: TripTransferDto })
  async createCar(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('legId', ParseIntPipe) legId: number,
    @Body() dto: CreateTransferCarDto,
  ): Promise<TripTransferDto> {
    return this.transfer.createCar(authUser.id, id, legId, dto);
  }

  /** Правка машины: водитель, места, телефон, заметка. */
  @Patch(':id/transfer/cars/:carId')
  @ApiOperation({ summary: 'Изменить машину в трансфере' })
  @ApiOkResponse({ type: TripTransferDto })
  async updateCar(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('carId', ParseIntPipe) carId: number,
    @Body() dto: UpdateTransferCarDto,
  ): Promise<TripTransferDto> {
    return this.transfer.updateCar(authUser.id, id, carId, dto);
  }

  /** Убрать машину: пассажиры остаются в строке нераспределёнными. */
  @Delete(':id/transfer/cars/:carId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Убрать машину из трансфера' })
  @ApiOkResponse({ type: TripTransferDto })
  async removeCar(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('carId', ParseIntPipe) carId: number,
  ): Promise<TripTransferDto> {
    return this.transfer.removeCar(authUser.id, id, carId);
  }
}
