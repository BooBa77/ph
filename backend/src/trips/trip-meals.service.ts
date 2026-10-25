import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DataSource,
  In,
  IsNull,
  Not,
  type EntityManager,
  type FindOperator,
  type FindOptionsWhere,
} from 'typeorm';

import { DishIngredient } from '../meals/entities/dish-ingredient.entity';
import type { ProductUnit } from '../meals/meal.types';
import { Dish } from '../meals/entities/dish.entity';
import { Product } from '../meals/entities/product.entity';
import {
  TripEatersDto,
  TripMealAllocationDto,
  TripMealCheckDto,
  TripMealCheckListDto,
  TripMealDishDto,
  TripMealDto,
  TripMealPackageDto,
  TripMealPackageItemDto,
  TripMealPlanDto,
  TripMealProductDto,
} from './dto/trip-meal.dto';
import { TripDateVariant } from './entities/trip-date-variant.entity';
import { TripMealAllocation } from './entities/trip-meal-allocation.entity';
import { TripMealCheck } from './entities/trip-meal-check.entity';
import { TripMealDishExclusion } from './entities/trip-meal-dish-exclusion.entity';
import { TripMealDish } from './entities/trip-meal-dish.entity';
import { TripMealLine } from './entities/trip-meal-line.entity';
import { TripMealPackage } from './entities/trip-meal-package.entity';
import { TripMeal } from './entities/trip-meal.entity';
import { TripParticipant } from './entities/trip-participant.entity';
import { TripProduct } from './entities/trip-product.entity';
import { Trip } from './entities/trip.entity';
import {
  TRIP_MEAL_KINDS,
  type TripMealForm,
  type TripMealKind,
} from './trip.types';
import { TripsService } from './trips.service';

const DAY_MS = 86_400_000;

/**
 * Чей слой еды: `null` — общая раскладка похода, uuid — личная еда
 * участника, который питается отдельно.
 *
 * Один и тот же код собирает оба слоя: правила раскладки, фасовки и
 * кулька одинаковые, разница только в том, чьи приёмы, пакеты, продукты
 * и отметки чек-листа читаются. Два набора копий однажды разошлись бы.
 */
type MealOwner = string | null;

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
  async getPlan(
    userId: string,
    id: number,
    owner: MealOwner = null,
  ): Promise<TripMealPlanDto> {
    const trip = await this.trips.getVisibleTrip(userId, id);
    const manager = this.dataSource.manager;

    await this.assertParticipant(manager, userId, trip);
    // Личная еда — личное дело: чужой слой не читает даже завхоз.
    if (owner !== null && owner !== userId) {
      throw new ForbiddenException('Личная еда участника видна только ему');
    }

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

    const eaters =
      owner === null
        ? await this.loadEaters(manager, trip)
        : await this.loadOwnerEater(manager, trip, owner);
    const meals = await this.loadMeals(manager, trip, eaters, owner);
    const packages = await this.loadPackages(manager, trip, meals, owner);

    return { dayCount, eaters, meals, packages };
  }

  /** Форма приёма: готовка или перекус. */
  async setForm(
    userId: string,
    id: number,
    owner: MealOwner = null,
    dayIndex: number,
    kind: TripMealKind,
    form: TripMealForm,
  ): Promise<TripMealPlanDto> {
    await this.mutate(userId, id, owner, async (manager, trip) => {
      await this.assertSlot(manager, trip, dayIndex, kind);
      const meal = await this.upsertMeal(manager, trip.id, dayIndex, kind, owner);
      meal.form = form;
      await manager.save(meal);
    });

    return this.getPlan(userId, id, owner);
  }

  /**
   * Поставить блюдо в приём.
   *
   * В общую раскладку — только своё блюдо: чужие не видны никому.
   * В личную — своё или **общее**, то есть блюдо, которое уже стоит
   * в общей раскладке похода: участник, питающийся отдельно, берёт
   * рецепт у группы, а не заводит его заново. Остальные чужие блюда
   * не ставятся — 403, как и в общей раскладке.
   */
  async addDish(
    userId: string,
    id: number,
    owner: MealOwner = null,
    dayIndex: number,
    kind: TripMealKind,
    dishId: string,
  ): Promise<TripMealPlanDto> {
    await this.mutate(userId, id, owner, async (manager, trip) => {
      await this.assertSlot(manager, trip, dayIndex, kind);

      const dish = await manager.findOne(Dish, { where: { id: dishId } });
      if (!dish) {
        throw new NotFoundException('Блюдо не найдено');
      }
      if (dish.ownerUserId !== userId) {
        const shared =
          owner !== null &&
          (await this.isDishInCommonPlan(manager, trip.id, dishId));
        if (!shared) {
          throw new ForbiddenException(
            'В раскладку можно ставить только свои блюда: чужие не видны никому',
          );
        }
      }

      const meal = await this.upsertMeal(manager, trip.id, dayIndex, kind, owner);
      const exists = await manager.exists(TripMealDish, {
        where: { mealId: meal.id, dishId },
      });
      if (!exists) {
        await manager.insert(TripMealDish, { mealId: meal.id, dishId });
        // Ингредиенты блюда живут в справочнике, а план похода — автономен:
        // копируем их в поход, иначе блюдо нечего фасовать. В личной еде
        // копии личные: чужая раскладка от них не меняется.
        await this.materializeDishProducts(manager, trip.id, [dishId], owner);
        await this.syncKulekForMeal(manager, meal);
      }
    });

    return this.getPlan(userId, id, owner);
  }

  /** Убрать блюдо из приёма. */
  async removeDish(
    userId: string,
    id: number,
    owner: MealOwner = null,
    dayIndex: number,
    kind: TripMealKind,
    dishId: string,
  ): Promise<TripMealPlanDto> {
    await this.mutate(userId, id, owner, async (manager, trip) => {
      const meal = await this.findMeal(manager, trip.id, dayIndex, kind, owner);
      if (!meal) return;

      await manager.delete(TripMealDish, { mealId: meal.id, dishId });
      await this.cleanupAllocations(manager, meal);
      await this.markMealPackagesStale(manager, meal.id);
      await this.cleanupMeal(manager, meal.id);
    });

    return this.getPlan(userId, id, owner);
  }

  /** Ручная строка: «хлеб 600 г» — абсолютная, без мясного флага. */
  async setLine(
    userId: string,
    id: number,
    owner: MealOwner = null,
    dayIndex: number,
    kind: TripMealKind,
    productId: number,
    amount: number,
  ): Promise<TripMealPlanDto> {
    await this.mutate(userId, id, owner, async (manager, trip) => {
      await this.assertSlot(manager, trip, dayIndex, kind);

      const product = await manager.findOne(TripProduct, {
        where: { id: productId, tripId: trip.id },
      });
      if (!product) {
        throw new BadRequestException('Такого продукта нет в этом походе');
      }
      if (!this.productAllowed(product, owner)) {
        throw new BadRequestException(
          'Личный продукт другого участника в план не поставить',
        );
      }

      const meal = await this.upsertMeal(manager, trip.id, dayIndex, kind, owner);
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

      await this.syncKulekForMeal(manager, meal);
    });

    return this.getPlan(userId, id, owner);
  }

  /**
   * Добавить продукт в приём по названию.
   *
   * Справочник — только источник подсказок: выбрали «тушёнку» — её имя,
   * единица и вес копируются в поход; ввели «траву» — в походе появляется
   * свой продукт, справочник не трогаем. Один вызов вместо «создай
   * продукт, потом поставь строку».
   */
  async addLineByName(
    userId: string,
    id: number,
    owner: MealOwner = null,
    dayIndex: number,
    kind: TripMealKind,
    dto: {
      amount: number;
      name?: string;
      catalogProductId?: number;
      unit?: ProductUnit;
      weightPerUnitGrams?: number;
    },
  ): Promise<TripMealPlanDto> {
    await this.mutate(userId, id, owner, async (manager, trip) => {
      await this.assertSlot(manager, trip, dayIndex, kind);

      let sample: {
        name: string;
        unit: ProductUnit;
        weightPerUnitGrams: number;
      } | null = null;

      if (dto.catalogProductId !== undefined) {
        const catalog = await manager.findOne(Product, {
          where: { id: dto.catalogProductId, tripId: IsNull() },
        });
        if (!catalog) {
          throw new BadRequestException('Такого продукта нет в справочнике');
        }

        sample = {
          name: catalog.name,
          unit: catalog.unit,
          weightPerUnitGrams: catalog.weightPerUnitGrams,
        };
      } else if (dto.name && dto.name.trim().length > 0) {
        sample = {
          name: dto.name.trim(),
          unit: dto.unit ?? 'piece',
          weightPerUnitGrams: dto.weightPerUnitGrams ?? 0,
        };
      }

      if (!sample) {
        throw new BadRequestException(
          'Нужно название продукта или продукт из справочника',
        );
      }

      const product = await this.ensureTripProduct(
        manager,
        trip.id,
        sample,
        owner,
      );
      const meal = await this.upsertMeal(manager, trip.id, dayIndex, kind, owner);
      const line = await manager.findOne(TripMealLine, {
        where: { mealId: meal.id, productId: product.id },
      });

      if (line) {
        line.amount = dto.amount;
        await manager.save(line);
      } else {
        await manager.insert(TripMealLine, {
          mealId: meal.id,
          productId: product.id,
          amount: dto.amount,
        });
      }

      await this.syncKulekForMeal(manager, meal);
    });

    return this.getPlan(userId, id, owner);
  }

  /** Убрать ручную строку. */
  async removeLine(
    userId: string,
    id: number,
    owner: MealOwner = null,
    dayIndex: number,
    kind: TripMealKind,
    productId: number,
  ): Promise<TripMealPlanDto> {
    await this.mutate(userId, id, owner, async (manager, trip) => {
      const meal = await this.findMeal(manager, trip.id, dayIndex, kind, owner);
      if (!meal) return;

      await manager.delete(TripMealLine, { mealId: meal.id, productId });
      await this.cleanupAllocations(manager, meal);
      await this.markMealPackagesStale(manager, meal.id);
      await this.cleanupMeal(manager, meal.id);
    });

    return this.getPlan(userId, id, owner);
  }

  /** Убрать приём целиком. */
  async removeMeal(
    userId: string,
    id: number,
    owner: MealOwner = null,
    dayIndex: number,
    kind: TripMealKind,
  ): Promise<TripMealPlanDto> {
    await this.mutate(userId, id, owner, async (manager, trip) => {
      const meal = await this.findMeal(manager, trip.id, dayIndex, kind, owner);
      if (meal) {
        await manager.delete(TripMeal, { id: meal.id });
      }
    });

    return this.getPlan(userId, id, owner);
  }

  // ─────────────────────────── фасовка ───────────────────────────

  /**
   * Новый пакет. Имя по умолчанию «Пакет N»; пустой пакет создать можно —
   * завхоз заводит тару заранее.
   */
  async createPackage(
    userId: string,
    id: number,
    owner: MealOwner = null,
  ): Promise<TripMealPlanDto> {
    await this.mutate(userId, id, owner, async (manager, trip) => {
      const name = await this.nextPackageName(manager, trip.id, owner);
      await manager.insert(TripMealPackage, {
        tripId: trip.id,
        name,
        kind: 'normal',
        eaterUserId: owner,
      });
    });

    return this.getPlan(userId, id, owner);
  }

  /** Имя пакета и фактический вес после взвешивания. */
  async updatePackage(
    userId: string,
    id: number,
    owner: MealOwner = null,
    packageId: string,
    dto: { name?: string; weightActualGrams?: number | null },
  ): Promise<TripMealPlanDto> {
    await this.mutate(userId, id, owner, async (manager, trip) => {
      const pack = await this.findPackage(manager, trip.id, packageId, owner);

      if (dto.name !== undefined) {
        const name = dto.name.trim();
        if (!name) {
          throw new BadRequestException('Имя пакета не может быть пустым');
        }
        if (name !== pack.name) {
          const clash = await manager.exists(TripMealPackage, {
            where: {
              tripId: trip.id,
              name,
              eaterUserId: this.layerOf(owner),
            },
          });
          if (clash) {
            throw new ConflictException('Пакет с таким именем уже есть');
          }
        }
        pack.name = name;
      }

      if (dto.weightActualGrams !== undefined) {
        pack.weightActualGrams = dto.weightActualGrams;
        // Взвесили заново — метка «перевесить» снимается.
        pack.weightActualStale = false;
      }

      await manager.save(pack);
    });

    return this.getPlan(userId, id, owner);
  }

  /** Удаление пакета обнуляет его доли: они уходят каскадом. */
  async removePackage(
    userId: string,
    id: number,
    owner: MealOwner = null,
    packageId: string,
  ): Promise<TripMealPlanDto> {
    await this.mutate(userId, id, owner, async (manager, trip) => {
      const pack = await this.findPackage(manager, trip.id, packageId, owner);
      await manager.delete(TripMealPackage, { id: pack.id });
    });

    return this.getPlan(userId, id, owner);
  }

  /**
   * Доли строки раскладки: список заменяет прежние.
   *
   * Фиксированных долей сколько угодно, «всё» — не больше одной. Эластичная
   * забирает остаток и следует за изменением количества. «Всё» на всю
   * строку — это та же эластичная одна: интерфейс, выбрав «всё», присылает
   * только её, и прежние доли этим же списком снимаются.
   */
  async setAllocations(
    userId: string,
    id: number,
    owner: MealOwner = null,
    dayIndex: number,
    kind: TripMealKind,
    productId: number,
    allocations: { packageId: string; amount: number; isElastic?: boolean }[],
  ): Promise<TripMealPlanDto> {
    await this.mutate(userId, id, owner, async (manager, trip) => {
      const meal = await this.findMeal(manager, trip.id, dayIndex, kind, owner);
      if (!meal) {
        throw new NotFoundException('В приёме пока нет строк');
      }

      const kulek = await manager.findOne(TripMealPackage, {
        where: { mealId: meal.id, kind: 'kulek' },
      });
      if (kulek) {
        // Ручная фасовка расформировывает кулёк: доли уходят, остаётся
        // «не расфасовано» — раскладывать заново, как хочет завхоз.
        await manager.delete(TripMealAllocation, { packageId: kulek.id });
        await manager.delete(TripMealPackage, { id: kulek.id });
      }

      const productIds = await this.mealProductIds(manager, meal);
      if (!productIds.includes(productId)) {
        throw new NotFoundException('Такой строки в приёме нет');
      }

      const elastic = allocations.filter((row) => row.isElastic);
      if (elastic.length > 1) {
        throw new BadRequestException('Эластичная «всё» — одна на строку');
      }

      const rows = allocations;
      const packageIds = [...new Set(rows.map((row) => row.packageId))];
      if (packageIds.length > 0) {
        // Пакет того же слоя: общая строка не уезжает в личную тару
        // и наоборот, иначе пакет участника повис бы на общей еде.
        const packs = await manager.find(TripMealPackage, {
          where: {
            id: In(packageIds),
            tripId: trip.id,
            eaterUserId: this.layerOf(owner),
          },
        });
        if (packs.length !== packageIds.length) {
          throw new BadRequestException(
            owner === null
              ? 'Пакет не из этого похода'
              : 'Пакет из чужого списка',
          );
        }
      }

      const previous = await manager.find(TripMealAllocation, {
        where: { mealId: meal.id, productId },
        select: { packageId: true },
      });

      await manager.delete(TripMealAllocation, { mealId: meal.id, productId });

      for (const row of rows) {
        await manager.insert(TripMealAllocation, {
          mealId: meal.id,
          productId,
          packageId: row.packageId,
          amount: row.isElastic ? 0 : row.amount,
          isElastic: row.isElastic ?? false,
        });
      }

      await this.markMealPackagesStale(manager, meal.id, [
        ...previous.map((row) => row.packageId),
        ...packageIds,
      ]);
    });

    return this.getPlan(userId, id, owner);
  }

  /**
   * Кулёк приёма: все продукты, включая соль, — в пакет с кодом «3з».
   *
   * Включение добавляет пакет и эластичные доли на каждый продукт приёма;
   * новые строки приёма тоже уходят в кулёк (`syncKulekForMeal`).
   * Выключение удаляет пакет, доли уходят каскадом.
   */
  async setKulek(
    userId: string,
    id: number,
    owner: MealOwner = null,
    dayIndex: number,
    kind: TripMealKind,
    enabled: boolean,
  ): Promise<TripMealPlanDto> {
    await this.mutate(userId, id, owner, async (manager, trip) => {
      const meal = enabled
        ? await this.upsertMeal(manager, trip.id, dayIndex, kind, owner)
        : await this.findMeal(manager, trip.id, dayIndex, kind, owner);
      if (!meal) return;

      const kulek = await manager.findOne(TripMealPackage, {
        where: { mealId: meal.id, kind: 'kulek' },
      });

      if (enabled) {
        if (kulek) return;

        const base = this.kulekName(dayIndex, kind);
        const clash = await manager.exists(TripMealPackage, {
          where: {
            tripId: trip.id,
            name: base,
            eaterUserId: this.layerOf(owner),
          },
        });
        const pack = await manager.save(
          manager.create(TripMealPackage, {
            tripId: trip.id,
            name: clash ? `${base} (${meal.id})` : base,
            kind: 'kulek',
            mealId: meal.id,
            eaterUserId: owner,
          }),
        );
        await this.syncKulek(manager, meal, pack);
      } else if (kulek) {
        await manager.delete(TripMealPackage, { id: kulek.id });
        await this.cleanupMeal(manager, meal.id);
      }
    });

    return this.getPlan(userId, id, owner);
  }

  private async findPackage(
    manager: EntityManager,
    tripId: string,
    packageId: string,
    owner: MealOwner,
  ): Promise<TripMealPackage> {
    const pack = await manager.findOne(TripMealPackage, {
      where: {
        id: packageId,
        tripId,
        eaterUserId: this.layerOf(owner),
      },
    });
    if (!pack) {
      throw new NotFoundException('Пакет не найден');
    }

    return pack;
  }

  private async nextPackageName(
    manager: EntityManager,
    tripId: string,
    owner: MealOwner,
  ): Promise<string> {
    const rows = await manager.find(TripMealPackage, {
      where: { tripId, eaterUserId: this.layerOf(owner) },
      select: { name: true },
    });

    let max = 0;
    for (const row of rows) {
      const match = /^Пакет (\d+)$/.exec(row.name);
      if (match) max = Math.max(max, Number(match[1]));
    }

    return `Пакет ${max + 1}`;
  }

  private kulekName(dayIndex: number, kind: TripMealKind): string {
    const letter: Record<TripMealKind, string> = {
      breakfast: 'з',
      lunch: 'о',
      dinner: 'у',
    };

    return `${dayIndex}${letter[kind]}`;
  }

  /** Продукты приёма: из блюд и из ручных строк. */
  private async mealProductIds(
    manager: EntityManager,
    meal: TripMeal,
  ): Promise<number[]> {
    const dishes = await manager.find(TripMealDish, {
      where: { mealId: meal.id },
    });
    const dishIds = dishes.map((row) => row.dishId);
    const ingredients = dishIds.length
      ? await manager.find(DishIngredient, {
          where: { dishId: In(dishIds) },
          relations: { product: true },
        })
      : [];
    const mealDishIds = dishes.map((row) => row.id);
    const exclusions = mealDishIds.length
      ? await manager.find(TripMealDishExclusion, {
          where: { mealDishId: In(mealDishIds) },
        })
      : [];
    const excluded = new Set(exclusions.map((row) => row.productId));

    const lines = await manager.find(TripMealLine, {
      where: { mealId: meal.id },
    });

    // Рецепт ссылается на справочник, а план — на продукт похода: пара
    // «справочник → поход» строится по имени, имена там одинаковые.
    const idByName = await this.tripProductIdsByName(
      manager,
      meal.tripId,
      meal.eaterUserId,
    );

    const fromDishes = ingredients
      .map((ingredient) => idByName.get(ingredient.product.name))
      .filter((productId): productId is number => productId !== undefined)
      .filter((productId) => !excluded.has(productId));

    return [...new Set([...fromDishes, ...lines.map((line) => line.productId)])];
  }

  /**
   * Карта «имя продукта → id продукта похода» для слоя.
   *
   * В личном слое видно и общее: свой продукт с тем же именем важнее
   * общего — так личная «Гречка» не путается с общей.
   */
  private async tripProductIdsByName(
    manager: EntityManager,
    tripId: string,
    owner: MealOwner,
  ): Promise<Map<string, number>> {
    const products = await manager.find(TripProduct, {
      where: this.productScope(tripId, owner),
    });

    const map = new Map<string, number>();
    for (const product of products) {
      if (product.ownerUserId === null) map.set(product.name, product.id);
    }
    for (const product of products) {
      if (product.ownerUserId !== null) map.set(product.name, product.id);
    }

    return map;
  }

  /**
   * Продукт похода по образцу справочника.
   *
   * Это и есть «скопировать, а не сослаться»: имя, единица и вес
   * переписываются в поход, дальше справочник ему не указ.
   *
   * В личном слое сначала ищется свой продукт того же имени, потом общий:
   * «Гречка» не должна раздваиваться на два мешка в одном рюкзаке.
   */
  private async ensureTripProduct(
    manager: EntityManager,
    tripId: string,
    sample: { name: string; unit: ProductUnit; weightPerUnitGrams: number },
    owner: MealOwner,
  ): Promise<TripProduct> {
    const name = sample.name.trim();

    const existing = await manager.findOne(TripProduct, {
      where: { tripId, name, ownerUserId: this.layerOf(owner) },
    });
    if (existing) return existing;

    if (owner !== null) {
      const common = await manager.findOne(TripProduct, {
        where: { tripId, name, ownerUserId: IsNull() },
      });
      if (common) return common;
    }

    return manager.save(
      manager.create(TripProduct, {
        tripId,
        ownerUserId: owner,
        name,
        unit: sample.unit,
        weightPerUnitGrams: sample.weightPerUnitGrams,
      }),
    );
  }

  /** Ингредиенты блюда переезжают в поход копиями, когда блюдо ставят в приём. */
  private async materializeDishProducts(
    manager: EntityManager,
    tripId: string,
    dishIds: string[],
    owner: MealOwner,
  ): Promise<void> {
    if (dishIds.length === 0) return;

    const ingredients = await manager.find(DishIngredient, {
      where: { dishId: In(dishIds) },
      relations: { product: true },
    });

    for (const ingredient of ingredients) {
      await this.ensureTripProduct(
        manager,
        tripId,
        {
          name: ingredient.product.name,
          unit: ingredient.product.unit,
          weightPerUnitGrams: ingredient.product.weightPerUnitGrams,
        },
        owner,
      );
    }
  }

  /** Эластичные доли кулька на продукты, которых в нём ещё нет. */
  private async syncKulek(
    manager: EntityManager,
    meal: TripMeal,
    pack: TripMealPackage,
  ): Promise<void> {
    const productIds = await this.mealProductIds(manager, meal);

    // Всё, что лежало в других пакетах, переезжает в кулёк: продукт
    // схлопывается в одну долю, а не остаётся размазанным по пакетам.
    await manager.delete(TripMealAllocation, {
      mealId: meal.id,
      packageId: Not(pack.id),
    });

    for (const productId of productIds) {

      await manager
        .createQueryBuilder()
        .insert()
        .into(TripMealAllocation)
        .values({
          mealId: meal.id,
          productId,
          packageId: pack.id,
          amount: 0,
          isElastic: true,
        })
        .orIgnore()
        .execute();
    }
  }

  /** После правки приёма новые продукты попадают в кулёк. */
  private async syncKulekForMeal(
    manager: EntityManager,
    meal: TripMeal,
  ): Promise<void> {
    const kulek = await manager.findOne(TripMealPackage, {
      where: { mealId: meal.id, kind: 'kulek' },
    });
    if (kulek) {
      await this.syncKulek(manager, meal, kulek);
    }

    await this.markMealPackagesStale(manager, meal.id);
  }

  /** У продукта не осталось строк — его доли больше не нужны. */
  private async cleanupAllocations(
    manager: EntityManager,
    meal: TripMeal,
  ): Promise<void> {
    const productIds = await this.mealProductIds(manager, meal);

    if (productIds.length === 0) {
      await manager.delete(TripMealAllocation, { mealId: meal.id });

      return;
    }

    await manager.delete(TripMealAllocation, {
      mealId: meal.id,
      productId: Not(In(productIds)),
    });
  }

  /**
   * Содержимое пакета изменилось — если его взвешивали, пора перевесить.
   * Пакеты без фактического веса метка не мешает: её просто не видно.
   */
  private async markMealPackagesStale(
    manager: EntityManager,
    mealId: string,
    extra: string[] = [],
  ): Promise<void> {
    const packs = await manager.find(TripMealPackage, {
      where: { mealId },
      select: { id: true },
    });
    const shares = await manager.find(TripMealAllocation, {
      where: { mealId },
      select: { packageId: true },
    });

    const ids = [
      ...new Set([
        ...packs.map((pack) => pack.id),
        ...shares.map((share) => share.packageId),
        ...extra,
      ]),
    ];
    if (ids.length === 0) return;

    await manager.update(
      TripMealPackage,
      { id: In(ids) },
      { weightActualStale: true },
    );
  }

  // ─────────────────────────── исключения в приёме ───────────────────────────

  /**
   * Убрать ингредиенты блюда в этом приёме: «лук не любим».
   *
   * Рецепт не меняется — исключение живёт в строке приёма. Раскладка
   * вычитает ингредиент из состава и количеств, а доли пакетов по ушедшему
   * продукту чистятся. Пустой список — вернуть всё.
   */
  async setDishExclusions(
    userId: string,
    id: number,
    owner: MealOwner = null,
    dayIndex: number,
    kind: TripMealKind,
    dishId: string,
    productIds: number[],
  ): Promise<TripMealPlanDto> {
    await this.mutate(userId, id, owner, async (manager, trip) => {
      const meal = await this.findMeal(manager, trip.id, dayIndex, kind, owner);
      if (!meal) {
        throw new NotFoundException('В приёме пока нет блюд');
      }

      const row = await manager.findOne(TripMealDish, {
        where: { mealId: meal.id, dishId },
      });
      if (!row) {
        throw new NotFoundException('Это блюдо не в этом приёме');
      }

      const ingredients = await manager.find(DishIngredient, {
        where: { dishId },
        relations: { product: true },
      });
      const idByName = await this.tripProductIdsByName(
        manager,
        trip.id,
        owner,
      );
      const allowed = new Set(
        ingredients
          .map((ingredient) => idByName.get(ingredient.product.name))
          .filter((productId): productId is number => productId !== undefined),
      );
      const unique = [...new Set(productIds)];
      if (unique.some((productId) => !allowed.has(productId))) {
        throw new BadRequestException('Такого ингредиента нет в блюде');
      }

      await manager.delete(TripMealDishExclusion, {
        mealDishId: row.id,
      });
      for (const productId of unique) {
        await manager.insert(TripMealDishExclusion, {
          mealDishId: row.id,
          productId,
        });
      }

      await this.cleanupAllocations(manager, meal);
      await this.markMealPackagesStale(manager, meal.id);
    });

    return this.getPlan(userId, id, owner);
  }

  // ─────────────────────────── чек-лист покупок ───────────────────────────

  /**
   * Чек-лист — живая проекция раскладки плюс отметки.
   *
   * Строки берутся из плана (с «надо» по вегетарианцам), отметки — из
   * `trip_meal_checks` и не сбрасываются при правке плана. Продукт ушёл
   * из плана, но куплен — остаётся строкой с `isOrphaned`: вычеркнуть
   * купленное значит потерять его из виду.
   *
   * Списков два: общий (`owner` = null) и личный у того, кто питается
   * отдельно. Они не пересекаются: отметка в общем не отмечает личную
   * строку того же продукта.
   */
  async getChecklist(
    userId: string,
    id: number,
    owner: MealOwner = null,
  ): Promise<TripMealCheckListDto> {
    const plan = await this.getPlan(userId, id, owner);
    const manager = this.dataSource.manager;

    const need = new Map<
      number,
      {
        productId: number;
        name: string;
        unit: Product['unit'];
        weightPerUnitGrams: number;
        needAmount: number;
      }
    >();

    for (const meal of plan.meals) {
      for (const product of meal.products) {
        const row = need.get(product.productId) ?? {
          productId: product.productId,
          name: product.name,
          unit: product.unit,
          weightPerUnitGrams: product.weightPerUnitGrams,
          needAmount: 0,
        };
        row.needAmount += product.amount;
        need.set(product.productId, row);
      }
    }

    const checks = await manager.find(TripMealCheck, {
      where: { tripId: String(id), eaterUserId: this.layerOf(owner) },
      relations: { buyer: true },
    });
    const checkByProduct = new Map(
      checks.map((check) => [check.productId, check]),
    );

    const rows: TripMealCheckDto[] = [...need.values()].map((product) => {
      const check = checkByProduct.get(product.productId);

      return {
        productId: product.productId,
        name: product.name,
        unit: product.unit,
        weightPerUnitGrams: product.weightPerUnitGrams,
        needAmount: product.needAmount,
        needGrams: product.needAmount * product.weightPerUnitGrams,
        isBought: check?.isBought ?? false,
        isHome: check?.isHome ?? false,
        boughtAmount: check?.boughtAmount ?? null,
        boughtByName: check?.buyer?.displayName ?? null,
        boughtAt: check?.boughtAt?.toISOString() ?? null,
        isOrphaned: false,
      };
    });

    const orphaned = checks.filter(
      (check) => check.isBought && !need.has(check.productId),
    );
    if (orphaned.length > 0) {
      const products = await manager.find(TripProduct, {
        where: {
          id: In(orphaned.map((check) => check.productId)),
          tripId: String(id),
        },
      });

      for (const check of orphaned) {
        const product = products.find((row) => row.id === check.productId);
        // Продукт чужого слоя в этом списке не показываем: личное
        // не протекает в общий чек-лист и наоборот.
        if (!product || !this.productAllowed(product, owner)) continue;

        rows.push({
          productId: product.id,
          name: product.name,
          unit: product.unit,
          weightPerUnitGrams: product.weightPerUnitGrams,
          needAmount: 0,
          needGrams: 0,
          isBought: true,
          isHome: check.isHome,
          boughtAmount: check.boughtAmount,
          boughtByName: check.buyer?.displayName ?? null,
          boughtAt: check.boughtAt?.toISOString() ?? null,
          isOrphaned: true,
        });
      }
    }

    rows.sort((left, right) => left.name.localeCompare(right.name));

    return { checks: rows };
  }

  /**
   * Отметки чек-листа: куплено, домашнее, сколько куплено.
   *
   * Ставит **любой участник** (решение заказчика): покупка — общее дело,
   * и роль завхоза для галочки не нужна. Продукт обязан быть в раскладке:
   * чек-лист растёт только вместе с планом, «куплено сверх» заводят
   * ручной строкой в приёме.
   *
   * В личном списке — только сам едок: отметить чужую личную строку
   * нельзя, её даже не видно.
   */
  async updateCheck(
    userId: string,
    id: number,
    owner: MealOwner = null,
    productId: number,
    dto: { isBought?: boolean; isHome?: boolean; boughtAmount?: number | null },
  ): Promise<TripMealCheckListDto> {
    const plan = await this.getPlan(userId, id, owner);
    const inPlan = plan.meals.some((meal) =>
      meal.products.some((product) => product.productId === productId),
    );
    if (!inPlan) {
      throw new BadRequestException(
        'Этого продукта нет в раскладке — добавьте строку в приём',
      );
    }

    const manager = this.dataSource.manager;
    const tripId = String(id);

    let row = await manager.findOne(TripMealCheck, {
      where: { tripId, productId, eaterUserId: this.layerOf(owner) },
    });
    if (!row) {
      row = manager.create(TripMealCheck, {
        tripId,
        productId,
        eaterUserId: owner,
      });
    }

    if (dto.isBought !== undefined) {
      row.isBought = dto.isBought;
      row.boughtBy = dto.isBought ? userId : null;
      row.boughtAt = dto.isBought ? new Date() : null;
    }
    if (dto.isHome !== undefined) {
      row.isHome = dto.isHome;
    }
    if (dto.boughtAmount !== undefined) {
      row.boughtAmount = dto.boughtAmount;
    }
    row.updatedBy = userId;

    await manager.save(row);

    return this.getChecklist(userId, id, owner);
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

  /**
   * Правка слоя.
   *
   * Общую раскладку правит тот, кому роль дала «Питание» (завхоз,
   * организатор). Личную — только её владелец: завхоз распоряжается общим
   * котлом, а не чужим рюкзаком.
   */
  private async mutate(
    userId: string,
    id: number,
    owner: MealOwner = null,
    work: (manager: EntityManager, trip: Trip) => Promise<void>,
  ): Promise<void> {
    const trip = await this.trips.getVisibleTrip(userId, id);

    if (owner === null) {
      const canEdit = await this.trips.canEditTab(userId, trip, 'meals');
      if (!canEdit) {
        throw new ForbiddenException('Раскладку правит завхоз или организатор');
      }
    } else if (owner !== userId) {
      throw new ForbiddenException(
        'Личную еду правит только тот, кто её ведёт',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      if (owner !== null) {
        await this.assertParticipant(manager, userId, trip);
      }
      await work(manager, trip);
    });
  }

  // ─────────────────────────── слои еды ───────────────────────────

  /**
   * Значение колонки-владельца для запросов и вставок.
   *
   * `null` в `where` TypeORM пропускает — «найди где угодно», поэтому
   * общий слой ищется через `IsNull()`, а не через голый `null`.
   */
  private layerOf(owner: MealOwner): string | FindOperator<string> {
    return owner === null ? IsNull() : owner;
  }

  /** Продукты, видимые слою: общие всегда, свои — только владельцу. */
  private productScope(
    tripId: string,
    owner: MealOwner,
  ): FindOptionsWhere<TripProduct>[] {
    const scope: FindOptionsWhere<TripProduct>[] = [
      { tripId, ownerUserId: IsNull() },
    ];
    if (owner !== null) scope.push({ tripId, ownerUserId: owner });

    return scope;
  }

  /** Личный продукт чужого участника в план не поставить. */
  private productAllowed(product: TripProduct, owner: MealOwner): boolean {
    return product.ownerUserId === null || product.ownerUserId === owner;
  }

  /**
   * Блюдо стоит в общей раскладке похода — значит, оно «общее»:
   * участник с отдельным питанием берёт его в свой план, не заводя
   * рецепт заново.
   */
  private async isDishInCommonPlan(
    manager: EntityManager,
    tripId: string,
    dishId: string,
  ): Promise<boolean> {
    return manager
      .createQueryBuilder(TripMealDish, 'mealDish')
      .innerJoin(TripMeal, 'meal', 'meal.id = mealDish.mealId')
      .where('meal.tripId = :tripId', { tripId })
      .andWhere('meal.eaterUserId IS NULL')
      .andWhere('mealDish.dishId = :dishId', { dishId })
      .getExists();
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
    owner: MealOwner,
  ): Promise<TripMeal | null> {
    return manager.findOne(TripMeal, {
      where: {
        tripId,
        dayIndex,
        kind,
        eaterUserId: this.layerOf(owner),
      },
    });
  }

  private async upsertMeal(
    manager: EntityManager,
    tripId: string,
    dayIndex: number,
    kind: TripMealKind,
    owner: MealOwner,
  ): Promise<TripMeal> {
    const existing = await this.findMeal(
      manager,
      tripId,
      dayIndex,
      kind,
      owner,
    );
    if (existing) return existing;

    return manager.save(
      manager.create(TripMeal, {
        tripId,
        dayIndex,
        kind,
        eaterUserId: owner,
      }),
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
    if (dishes === 0 && lines === 0) {
      // Пустой приём не должен висеть из-за кулька: пакеты уходят с ним.
      await manager.delete(TripMealPackage, { mealId });
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

  /**
   * Едоки личного слоя: сам владелец.
   *
   * Количества в личной еде считаются на одного человека, поэтому
   * «едоков» ровно столько, сколько он за собой признаёт: вегетарианец
   * получает мясные ингредиенты с нулём — та же формула, что и в общем
   * слое, только состав из одного человека.
   */
  private async loadOwnerEater(
    manager: EntityManager,
    trip: Trip,
    owner: string,
  ): Promise<TripEatersDto> {
    const participant = await manager.findOne(TripParticipant, {
      where: { tripId: trip.id, userId: owner, status: 'going' },
      relations: { user: true },
    });
    if (!participant) {
      throw new BadRequestException(
        'Личная еда доступна только идущим в поход',
      );
    }

    const person = {
      userId: participant.userId,
      displayName: participant.user?.displayName ?? 'Неизвестный',
      avatarUrl: participant.user?.avatarUrl ?? null,
      gender: participant.user?.gender ?? 'm',
      isVegetarian: participant.user?.isVegetarian ?? false,
      allergies: participant.user?.allergies ?? null,
      eatsSeparately: participant.eatsSeparately,
    };

    return {
      total: 1,
      men: person.gender === 'm' ? 1 : 0,
      women: person.gender === 'f' ? 1 : 0,
      vegetarians: person.isVegetarian ? 1 : 0,
      people: [person],
    };
  }

  private async loadMeals(
    manager: EntityManager,
    trip: Trip,
    eaters: TripEatersDto,
    owner: MealOwner,
  ): Promise<TripMealDto[]> {
    const meals = await manager.find(TripMeal, {
      where: { tripId: trip.id, eaterUserId: this.layerOf(owner) },
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

    // План живёт продуктами похода; справочник нужен только в рецептах.
    // В личном слое видно и общее: своё имя важнее общего.
    const tripProducts = await manager.find(TripProduct, {
      where: this.productScope(trip.id, owner),
    });
    const tripProductsByName = new Map<string, TripProduct>();
    for (const product of tripProducts) {
      if (product.ownerUserId === null) {
        tripProductsByName.set(product.name, product);
      }
    }
    for (const product of tripProducts) {
      if (product.ownerUserId !== null) {
        tripProductsByName.set(product.name, product);
      }
    }

    const allocations = await manager.find(TripMealAllocation, {
      where: { mealId: In(mealIds) },
    });

    const mealDishIds = dishes.map((row) => row.id);
    const exclusions = mealDishIds.length
      ? await manager.find(TripMealDishExclusion, {
          where: { mealDishId: In(mealDishIds) },
        })
      : [];
    const exclusionsByDish = new Map<string, Set<number>>();
    for (const exclusion of exclusions) {
      const set = exclusionsByDish.get(exclusion.mealDishId) ?? new Set<number>();
      set.add(exclusion.productId);
      exclusionsByDish.set(exclusion.mealDishId, set);
    }

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
        exclusionsByDish,
        eaters,
        tripProductsByName,
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
      exclusionsByDish: Map<string, Set<number>>;
      eaters: TripEatersDto;
      tripProductsByName: Map<string, TripProduct>;
    },
  ): TripMealDto {
    const products = new Map<number, ProductRow>();
    const dishDtos: TripMealDishDto[] = [];

    for (const row of data.dishes) {
      const dish = row.dish;
      const ingredients = data.ingredientsByDish.get(Number(dish.id)) ?? [];
      const excluded = data.exclusionsByDish.get(row.id) ?? new Set<number>();

      // Ингредиент рецепта ссылается на справочник; в плане он живёт
      // продуктом похода с тем же именем.
      const rows = ingredients
        .map((ingredient) => ({
          ingredient,
          product: data.tripProductsByName.get(ingredient.product.name),
        }))
        .filter(
          (row): row is { ingredient: DishIngredient; product: TripProduct } =>
            row.product !== undefined,
        );

      dishDtos.push({
        dishId: dish.id,
        title: dish.title,
        ingredients: rows.map(({ ingredient, product }) => ({
          productId: product.id,
          name: product.name,
          unit: product.unit,
          amount: ingredient.amount,
          isMeat: ingredient.isMeat,
        })),
        excludedProductIds: [...excluded],
      });

      for (const { ingredient, product } of rows) {
        if (excluded.has(product.id)) continue;

        const portion = ingredient.isMeat
          ? Math.max(0, data.eaters.total - data.eaters.vegetarians)
          : data.eaters.total;
        const recipeAmount = ingredient.amount * portion;

        const row = products.get(product.id) ?? {
          product,
          recipeAmount: 0,
          manualAmount: 0,
          isMeat: false,
          fromDishes: new Set<string>(),
        };

        row.recipeAmount += recipeAmount;
        row.isMeat = row.isMeat || ingredient.isMeat;
        row.fromDishes.add(dish.title);
        products.set(product.id, row);
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
        // В походе не бывает полутора банок: рецепт дробный, а количество
        // в приёме — целое, округлённое вверх (0,33 × 4 = 1,32 → 2).
        const recipeAmount = Math.ceil(row.recipeAmount);
        const amount = recipeAmount + row.manualAmount;
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
    owner: MealOwner,
  ): Promise<TripMealPackageDto[]> {
    const packages = await manager.find(TripMealPackage, {
      where: { tripId: trip.id, eaterUserId: this.layerOf(owner) },
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
