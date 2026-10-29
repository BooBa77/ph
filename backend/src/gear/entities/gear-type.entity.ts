import {
  Check,
  Column,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { GEAR_CODE_PATTERN } from '../gear.types';
import { GearTypeAttribute } from './gear-type-attribute.entity';

/**
 * Тип снаряжения: «Палатка», «Топор», «Газовый баллон».
 *
 * **Данные, а не код.** Типы правит админ (`/admin/gear`), и появление
 * «гамака» или «тента» не должно означать миграцию. Поэтому таблица,
 * а не список в коде как `GEAR_KINDS`: тот список — виды старого каталога,
 * которые как раз и уедут в Stage B.
 *
 * **`code` — контракт и не меняется.** Латиница по регулярке, уникален,
 * в `PATCH` его нет: на код будут опираться фильтры Stage B и фронт.
 * Ошибка в коде лечится архивом строки и новой строкой с новым кодом —
 * не переименованием.
 *
 * **Групп нет.** `kind` у типа не заводим: группы (`gear_groups` +
 * `gear_types.group_id`) — отдельная миграция Stage B, тогда же `kind`
 * уедет из `gear_items`. Пока список типов в админке плоский.
 *
 * **Удаления нет, есть архив** (`is_active`): в Stage B на тип будут
 * ссылаться вещи, а физическое удаление строки из справочника выдернуло бы
 * их молча. Архивный тип виден в админке, но не в публичном API.
 */
@Entity('gear_types')
@Unique('UQ_gear_types_code', ['code'])
@Check(
  'chk_gear_types_code',
  `"code" ~ '${GEAR_CODE_PATTERN.source}' AND char_length("code") <= 40`,
)
@Check('chk_gear_types_name', `char_length(btrim("name")) BETWEEN 1 AND 100`)
@Check('chk_gear_types_sort', `"sort_order" >= 0`)
export class GearType {
  @PrimaryGeneratedColumn({ type: 'integer' })
  id: number;

  /** Стабильный код: `tent`, `axe`, `gas`. */
  @Column({ type: 'text' })
  code: string;

  /** Название для человека: «Палатка». */
  @Column({ type: 'text' })
  name: string;

  /** Архив: тип остаётся в справочнике, но не отдаётся публично. */
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** Порядок в списке; порядок задаёт админ, а не алфавит. */
  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number;

  @OneToMany(() => GearTypeAttribute, (attribute) => attribute.gearType)
  attributes: GearTypeAttribute[];
}
