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
 * а не список в коде: списком такой справочник был бы закрыт для правок
 * без выпуска новой версии бэкенда.
 *
 * **`code` — контракт и не меняется.** Латиница по регулярке, уникален,
 * в `PATCH` его нет: на код опираются фильтры экранов и фронт.
 * Ошибка в коде лечится архивом строки и новой строкой с новым кодом —
 * не переименованием.
 *
 * **Групп нет.** Группы (`gear_groups` + привязка вещей) — отдельная
 * миграция Stage B, у типа группы не будет: группируются вещи, а не
 * справочник. Пока список типов в админке плоский.
 *
 * **Удаления нет, есть архив** (`is_active`): на тип ссылаются вещи,
 * а физическое удаление строки из справочника выдернуло бы их молча.
 * Архивный тип виден в админке, но не в публичном API.
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
