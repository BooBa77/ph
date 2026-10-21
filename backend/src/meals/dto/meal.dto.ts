import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

import type { ProductUnit } from '../meal.types';
import { PRODUCT_UNITS } from '../meal.types';
import type { Dish } from '../entities/dish.entity';
import type { DishIngredient } from '../entities/dish-ingredient.entity';
import type { Product } from '../entities/product.entity';

/** Продукт справочника. */
export class ProductDto {
  @ApiProperty({ description: 'Id продукта', example: 7 })
  id: number;

  @ApiProperty({ description: 'Название', example: 'Тушёнка' })
  name: string;

  @ApiProperty({
    description: 'Единица: граммы, штука, банка, упаковка',
    enum: PRODUCT_UNITS,
    example: 'can',
  })
  unit: ProductUnit;

  @ApiProperty({ description: 'Вес одной единицы, граммы', example: 340 })
  weightPerUnitGrams: number;

  static from(product: Product): ProductDto {
    return {
      id: product.id,
      name: product.name,
      unit: product.unit,
      weightPerUnitGrams: product.weightPerUnitGrams,
    };
  }
}

/** Ответ `GET /api/products`. */
export class ProductListDto {
  @ApiProperty({ description: 'Найденные продукты', type: [ProductDto] })
  products: ProductDto[];
}

/** Строка состава блюда: продукт, количество и посчитанный вес. */
export class DishIngredientDto {
  @ApiProperty({ description: 'Id строки', example: '12' })
  id: string;

  @ApiProperty({ description: 'Продукт', type: ProductDto })
  product: ProductDto;

  @ApiProperty({
    description: 'Количество в единицах продукта',
    example: 2,
  })
  amount: number;

  @ApiProperty({
    description: 'Вес строки, граммы (количество × вес единицы)',
    example: 680,
  })
  grams: number;

  static from(ingredient: DishIngredient): DishIngredientDto {
    const product = ingredient.product;

    return {
      id: ingredient.id,
      product: ProductDto.from(product),
      amount: ingredient.amount,
      grams: ingredient.amount * product.weightPerUnitGrams,
    };
  }
}

/**
 * Блюдо целиком, с составом и весом.
 *
 * `totalGrams` считает бэкенд, а не клиент: та же формула нужна раскладке
 * (Ф7), и две копии однажды разошлись бы.
 */
export class DishDto {
  @ApiProperty({ description: 'Id блюда', example: '4' })
  id: string;

  @ApiProperty({ description: 'Название', example: 'Каша с тушёнкой' })
  title: string;

  @ApiProperty({ description: 'Заметка', nullable: true })
  note: string | null;

  @ApiProperty({ description: 'Состав', type: [DishIngredientDto] })
  ingredients: DishIngredientDto[];

  @ApiProperty({ description: 'Вес блюда по составу, граммы', example: 1180 })
  totalGrams: number;

  @ApiProperty({ description: 'Создан', example: '2026-10-21T08:00:00.000Z' })
  createdAt: string;

  static from(dish: Dish, ingredients: DishIngredient[]): DishDto {
    const rows = ingredients.map((ingredient) => DishIngredientDto.from(ingredient));

    return {
      id: dish.id,
      title: dish.title,
      note: dish.note,
      ingredients: rows,
      totalGrams: rows.reduce((sum, row) => sum + row.grams, 0),
      createdAt: dish.createdAt.toISOString(),
    };
  }
}

/** Мои блюда. */
export class DishListDto {
  @ApiProperty({ description: 'Блюда', type: [DishDto] })
  dishes: DishDto[];
}

/** Тело `POST /api/dishes`. */
export class CreateDishDto {
  @ApiProperty({
    description: 'Название блюда',
    example: 'Каша с тушёнкой',
    maxLength: 120,
  })
  @IsString({ message: 'Название должно быть строкой' })
  @MaxLength(120, { message: 'Название не должно превышать 120 символов' })
  title: string;
}

/** Тело `PATCH /api/dishes/:id`. */
export class UpdateDishDto {
  @ApiProperty({ description: 'Название', maxLength: 120, required: false })
  @IsOptional()
  @IsString({ message: 'Название должно быть строкой' })
  @MaxLength(120, { message: 'Название не должно превышать 120 символов' })
  title?: string;

  @ApiProperty({
    description: 'Заметка. null — стереть',
    maxLength: 500,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Заметка должна быть строкой' })
  @MaxLength(500, { message: 'Заметка не должна превышать 500 символов' })
  note?: string | null;
}

/** Тело `POST /api/dishes/:id/ingredients`. */
export class AddIngredientDto {
  @ApiProperty({ description: 'Продукт из справочника', example: 7 })
  @IsInt({ message: 'Продукт должен быть id из справочника' })
  @Min(1, { message: 'Продукт должен быть id из справочника' })
  productId: number;

  @ApiProperty({
    description: 'Количество в единицах продукта',
    example: 2,
  })
  @IsInt({ message: 'Количество должно быть целым числом единиц' })
  @Min(1, { message: 'Количество должно быть больше нуля' })
  amount: number;
}

/** Тело `PATCH /api/dishes/ingredients/:id`. */
export class UpdateIngredientDto {
  @ApiProperty({ description: 'Количество в единицах продукта', example: 3 })
  @IsInt({ message: 'Количество должно быть целым числом единиц' })
  @Min(1, { message: 'Количество должно быть больше нуля' })
  amount: number;
}

/** Строка поиска по справочнику продуктов. */
export class ProductSearchQueryDto {
  @ApiProperty({
    description: 'Подстрока названия. Пусто — пустой список, а не всё',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Строка поиска должна быть строкой' })
  @MaxLength(120, { message: 'Строка поиска не должна превышать 120 символов' })
  search?: string;
}
