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

import { GearItem } from '../../gear/entities/gear-item.entity';
import { User } from '../../users/entities/user.entity';
import { Checklist } from './checklist.entity';

/**
 * Пункт чек-листа: «палатка», «газ», «аптечка».
 *
 * **Отметка и её автор.** `is_done` — состояние, `done_by_user_id`
 * и `done_at` — кто и когда. «Кто» нужно не для отчёта, а для вопроса
 * «Ваня, ты взял газ?»: в общем списке отмечать может любой участник,
 * и без автора отметка обезличена. Пара пишется и снимается только
 * вместе — CHECK `chk_checklist_items_done` не пропустит половину
 * состояния.
 *
 * `title` — обычный текст, не markdown: пункт читают в списке с галочкой,
 * а не в тексте.
 *
 * **Пункт бывает двух видов (31.10.2026).** Обычный текст — «спички»,
 * «бинт» — и указание на конкретный экземпляр снаряжения: `gear_item_id`
 * ссылается на вещь личного каталога. Ссылка не заменяет `title`, а
 * дополняет его: `title` — снимок названия вещи на момент привязки, и
 * благодаря ему пункт читается даже тогда, когда вещи уже нет.
 *
 * **Удалили вещь — пункт остался текстом типа.** Это делает триггер в базе
 * (`trg_gear_items_unlink_checklists`), а не сервис: вещь уходит и ручкой
 * каталога, и каскадом одноразовой вещи похода, а сервисная уборка прошла
 * бы мимо каскадов. После удаления `gear_item_id` — NULL, `title` — имя
 * типа («Палатка»), и пункт снова обычный текстовый.
 *
 * `created_by_user_id` есть по той же причине, что `done_by`: в общем
 * списке пункты добавляет организатор, в личном — сам человек, а
 * «организатор предложил в личный» однажды появится (см. `trip-tabs.md`)
 * и потребует различать автора и владельца.
 */
@Entity('checklist_items')
@Index('IDX_checklist_items_list', ['checklistId', 'id'])
@Index('IDX_checklist_items_gear', ['gearItemId'])
@Check('chk_checklist_items_title', `char_length(btrim("title")) > 0`)
@Check(
  'chk_checklist_items_done',
  `("is_done" = false AND "done_at" IS NULL)
   OR ("is_done" = true AND "done_at" IS NOT NULL)`,
)
export class ChecklistItem {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'checklist_id', type: 'bigint' })
  checklistId: string;

  @ManyToOne(() => Checklist, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'checklist_id',
    foreignKeyConstraintName: 'FK_checklist_items_list',
  })
  checklist: Checklist;

  /** Текст пункта: «Палатка на четыре человека». */
  @Column({ type: 'varchar', length: 200 })
  title: string;

  /**
   * Конкретный экземпляр снаряжения из личного каталога автора пункта.
   *
   * `NULL` — обычный текстовый пункт. Ссылка необязательна и не заменяет
   * текст: `title` остаётся снимком названия (см. doc класса).
   *
   * `SET NULL` на удаление вещи — страховка уровня FK; настоящий сценарий
   * («ссылка становится текстом типа») делает триггер, который успевает
   * до каскада.
   */
  @Column({ name: 'gear_item_id', type: 'bigint', nullable: true })
  gearItemId: string | null;

  @ManyToOne(() => GearItem, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'gear_item_id',
    foreignKeyConstraintName: 'FK_checklist_items_gear_item',
  })
  gearItem: GearItem | null;

  @Column({ name: 'is_done', type: 'boolean', default: false })
  isDone: boolean;

  @Column({ name: 'done_by_user_id', type: 'uuid', nullable: true })
  doneByUserId: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({
    name: 'done_by_user_id',
    foreignKeyConstraintName: 'FK_checklist_items_done_by',
  })
  doneBy: User | null;

  @Column({ name: 'done_at', type: 'timestamptz', nullable: true })
  doneAt: Date | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({
    name: 'created_by_user_id',
    foreignKeyConstraintName: 'FK_checklist_items_created_by',
  })
  createdBy: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
