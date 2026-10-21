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
import { Trip } from '../../trips/entities/trip.entity';
import type { ChecklistScope } from '../checklist.types';

/**
 * Чек-лист: шаблон пользователя, общий список похода или личный в походе.
 *
 * **Одна таблица на три области** — потому что поля у них одни и те же,
 * а различие только в правилах доступа, которые всё равно живут
 * в приложении. Три таблицы дали бы три одинаковых набора CRUD-запросов
 * и три способа ошибиться в них по-разному.
 *
 * Законные комбинации записаны CHECK-ом (`chk_checklists_scope`):
 *
 * - `template` — шаблон: `trip_id` NULL, владелец есть;
 * - `trip` — общий список похода: `trip_id` есть, владельца нет (он
 *   принадлежит походу, а не человеку: организатор уйдёт — список
 *   останется);
 * - `personal` — личный список участника: есть и поход, и владелец.
 *
 * **Шаблон — это шаблон, а не ссылка.** В поход попадает копия: правка
 * шаблона не должна переписывать прошедший поход, а удаление шаблона —
 * обнулять чек-лист, по которому уже ходили.
 *
 * Уникальность: один общий список на поход и один личный на пару
 * «поход + человек». Два общих списка означали бы два места, где отмечают
 * одно и то же (частичные уникальные индексы в миграции `Checklists`).
 */
@Entity('checklists')
@Index('UQ_checklists_trip_shared', ['tripId'], {
  unique: true,
  where: `"scope" = 'trip'`,
})
@Index('UQ_checklists_trip_personal', ['tripId', 'ownerUserId'], {
  unique: true,
  where: `"scope" = 'personal'`,
})
@Index('IDX_checklists_owner', ['ownerUserId'])
@Check(
  'chk_checklists_scope',
  `("scope" = 'template' AND "trip_id" IS NULL AND "owner_user_id" IS NOT NULL)
   OR ("scope" = 'trip' AND "trip_id" IS NOT NULL AND "owner_user_id" IS NULL)
   OR ("scope" = 'personal' AND "trip_id" IS NOT NULL AND "owner_user_id" IS NOT NULL)`,
)
export class Checklist {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  /** `template` | `trip` | `personal` — см. `checklist.types.ts`. */
  @Column({ type: 'varchar', length: 20 })
  scope: ChecklistScope;

  /**
   * Владелец списка. У общего списка похода его нет намеренно: список
   * принадлежит походу, и «мой общий список» — это уже не общий.
   */
  @Column({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({
    name: 'owner_user_id',
    foreignKeyConstraintName: 'FK_checklists_owner',
  })
  owner: User | null;

  /** Поход, в котором живёт список. У шаблона — NULL. */
  @Column({ name: 'trip_id', type: 'bigint', nullable: true })
  tripId: string | null;

  @ManyToOne(() => Trip, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({
    name: 'trip_id',
    foreignKeyConstraintName: 'FK_checklists_trip',
  })
  trip: Trip | null;

  /**
   * Заголовок. У шаблона он обязателен («Снаряжение, лето»), у списков
   * похода обычно пуст: «общий чек-лист» — это и так понятно по вкладке.
   * Поэтому пустая строка по умолчанию, а проверка «не пусто» — забота
   * сервиса и только для шаблонов.
   */
  @Column({ type: 'varchar', length: 120, default: '' })
  title: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
