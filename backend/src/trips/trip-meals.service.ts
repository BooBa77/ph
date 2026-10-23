import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, In, type EntityManager } from 'typeorm';

import { DishIngredient } from '../meals/entities/dish-ingredient.entity';
import { Dish } from '../meals/entities/dish.entity';
import { Product } from '../meals/entities/product.entity';
import {
  TripEatersDto,
  TripMealAllocationDto,
  TripMealDishDto,
  TripMealDto,
  TripMealPackageDto,
  TripMealPackageItemDto,
  TripMealPlanDto,
  TripMealProductDto,
} from './dto/trip-meal.dto';
import { TripDateVariant } from './entities/trip-date-variant.entity';
import { TripMealAllocation } from './entities/trip-meal-allocation.entity';
import { TripMealDish } from './entities/trip-meal-dish.entity';
import { TripMealLine } from './entities/trip-meal-line.entity';
import { TripMealPackage } from './entities/trip-meal-package.entity';
import { TripMeal } from './entities/trip-meal.entity';
import { TripParticipant } from './entities/trip-participant.entity';
import { Trip } from './entities/trip.entity';
import {
  TRIP_MEAL_KINDS,
  type TripMealForm,
  type TripMealKind,
} from './trip.types';
import { TripsService } from './trips.service';

const DAY_MS = 86_400_000;

/** Строка продукта, собранная из рецептов и ручных строк одного приёма. */
interface ProductRow {
  product: Product;
  recipeAmount: number;
  manualAmount: number;
  isMeat: boolean;
  fromDishes: Set<string>;
}

/**
 * Раскладка и фасовка похода (`docs/ph/meals.md` §5).
 *
 * **Дни и приёмы.** День — свойство похода: у решённого это даты, у
 * «Планирую» — базовый срок прогноза. «Питание» открывается, только когда
 * есть конкретное число (`tabs.md` §7), поэтому у мечты и «Планирую» без
 * числа раскладки нет — 400, а не пустая таблица.
 *
 * **Строка раскладки собирается на чтении.** Рецепт блюда — на одного
 * человека; в походе количество = рецепт × едоков, мясное — × (едоков −
 * вегетарианцев). Ручные строки абсолютные. Хранимые количества были бы
 * копией, которая устаревает от смены состава, поэтому в базе только
 * источники.
 *
 * **Права.** Читает состав; правит тот, кому роль дала «Питание» (завхоз,
 * организатор). Отметки чек-листа — отдельная история (§5.5), здесь их нет.
 */
@Injectable()
export class TripMealsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly trips: TripsService,
  ) {}

  /** Раскладка и фасовка целиком. */
  async getPlan(userId: string, id: number): Promise<TripMealPlanDto> {
    const trip = await this.trips.getVisibleTrip(userId, id);
    const manager = this.dataSource.manager;

    await this.assertParticipant(manager, userId, trip);

    if (trip.status === 'idea') {
      throw new BadRequestException(
        'У мечты раскладки нет — переведите поход в «Планирую»',
      );
    }

    const dayCount = await this.dayCount(manager, trip);
    if (dayCount === 0) {
      throw new BadRequestException(
        trip.status === 'planning'
          ? 'Раскладка начнётся с конкретного числа: укажите день в прогнозе'
          : 'У похода нет продолжительности — раскладку не из чего считать',
      );
    }

    const eaters = await this.loadEaters(manager, trip);
    const meals = await this.loadMeals(manager, trip, eaters);
    const packages = await this.loadPackages(manager, trip, meals);

    return { dayCount, eaters, meals, packages };
  }

  /** Форма приёма: готовка или перекус. */
  async setForm(
    userId: string,
    id: number,
    dayIndex: number,
    kind: TripMealKind,
    form: TripMealForm,
  ): Promise<TripMealPlanDto> {
    await this.mutate(userId, id, async (manager, trip) => {
      await this.assertSlot(manager, trip, dayIndex, kind);
      const meal = await this.upsertMeal(manager, trip.id, dayIndex, kind);
      meal.form = form;
      await manager.save(meal);
    });

    return this.getPlan(userId, id);
  }

  /** Поставить своё блюдо в приём. */
  async addDish(
    userId: string,
    id: number,
    dayIndex: number,
    kind: TripMealKind,
    dishId: string,
  ): Promise<TripMealPlanDto> {
    await this.mutate(userId, id, async (manager, trip) => {
      await this.assertSlot(manager, trip, dayIndex, kind);

      const dish = await manager.findOne(Dish, { where: { id: dishId } });
      if (!dish) {
        throw new NotFoundException('Блюдо не найдено');
      }
      if (dish.ownerUserId !== userId) {
        throw new ForbiddenException(
          'В раскладку можно ставить только свои блюда: чужие не видны никому',
        );
      }

      const meal = await this.upsertMeal(manager, trip.id, dayIndex, kind);
      const exists = await manager.exists(TripMealDish, {
        where: { mealId: meal.id, dishId },
      });
      if (!exists) {
        await manager.insert(TripMealDish, { mealId: meal.id, dishId });
      }
    });

    return this.getPlan(userId, id);
  }

  /** Убрать блюдо из приёма. */
  async removeDish(
    userId: string,
    id: number,
    dayIndex: number,
    kind: TripMealKind,
    dishId: string,
  ): Promise<TripMealPlanDto> {
    await this.mutate(userId, id, async (manager, trip) => {
      const meal = await this.findMeal(manager, trip.id, dayIndex, kind);
      if (!meal) return;

      await manager.delete(TripMealDish, { mealId: meal.id, dishId });
      await this.cleanupMeal(manager, meal.id);
    });

    return this.getPlan(userId, id);
  }

  /** Ручная строка: «хлеб 600 г» — абсолютная, без мясного флага. */
  async setLine(
    userId: string,
    id: number,
    dayIndex: number,
    kind: TripMealKind,
    productId: number,
    amount: number,
  ): Promise<TripMealPlanDto> {
    await this.mutate(userId, id, async (manager, trip) => {
      await this.assertSlot(manager, trip, dayIndex, kind);

      const product = await manager.findOne(Product, {
        where: { id: productId },
      });
      if (!product) {
        throw new BadRequestException('Такого продукта нет в справочнике');
      }

      const meal = await this.upsertMeal(manager, trip.id, dayIndex, kind);
      const line = await manager.findOne(TripMealLine, {
        where: { mealId: meal.id, productId },
      });

      if (line) {
        line.amount = amount;
        await manager.save(line);
      } else {
        await manager.insert(TripMealLine, {
          mealId: meal.id,
          productId,
          amount,
        });
      }
    });

    return this.getPlan(userId, id);
  }

  /** Убрать ручную строку. */
  async removeLine(
    userId: string,
    id: number,
    dayIndex: number,
    kind: TripMealKind,
    productId: number,
  ): Promise<TripMealPlanDto> {
    await this.mutate(userId, id, async (manager, trip) => {
      const meal = await this.findMeal(manager, trip.id, dayIndex, kind);
      if (!meal) return;

      await manager.delete(TripMealLine, { mealId: meal.id, productId });
      await this.cleanupMeal(manager, meal.id);
    });

    return this.getPlan(userId, id);
  }

  /** Убрать приём целиком. */
  async removeMeal(
    userId: string,
    id: number,
    dayIndex: number,
    kind: TripMealKind,
  ): Promise<TripMealPlanDto> {
    await this.mutate(userId, id, async (manager, trip) => {
      const meal = await this.findMeal(manager, trip.id, dayIndex, kind);
      if (meal) {
        await manager.delete(TripMeal, { id: meal.id });
      }
    });

    return this.getPlan(userId, id);
  }

  // ─────────────────────────── доступ ───────────────────────────

  /** Раскладку видит состав; посторонний не видит даже, что она есть. */
  private async assertParticipant(
    manager: EntityManager,
    userId: string,
    trip: Trip,
  ): Promise<void> {
    if (trip.organizerUserId === userId) return;

    const exists = await manager.exists(TripParticipant, {
      where: { tripId: trip.id, userId },
    });
    if (!exists) {
      throw new ForbiddenException('Питание доступно только составу похода');
    }
  }

  private async mutate(
    userId: string,
    id: number,
    work: (manager: EntityManager, trip: Trip) => Promise<void>,
  ): Promise<void> {
    const trip = await this.trips.getVisibleTrip(userId, id);

    const canEdit = await this.trips.canEditTab(userId, trip, 'meals');
    if (!canEdit) {
      throw new ForbiddenException('Раскладку правит завхоз или организатор');
    }

    await this.dataSource.transaction(async (manager) => {
      await work(manager, trip);
    });
  }

  // ─────────────────────────── дни и приёмы ───────────────────────────

  /**
   * Сколько дней в походе.
   *
   * «Решено» — по датам (обе границы включительно); «Планирую» — базовый
   * срок прогноза, но только когда есть конкретное число: без числа
   * подготовка ещё не началась. «Мечта» — 0, раскладки нет.
   */
  private async dayCount(
    manager: EntityManager,
    trip: Trip,
  ): Promise<number> {
    if (trip.status === 'idea') return 0;

    if (trip.status === 'decided') {
      if (!trip.startsAt || !trip.endsAt) return 0;
      const days =
        Math.floor(
          (trip.endsAt.getTime() - trip.startsAt.getTime()) / DAY_MS,
        ) + 1;

      return Math.max(1, days);
    }

    const variants = await manager.find(TripDateVariant, {
      where: { tripId: trip.id },
      order: { id: 'ASC' },
    });
    if (!variants.some((variant) => variant.day !== null)) return 0;

    return (
      variants.find((variant) => variant.durationDays !== null)?.durationDays ??
      0
    );
  }

  private async assertSlot(
    manager: EntityManager,
    trip: Trip,
    dayIndex: number,
    kind: TripMealKind,
  ): Promise<void> {
    if (!TRIP_MEAL_KINDS.includes(kind)) {
      throw new BadRequestException('Приём — завтрак, обед или ужин');
    }

    const days = await this.dayCount(manager, trip);
    if (days === 0) {
      throw new BadRequestException(
        'Раскладка начнётся, когда у похода появятся дни: конкретное число и продолжительность',
      );
    }
    if (!Number.isInteger(dayIndex) || dayIndex < 1 || dayIndex > days) {
      throw new BadRequestException('День вне похода');
    }
  }

  private async findMeal(
    manager: EntityManager,
    tripId: string,
    dayIndex: number,
    kind: TripMealKind,
  ): Promise<TripMeal | null> {
    return manager.findOne(TripMeal, {
      where: { tripId, dayIndex, kind },
    });
  }

  private async upsertMeal(
    manager: EntityManager,
    tripId: string,
    dayIndex: number,
    kind: TripMealKind,
  ): Promise<TripMeal> {
    const existing = await this.findMeal(manager, tripId, dayIndex, kind);
    if (existing) return existing;

    return manager.save(
      manager.create(TripMeal, { tripId, dayIndex, kind }),
    );
  }

  /**
   * Приём без данных не нужен: уходит вместе с последним блюдом или
   * строкой. Кулёк-пакет — тоже данные: пока он есть, приём живёт.
   */
  private async cleanupMeal(
    manager: EntityManager,
    mealId: string,
  ): Promise<void> {
    const dishes = await manager.count(TripMealDish, {
      where: { mealId },
    });
    const lines = await manager.count(TripMealLine, { where: { mealId } });
    const packages = await manager.count(TripMealPackage, {
      where: { mealId },
    });

    if (dishes === 0 && lines === 0 && packages === 0) {
      await manager.delete(TripMeal, { id: mealId });
    }
  }

  // ─────────────────────────── чтение ───────────────────────────

  private async loadEaters(
    manager: EntityManager,
    trip: Trip,
  ): Promise<TripEatersDto> {
    const rows = await manager.find(TripParticipant, {
      where: { tripId: trip.id, status: 'going' },
      relations: { user: true },
      order: { createdAt: 'ASC' },
    });

    const people = rows.map((participant) => ({
      userId: participant.userId,
      displayName: participant.user?.displayName ?? 'Неизвестный',
      avatarUrl: participant.user?.avatarUrl ?? null,
      gender: participant.user?.gender ?? 'm',
      isVegetarian: participant.user?.isVegetarian ?? false,
      allergies: participant.user?.allergies ?? null,
      eatsSeparately: participant.eatsSeparately,
    }));

    // Отдельное питание — не едок: не в М/Ж, не в вегетарианцах.
    const eaters = people.filter((person) => !person.eatsSeparately);

    return {
      total: eaters.length,
      men: eaters.filter((person) => person.gender === 'm').length,
      women: eaters.filter((person) => person.gender === 'f').length,
      vegetarians: eaters.filter((person) => person.isVegetarian).length,
      people,
    };
  }

  private async loadMeals(
    manager: EntityManager,
    trip: Trip,
    eaters: TripEatersDto,
  ): Promise<TripMealDto[]> {
    const meals = await manager.find(TripMeal, {
      where: { tripId: trip.id },
      order: { dayIndex: 'ASC', kind: 'ASC' },
    });
    if (meals.length === 0) return [];

    const mealIds = meals.map((meal) => meal.id);

    const dishes = await manager.find(TripMealDish, {
      where: { mealId: In(mealIds) },
      relations: { dish: true },
      order: { id: 'ASC' },
    });
    const dishIds = [...new Set(dishes.map((row) => row.dishId))];
    const ingredients = dishIds.length
      ? await manager.find(DishIngredient, {
          where: { dishId: In(dishIds) },
          relations: { product: true },
          order: { id: 'ASC' },
        })
      : [];

    const lines = await manager.find(TripMealLine, {
      where: { mealId: In(mealIds) },
      relations: { product: true },
    });

    const allocations = await manager.find(TripMealAllocation, {
      where: { mealId: In(mealIds) },
    });

    const ingredientsByDish = new Map<number, DishIngredient[]>();
    for (const ingredient of ingredients) {
      const list = ingredientsByDish.get(Number(ingredient.dishId)) ?? [];
      list.push(ingredient);
      ingredientsByDish.set(Number(ingredient.dishId), list);
    }

    return meals.map((meal) =>
      this.buildMeal(meal, {
        dishes: dishes.filter((row) => row.mealId === meal.id),
        ingredientsByDish,
        lines: lines.filter((row) => row.mealId === meal.id),
        allocations: allocations.filter((row) => row.mealId === meal.id),
        eaters,
      }),
    );
  }

  private buildMeal(
    meal: TripMeal,
    data: {
      dishes: TripMealDish[];
      ingredientsByDish: Map<number, DishIngredient[]>;
      lines: TripMealLine[];
      allocations: TripMealAllocation[];
      eaters: TripEatersDto;
    },
  ): TripMealDto {
    const products = new Map<number, ProductRow>();
    const dishDtos: TripMealDishDto[] = [];

    for (const row of data.dishes) {
      const dish = row.dish;
      const ingredients = data.ingredientsByDish.get(Number(dish.id)) ?? [];

      dishDtos.push({
        dishId: dish.id,
        title: dish.title,
        ingredients: ingredients.map((ingredient) => ({
          productId: ingredient.productId,
          name: ingredient.product.name,
          unit: ingredient.product.unit,
          amount: ingredient.amount,
          isMeat: ingredient.isMeat,
        })),
      });

      for (const ingredient of ingredients) {
        const portion = ingredient.isMeat
          ? Math.max(0, data.eaters.total - data.eaters.vegetarians)
          : data.eaters.total;
        const recipeAmount = ingredient.amount * portion;

        const product = products.get(ingredient.productId) ?? {
          product: ingredient.product,
          recipeAmount: 0,
          manualAmount: 0,
          isMeat: false,
          fromDishes: new Set<string>(),
        };

        product.recipeAmount += recipeAmount;
        product.isMeat = product.isMeat || ingredient.isMeat;
        product.fromDishes.add(dish.title);
        products.set(ingredient.productId, product);
      }
    }

    for (const line of data.lines) {
      const product = products.get(line.productId) ?? {
        product: line.product,
        recipeAmount: 0,
        manualAmount: 0,
        isMeat: false,
        fromDishes: new Set<string>(),
      };

      product.manualAmount += line.amount;
      products.set(line.productId, product);
    }

    const allocationsByProduct = new Map<number, TripMealAllocation[]>();
    for (const allocation of data.allocations) {
      const list = allocationsByProduct.get(allocation.productId) ?? [];
      list.push(allocation);
      allocationsByProduct.set(allocation.productId, list);
    }

    const productDtos: TripMealProductDto[] = [...products.values()]
      .sort((left, right) => left.product.name.localeCompare(right.product.name))
      .map((row) => {
        const amount = row.recipeAmount + row.manualAmount;
        const rows = allocationsByProduct.get(row.product.id) ?? [];
        const fixed = rows
          .filter((allocation) => !allocation.isElastic)
          .reduce((sum, allocation) => sum + allocation.amount, 0);

        const allocations: TripMealAllocationDto[] = rows.map((allocation) => ({
          packageId: allocation.packageId,
          // У «всё» хранится 0: остаток считается от количества, иначе
          // он устаревал бы от каждой смены состава.
          amount: allocation.isElastic
            ? Math.max(0, amount - fixed)
            : allocation.amount,
          isElastic: allocation.isElastic,
        }));

        return {
          productId: row.product.id,
          name: row.product.name,
          unit: row.product.unit,
          weightPerUnitGrams: row.product.weightPerUnitGrams,
          recipeAmount: row.recipeAmount,
          manualAmount: row.manualAmount,
          amount,
          isMeat: row.isMeat,
          fromDishes: [...row.fromDishes],
          allocations,
        };
      });

    return {
      id: meal.id,
      dayIndex: meal.dayIndex,
      kind: meal.kind,
      form: meal.form,
      dishes: dishDtos,
      products: productDtos,
      weightGrams: productDtos.reduce(
        (sum, product) => sum + product.amount * product.weightPerUnitGrams,
        0,
      ),
    };
  }

  private async loadPackages(
    manager: EntityManager,
    trip: Trip,
    meals: TripMealDto[],
  ): Promise<TripMealPackageDto[]> {
    const packages = await manager.find(TripMealPackage, {
      where: { tripId: trip.id },
      order: { id: 'ASC' },
    });
    if (packages.length === 0) return [];

    const mealById = new Map(meals.map((meal) => [meal.id, meal]));
    const productByKey = new Map<string, TripMealProductDto>();
    for (const meal of meals) {
      for (const product of meal.products) {
        productByKey.set(`${meal.id}:${product.productId}`, product);
      }
    }

    const allocations = meals.length
      ? await manager.find(TripMealAllocation, {
          where: { mealId: In(meals.map((meal) => meal.id)) },
        })
      : [];

    const itemsByPackage = new Map<string, TripMealPackageItemDto[]>();
    for (const allocation of allocations) {
      const meal = mealById.get(allocation.mealId);
      const product = productByKey.get(
        `${allocation.mealId}:${allocation.productId}`,
      );
      if (!meal || !product) continue;

      const share = product.allocations.find(
        (row) => row.packageId === allocation.packageId,
      );
      const amount = share?.amount ?? 0;

      const items = itemsByPackage.get(allocation.packageId) ?? [];
      items.push({
        mealId: allocation.mealId,
        dayIndex: meal.dayIndex,
        kind: meal.kind,
        productId: allocation.productId,
        name: product.name,
        amount,
        isElastic: allocation.isElastic,
        weightGrams: amount * product.weightPerUnitGrams,
      });
      itemsByPackage.set(allocation.packageId, items);
    }

    return packages.map((row) => {
      const items = itemsByPackage.get(row.id) ?? [];

      return {
        id: row.id,
        name: row.name,
        kind: row.kind,
        mealId: row.mealId,
        weightActualGrams: row.weightActualGrams,
        weightActualStale: row.weightActualStale,
        weightEstimatedGrams: items.reduce(
          (sum, item) => sum + item.weightGrams,
          0,
        ),
        items,
      };
    });
  }
}
