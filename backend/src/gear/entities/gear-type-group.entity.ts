import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { GearGroup } from './gear-group.entity';
import { GearType } from './gear-type.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Раскладка типов по личным группам (02.11.2026).
 *
 * Заказчик: «группировать их [типы] разрешим самостоятельно… можно
 * переименовывать, удалять, перекидывать содержащиеся типы». Одна строка —
 * «этот тип у этого человека лежит в этой группе».
 *
 * **`UNIQUE (owner_user_id, gear_type_id)`** — тип лежит ровно в одной
 * группе. Без этого вещь одного типа показалась бы в двух секциях каталога,
 * а «перекинуть тип» означало бы «добавить ещё одну строку».
 *
 * **Свои строки, а не общий справочник.** Раскладка у каждого своя: две
 * группы `gear_groups` с одним именем у разных людей — это разные группы,
 * и внешний ключ на `group_id` не даст перепутать их, потому что группа
 * принадлежит тому же `owner_user_id` (это проверяет сервис).
 *
 * **Каскады.** Удалили группу — строки раскладки уходят (`CASCADE`), но
 * сервис сначала переносит типы в «Прочее»: иначе тип исчез бы из каталога
 * вместе с вещами. Удалили тип — раскладка не нужна.
 */
@Entity('gear_type_groups')
@Unique('UQ_gear_type_groups_type', ['ownerUserId', 'gearTypeId'])
@Index('IDX_gear_type_groups_group', ['ownerUserId', 'groupId'])
export class GearTypeGroup {
  @PrimaryGeneratedColumn({ type: 'integer' })
  id: number;

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'owner_user_id',
    foreignKeyConstraintName: 'FK_gear_type_groups_owner',
  })
  owner: User;

  @Column({ name: 'gear_type_id', type: 'integer' })
  gearTypeId: number;

  @ManyToOne(() => GearType, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'gear_type_id',
    foreignKeyConstraintName: 'FK_gear_type_groups_type',
  })
  gearType: GearType;

  @Column({ name: 'group_id', type: 'integer' })
  groupId: number;

  @ManyToOne(() => GearGroup, (group) => group.typeGroups, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'group_id',
    foreignKeyConstraintName: 'FK_gear_type_groups_group',
  })
  group: GearGroup;
}
