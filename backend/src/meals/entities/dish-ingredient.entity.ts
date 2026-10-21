import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Dish } from './dish.entity';
import { Product } from './product.entity';

/**
 * Строка состава блюда: продукт и его количество.
 *
 * **Количество — в единицах продукта** (граммы, штуки, банки, упаковки),
 * целым числом. Полбанки тушёнки в раскладке не бывает, а дробное
 * количество пришлось бы переводить при каждом сложении веса.
 *
 * **Продукт в блюде один раз** (уникальный индекс): две строки с одним
 * продуктом означали бы два количества одного и того же, и «сколько сахара
 * в каше» стало бы вопросом без ответа.
 *
 * `RESTRICT` на продукт: справочник не удаляют, пока на него ссылаются —
 * блюдо с исчезнувшим продуктом не посчитать. `CASCADE` на блюдо: состав —
 * часть блюда.
 */
@Entity('dish_ingredients')
@Index('UQ_dish_ingredients_product', ['dishId', 'productId'], { unique: true })
@Index('IDX_dish_ingredients_dish', ['dishId', 'id'])
@Check('chk_dish_ingredients_amount', `"amount" > 0`)
export class DishIngredient {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'dish_id', type: 'bigint' })
  dishId: string;

  @ManyToOne(() => Dish, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'dish_id',
    foreignKeyConstraintName: 'FK_dish_ingredients_dish',
  })
  dish: Dish;

  @Column({ name: 'product_id', type: 'int' })
  productId: number;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'product_id',
    foreignKeyConstraintName: 'FK_dish_ingredients_product',
  })
  product: Product;

  /** Количество в единицах продукта: 200 г крупы, 2 банки тушёнки. */
  @Column({ type: 'int' })
  amount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
