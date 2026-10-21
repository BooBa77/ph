import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { sqlValues } from '../../users/sport-experience.types';
import { User } from '../../users/entities/user.entity';
import { GEAR_KINDS, type GearKind } from '../gear.types';

/**
 * Личное снаряжение человека: «палатка, 2.4 кг», «спальник, 900 г».
 *
 * **Каталог пользователя, а не похода.** Один и тот же спальник ездит
 * во все походы, и заводить его заново к каждому — это ровно та работа,
 * от которой каталог и спасает. В походе (вкладка «Снаряжение», Ф7)
 * человек будет **выбирать** из этого списка, а не писать заново.
 *
 * **Вес необязателен, но если указан — то в граммах.** Граммы, а не
 * килограммы с дробью: `numeric` в Node приезжает строкой и утёк бы
 * в JSON строкой, а дробные килограммы в снаряжении всё равно округляют.
 * `NULL` — «вес не знаю»; такой предмет не попадает в сумму рюкзака,
 * и это честнее нуля: ноль означал бы «невесомый».
 *
 * **Зачем вес вообще.** Раскладка и «вес рюкзака» (Ф7) считаются из этих
 * чисел: без них вкладка «Снаряжение» — список слов, а не подготовка.
 *
 * Вид (`kind`) — короткий список в коде, см. `gear.types.ts`. У одного
 * человека может быть два спальника и три палатки: поэтому это не
 * «одна вещь на категорию», а обычный список предметов.
 */
@Entity('gear_items')
@Index('IDX_gear_items_owner', ['ownerUserId', 'kind', 'id'])
@Check('chk_gear_items_kind', `"kind" IN (${sqlValues(GEAR_KINDS)})`)
@Check(
  'chk_gear_items_weight',
  `"weight_grams" IS NULL OR "weight_grams" > 0`,
)
@Check('chk_gear_items_title', `char_length(btrim("title")) > 0`)
export class GearItem {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'owner_user_id',
    foreignKeyConstraintName: 'FK_gear_items_owner',
  })
  owner: User;

  @Column({ type: 'varchar', length: 20 })
  kind: GearKind;

  /** Название словами: «Палатка на четверых», «Спальник зимний». */
  @Column({ type: 'varchar', length: 120 })
  title: string;

  /** Вес в граммах. `NULL` — не указан (и не считается). */
  @Column({ name: 'weight_grams', type: 'int', nullable: true })
  weightGrams: number | null;

  /** Комментарий: «проклеена, течёт по шву». */
  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
