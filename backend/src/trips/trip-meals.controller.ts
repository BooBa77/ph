import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import {
  AddMealDishDto,
  SetMealFormDto,
  SetMealLineDto,
  TripMealPlanDto,
} from './dto/trip-meal.dto';
import type { TripMealKind } from './trip.types';
import { TripMealsService } from './trip-meals.service';

/**
 * «Питание» похода: раскладка и фасовка (`meals.md` §5).
 *
 * Отдельный контроллер с тем же префиксом `trips`, что и основной: маршруты
 * `:id/meal-plan` и `:id/meals/...`, и держать их в `TripsController` значило
 * бы раздуть его ещё на сотню строк. Права и доступ считает сервис: читает
 * состав, правит завхоз или организатор.
 */
@ApiTags('trip-meals')
@Controller('trips')
export class TripMealsController {
  constructor(private readonly tripMeals: TripMealsService) {}

  /** Раскладка и фасовка целиком: едоки, дни, приёмы, пакеты. */
  @Get(':id/meal-plan')
  @ApiOperation({ summary: 'Раскладка и фасовка похода' })
  @ApiOkResponse({ type: TripMealPlanDto })
  async getPlan(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripMealPlanDto> {
    return this.tripMeals.getPlan(authUser.id, id);
  }

  /** Форма приёма: готовка или перекус. */
  @Put(':id/meals/:dayIndex/:kind/form')
  @ApiOperation({ summary: 'Форма приёма' })
  @ApiOkResponse({ type: TripMealPlanDto })
  async setForm(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('dayIndex', ParseIntPipe) dayIndex: number,
    @Param('kind') kind: TripMealKind,
    @Body() dto: SetMealFormDto,
  ): Promise<TripMealPlanDto> {
    return this.tripMeals.setForm(authUser.id, id, dayIndex, kind, dto.form);
  }

  /** Поставить своё блюдо в приём. */
  @Post(':id/meals/:dayIndex/:kind/dishes')
  @ApiOperation({ summary: 'Добавить блюдо в приём' })
  @ApiOkResponse({ type: TripMealPlanDto })
  async addDish(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('dayIndex', ParseIntPipe) dayIndex: number,
    @Param('kind') kind: TripMealKind,
    @Body() dto: AddMealDishDto,
  ): Promise<TripMealPlanDto> {
    return this.tripMeals.addDish(authUser.id, id, dayIndex, kind, dto.dishId);
  }

  /** Убрать блюдо из приёма. */
  @Delete(':id/meals/:dayIndex/:kind/dishes/:dishId')
  @ApiOperation({ summary: 'Убрать блюдо из приёма' })
  @ApiOkResponse({ type: TripMealPlanDto })
  async removeDish(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('dayIndex', ParseIntPipe) dayIndex: number,
    @Param('kind') kind: TripMealKind,
    @Param('dishId') dishId: string,
  ): Promise<TripMealPlanDto> {
    return this.tripMeals.removeDish(authUser.id, id, dayIndex, kind, dishId);
  }

  /** Ручная строка: «хлеб 600 г» — абсолютная. */
  @Put(':id/meals/:dayIndex/:kind/lines/:productId')
  @ApiOperation({ summary: 'Ручная строка в приёме' })
  @ApiOkResponse({ type: TripMealPlanDto })
  async setLine(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('dayIndex', ParseIntPipe) dayIndex: number,
    @Param('kind') kind: TripMealKind,
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: SetMealLineDto,
  ): Promise<TripMealPlanDto> {
    return this.tripMeals.setLine(
      authUser.id,
      id,
      dayIndex,
      kind,
      productId,
      dto.amount,
    );
  }

  /** Убрать ручную строку. */
  @Delete(':id/meals/:dayIndex/:kind/lines/:productId')
  @ApiOperation({ summary: 'Убрать ручную строку' })
  @ApiOkResponse({ type: TripMealPlanDto })
  async removeLine(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('dayIndex', ParseIntPipe) dayIndex: number,
    @Param('kind') kind: TripMealKind,
    @Param('productId', ParseIntPipe) productId: number,
  ): Promise<TripMealPlanDto> {
    return this.tripMeals.removeLine(
      authUser.id,
      id,
      dayIndex,
      kind,
      productId,
    );
  }

  /** Убрать приём целиком. */
  @Delete(':id/meals/:dayIndex/:kind')
  @ApiOperation({ summary: 'Убрать приём' })
  @ApiOkResponse({ type: TripMealPlanDto })
  async removeMeal(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('dayIndex', ParseIntPipe) dayIndex: number,
    @Param('kind') kind: TripMealKind,
  ): Promise<TripMealPlanDto> {
    return this.tripMeals.removeMeal(authUser.id, id, dayIndex, kind);
  }
}
