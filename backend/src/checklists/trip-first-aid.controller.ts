import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import { ChecklistsService } from './checklists.service';
import { SetFirstAidWeightDto, TripFirstAidDto } from './dto/checklist.dto';

/**
 * Вкладка «Аптечка» похода (09.11.2026).
 *
 * Два адреса, потому что действий два: посмотреть, что собрано, и записать
 * вес готовой аптечки. Списки и их пункты правятся общими ручками
 * чек-листов (`ChecklistsController`): аптечка — та же подсистема списков,
 * просто с областью `first_aid`. Отдельная копия CRUD завела бы вторую
 * правду о правах и пунктах.
 *
 * Проверка «виден ли поход» живёт в `ChecklistsService` — том же месте,
 * что у «Снаряжения»: постороннему и приватный поход, и аптечка отвечают
 * одинаково (404), чтобы существование похода не утекало.
 */
@ApiTags('first-aid')
@Controller('trips')
export class TripFirstAidController {
  constructor(private readonly checklistsService: ChecklistsService) {}

  /**
   * Две секции: общественная (если есть доктор) и личная.
   *
   * Списки заводятся при первом чтении: «в секциях по одному чек-листу» —
   * это состояние вкладки, а не отдельная кнопка «создать».
   */
  @Get(':id/first-aid')
  @ApiOperation({ summary: 'Аптечка похода: общественная и личная' })
  @ApiOkResponse({ type: TripFirstAidDto })
  async get(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripFirstAidDto> {
    return this.checklistsService.getFirstAid(authUser.id, id);
  }

  /**
   * Вес готовой аптечки. `weightGrams: null` — «ещё не взвесили»: в
   * раскладке такая аптечка весит 0, а цифры на экране нет.
   */
  @Patch(':id/first-aid/weight')
  @ApiOperation({ summary: 'Записать вес аптечки' })
  @ApiOkResponse({ type: TripFirstAidDto })
  async setWeight(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetFirstAidWeightDto,
  ): Promise<TripFirstAidDto> {
    return this.checklistsService.setFirstAidWeight(authUser.id, id, dto);
  }
}
