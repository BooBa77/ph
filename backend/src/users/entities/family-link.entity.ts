import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from './user.entity';
import { FAMILY_LINK_STATUSES, type FamilyLinkStatus } from '../family.types';
import { sqlValues } from '../sport-experience.types';

/**
 * Родная связь между двумя людьми (10.11.2026).
 *
 * Заказчик: «Вводим понятие „родные“, это члены семьи, с которыми общий
 * бюджет и снаряжение». Модель и причины — `family.types.ts`.
 *
 * ## Канонический порядок пары
 *
 * `user_a_id < user_b_id` — правило базы (`chk_family_links_pair`), а не
 * соглашение кода. Оно делает пару уникальной одним индексом: две строки
 * «Иван → Анна» и «Анна → Иван» физически невозможны. Сортировать uuid
 * умеет и Postgres, и сервис — сравнение идёт по строке, а `ParseUUIDPipe`
 * не меняет регистр, поэтому сервис приводит обе стороны к нижнему регистру
 * перед сравнением.
 *
 * ## Кто отправил запрос
 *
 * `requested_by_user_id` — одна из двух сторон (`chk_family_links_requester`).
 * Вторая сторона подтверждает запрос; для виртуального человека
 * (`is_virtual`) подтверждения нет — его создатель и есть подтверждение.
 *
 * `responded_at` — момент согласия. CHECK требует «принято тогда и только
 * тогда, когда есть дата»: строка `accepted` без даты означала бы родство,
 * о котором никто не договаривался.
 *
 * ## Удаление людей
 *
 * `ON DELETE CASCADE`, а не `RESTRICT`: родство — личная связь без
 * исторической ценности, и уход человека (в том числе физическое удаление
 * тестовой строки) не должен оставлять висящую запись о нём. Обычный
 * пользователь удаляется мягко (`deleted_at`), и тогда связь остаётся, но
 * в списке не показывается — человек не пропадает из походов.
 */
@Entity('family_links')
@Check('chk_family_links_pair', `"user_a_id" < "user_b_id"`)
@Check(
  'chk_family_links_requester',
  `"requested_by_user_id" IN ("user_a_id", "user_b_id")`,
)
@Check(
  'chk_family_links_status',
  `"status" IN (${sqlValues(FAMILY_LINK_STATUSES)})`,
)
@Check(
  'chk_family_links_responded',
  `("status" = 'accepted') = ("responded_at" IS NOT NULL)`,
)
@Index('UQ_family_links_pair', ['userAId', 'userBId'], { unique: true })
@Index('IDX_family_links_user_b', ['userBId'])
export class FamilyLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Первая (меньшая по uuid) сторона пары. */
  @Column({ name: 'user_a_id', type: 'uuid' })
  userAId: string;

  /** Вторая (большая по uuid) сторона пары. */
  @Column({ name: 'user_b_id', type: 'uuid' })
  userBId: string;

  /** Кто отправил запрос: одна из двух сторон. */
  @Column({ name: 'requested_by_user_id', type: 'uuid' })
  requestedByUserId: string;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status: FamilyLinkStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /** Когда родство подтвердили. `NULL` — запрос ещё висит. */
  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_a_id',
    foreignKeyConstraintName: 'FK_family_links_user_a',
  })
  userA: User;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'user_b_id',
    foreignKeyConstraintName: 'FK_family_links_user_b',
  })
  userB: User;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'requested_by_user_id',
    foreignKeyConstraintName: 'FK_family_links_requested_by',
  })
  requestedBy: User;
}
