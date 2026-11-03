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
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import {
  AssignGearGroupTypeDto,
  CreateGearGroupDto,
  GearGroupListDto,
  MoveGearGroupDto,
  UpdateGearGroupDto,
} from './dto/gear-group.dto';
import { GearGroupsService } from './gear-groups.service';

/**
 * Личные группы снаряжения (02.11.2026).
 *
 * Заказчик: «Раздел „Снаряжение“… добавляем кнопку „Настройка группировки
 * снаряжения“. По этой кнопке открывается инструмент для редактирования
 * групп — можно переименовывать, удалять, перекидывать содержащиеся типы».
 *
 * Всё «от токена»: группа принадлежит человеку, чужой id отвечает 404.
 * Ручки возвращают **список целиком**, а не одну группу: настройщик после
 * переименования, перестановки или удаления показывает все секции, и
 * склеивание ответа на клиенте повторяло бы правила сервера.
 *
 * «Прочее» — неудаляемо (409) и не переставляется (400): это умолчание
 * для типа без своей группы и свалка внизу каталога.
 */
@ApiTags('gear')
@Controller('gear-groups')
export class GearGroupsController {
  constructor(private readonly gearGroupsService: GearGroupsService) {}

  /** Мои группы с типами; заодно досоздаёт копии рекомендуемых. */
  @Get()
  @ApiOperation({ summary: 'Мои группы снаряжения' })
  @ApiOkResponse({ type: GearGroupListDto })
  async list(@CurrentUser() authUser: AuthUser): Promise<GearGroupListDto> {
    return this.gearGroupsService.list(authUser.id);
  }

  /** Своя группа: встаёт перед «Прочим». */
  @Post()
  @ApiOperation({ summary: 'Создать группу снаряжения' })
  @ApiCreatedResponse({ type: GearGroupListDto })
  async create(
    @CurrentUser() authUser: AuthUser,
    @Body() dto: CreateGearGroupDto,
  ): Promise<GearGroupListDto> {
    return this.gearGroupsService.create(authUser.id, dto);
  }

  /** Имя и порядок. У «Прочего» порядок менять нельзя — 400. */
  @Patch(':id')
  @ApiOperation({ summary: 'Изменить группу снаряжения' })
  @ApiOkResponse({ type: GearGroupListDto })
  async update(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGearGroupDto,
  ): Promise<GearGroupListDto> {
    return this.gearGroupsService.update(authUser.id, id, dto);
  }

  /** Удалить группу: её типы переезжают в «Прочее». «Прочее» — 409. */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Удалить группу снаряжения' })
  @ApiOkResponse({ type: GearGroupListDto })
  async remove(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<GearGroupListDto> {
    return this.gearGroupsService.remove(authUser.id, id);
  }

  /** Переставить группу выше или ниже. «Прочее» — 400. */
  @Post(':id/move')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Переставить группу снаряжения' })
  @ApiOkResponse({ type: GearGroupListDto })
  async move(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MoveGearGroupDto,
  ): Promise<GearGroupListDto> {
    return this.gearGroupsService.move(authUser.id, id, dto.direction);
  }

  /** Переложить тип в эту группу. */
  @Post(':id/types')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Переложить тип в группу' })
  @ApiOkResponse({ type: GearGroupListDto })
  async assignType(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignGearGroupTypeDto,
  ): Promise<GearGroupListDto> {
    return this.gearGroupsService.assignType(authUser.id, id, dto);
  }
}
