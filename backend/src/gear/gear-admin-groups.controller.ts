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
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import {
  CreateGearGroupDto,
  GearAdminGroupDto,
  GearAdminGroupListDto,
  UpdateGearGroupDto,
} from './dto/gear-group.dto';
import { GearGroupsService } from './gear-groups.service';

/**
 * Админка групп снаряжения (31.10.2026).
 *
 * Префикс `gear/admin/groups` — тот же приём, что `gear/admin/types`:
 * один контроллер и одна проверка прав (`isAdminUser` в сервисе),
 * публичный `gear-groups` остаётся только чтением.
 *
 * **Удаление — архив.** `DELETE` отвечает 204 и ставит `is_active = false`;
 * повторный вызов тоже 204. Физического удаления нет: на группу ссылаются
 * вещи. Исключение одно — «Прочее»: её архив запрещён (409), потому что
 * это группа по умолчанию.
 */
@ApiTags('gear')
@Controller('gear/admin/groups')
@ApiForbiddenResponse({ description: 'Раздел только для администратора' })
export class GearAdminGroupsController {
  constructor(private readonly gearGroupsService: GearGroupsService) {}

  /** Все группы, включая архивные, с числом вещей. */
  @Get()
  @ApiOperation({ summary: 'Группы снаряжения для админки' })
  @ApiOkResponse({ type: GearAdminGroupListDto })
  async list(
    @CurrentUser() authUser: AuthUser,
  ): Promise<GearAdminGroupListDto> {
    return this.gearGroupsService.listAdmin(authUser.id);
  }

  /** Новая группа. `code` занимается навсегда: в `PATCH` его нет. */
  @Post()
  @ApiOperation({ summary: 'Создать группу снаряжения' })
  @ApiCreatedResponse({ type: GearAdminGroupDto })
  async create(
    @CurrentUser() authUser: AuthUser,
    @Body() dto: CreateGearGroupDto,
  ): Promise<GearAdminGroupDto> {
    return this.gearGroupsService.createGroup(authUser.id, dto);
  }

  /** Правка группы: имя, порядок, активность. `code` не меняется — 400. */
  @Patch(':id')
  @ApiOperation({ summary: 'Изменить группу снаряжения' })
  @ApiOkResponse({ type: GearAdminGroupDto })
  async update(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGearGroupDto,
  ): Promise<GearAdminGroupDto> {
    return this.gearGroupsService.updateGroup(authUser.id, id, dto);
  }

  /** В архив: `is_active = false`, ответ 204. «Прочее» — 409. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Убрать группу в архив' })
  @ApiNoContentResponse({ description: 'Группа в архиве' })
  async archive(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.gearGroupsService.archiveGroup(authUser.id, id);
  }
}
