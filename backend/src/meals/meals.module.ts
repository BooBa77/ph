import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DishesController } from './dishes.controller';
import { DishIngredient } from './entities/dish-ingredient.entity';
import { Dish } from './entities/dish.entity';
import { Product } from './entities/product.entity';
import { MealsService } from './meals.service';
import { ProductsController } from './products.controller';

/**
 * Питание: справочник продуктов и кулинарная книга (Ф4 карты вкладок).
 *
 * Справочник продуктов принадлежит домену, а не отдельному модулю:
 * продукт нужен блюдам, блюда — раскладке, раскладка — вкладке «Питание».
 * Разносить продукты и блюда по разным модулям значило бы держать две
 * сущности одного домена в разных местах.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Product, Dish, DishIngredient])],
  controllers: [ProductsController, DishesController],
  providers: [MealsService],
  exports: [MealsService],
})
export class MealsModule {}
