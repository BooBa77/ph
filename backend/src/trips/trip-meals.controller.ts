import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/decorators/current-user.decorator';
import {
  AddMealDishDto,
  SetMealAllocationsDto,
  SetMealFormDto,
  SetMealKulekDto,
  SetMealLineDto,
  SetDishExclusionsDto,
  TripMealCheckListDto,
  TripMealPlanDto,
  UpdateMealCheckDto,
  UpdateMealPackageDto,
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

  /** Исключить ингредиенты блюда в этом приёме: «лук не любим». */
  @Put(':id/meals/:dayIndex/:kind/dishes/:dishId/exclusions')
  @ApiOperation({ summary: 'Исключения ингредиентов в приёме' })
  @ApiOkResponse({ type: TripMealPlanDto })
  async setDishExclusions(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('dayIndex', ParseIntPipe) dayIndex: number,
    @Param('kind') kind: TripMealKind,
    @Param('dishId') dishId: string,
    @Body() dto: SetDishExclusionsDto,
  ): Promise<TripMealPlanDto> {
    return this.tripMeals.setDishExclusions(
      authUser.id,
      id,
      dayIndex,
      kind,
      dishId,
      dto.productIds,
    );
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

  // ─────────────────────────── фасовка ───────────────────────────

  /** Новый пакет: имя по умолчанию «Пакет N». */
  @Post(':id/meal-packages')
  @ApiOperation({ summary: 'Новый пакет' })
  @ApiOkResponse({ type: TripMealPlanDto })
  async createPackage(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripMealPlanDto> {
    return this.tripMeals.createPackage(authUser.id, id);
  }

  /** Имя пакета и фактический вес после взвешивания. */
  @Patch(':id/meal-packages/:packageId')
  @ApiOperation({ summary: 'Правка пакета' })
  @ApiOkResponse({ type: TripMealPlanDto })
  async updatePackage(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('packageId') packageId: string,
    @Body() dto: UpdateMealPackageDto,
  ): Promise<TripMealPlanDto> {
    return this.tripMeals.updatePackage(authUser.id, id, packageId, dto);
  }

  /** Удаление пакета: его доли уходят каскадом. */
  @Delete(':id/meal-packages/:packageId')
  @ApiOperation({ summary: 'Удалить пакет' })
  @ApiOkResponse({ type: TripMealPlanDto })
  async removePackage(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('packageId') packageId: string,
  ): Promise<TripMealPlanDto> {
    return this.tripMeals.removePackage(authUser.id, id, packageId);
  }

  /** Доли строки раскладки по пакетам: список заменяет прежние. */
  @Put(':id/meals/:dayIndex/:kind/allocations/:productId')
  @ApiOperation({ summary: 'Доли строки по пакетам' })
  @ApiOkResponse({ type: TripMealPlanDto })
  async setAllocations(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('dayIndex', ParseIntPipe) dayIndex: number,
    @Param('kind') kind: TripMealKind,
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: SetMealAllocationsDto,
  ): Promise<TripMealPlanDto> {
    return this.tripMeals.setAllocations(
      authUser.id,
      id,
      dayIndex,
      kind,
      productId,
      dto.allocations,
    );
  }

  /** Кулёк приёма: включить или выключить. */
  @Put(':id/meals/:dayIndex/:kind/kulek')
  @ApiOperation({ summary: 'Кулёк приёма' })
  @ApiOkResponse({ type: TripMealPlanDto })
  async setKulek(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('dayIndex', ParseIntPipe) dayIndex: number,
    @Param('kind') kind: TripMealKind,
    @Body() dto: SetMealKulekDto,
  ): Promise<TripMealPlanDto> {
    return this.tripMeals.setKulek(
      authUser.id,
      id,
      dayIndex,
      kind,
      dto.enabled,
    );
  }

  // ─────────────────────────── чек-лист покупок ───────────────────────────

  /** Чек-лист: проекция раскладки и отметки. */
  @Get(':id/meal-checks')
  @ApiOperation({ summary: 'Чек-лист покупок' })
  @ApiOkResponse({ type: TripMealCheckListDto })
  async getChecklist(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripMealCheckListDto> {
    return this.tripMeals.getChecklist(authUser.id, id);
  }

  /** Отметки чек-листа: куплено, домашнее, сколько куплено. Любой участник. */
  @Put(':id/meal-checks/:productId')
  @ApiOperation({ summary: 'Отметка чек-листа' })
  @ApiOkResponse({ type: TripMealCheckListDto })
  async updateCheck(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: UpdateMealCheckDto,
  ): Promise<TripMealCheckListDto> {
    return this.tripMeals.updateCheck(authUser.id, id, productId, dto);
  }
}
