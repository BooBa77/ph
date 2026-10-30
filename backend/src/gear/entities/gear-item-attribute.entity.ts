import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { GearItem } from './gear-item.entity';
import { GearTypeAttribute } from './gear-type-attribute.entity';

/**
 * Значение характеристики у вещи: «вместимость 3 места», «модель MSR».
 *
 * **Типизированные колонки, а не jsonb.** Вид характеристики (`number`,
 * `text`, `bool`, `select`) решает, в какую колонку ляжет значение, и по
 * этой колонке потом фильтруют и сравнивают. В jsonb значение пришлось бы
 * приводить к типу на каждом чтении, а опечатку «3 места» вместо `3`
 * база бы не заметила.
 *
 * **Ровно одно значение.** CHECK `num_nonnulls(number_value, text_value,
 * bool_value) = 1` не даёт ни пустой строки, ни двух значений сразу:
 * и то и другое — ошибка записи, а не вариант данных. Соответствие вида
 * колонке (число → `number_value`, строка и список → `text_value`,
 * галочка → `bool_value`) проверяет API: колонка выбирается там же, где
 * читается вид, и второй раз это правило не дублируется.
 *
 * **Одно значение на характеристику.** `UNIQUE (gear_item_id,
 * gear_type_attribute_id)`: «две вместимости у одной палатки» — это не
 * две палатки, а непонимание, что значение одно.
 *
 * **`ON DELETE CASCADE` с обеих сторон.** Вещь удаляют — значения уходят
 * вместе с ней, иначе они осиротели бы; характеристику физически удаляют
 * (в API это архив) — значения без неё нечитаемы, потому что ни имени,
 * ни вида у них не осталось.
 *
 * Число хранится `numeric`, а не `int`: у характеристики может быть дробь
 * («2,5 литра газа»), и терять её при записи незачем. В DTO число приходит
 * **числом**: `numeric` в Node приезжает строкой, и без `transformer`
 * она утекла бы в JSON строкой — ровно та причина, по которой вес снаряжения
 * измеряется граммами и лежит `int`.
 */
@Entity('gear_item_attributes')
@Unique('UQ_gear_item_attributes', ['gearItemId', 'gearTypeAttributeId'])
@Check(
  'chk_gear_item_attributes_one_value',
  `num_nonnulls("number_value", "text_value", "bool_value") = 1`,
)
@Check(
  'chk_gear_item_attributes_text',
  `"text_value" IS NULL OR btrim("text_value") <> ''`,
)
export class GearItemAttribute {
  @PrimaryGeneratedColumn({ type: 'integer' })
  id: number;

  @Column({ name: 'gear_item_id', type: 'bigint' })
  gearItemId: string;

  @ManyToOne(() => GearItem, (item) => item.attributes, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'gear_item_id',
    foreignKeyConstraintName: 'FK_gear_item_attributes_item',
  })
  gearItem: GearItem;

  @Column({ name: 'gear_type_attribute_id', type: 'integer' })
  gearTypeAttributeId: number;

  @ManyToOne(() => GearTypeAttribute, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'gear_type_attribute_id',
    foreignKeyConstraintName: 'FK_gear_item_attributes_attribute',
  })
  gearTypeAttribute: GearTypeAttribute;

  /** Числовое значение: «3 места», «2,5 литра». */
  @Column({
    name: 'number_value',
    type: 'numeric',
    nullable: true,
    transformer: {
      to: (value: number | null) => value,
      from: (value: string | null) => (value === null ? null : Number(value)),
    },
  })
  numberValue: number | null;

  /**
   * Текстовое значение: модель палатки, а у списка — **имя выбранного
   * варианта** (одинаково для выбранного и для своего). Отсюда правило,
   * записанное в `gear-types.md`: переименование варианта обязано одной
   * транзакцией обновить и старые значения.
   */
  @Column({ name: 'text_value', type: 'text', nullable: true })
  textValue: string | null;

  /** Галочка: «баллон новый». `false` — значение, а не пустота. */
  @Column({ name: 'bool_value', type: 'boolean', nullable: true })
  boolValue: boolean | null;
}
