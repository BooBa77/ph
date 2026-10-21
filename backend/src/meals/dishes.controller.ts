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
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import {
  AddIngredientDto,
  CreateDishDto,
  DishDto,
  DishIngredientDto,
  DishListDto,
  UpdateDishDto,
  UpdateIngredientDto,
} from './dto/meal.dto';
import { MealsService } from './meals.service';

/**
 * Кулинарная книга: мои блюда и их состав.
 *
 * Блюда личные: чужие не видны никому — ни участникам, ни организатору.
 * Поэтому все роуты работают «от токена», а чужое блюдо отвечает 404.
 */
@ApiTags('meals')
@Controller('dishes')
export class DishesController {
  constructor(private readonly mealsService: MealsService) {}

  /** Мои блюда с составом и весом. */
  @Get()
  @ApiOperation({ summary: 'Мои блюда' })
  @ApiOkResponse({ type: DishListDto })
  async list(@CurrentUser() authUser: AuthUser): Promise<DishListDto> {
    return this.mealsService.listDishes(authUser.id);
  }

  /** Новое блюдо. Состав добавляется по продуктам. */
  @Post()
  @ApiOperation({ summary: 'Создать блюдо' })
  @ApiCreatedResponse({ type: DishDto })
  async create(
    @CurrentUser() authUser: AuthUser,
    @Body() dto: CreateDishDto,
  ): Promise<DishDto> {
    return this.mealsService.createDish(authUser.id, dto);
  }

  /** Переименовать блюдо и/или изменить заметку. */
  @Patch(':id')
  @ApiOperation({ summary: 'Изменить блюдо' })
  @ApiOkResponse({ type: DishDto })
  async update(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDishDto,
  ): Promise<DishDto> {
    return this.mealsService.updateDish(authUser.id, id, dto);
  }

  /** Удалить блюдо вместе с составом. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Удалить блюдо' })
  @ApiNoContentResponse({ description: 'Блюдо удалено' })
  async remove(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.mealsService.deleteDish(authUser.id, id);
  }

  /**
   * Добавить продукт из справочника.
   *
   * Повторный продукт в блюде — 409: две строки с одним продуктом означали
   * бы два количества одного и того же, и вес блюда считался бы дважды.
   */
  @Post(':id/ingredients')
  @ApiOperation({ summary: 'Добавить продукт в блюдо' })
  @ApiCreatedResponse({ type: DishIngredientDto })
  async addIngredient(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddIngredientDto,
  ): Promise<DishIngredientDto> {
    return this.mealsService.addIngredient(authUser.id, id, dto);
  }

  /** Изменить количество продукта в блюде. */
  @Patch('ingredients/:ingredientId')
  @ApiOperation({ summary: 'Изменить количество продукта' })
  @ApiOkResponse({ type: DishIngredientDto })
  async updateIngredient(
    @CurrentUser() authUser: AuthUser,
    @Param('ingredientId', ParseIntPipe) ingredientId: number,
    @Body() dto: UpdateIngredientDto,
  ): Promise<DishIngredientDto> {
    return this.mealsService.updateIngredient(authUser.id, ingredientId, dto);
  }

  /** Убрать продукт из блюда. */
  @Delete('ingredients/:ingredientId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Убрать продукт из блюда' })
  @ApiNoContentResponse({ description: 'Продукт убран' })
  async removeIngredient(
    @CurrentUser() authUser: AuthUser,
    @Param('ingredientId', ParseIntPipe) ingredientId: number,
  ): Promise<void> {
    return this.mealsService.deleteIngredient(authUser.id, ingredientId);
  }
}
