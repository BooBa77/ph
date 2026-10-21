import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ProductListDto, ProductSearchQueryDto } from './dto/meal.dto';
import { MealsService } from './meals.service';

/**
 * Справочник продуктов: только чтение.
 *
 * Пополнение справочника — отдельная задача (решено: будущий функционал),
 * поэтому здесь один роут. Приложению в базе выдан `SELECT`: даже если
 * появится роут записи, право на это придётся выдавать осознанно.
 *
 * Без строки поиска роут отдаёт **пустой список**, а не все продукты:
 * справочник не листают, его ищут — и подсказка в поле ввода говорит
 * человеку, что делать.
 */
@ApiTags('meals')
@Controller('products')
export class ProductsController {
  constructor(private readonly mealsService: MealsService) {}

  /** Поиск продукта по подстроке названия. */
  @Get()
  @ApiOperation({ summary: 'Поиск продукта в справочнике' })
  @ApiOkResponse({ type: ProductListDto })
  async search(@Query() query: ProductSearchQueryDto): Promise<ProductListDto> {
    return this.mealsService.searchProducts(query.search);
  }
}
