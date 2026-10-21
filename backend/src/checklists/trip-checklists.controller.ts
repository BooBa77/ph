import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { ChecklistsService } from './checklists.service';
import {
  ChecklistDto,
  CreateTripChecklistDto,
  TripChecklistListDto,
} from './dto/checklist.dto';

/**
 * Чек-листы похода: общий и свой личный.
 *
 * Отдельный контроллер, а не методы в `TripsController`, потому что
 * это **чужой домен**: походы не должны знать, как устроены списки.
 * Проверка «виден ли поход» при этом одна на всех — её делает
 * `TripsService.getVisibleTrip`, а не копия правил здесь.
 *
 * Приватный поход постороннему — 404 (тот же ответ, что у самого похода):
 * существование закрытого похода не должно утекать даже через списки.
 */
@ApiTags('checklists')
@Controller('trips')
export class TripChecklistsController {
  constructor(private readonly checklistsService: ChecklistsService) {}

  /**
   * Списки похода: `shared` и `personal`. `null` — списка ещё нет.
   *
   * Личный список ищется по паре «поход + я»: чужие личные списки сюда
   * не попадают ни при каких правах.
   */
  @Get(':id/checklists')
  @ApiOperation({ summary: 'Чек-листы похода' })
  @ApiOkResponse({ type: TripChecklistListDto })
  async list(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripChecklistListDto> {
    return this.checklistsService.listForTrip(authUser.id, id);
  }

  /**
   * Завести список в походе: общий (организатор) или личный (участник).
   *
   * `fromTemplateId` копирует пункты шаблона — копия, а не ссылка: правка
   * шаблона не переписывает поход. Повторный запрос даёт 409: список один,
   * и молча вернуть чужой значило бы соврать о том, кто его создал.
   */
  @Post(':id/checklists')
  @ApiOperation({ summary: 'Создать чек-лист в походе' })
  @ApiCreatedResponse({ type: ChecklistDto })
  async create(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateTripChecklistDto,
  ): Promise<ChecklistDto> {
    return this.checklistsService.createForTrip(authUser.id, id, dto);
  }
}
