import {
  Check,
  Column,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { GEAR_CODE_PATTERN } from '../gear.types';
import { GearItem } from './gear-item.entity';

/**
 * Группа снаряжения — **полка каталога**, а не тип вещи (31.10.2026).
 *
 * Заказчик: «Группа — это полка в каталоге и в снаряжении похода
 * („Костровое“, „Ночлег“), а не тип: одна группа собирает топор, пилу
 * и розжиг, которые лежат в разных типах». Поэтому группа — отдельная
 * таблица, а вещь ссылается на неё (`gear_items.group_id`). У типа группы
 * нет: `gear_types.group_id` не делаем — иначе топор нельзя было бы
 * положить в «Костровое», не переопределив тип.
 *
 * **Группа у вещи обязательна.** Иначе вещь выпала бы из каталога, который
 * на экране собран секциями по группам. Для вещей, которым полка не нужна,
 * есть «Прочее» (`code = 'other'`): это группа по умолчанию, и API ставит
 * её, когда `groupId` не передали. Архив «Прочего» запрещён — иначе
 * умолчание некуда девать.
 *
 * **`code` — контракт и не меняется**, как у типов: он уходит в API,
 * на него опирается умолчание (`other`) и будущие фильтры. Ошибку
 * исправляют архивом и новой строкой с новым кодом.
 *
 * **Порядок задаёт админ** (`sort_order`), а вещи внутри группы человек
 * упорядочивает сам (`gear_items.sort_order`): это разные порядки и разные
 * владельцы настройки.
 *
 * **Удаления нет, есть архив** (`is_active`): на группу ссылаются вещи,
 * и физическое удаление выдернуло бы их полку. Архивная группа видна
 * в админке, но не в публичном списке; вещи в ней остаются и идут после
 * действующих групп.
 */
@Entity('gear_groups')
@Unique('UQ_gear_groups_code', ['code'])
@Check(
  'chk_gear_groups_code',
  `"code" ~ '${GEAR_CODE_PATTERN.source}' AND char_length("code") <= 40`,
)
@Check('chk_gear_groups_name', `char_length(btrim("name")) BETWEEN 1 AND 100`)
@Check('chk_gear_groups_sort', `"sort_order" >= 0`)
export class GearGroup {
  @PrimaryGeneratedColumn({ type: 'integer' })
  id: number;

  /** Стабильный код: `other`, `campfire`, `kitchen`, `roof`. */
  @Column({ type: 'text' })
  code: string;

  /** Название для человека: «Костровое», «Прочее». */
  @Column({ type: 'text' })
  name: string;

  /** Архив: группа остаётся в справочнике, но не отдаётся публично. */
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** Порядок секций каталога; задаёт админ, а не алфавит. */
  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number;

  @OneToMany(() => GearItem, (item) => item.group)
  items: GearItem[];
}
