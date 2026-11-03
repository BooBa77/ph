import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';
import { GEAR_CODE_PATTERN } from '../gear.types';
import { GearTypeGroup } from './gear-type-group.entity';

/**
 * Личная группа снаряжения (02.11.2026).
 *
 * Заказчик: «Типы, по-прежнему, создаёт админ… А группировать их разрешим
 * самостоятельно. Заводим рекомендуемые группы, они управляются админом,
 * приходят новым пользователям и с новыми типами, но пользователь в праве
 * сам менять их под себя».
 *
 * Поэтому группа теперь **личная** (`owner_user_id`) и собирает **типы**,
 * а не вещи: вещь попадает в группу своего типа. Связь «тип → группа»
 * лежит в `gear_type_groups`, а не здесь: одна строка — один тип.
 *
 * `template_code` — след шаблона, из которого группа пришла (`roof`,
 * `campfire`, `kitchen`, `dishes`, `other`). Он нужен ровно для двух вещей:
 * найти «Прочее» (`other`) и положить в ту же группу новый тип, для
 * которого админ указал этот шаблон. У группы, заведённой человеком,
 * шаблона нет (`NULL`).
 *
 * **«Прочее» неудаляемо и всегда последнее.** Это умолчание для типа без
 * рекомендованной группы и место, куда переезжают типы удалённой группы;
 * переставить его выше других API не даёт.
 *
 * **Удаление разрешено, архива нет.** Группа — личная настройка, и человек
 * вправе её убрать; типы уходят в «Прочее», вещи не теряются. Это отличие
 * от шаблонов админа (`gear_group_templates`), где удаление заменено
 * архивом, потому что на шаблон ссылается рекомендуемая группа типа.
 */
@Entity('gear_groups')
@Index('IDX_gear_groups_owner_order', ['ownerUserId', 'sortOrder', 'id'])
@Index('UQ_gear_groups_owner_template', ['ownerUserId', 'templateCode'], {
  unique: true,
  where: `"template_code" IS NOT NULL`,
})
@Check('chk_gear_groups_name', `char_length(btrim("name")) BETWEEN 1 AND 100`)
@Check('chk_gear_groups_sort', `"sort_order" >= 0`)
@Check(
  'chk_gear_groups_template_code',
  `"template_code" IS NULL OR ("template_code" ~ '${GEAR_CODE_PATTERN.source}' AND char_length("template_code") <= 40)`,
)
export class GearGroup {
  @PrimaryGeneratedColumn({ type: 'integer' })
  id: number;

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'owner_user_id',
    foreignKeyConstraintName: 'FK_gear_groups_owner',
  })
  owner: User;

  /** Код шаблона, из которого пришла группа. `NULL` — своя группа. */
  @Column({ name: 'template_code', type: 'text', nullable: true })
  templateCode: string | null;

  /** Название для человека: «Кров», «Костровое», «Прочее». */
  @Column({ type: 'text' })
  name: string;

  /** Порядок секций каталога: свой у каждого человека. */
  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number;

  @OneToMany(() => GearTypeGroup, (mapping) => mapping.group)
  typeGroups: GearTypeGroup[];
}
