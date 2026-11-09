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
import type { ChecklistArea, ChecklistScope } from '../checklist.types';

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
 * - `personal` — личный список участника: есть и поход, и владелец;
 * - `recommendation` — рекомендация личных вещей от организатора: поход
 *   есть, владельца нет. Отметки участников живут отдельно
 *   (`checklist_recommendation_marks`), потому что «взял» у каждого своё.
 *
 * **Шаблон — это шаблон, а не ссылка.** В поход попадает копия: правка
 * шаблона не должна переписывать прошедший поход, а удаление шаблона —
 * обнулять чек-лист, по которому уже ходили.
 *
 * Уникальность: один общий список на поход, одна рекомендация на поход
 * и один личный на пару «поход + человек». Два общих списка означали бы
 * два места, где отмечают одно и то же (частичные уникальные индексы
 * в миграциях `Checklists` и `TripGearChecklists`).
 */
@Entity('checklists')
@Index('UQ_checklists_trip_shared', ['tripId', 'area'], {
  unique: true,
  where: `"scope" = 'trip'`,
})
@Index('UQ_checklists_trip_personal', ['tripId', 'ownerUserId', 'area'], {
  unique: true,
  where: `"scope" = 'personal'`,
})
@Index('UQ_checklists_trip_recommendation', ['tripId', 'area'], {
  unique: true,
  where: `"scope" = 'recommendation'`,
})
@Index('IDX_checklists_owner', ['ownerUserId'])
@Check(
  'chk_checklists_scope',
  `("scope" = 'template' AND "trip_id" IS NULL AND "owner_user_id" IS NOT NULL)
   OR ("scope" = 'trip' AND "trip_id" IS NOT NULL AND "owner_user_id" IS NULL)
   OR ("scope" = 'personal' AND "trip_id" IS NOT NULL AND "owner_user_id" IS NOT NULL)
   OR ("scope" = 'recommendation' AND "trip_id" IS NOT NULL AND "owner_user_id" IS NULL)`,
)
@Check(
  'chk_checklists_area',
  `"area" IN ('gear', 'first_aid')`,
)
@Check(
  'chk_checklists_weight',
  `"weight_grams" IS NULL OR "weight_grams" > 0`,
)
export class Checklist {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  /** `template` | `trip` | `personal` | `recommendation` — см. `checklist.types.ts`. */
  @Column({ type: 'varchar', length: 20 })
  scope: ChecklistScope;

  /**
   * Вкладка похода, которой принадлежит список (09.11.2026).
   *
   * `gear` — «Снаряжение» (и шаблоны профиля), `first_aid` — «Аптечка».
   * Уникальность списков считается по паре «область + поход», поэтому
   * общественная аптечка не конфликтует с общим списком снаряжения.
   */
  @Column({ type: 'varchar', length: 20, default: 'gear' })
  area: ChecklistArea;

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

  /**
   * Вес готовой аптечки в граммах (09.11.2026).
   *
   * Поле есть только у списков аптечки: в «Снаряжении» вес считают вещи.
   * `NULL` — «ещё не взвесили»: в раскладке такая аптечка весит 0 и вес
   * не показывается вовсе, чтобы ноль не читался как «пустая аптечка».
   * `CHECK` не пускает сюда 0: ноль и «неизвестно» — разные вещи, и одна
   * колонка не должна означать обе.
   */
  @Column({ name: 'weight_grams', type: 'integer', nullable: true })
  weightGrams: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
