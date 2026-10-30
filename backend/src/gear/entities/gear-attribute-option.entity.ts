import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { GEAR_CODE_PATTERN } from '../gear.types';
import { GearTypeAttribute } from './gear-type-attribute.entity';

/**
 * Вариант характеристики-списка: «резьбовой», «цанговый», «гравитационный».
 *
 * Зачем отдельная таблица, а не массив строк в характеристике (решение
 * заказчика 30.10.2026): **варианты перекручиваются** — админ переименовывает,
 * добавляет и архивирует их. Массив этого не переживает: у строки в массиве
 * нет стабильного кода, нет архива и нет порядка, а переименование пришлось бы
 * руками размазывать по всем местам, где значение уже сохранено. Отдельная
 * строка даёт то же, что уже дали типы: **код латиницей как контракт, имя для
 * человека, порядок, архив вместо удаления**.
 *
 * **`code` — стабильный контракт и не меняется.** На него будут опираться
 * фильтры Stage B и, позже, значения экземпляров; в `PATCH` поля `code` нет
 * (400). Ошибка в коде лечится архивом варианта и новым вариантом с новым
 * кодом — как у типов и характеристик.
 *
 * **`name` — то, что видит человек.** В Stage B `text_value` экземпляра будет
 * хранить **имя** варианта (`text_value` одинаков и для выбранного, и для
 * своего значения — решение заказчика). Отсюда правило, которое надо помнить
 * в Stage B: **переименование варианта обязано одной транзакцией обновить
 * и старые значения** — иначе старые вещи разойдутся с новым именем
 * и фильтр по этому варианту начнёт врать. Сейчас таблицы значений ещё нет,
 * поэтому правило записано в документации (`gear-types.md`), а не в коде.
 *
 * **`UNIQUE (gear_type_attribute_id, code)` без `WHERE is_active`** — как
 * у характеристик: архивный код остаётся занятым. Иначе активный и архивный
 * вариант с одним кодом сосуществовали бы, и значение «по коду» стало бы
 * неоднозначным.
 *
 * **Удаления нет, есть архив** (`is_active`): в Stage B на вариант как минимум
 * будет опираться имя в сохранённом значении, а физическое удаление строки
 * молча оставило бы значения без варианта.
 */
@Entity('gear_attribute_options')
@Unique('UQ_gear_attribute_options_code', ['gearTypeAttributeId', 'code'])
@Check(
  'chk_gear_attribute_options_code',
  `"code" ~ '${GEAR_CODE_PATTERN.source}' AND char_length("code") <= 40`,
)
@Check(
  'chk_gear_attribute_options_name',
  `char_length(btrim("name")) BETWEEN 1 AND 100`,
)
@Check('chk_gear_attribute_options_sort', `"sort_order" >= 0`)
export class GearAttributeOption {
  @PrimaryGeneratedColumn({ type: 'integer' })
  id: number;

  @Column({ name: 'gear_type_attribute_id', type: 'integer' })
  gearTypeAttributeId: number;

  @ManyToOne(() => GearTypeAttribute, (attribute) => attribute.options, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'gear_type_attribute_id',
    foreignKeyConstraintName: 'FK_gear_attribute_options_attribute',
  })
  gearTypeAttribute: GearTypeAttribute;

  /** Код варианта: `thread`, `collet`, `gravity`. */
  @Column({ type: 'text' })
  code: string;

  /** Имя для человека: «резьбовой». Оно же попадёт в `text_value` в Stage B. */
  @Column({ type: 'text' })
  name: string;

  /** Архив: вариант не предлагается, но строка и код остаются. */
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** Порядок в списке: «резьбовой» раньше «цангового», потому что так решил админ. */
  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number;
}
