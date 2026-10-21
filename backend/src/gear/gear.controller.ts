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
  CreateGearItemDto,
  GearItemDto,
  GearListDto,
  UpdateGearItemDto,
} from './dto/gear.dto';
import { GearService } from './gear.service';

/**
 * Личное снаряжение: каталог предметов с весом.
 *
 * Как и календарь, контроллер работает «от токена»: предмет принадлежит
 * тому, кто прислал запрос, и владельца в теле нет — иначе можно было бы
 * писать в чужой каталог.
 */
@ApiTags('gear')
@Controller('gear')
export class GearController {
  constructor(private readonly gearService: GearService) {}

  /** Мой список с итогом по весу. */
  @Get()
  @ApiOperation({ summary: 'Моё снаряжение' })
  @ApiOkResponse({ type: GearListDto })
  async list(@CurrentUser() authUser: AuthUser): Promise<GearListDto> {
    return this.gearService.list(authUser.id);
  }

  /** Новый предмет. Вес можно не указывать — он попадёт в список «не взвешено». */
  @Post()
  @ApiOperation({ summary: 'Добавить предмет' })
  @ApiCreatedResponse({ type: GearItemDto })
  async create(
    @CurrentUser() authUser: AuthUser,
    @Body() dto: CreateGearItemDto,
  ): Promise<GearItemDto> {
    return this.gearService.create(authUser.id, dto);
  }

  /** Правка предмета. `weightGrams: null` — стереть вес. */
  @Patch(':id')
  @ApiOperation({ summary: 'Изменить предмет' })
  @ApiOkResponse({ type: GearItemDto })
  async update(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGearItemDto,
  ): Promise<GearItemDto> {
    return this.gearService.update(authUser.id, id, dto);
  }

  /** Удалить предмет. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить предмет' })
  @ApiNoContentResponse({ description: 'Предмет удалён' })
  async remove(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.gearService.remove(authUser.id, id);
  }
}
