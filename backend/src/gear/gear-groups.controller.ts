import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { GearGroupListDto } from './dto/gear-group.dto';
import { GearGroupsService } from './gear-groups.service';

/**
 * Публичное чтение групп снаряжения (31.10.2026).
 *
 * Экран `/profile/gear` собирает каталог секциями по группам и спрашивает
 * этот список один раз: из него берутся названия полок, их порядок
 * и выбор группы в форме вещи. Только действующие группы — архивные нужны
 * лишь админке.
 *
 * Как и `GET /api/gear-types`, доступно авторизованному пользователю:
 * группы — часть личного каталога, а не публичный справочник.
 */
@ApiTags('gear')
@Controller('gear-groups')
export class GearGroupsController {
  constructor(private readonly gearGroupsService: GearGroupsService) {}

  /** Действующие группы в порядке админа. */
  @Get()
  @ApiOperation({ summary: 'Группы снаряжения' })
  @ApiOkResponse({ type: GearGroupListDto })
  async list(): Promise<GearGroupListDto> {
    return this.gearGroupsService.listPublic();
  }
}
