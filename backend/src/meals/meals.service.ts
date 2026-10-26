import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';

import {
  AddIngredientDto,
  CreateDishDto,
  DishDto,
  DishIngredientDto,
  DishListDto,
  ProductDto,
  ProductListDto,
  UpdateDishDto,
  UpdateIngredientDto,
} from './dto/meal.dto';
import { DishIngredient } from './entities/dish-ingredient.entity';
import { Dish } from './entities/dish.entity';
import { Product } from './entities/product.entity';

/** Сколько продуктов отдавать на один поиск. */
const PRODUCT_SEARCH_LIMIT = 30;

/**
 * Питание: справочник продуктов и кулинарная книга.
 *
 * Две половины с разными правами:
 *
 * - **продукты** — общий справочник. Приложение их только читает
 *   (в базе выдан `SELECT`): пополнение справочника — отдельная задача,
 *   и «пользователь заводит свою гречку» сломало бы раскладку, потому что
 *   веса разошлись бы;
 * - **блюда** — личные: у каждого своя книга, чужие блюда не видны никому.
 *   Чужое блюдо отвечает 404, как чужой шаблон чек-листа: перебирать id
 *   нечего.
 *
 * Вес считается на бэкенде (`totalGrams`): та же формула понадобится
 * раскладке (Ф7), и две копии однажды разошлись бы.
 */
@Injectable()
export class MealsService {
  constructor(private readonly dataSource: DataSource) {}

  // ───────────────────────── продукты ─────────────────────────

  /**
   * Поиск по справочнику: подстрока названия, не больше 30 строк.
   *
   * Пустая строка — пустой список, а не «все продукты»: справочник
   * не листают целиком, его ищут по названию. `%` и `_` экранируются,
   * иначе «%» пользователя превратился бы в «найди всё».
   *
   * Продуктов похода здесь нет: своя «экзотика» живёт в `trip_products`
   * и в справочник не попадает — иначе подсказки засорялись бы чужими
   * походами.
   */
  async searchProducts(search: string | undefined): Promise<ProductListDto> {
    const text = search?.trim();
    if (!text) return { products: [] };

    const escaped = text.replace(/[%_\\]/g, '\\$&');

    const products = await this.dataSource.manager
      .createQueryBuilder(Product, 'product')
      .where('product.name ILIKE :search', { search: `%${escaped}%` })
      .orderBy('product.name', 'ASC')
      .take(PRODUCT_SEARCH_LIMIT)
      .getMany();

    return { products: products.map((product) => ProductDto.from(product)) };
  }

  // ───────────────────────── блюда ─────────────────────────

  /** Мои блюда с составом и весом. */
  async listDishes(userId: string): Promise<DishListDto> {
    const manager = this.dataSource.manager;

    const dishes = await manager.find(Dish, {
      where: { ownerUserId: userId },
      order: { id: 'ASC' },
    });

    return { dishes: await this.withIngredients(manager, dishes) };
  }

  /** Новое блюдо. Состав добавляется отдельно: пустое блюдо — норма. */
  async createDish(userId: string, dto: CreateDishDto): Promise<DishDto> {
    const title = dto.title.trim();
    if (title.length === 0) {
      throw new BadRequestException('У блюда должно быть название');
    }

    const manager = this.dataSource.manager;
    const saved = await manager.save(
      manager.create(Dish, { ownerUserId: userId, title, note: null }),
    );

    return DishDto.from(saved, []);
  }

  /** Переименовать блюдо и/или изменить заметку. */
  async updateDish(
    userId: string,
    id: number,
    dto: UpdateDishDto,
  ): Promise<DishDto> {
    const manager = this.dataSource.manager;
    const dish = await this.findOwnedDish(manager, userId, id);

    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (title.length === 0) {
        throw new BadRequestException('У блюда должно быть название');
      }
      dish.title = title;
    }

    if (dto.note !== undefined) dish.note = dto.note?.trim() || null;

    const saved = await manager.save(dish);

    return (await this.withIngredients(manager, [saved]))[0];
  }

  /** Удалить блюдо вместе с составом (каскад в базе). */
  async deleteDish(userId: string, id: number): Promise<void> {
    const manager = this.dataSource.manager;
    const dish = await this.findOwnedDish(manager, userId, id);

    await manager.delete(Dish, { id: dish.id });
  }

  /** Добавить продукт в состав блюда. */
  async addIngredient(
    userId: string,
    dishId: number,
    dto: AddIngredientDto,
  ): Promise<DishIngredientDto> {
    const manager = this.dataSource.manager;
    const dish = await this.findOwnedDish(manager, userId, dishId);

    const product = await manager.findOne(Product, {
      where: { id: dto.productId },
    });
    if (!product) {
      throw new BadRequestException(
        'Такого продукта нет в справочнике — выберите из подсказок',
      );
    }

    const existing = await manager.findOne(DishIngredient, {
      where: { dishId: dish.id, productId: product.id },
    });
    if (existing) {
      throw new ConflictException(
        'Этот продукт уже есть в блюде — измените количество',
      );
    }

    const saved = await manager.save(
      manager.create(DishIngredient, {
        dishId: dish.id,
        productId: product.id,
        amount: dto.amount,
        isMeat: dto.isMeat ?? false,
      }),
    );

    return DishIngredientDto.from({ ...saved, product });
  }

  /** Изменить количество продукта в блюде. */
  async updateIngredient(
    userId: string,
    ingredientId: number,
    dto: UpdateIngredientDto,
  ): Promise<DishIngredientDto> {
    const manager = this.dataSource.manager;
    const ingredient = await this.findOwnedIngredient(
      manager,
      userId,
      ingredientId,
    );

    ingredient.amount = dto.amount;
    if (dto.isMeat !== undefined) {
      ingredient.isMeat = dto.isMeat;
    }

    return DishIngredientDto.from(await manager.save(ingredient));
  }

  /** Убрать продукт из блюда. */
  async deleteIngredient(userId: string, ingredientId: number): Promise<void> {
    const manager = this.dataSource.manager;
    const ingredient = await this.findOwnedIngredient(
      manager,
      userId,
      ingredientId,
    );

    await manager.delete(DishIngredient, { id: ingredient.id });
  }

  // ───────────────────────── внутреннее ─────────────────────────

  /** Моё блюдо или 404: чужое не существует. */
  private async findOwnedDish(
    manager: EntityManager,
    userId: string,
    id: number,
  ): Promise<Dish> {
    const dish = await manager.findOne(Dish, {
      where: { id: String(id), ownerUserId: userId },
    });
    if (!dish) throw new NotFoundException('Блюдо не найдено');

    return dish;
  }

  /**
   * Моя строка состава (вместе с продуктом) или 404.
   *
   * Проверка идёт через блюдо: строка принадлежит не человеку, а блюду,
   * и «мой продукт» означает «продукт в моём блюде».
   */
  private async findOwnedIngredient(
    manager: EntityManager,
    userId: string,
    id: number,
  ): Promise<DishIngredient> {
    const ingredient = await manager.findOne(DishIngredient, {
      where: { id: String(id) },
      relations: { product: true },
    });
    if (!ingredient) throw new NotFoundException('Продукт в блюде не найден');

    await this.findOwnedDish(manager, userId, Number(ingredient.dishId));

    return ingredient;
  }

  /** Состав для нескольких блюд — одним запросом, а не N+1. */
  private async withIngredients(
    manager: EntityManager,
    dishes: Dish[],
  ): Promise<DishDto[]> {
    if (dishes.length === 0) return [];

    const ingredients = await manager.find(DishIngredient, {
      where: { dishId: In(dishes.map((dish) => dish.id)) },
      relations: { product: true },
      order: { dishId: 'ASC', id: 'ASC' },
    });

    return dishes.map((dish) =>
      DishDto.from(
        dish,
        ingredients.filter((ingredient) => ingredient.dishId === dish.id),
      ),
    );
  }
}
