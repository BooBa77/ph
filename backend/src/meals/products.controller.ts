import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CreateProductDto, ProductDto, ProductListDto, ProductSearchQueryDto } from './dto/meal.dto';
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
  async search(
    @Query() query: ProductSearchQueryDto,
    @Query('tripId') tripId?: string,
  ): Promise<ProductListDto> {
    return this.mealsService.searchProducts(query.search, tripId);
  }

  /** Свой продукт: вес единицы 0, граммы по нему не считаются. */
  @Post()
  @ApiOperation({ summary: 'Добавить свой продукт' })
  @ApiCreatedResponse({ type: ProductDto })
  async create(
    @Body() dto: CreateProductDto,
    @Query('tripId') tripId?: string,
  ): Promise<ProductDto> {
    return this.mealsService.createProduct(dto, tripId);
  }
}
