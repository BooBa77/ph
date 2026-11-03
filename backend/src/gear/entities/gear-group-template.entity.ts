import {
  Check,
  Column,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { GEAR_CODE_PATTERN } from '../gear.types';

/**
 * Рекомендуемая группа снаряжения — шаблон админа (02.11.2026).
 *
 * Заказчик: «Заводим рекомендуемые группы, они управляются админом,
 * приходят новым пользователям и с новыми типами, но пользователь в праве
 * сам менять их под себя».
 *
 * Шаблон — не рабочая группа: на него ссылается рекомендуемая группа типа
 * (`gear_types.recommended_group_id`), а человек получает **копию**
 * в `gear_groups` при первом открытии каталога. Копия живёт своей жизнью:
 * переименование или удаление у одного человека не трогает ни шаблон,
 * ни группы других.
 *
 * **`code` — контракт и не меняется**, как у типов: по нему личная копия
 * находит «Прочее» (`other`) и понимает, в какую группу положить новый тип.
 * Ошибку исправляют архивом и новой строкой с новым кодом.
 *
 * **Удаления нет, есть архив** (`is_active`): на шаблон ссылаются типы.
 * Архивный шаблон не предлагается админу в выборе рекомендуемой группы
 * и не создаётся новым пользователям; у существующих личных копий он
 * остаётся как был.
 */
@Entity('gear_group_templates')
@Unique('UQ_gear_group_templates_code', ['code'])
@Check(
  'chk_gear_group_templates_code',
  `"code" ~ '${GEAR_CODE_PATTERN.source}' AND char_length("code") <= 40`,
)
@Check('chk_gear_group_templates_name', `char_length(btrim("name")) BETWEEN 1 AND 100`)
@Check('chk_gear_group_templates_sort', `"sort_order" >= 0`)
export class GearGroupTemplate {
  @PrimaryGeneratedColumn({ type: 'integer' })
  id: number;

  /** Стабильный код: `other`, `campfire`, `kitchen`, `roof`, `dishes`. */
  @Column({ type: 'text' })
  code: string;

  /** Название для человека: «Костровое», «Прочее». */
  @Column({ type: 'text' })
  name: string;

  /** Архив: шаблон остаётся в админке, но новым пользователям не едет. */
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** Порядок, в котором группы придут новому пользователю. */
  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number;
}
