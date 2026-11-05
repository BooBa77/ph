import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';
import { ChecklistItem } from './checklist-item.entity';

/**
 * Отметка участника на пункте рекомендации организатора (05.11.2026).
 *
 * **Почему не `checklist_items.is_done`.** Пункт рекомендации один на всех
 * участников, а «взял» у каждого своё. Если писать отметку в сам пункт,
 * первый же участник отметил бы вещь за всех — ровно то, чего заказчик
 * не хотел: «Отметки о выполнении не возвращаются организатору, он передал
 * рекомендацию, дальше всё на совести участника».
 *
 * Поэтому отметка — отдельная строка на пару «пункт + человек». Организатор
 * видит рекомендацию без отметок, участник — свою галочку; чужие галочки
 * ему не нужны.
 *
 * **Строка есть — пункт отмечен.** Отдельного `is_done` нет: сняли отметку —
 * строку удалили, снова поставили — вставили заново. Так невозможно получить
 * «отметка false, а done_at есть» — половину состояния, которую пришлось бы
 * ловить CHECK-ом.
 *
 * Удаление пункта рекомендации уносит и отметки (`CASCADE`): совет убрали —
 * галочкам на него не место. Пользователь удаляется только мягко, поэтому
 * `RESTRICT` — как у всех ссылок на человека в проекте.
 */
@Entity('checklist_recommendation_marks')
@Index('UQ_checklist_recommendation_marks', ['itemId', 'userId'], {
  unique: true,
})
@Index('IDX_checklist_recommendation_marks_user', ['userId'])
export class ChecklistRecommendationMark {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'item_id', type: 'bigint' })
  itemId: string;

  @ManyToOne(() => ChecklistItem, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'item_id',
    foreignKeyConstraintName: 'FK_checklist_recommendation_marks_item',
  })
  item: ChecklistItem;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'FK_checklist_recommendation_marks_user',
  })
  user: User;

  @CreateDateColumn({ name: 'done_at', type: 'timestamptz' })
  doneAt: Date;
}
