import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, Matches, Min } from 'class-validator';

import type { ProductUnit } from '../../meals/meal.types';
import { PRODUCT_UNITS } from '../../meals/meal.types';
import type { UserGender } from '../../users/gender.types';
import { USER_GENDERS } from '../../users/gender.types';
import {
  TRIP_MEAL_FORMS,
  TRIP_MEAL_KINDS,
  TRIP_MEAL_PACKAGE_KINDS,
  type TripMealForm,
  type TripMealKind,
  type TripMealPackageKind,
} from '../trip.types';

/** Ингредиент блюда в раскладке — на одного человека. */
export class TripMealIngredientDto {
  @ApiProperty({ description: 'Id продукта', example: 7 })
  productId: number;

  @ApiProperty({ description: 'Название продукта', example: 'Крупа гречневая' })
  name: string;

  @ApiProperty({ description: 'Единица продукта', enum: PRODUCT_UNITS })
  unit: ProductUnit;

  @ApiProperty({ description: 'Количество на человека', example: 80 })
  amount: number;

  @ApiProperty({
    description: 'Мясной ингредиент: считается без вегетарианцев',
    example: false,
  })
  isMeat: boolean;
}

/** Блюдо в приёме: рецепт на человека. */
export class TripMealDishDto {
  @ApiProperty({ description: 'Id блюда', example: '4' })
  dishId: string;

  @ApiProperty({ description: 'Название блюда', example: 'Гречка с тушёнкой' })
  title: string;

  @ApiProperty({ description: 'Состав на одного', type: [TripMealIngredientDto] })
  ingredients: TripMealIngredientDto[];
}

/** Доля строки раскладки в пакете. */
export class TripMealAllocationDto {
  @ApiProperty({ description: 'Id пакета', example: '2' })
  packageId: string;

  @ApiProperty({
    description: 'Сколько положили. У эластичной «всё» — остаток',
    example: 400,
  })
  amount: number;

  @ApiProperty({
    description: 'Эластичная «всё»: забирает остаток и следует за количеством',
    example: false,
  })
  isElastic: boolean;
}

/** Строка раскладки: продукт в приёме, рецептовая и ручная части. */
export class TripMealProductDto {
  @ApiProperty({ description: 'Id продукта', example: 7 })
  productId: number;

  @ApiProperty({ description: 'Название', example: 'Крупа гречневая' })
  name: string;

  @ApiProperty({ description: 'Единица', enum: PRODUCT_UNITS })
  unit: ProductUnit;

  @ApiProperty({ description: 'Вес единицы, граммы', example: 1 })
  weightPerUnitGrams: number;

  @ApiProperty({
    description: 'Сколько дали рецепты (рецепт × едоков; мясное — без вегетарианцев)',
    example: 480,
  })
  recipeAmount: number;

  @ApiProperty({ description: 'Сколько добавили рукой', example: 120 })
  manualAmount: number;

  @ApiProperty({ description: 'Итого в приёме', example: 600 })
  amount: number;

  @ApiProperty({
    description: 'Мясное: в подписи будет «на 4 из 6»',
    example: false,
  })
  isMeat: boolean;

  @ApiProperty({
    description: 'Из каких блюд пришло',
    type: [String],
    example: ['Гречка с тушёнкой'],
  })
  fromDishes: string[];

  @ApiProperty({ description: 'Доли по пакетам', type: [TripMealAllocationDto] })
  allocations: TripMealAllocationDto[];
}

/** Приём пищи с блюдами и строками. */
export class TripMealDto {
  @ApiProperty({ description: 'Id приёма', example: '3' })
  id: string;

  @ApiProperty({ description: 'Номер дня от начала', example: 1 })
  dayIndex: number;

  @ApiProperty({ description: 'Приём', enum: TRIP_MEAL_KINDS })
  kind: TripMealKind;

  @ApiProperty({ description: 'Форма: готовка или перекус', enum: TRIP_MEAL_FORMS })
  form: TripMealForm;

  @ApiProperty({ description: 'Блюда', type: [TripMealDishDto] })
  dishes: TripMealDishDto[];

  @ApiProperty({ description: 'Строки по продуктам', type: [TripMealProductDto] })
  products: TripMealProductDto[];

  @ApiProperty({ description: 'Вес приёма, граммы', example: 1180 })
  weightGrams: number;
}

/** Едок: идущий участник с диетическими пометками. */
export class TripEaterDto {
  @ApiProperty({ description: 'Id пользователя' })
  userId: string;

  @ApiProperty({ description: 'Имя', example: 'Ваня' })
  displayName: string;

  @ApiProperty({ description: 'Аватарка', nullable: true })
  avatarUrl: string | null;

  @ApiProperty({ description: 'Пол', enum: USER_GENDERS })
  gender: UserGender;

  @ApiProperty({ description: 'Вегетарианец', example: false })
  isVegetarian: boolean;

  @ApiProperty({ description: 'Аллергии, текст из профиля', nullable: true })
  allergies: string | null;

  @ApiProperty({
    description: 'Питается отдельно: не едок, пакеты еды не назначаются',
    example: false,
  })
  eatsSeparately: boolean;
}

/** Едоки похода: счётчики и люди. */
export class TripEatersDto {
  @ApiProperty({ description: 'Едоков всего (без отдельного питания)', example: 6 })
  total: number;

  @ApiProperty({ description: 'Мужчин среди едоков', example: 4 })
  men: number;

  @ApiProperty({ description: 'Женщин среди едоков', example: 2 })
  women: number;

  @ApiProperty({ description: 'Вегетарианцев среди едоков', example: 1 })
  vegetarians: number;

  @ApiProperty({
    description: 'Идущие участники с пометками — включая тех, кто ест отдельно',
    type: [TripEaterDto],
  })
  people: TripEaterDto[];
}

/** Строка пакета: что из какого приёма в него упаковали. */
export class TripMealPackageItemDto {
  @ApiProperty({ description: 'Id приёма', example: '3' })
  mealId: string;

  @ApiProperty({ description: 'День', example: 1 })
  dayIndex: number;

  @ApiProperty({ description: 'Приём', enum: TRIP_MEAL_KINDS })
  kind: TripMealKind;

  @ApiProperty({ description: 'Id продукта', example: 7 })
  productId: number;

  @ApiProperty({ description: 'Название', example: 'Крупа гречневая' })
  name: string;

  @ApiProperty({ description: 'Количество', example: 400 })
  amount: number;

  @ApiProperty({ description: 'Эластичная «всё»', example: false })
  isElastic: boolean;

  @ApiProperty({ description: 'Вес строки, граммы', example: 400 })
  weightGrams: number;
}

/** Пакет фасовки. */
export class TripMealPackageDto {
  @ApiProperty({ description: 'Id пакета', example: '2' })
  id: string;

  @ApiProperty({ description: 'Имя', example: 'Пакет 2' })
  name: string;

  @ApiProperty({ description: 'Вид', enum: TRIP_MEAL_PACKAGE_KINDS })
  kind: TripMealPackageKind;

  @ApiProperty({ description: 'Приём для кулёка', nullable: true })
  mealId: string | null;

  @ApiProperty({ description: 'Фактический вес, граммы', nullable: true })
  weightActualGrams: number | null;

  @ApiProperty({ description: 'Содержимое менялось после взвешивания' })
  weightActualStale: boolean;

  @ApiProperty({ description: 'Расчётный вес, граммы', example: 3200 })
  weightEstimatedGrams: number;

  @ApiProperty({ description: 'Содержимое', type: [TripMealPackageItemDto] })
  items: TripMealPackageItemDto[];
}

/** Раскладка и фасовка похода целиком. */
export class TripMealPlanDto {
  @ApiProperty({ description: 'Сколько дней в походе', example: 5 })
  dayCount: number;

  @ApiProperty({ description: 'Едоки', type: TripEatersDto })
  eaters: TripEatersDto;

  @ApiProperty({ description: 'Приёмы с данными', type: [TripMealDto] })
  meals: TripMealDto[];

  @ApiProperty({ description: 'Пакеты', type: [TripMealPackageDto] })
  packages: TripMealPackageDto[];
}

/** Тело `PUT /api/trips/:id/meals/:day/:kind/form`. */
export class SetMealFormDto {
  @ApiProperty({ description: 'Готовка или перекус', enum: TRIP_MEAL_FORMS })
  @IsIn(TRIP_MEAL_FORMS, { message: 'Форма приёма — «готовка» или «перекус»' })
  form: TripMealForm;
}

/** Тело `POST /api/trips/:id/meals/:day/:kind/dishes`. */
export class AddMealDishDto {
  @ApiProperty({ description: 'Id своего блюда', example: '4' })
  @IsString({ message: 'Блюдо должно быть id' })
  @Matches(/^\d+$/, { message: 'Блюдо должно быть id' })
  dishId: string;
}

/** Тело `PUT /api/trips/:id/meals/:day/:kind/lines/:productId`. */
export class SetMealLineDto {
  @ApiProperty({ description: 'Количество в единицах продукта', example: 600 })
  @IsInt({ message: 'Количество должно быть целым числом единиц' })
  @Min(1, { message: 'Количество должно быть больше нуля' })
  amount: number;
}
