import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { GearTypeListDto } from './dto/gear-type.dto';
import { GearTypesService } from './gear-types.service';

/**
 * Публичный справочник типов снаряжения.
 *
 * Только чтение и только активное. Пока потребителя нет — старый каталог
 * живёт на `gear_items.kind`, — но это контракт Stage B: универсальные
 * страницы будут строить форму вещи по этому ответу, не зная конкретных
 * типов. Поэтому ручка есть и покрыта тестами уже в Stage A.
 *
 * Все изменения живут под `/api/gear/admin/types` — один контроллер, одна
 * проверка прав. `POST /api/gear-types` выглядел бы публичным ресурсом,
 * хотя это админская операция.
 */
@ApiTags('gear')
@Controller('gear-types')
export class GearTypesController {
  constructor(private readonly gearTypesService: GearTypesService) {}

  /** Активные типы с активными характеристиками, в порядке показа. */
  @Get()
  @ApiOperation({ summary: 'Справочник типов снаряжения' })
  @ApiOkResponse({ type: GearTypeListDto })
  async list(): Promise<GearTypeListDto> {
    return this.gearTypesService.listPublic();
  }
}
