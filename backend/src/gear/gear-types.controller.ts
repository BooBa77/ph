import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { GearTypeListDto } from './dto/gear-type.dto';
import { GearTypesService } from './gear-types.service';

/**
 * Публичный справочник типов снаряжения.
 *
 * Только чтение и только активное. Из этого ответа строятся формы вещи
 * в каталоге (`/profile/gear`) и фильтры экранов «Палатки» и «Костровое»:
 * они не знают конкретных типов, а читают код из справочника. Поэтому
 * ручка появилась в Stage A, до потребителей, и сразу была покрыта тестами.
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
