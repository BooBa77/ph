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

/**
 * Действующая родственная связь между двумя людьми (10.11.2026).
 *
 * Заказчик: «Вводим понятие „родные“, это члены семьи, с которыми общий
 * бюджет и снаряжение». Модель и причины — `family.types.ts`.
 *
 * ## Строка есть — родные, строки нет — нет
 *
 * С 11.11.2026 у связи **нет статуса**: заявки на объединение семьи живут
 * в `family_unions`, а здесь только состоявшееся родство. В прошлом шаге
 * `pending` стоял прямо в паре, и одна и та же мысль («ждём согласия»)
 * хранилась в двух местах: в паре — статусом, в заявке — составом.
 *
 * ## Канонический порядок пары
 *
 * `user_a_id < user_b_id` — правило базы (`chk_family_links_pair`), а не
 * соглашение кода. Оно делает пару уникальной одним индексом: две строки
 * «Иван → Анна» и «Анна → Иван» физически невозможны. Сортировать uuid
 * умеют и Postgres, и сервис — сравнение идёт по строке, а `ParseUUIDPipe`
 * не меняет регистр, поэтому сервис приводит обе стороны к нижнему
 * регистру перед сравнением.
 *
 * ## Дата
 *
 * `accepted_at` — когда родство возникло: у связей, созданных заявкой,
 * это момент, когда согласились все. `created_at` — когда строку записали
 * (у связей от заявки они совпадают). В «Контактах» показывается
 * `accepted_at`: «родные с 11 ноября», а не «строка вставлена».
 *
 * ## Удаление людей
 *
 * `ON DELETE CASCADE`, а не `RESTRICT`: родство — личная связь без
 * исторической ценности, и уход человека (в том числе физическое удаление
 * тестовой строки) не должен оставлять висящую запись о нём. Обычный
 * пользователь удаляется мягко (`deleted_at`), и тогда связь остаётся,
 * но в списке не показывается — человек не пропадает из походов.
 */
@Entity('family_links')
@Check('chk_family_links_pair', `"user_a_id" < "user_b_id"`)
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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /** Когда родство возникло — его и показывает экран «родные с …». */
  @Column({
    name: 'accepted_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  acceptedAt: Date;

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
}
