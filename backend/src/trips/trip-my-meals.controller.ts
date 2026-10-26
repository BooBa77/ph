import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
  AddMealLineDto,
  SetDishExclusionsDto,
  TripMealCheckListDto,
  TripMealPlanDto,
  UpdateMealCheckDto,
} from './dto/trip-meal.dto';
import type { TripMealKind } from './trip.types';
import { TripMealsService } from './trip-meals.service';

/**
 * «Моя еда»: личные блюда и продукты участника в плашке приёма.
 *
 * Отдельные маршруты, а не флаг в общих: личный слой — не часть общей
 * раскладки, и путать их в одном `:id/meals/...` значило бы каждый вызов
 * проверять, чей слой просят. Владелец всегда тот, кто делает запрос, —
 * перебирать id нечего.
 *
 * **Чего здесь намеренно нет.**Личная еда не фасуется: у неё нет пакетов,
 * долей и кулька — в рюкзак она уходит одной позицией «Продукты» с общим
 * весом. Нет и формы приёма с исключениями ингредиентов: в личном слое
 * это не с чем сравнивать, а UI их не показывает. Если модель поменяется,
 * маршруты вернутся — сервис умеет оба слоя.
 *
 * Права считает сервис: личную еду видит и правит только её владелец,
 * завхоз сюда не заходит.
 */
@ApiTags('trip-meals')
@Controller('trips')
export class TripMyMealsController {
  constructor(private readonly tripMeals: TripMealsService) {}

  /** Личная раскладка: мои блюда и продукты по дням и приёмам. */
  @Get(':id/my-meal-plan')
  @ApiOperation({ summary: 'Моя личная раскладка' })
  @ApiOkResponse({ type: TripMealPlanDto })
  async getPlan(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripMealPlanDto> {
    return this.tripMeals.getPlan(authUser.id, id, authUser.id);
  }

  /** Блюдо в мой приём: своё или общее из раскладки похода. */
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

  /** Убрать блюдо из моего приёма. */
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

  /** Исключить ингредиенты блюда в моём приёме: «это я не ем». */
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

  /** Продукт в мой приём: из справочника или своим названием. */
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

  /** Убрать продукт из моего приёма. */
  @Delete(':id/my-meals/:dayIndex/:kind/lines/:productId')
  @ApiOperation({ summary: 'Убрать продукт из личного приёма' })
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

  /** Мой список продуктов: проекция моей еды и мои отметки. */
  @Get(':id/my-meal-checks')
  @ApiOperation({ summary: 'Мой список продуктов' })
  @ApiOkResponse({ type: TripMealCheckListDto })
  async getChecklist(
    @CurrentUser() authUser: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TripMealCheckListDto> {
    return this.tripMeals.getChecklist(authUser.id, id, authUser.id);
  }

  /** Отметки моего списка: куплено, домашнее, сколько куплено. */
  @Put(':id/my-meal-checks/:productId')
  @ApiOperation({ summary: 'Отметка моего списка продуктов' })
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
