import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';

import { User } from './user.entity';
import { FamilyUnion } from './family-union.entity';
import {
  FAMILY_UNION_CONSENTS,
  type FamilyUnionConsent,
} from '../family.types';
import { sqlValues } from '../sport-experience.types';

/**
 * Согласие участника на объединение семей (11.11.2026).
 *
 * Заявка собирает **обе компоненты** связей, поэтому участников столько,
 * сколько родных у двух семей вместе. Каждый отвечает сам:
 *
 * - `pending` — ещё не ответил; `responded_at` тогда пуст
 *   (`chk_family_union_members_responded`);
 * - `accepted` — согласен; когда согласны все, заявка сливает семьи;
 * - `declined` — отказался, и заявка закрывается отказом: одна семья
 *   целиком не может втянуть человека без его слова.
 *
 * Инициатор тоже строка этой таблицы — с `accepted` сразу. Так «сколько
 * ждём ответа» считается одним запросом, без особого случая «а инициатора
 * не считаем».
 *
 * `PRIMARY KEY (union_id, user_id)` — один участник один раз; `user_id`
 * индексирован отдельно, по нему строятся «мои заявки».
 */
@Entity('family_union_members')
@Check(
  'chk_family_union_members_consent',
  `"consent" IN (${sqlValues(FAMILY_UNION_CONSENTS)})`,
)
@Check(
  'chk_family_union_members_responded',
  `("consent" = 'pending') = ("responded_at" IS NULL)`,
)
@Index('IDX_family_union_members_user', ['userId'])
export class FamilyUnionMember {
  @PrimaryColumn({ name: 'union_id', type: 'uuid' })
  unionId: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  consent: FamilyUnionConsent;

  /** Момент ответа. У `pending` — `NULL`: ответа ещё не было. */
  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  @ManyToOne(() => FamilyUnion, (union) => union.members, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'union_id',
    foreignKeyConstraintName: 'FK_family_union_members_union',
  })
  union: FamilyUnion;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_family_union_members_user',
  })
  user: User;
}
