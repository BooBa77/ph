import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { sqlValues } from '../../users/sport-experience.types';
import { GEAR_CODE_PATTERN, GEAR_VALUE_KINDS } from '../gear.types';
import type { GearValueKind } from '../gear.types';
import { GearType } from './gear-type.entity';

/**
 * Характеристика типа снаряжения: «Вместимость, мест, число».
 *
 * У палатки — мест и модель, у пилы — привод, полотно, бренд и длина,
 * у газового баллона — объём и «новый». Набор у каждого типа свой, поэтому
 * характеристика — строка, а не колонка: добавить «Марку» топору должен
 * уметь админ, а не миграция.
 *
 * **`valueKind` говорит, куда ляжет значение.** В Stage A таблицы значений
 * ещё нет, но вид задаётся сразу: `number` → `number_value`, `text` →
 * `text_value`, `bool` → `bool_value` в Stage B. Поэтому вид **не меняется**
 * ни при каких обстоятельствах (API отвечает 409): смена вида означала бы
 * перенос уже записанных значений, а их тип — часть контракта.
 *
 * **`code` уникален внутри типа, включая архивные.** `UNIQUE (gear_type_id,
 * code)` без `WHERE is_active`: архивный код остаётся занятым. Иначе
 * активный и архивный атрибуты с одним кодом сосуществовали бы, а
 * `attributes {code: value}` в Stage B стал бы неоднозначным. Ошибка
 * в коде лечится архивом и новой строкой с новым кодом.
 *
 * **`isRequired` — про значения, а не про форму справочника.** Обязательный
 * атрибут в Stage B потребует замещающего значения (`fillMissing`), чтобы
 * старые вещи не остались с дырой; в Stage A замещающее значение
 * принимается и проверяется, но писать его некуда.
 */
@Entity('gear_type_attributes')
@Unique('UQ_gear_type_attributes_code', ['gearTypeId', 'code'])
@Check(
  'chk_gear_type_attributes_value_kind',
  `"value_kind" IN (${sqlValues(GEAR_VALUE_KINDS)})`,
)
@Check(
  'chk_gear_type_attributes_code',
  `"code" ~ '${GEAR_CODE_PATTERN.source}' AND char_length("code") <= 40`,
)
@Check(
  'chk_gear_type_attributes_name',
  `char_length(btrim("name")) BETWEEN 1 AND 100`,
)
@Check(
  'chk_gear_type_attributes_unit',
  `"unit" IS NULL OR (btrim("unit") <> '' AND char_length("unit") <= 20)`,
)
@Check('chk_gear_type_attributes_sort', `"sort_order" >= 0`)
export class GearTypeAttribute {
  @PrimaryGeneratedColumn({ type: 'integer' })
  id: number;

  @Column({ name: 'gear_type_id', type: 'integer' })
  gearTypeId: number;

  @ManyToOne(() => GearType, (gearType) => gearType.attributes, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'gear_type_id',
    foreignKeyConstraintName: 'FK_gear_type_attributes_type',
  })
  gearType: GearType;

  /** Код внутри типа: `seats`, `model`, `is_new`. */
  @Column({ type: 'text' })
  code: string;

  /** Название для человека: «Вместимость». */
  @Column({ type: 'text' })
  name: string;

  /** В какую типизированную колонку ляжет значение в Stage B. */
  @Column({ name: 'value_kind', type: 'text' })
  valueKind: GearValueKind;

  /** Единица: «мест», «см», «л». Только для показа рядом со значением. */
  @Column({ type: 'text', nullable: true })
  unit: string | null;

  /** Обязательное значение у вещи (в Stage A только флаг). */
  @Column({ name: 'is_required', type: 'boolean', default: false })
  isRequired: boolean;

  /** Архив: атрибут остаётся, но не отдаётся публично и не спрашивается. */
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number;
}
