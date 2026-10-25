import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
  AddMealLineDto,
  SetDishExclusionsDto,
  SetMealAllocationsDto,
  SetMealFormDto,
  SetMealKulekDto,
  SetMealLineDto,
  TripMealCheckListDto,
  TripMealPlanDto,
  UpdateMealCheckDto,
  UpdateMealPackageDto,
} from './dto/trip-meal.dto';
import type { TripMealKind } from './trip.types';
import { TripMealsService } from './trip-meals.service';

/**
 * «Моя еда»: личное питание участника, который едет отдельно.
 *
 * Отдельные маршруты, а не флаг в общих: личный слой — не часть общей
 * раскладки, и путать их в одном `:id/meals/...` значило бы каждый вызов
 * проверять, чей слой просят. Здесь владелец всегда тот, кто делает
 * запрос, — перебирать id нечего.
 *
 * Права считает сервис: личную еду видит и правит только её владелец,
 * завхоз сюда не заходит. Флаг «питаюсь отдельно» ставится на участии
 * (`PATCH /api/trips/:id/participants/me`), а не здесь: личную еду можно
 * вести заранее, не объявляя себя отдельным.
 */
@ApiTags('trip-meals')
@Controller('trips')
export class TripMyMealsController {
  constructor(private readonly tripMeals: TripMealsService) {}

  /** Личная раскладка: дни и приёмы того, кто питается отдельно. */
  @Get(':id/my-meal-plan')
  @ApiOperation({ summary: 'Моя личная раскладка и фасовка' })
  @ApiOkResponse({ type: TripMealPlanDto })
  async getPlan(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripMealPlanDto> {
    return this.tripMeals.getPlan(authUser.id, id, authUser.id);
  }

  /** Форма приёма: готовка или перекус. */
  @Put(':id/my-meals/:dayIndex/:kind/form')
  @ApiOperation({ summary: 'Форма личного приёма' })
  @ApiOkResponse({ type: TripMealPlanDto })
  async setForm(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('dayIndex', ParseIntPipe) dayIndex: number,
    @Param('kind') kind: TripMealKind,
    @Body() dto: SetMealFormDto,
  ): Promise<TripMealPlanDto> {
    return this.tripMeals.setForm(
      authUser.id,
      id,
      authUser.id,
      dayIndex,
      kind,
      dto.form,
    );
  }

  /**
   * Блюдо в личный приём: своё или общее из раскладки похода.
   *
   * «Общее» — то, что уже стоит в общей раскладке: участник берёт рецепт
   * группы, а не заводит его заново. Чужие блюда вне похода по-прежнему
   * не видны (404).
   */
  @Post(':id/my-meals/:dayIndex/:kind/dishes')
  @ApiOperation({ summary: 'Добавить блюдо в личный приём' })
  @ApiOkResponse({ type: TripMealPlanDto })
  async addDish(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('dayIndex', ParseIntPipe) dayIndex: number,
    @Param('kind') kind: TripMealKind,
    @Body() dto: AddMealDishDto,
  ): Promise<TripMealPlanDto> {
    return this.tripMeals.addDish(
      authUser.id,
      id,
      authUser.id,
      dayIndex,
      kind,
      dto.dishId,
    );
  }

  /** Убрать блюдо из личного приёма. */
  @Delete(':id/my-meals/:dayIndex/:kind/dishes/:dishId')
  @ApiOperation({ summary: 'Убрать блюдо из личного приёма' })
  @ApiOkResponse({ type: TripMealPlanDto })
  async removeDish(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('dayIndex', ParseIntPipe) dayIndex: number,
    @Param('kind') kind: TripMealKind,
    @Param('dishId') dishId: string,
  ): Promise<TripMealPlanDto> {
    return this.tripMeals.removeDish(
      authUser.id,
      id,
      authUser.id,
      dayIndex,
      kind,
      dishId,
    );
  }

  /** Исключить ингредиенты блюда в личном приёме. */
  @Put(':id/my-meals/:dayIndex/:kind/dishes/:dishId/exclusions')
  @ApiOperation({ summary: 'Исключения ингредиентов в личном приёме' })
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
      authUser.id,
      dayIndex,
      kind,
      dishId,
      dto.productIds,
    );
  }

  /** Ручная строка в личном приёме. */
  @Put(':id/my-meals/:dayIndex/:kind/lines/:productId')
  @ApiOperation({ summary: 'Ручная строка в личном приёме' })
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
      authUser.id,
      dayIndex,
      kind,
      productId,
      dto.amount,
    );
  }

  /** Добавить продукт в личный приём по названию или из справочника. */
  @Post(':id/my-meals/:dayIndex/:kind/lines')
  @HttpCode(200)
  @ApiOperation({ summary: 'Добавить продукт в личный приём' })
  @ApiOkResponse({ type: TripMealPlanDto })
  async addLineByName(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('dayIndex', ParseIntPipe) dayIndex: number,
    @Param('kind') kind: TripMealKind,
    @Body() dto: AddMealLineDto,
  ): Promise<TripMealPlanDto> {
    return this.tripMeals.addLineByName(
      authUser.id,
      id,
      authUser.id,
      dayIndex,
      kind,
      dto,
    );
  }

  /** Убрать ручную строку. */
  @Delete(':id/my-meals/:dayIndex/:kind/lines/:productId')
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
      authUser.id,
      dayIndex,
      kind,
      productId,
    );
  }

  /** Убрать приём целиком. */
  @Delete(':id/my-meals/:dayIndex/:kind')
  @ApiOperation({ summary: 'Убрать личный приём' })
  @ApiOkResponse({ type: TripMealPlanDto })
  async removeMeal(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('dayIndex', ParseIntPipe) dayIndex: number,
    @Param('kind') kind: TripMealKind,
  ): Promise<TripMealPlanDto> {
    return this.tripMeals.removeMeal(
      authUser.id,
      id,
      authUser.id,
      dayIndex,
      kind,
    );
  }

  // ─────────────────────────── личная фасовка ───────────────────────────

  /** Новый личный пакет. */
  @Post(':id/my-meal-packages')
  @ApiOperation({ summary: 'Новый личный пакет' })
  @ApiOkResponse({ type: TripMealPlanDto })
  async createPackage(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripMealPlanDto> {
    return this.tripMeals.createPackage(authUser.id, id, authUser.id);
  }

  /** Имя личного пакета и фактический вес. */
  @Patch(':id/my-meal-packages/:packageId')
  @ApiOperation({ summary: 'Правка личного пакета' })
  @ApiOkResponse({ type: TripMealPlanDto })
  async updatePackage(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('packageId') packageId: string,
    @Body() dto: UpdateMealPackageDto,
  ): Promise<TripMealPlanDto> {
    return this.tripMeals.updatePackage(
      authUser.id,
      id,
      authUser.id,
      packageId,
      dto,
    );
  }

  /** Удалить личный пакет. */
  @Delete(':id/my-meal-packages/:packageId')
  @ApiOperation({ summary: 'Удалить личный пакет' })
  @ApiOkResponse({ type: TripMealPlanDto })
  async removePackage(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('packageId') packageId: string,
  ): Promise<TripMealPlanDto> {
    return this.tripMeals.removePackage(
      authUser.id,
      id,
      authUser.id,
      packageId,
    );
  }

  /** Доли личной строки по личным пакетам. */
  @Put(':id/my-meals/:dayIndex/:kind/allocations/:productId')
  @ApiOperation({ summary: 'Доли личной строки по пакетам' })
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
      authUser.id,
      dayIndex,
      kind,
      productId,
      dto.allocations,
    );
  }

  /** Кулёк личного приёма. */
  @Put(':id/my-meals/:dayIndex/:kind/kulek')
  @ApiOperation({ summary: 'Кулёк личного приёма' })
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
      authUser.id,
      dayIndex,
      kind,
      dto.enabled,
    );
  }

  // ─────────────────────────── личный чек-лист ───────────────────────────

  /** Личный список покупок: проекция моей раскладки и мои отметки. */
  @Get(':id/my-meal-checks')
  @ApiOperation({ summary: 'Мой список покупок' })
  @ApiOkResponse({ type: TripMealCheckListDto })
  async getChecklist(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripMealCheckListDto> {
    return this.tripMeals.getChecklist(authUser.id, id, authUser.id);
  }

  /** Отметки личного списка: куплено, домашнее, сколько куплено. */
  @Put(':id/my-meal-checks/:productId')
  @ApiOperation({ summary: 'Отметка личного списка покупок' })
  @ApiOkResponse({ type: TripMealCheckListDto })
  async updateCheck(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: UpdateMealCheckDto,
  ): Promise<TripMealCheckListDto> {
    return this.tripMeals.updateCheck(
      authUser.id,
      id,
      authUser.id,
      productId,
      dto,
    );
  }
}
