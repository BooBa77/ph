import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  NotEquals,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

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

  @ApiProperty({
    description: 'Ингредиенты, убранные в этом приёме (рецепт не меняется)',
    type: [Number],
    example: [12],
  })
  excludedProductIds: number[];
}

/** Тело `PUT .../meals/:day/:kind/dishes/:dishId/exclusions`. */
export class SetDishExclusionsDto {
  @ApiProperty({
    description: 'Продукты, которые убрать из блюда в этом приёме. Пусто — вернуть все',
    type: [Number],
    example: [12],
  })
  @IsArray({ message: 'Исключения должны быть списком продуктов' })
  @ArrayMaxSize(100, { message: 'Слишком много исключений' })
  @IsInt({ each: true, message: 'Продукт должен быть id из справочника' })
  @Min(1, { each: true, message: 'Продукт должен быть id из справочника' })
  productIds: number[];
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

/**
 * Тело `POST /api/trips/:id/meals/:day/:kind/lines`.
 *
 * Либо `catalogProductId` (продукт справочника копируется в поход), либо
 * `name` (свой продукт этого похода). Ссылки на справочник в плане нет.
 */
export class AddMealLineDto {
  @ApiProperty({ description: 'Количество', example: 1 })
  @IsInt({ message: 'Количество — целое число' })
  @Min(1, { message: 'Количество должно быть больше нуля' })
  amount: number;

  @ApiProperty({
    description: 'Название своего продукта похода',
    required: false,
    example: 'Трава',
  })
  @IsOptional()
  @IsString({ message: 'Название продукта — строка' })
  @MaxLength(120, { message: 'Название длиннее 120 символов' })
  name?: string;

  @ApiProperty({
    description: 'Id продукта справочника: скопировать в поход',
    required: false,
  })
  @IsOptional()
  @IsInt({ message: 'Id продукта — целое число' })
  @Min(1)
  catalogProductId?: number;

  @ApiProperty({
    description: 'Единица своего продукта',
    required: false,
    enum: PRODUCT_UNITS,
  })
  @IsOptional()
  @IsIn(PRODUCT_UNITS, { message: 'Такой единицы нет в справочнике' })
  unit?: ProductUnit;

  @ApiProperty({
    description: 'Вес единицы своего продукта, граммы',
    required: false,
  })
  @IsOptional()
  @IsInt({ message: 'Вес единицы — целое число грамм' })
  @Min(0, { message: 'Вес единицы не может быть отрицательным' })
  weightPerUnitGrams?: number;
}

/** Тело `PUT /api/trips/:id/meals/:day/:kind/lines/:productId`. */
export class SetMealLineDto {
  @ApiProperty({
    description: 'Количество: плюс — добавили, минус — убрали',
    example: 600,
  })
  @IsInt({ message: 'Количество должно быть целым числом единиц' })
  @NotEquals(0, { message: 'Количество не может быть нулём' })
  amount: number;
}

/** Тело `PATCH /api/trips/:id/meal-packages/:packageId`. */
export class UpdateMealPackageDto {
  @ApiProperty({
    description: 'Имя пакета. Не задано — не трогаем',
    required: false,
    maxLength: 60,
  })
  @IsOptional()
  @IsString({ message: 'Имя пакета должно быть строкой' })
  @MaxLength(60, { message: 'Имя пакета не должно превышать 60 символов' })
  name?: string;

  @ApiProperty({
    description:
      'Фактический вес, граммы. null — сбросить взвешивание; не задано — не трогаем',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsInt({ message: 'Вес должен быть целым числом граммов' })
  @Min(1, { message: 'Вес должен быть больше нуля' })
  weightActualGrams?: number | null;
}

/** Одна доля строки раскладки в пакете. */
export class MealAllocationInputDto {
  @ApiProperty({ description: 'Id пакета', example: '2' })
  @IsString({ message: 'Пакет должен быть id' })
  @Matches(/^\d+$/, { message: 'Пакет должен быть id' })
  packageId: string;

  @ApiProperty({
    description: 'Количество. Для «всё» не важно — остаток считается сам',
    example: 400,
  })
  @IsInt({ message: 'Количество должно быть целым числом' })
  @Min(0, { message: 'Количество не может быть отрицательным' })
  amount: number;

  @ApiProperty({
    description: 'Эластичная «всё»: забирает остаток и следует за количеством',
    required: false,
    example: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'Флаг «всё» должен быть true или false' })
  isElastic?: boolean;
}

/** Тело `PUT /api/trips/:id/meals/:day/:kind/allocations/:productId`. */
export class SetMealAllocationsDto {
  @ApiProperty({
    description:
      'Доли строки целиком: список заменяет прежние. Пустой — снять все',
    type: [MealAllocationInputDto],
  })
  @IsArray({ message: 'Доли должны быть списком' })
  @ArrayMaxSize(50, { message: 'Слишком много долей' })
  @ValidateNested({ each: true })
  @Type(() => MealAllocationInputDto)
  allocations: MealAllocationInputDto[];
}

/** Тело `PUT /api/trips/:id/meals/:day/:kind/kulek`. */
export class SetMealKulekDto {
  @ApiProperty({
    description: 'Включить кулёк приёма (true) или выключить (false)',
    example: true,
  })
  @IsBoolean({ message: 'Кулёк — true или false' })
  enabled: boolean;
}

// ─────────────────────── чек-лист покупок ───────────────────────

/** Строка чек-листа: продукт раскладки и его отметки. */
export class TripMealCheckDto {
  @ApiProperty({ description: 'Id продукта', example: 7 })
  productId: number;

  @ApiProperty({ description: 'Название', example: 'Крупа гречневая' })
  name: string;

  @ApiProperty({ description: 'Единица', enum: PRODUCT_UNITS })
  unit: ProductUnit;

  @ApiProperty({ description: 'Вес единицы, граммы', example: 1 })
  weightPerUnitGrams: number;

  @ApiProperty({ description: 'Сколько надо по раскладке', example: 600 })
  needAmount: number;

  @ApiProperty({ description: 'Сколько это в граммах', example: 600 })
  needGrams: number;

  @ApiProperty({ description: 'Куплено', example: false })
  isBought: boolean;

  @ApiProperty({
    description: 'Домашнее: покупать не нужно, но строка остаётся',
    example: false,
  })
  isHome: boolean;

  @ApiProperty({
    description: 'Сколько куплено фактически',
    nullable: true,
    example: 600,
  })
  boughtAmount: number | null;

  @ApiProperty({ description: 'Кто отметил покупку', nullable: true })
  boughtByName: string | null;

  @ApiProperty({ description: 'Когда отметили', nullable: true })
  boughtAt: string | null;

  @ApiProperty({
    description: 'Продукт ушёл из раскладки, но куплен — строка осталась',
    example: false,
  })
  isOrphaned: boolean;
}

export class TripMealCheckListDto {
  @ApiProperty({ description: 'Чек-лист', type: [TripMealCheckDto] })
  checks: TripMealCheckDto[];
}

/** Тело `PUT /api/trips/:id/meal-checks/:productId`. */
export class UpdateMealCheckDto {
  @ApiProperty({
    description: 'Куплено. Не задано — не трогаем',
    required: false,
    example: true,
  })
  @IsOptional()
  @IsBoolean({ message: 'Отметка «куплено» — true или false' })
  isBought?: boolean;

  @ApiProperty({
    description: 'Домашнее. Не задано — не трогаем',
    required: false,
    example: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'Отметка «домашнее» — true или false' })
  isHome?: boolean;

  @ApiProperty({
    description: 'Сколько куплено фактически. null — сбросить',
    required: false,
    nullable: true,
    example: 600,
  })
  @IsOptional()
  @IsInt({ message: 'Купленное количество — целое число' })
  @Min(0, { message: 'Купленное количество не может быть отрицательным' })
  boughtAmount?: number | null;
}
