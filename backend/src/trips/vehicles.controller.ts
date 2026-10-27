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
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import {
  CreateVehicleDto,
  UpdateVehicleDto,
  VehicleDto,
  VehicleListDto,
} from './dto/vehicle.dto';
import { VehiclesService } from './vehicles.service';

/**
 * Каталог транспорта участника — «как снаряжение».
 *
 * Владельца в теле нет: транспорт всегда свой (работает от токена).
 * На вкладке «Трансфер» этот список показывается выбором, чтобы не
 * заполнять способ, места и номер в каждой карточке заново.
 */
@ApiTags('vehicles')
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  @ApiOperation({ summary: 'Мой транспорт' })
  @ApiOkResponse({ type: VehicleListDto })
  async list(@CurrentUser() authUser: AuthUser): Promise<VehicleListDto> {
    return this.vehicles.list(authUser.id);
  }

  @Post()
  @ApiOperation({ summary: 'Завести транспорт' })
  @ApiCreatedResponse({ type: VehicleDto })
  async create(
    @CurrentUser() authUser: AuthUser,
    @Body() dto: CreateVehicleDto,
  ): Promise<VehicleDto> {
    return this.vehicles.create(authUser.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Изменить транспорт' })
  @ApiOkResponse({ type: VehicleDto })
  async update(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVehicleDto,
  ): Promise<VehicleDto> {
    return this.vehicles.update(authUser.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить транспорт' })
  @ApiNoContentResponse({ description: 'Транспорт удалён' })
  async remove(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.vehicles.remove(authUser.id, id);
  }
}
