import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { GeoObjectListDto, GeoObjectQueryDto } from './dto/geo-object.dto';
import { ObjectsService } from './objects.service';

/**
 * Справочник географических объектов.
 *
 * Только чтение: справочник наполняет админ скриптом, пользователь его
 * не создаёт и не правит. Нужен фронтенду, чтобы выбирать цель похода —
 * без него форма создания похода не может предложить ничего, кроме
 * вписанного руками id.
 *
 * Роут защищён глобальным `JwtAuthGuard`, как и всё остальное: справочник
 * не тайна, но и не то, что нужно отдавать анонимам.
 */
@ApiTags('objects')
@Controller('objects')
export class ObjectsController {
  constructor(private readonly objectsService: ObjectsService) {}

  /** Поиск объектов по подстроке имени. Без `search` — первые по алфавиту. */
  @Get()
  @ApiOperation({ summary: 'Справочник географических объектов' })
  @ApiOkResponse({ type: GeoObjectListDto })
  async list(@Query() query: GeoObjectQueryDto): Promise<GeoObjectListDto> {
    return this.objectsService.list(query);
  }
}
