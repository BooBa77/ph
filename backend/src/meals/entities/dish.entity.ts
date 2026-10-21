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

import { User } from '../../users/entities/user.entity';

/**
 * Блюдо кулинарной книги пользователя: «каша с тушёнкой», «суп из пакета».
 *
 * **Личное**, в отличие от продуктов: у каждого своя книга, и чужие блюда
 * не видны никому — ни другим участникам, ни организатору. В поход блюдо
 * попадает **снимком состава** (решение в `trip-tabs.md`): правка блюда
 * в книге не должна переписывать прошедший поход, поэтому вкладка «Питание»
 * будет копировать состав, а не ссылаться на блюдо.
 *
 * Состав живёт отдельными строками (`dish_ingredients`), а не текстом:
 * из строк складывается вес блюда и список продуктов для магазина.
 */
@Entity('dishes')
@Index('IDX_dishes_owner', ['ownerUserId', 'id'])
@Check('chk_dishes_title', `char_length(btrim("title")) > 0`)
export class Dish {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'owner_user_id',
    foreignKeyConstraintName: 'FK_dishes_owner',
  })
  owner: User;

  /** Название блюда: «Каша с тушёнкой». */
  @Column({ type: 'varchar', length: 120 })
  title: string;

  /** Как готовить и прочие заметки: «варить 15 минут, солить в конце». */
  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
