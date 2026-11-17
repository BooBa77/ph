import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { sqlValues } from '../../users/sport-experience.types';
import { User } from '../../users/entities/user.entity';
import {
  DEPOSIT_STATUSES,
  PARTICIPANT_STATUSES,
  type DepositStatus,
  type ParticipantStatus,
} from '../trip.types';
import { Trip } from './trip.entity';

/**
 * Участник похода.
 *
 * Составной ключ `(trip_id, user_id)` — человек в походе ровно один раз,
 * и это же индекс для выборки участников похода. Для обратного запроса
 * («в каких походах я участвую») нужен отдельный индекс по `user_id`,
 * он объявлен ниже.
 *
 * Организатор здесь тоже есть, и его статус может быть `declined`:
 * «организую, но сам не пойду» — законная ситуация, а не поломка данных.
 * Удалить организатора из участников нельзя — за этим следит триггер
 * (`trg_trip_participants_prevent_organizer_delete`), потому что автор
 * похода не должен теряться даже при ручной правке в базе.
 *
 * `created_at` — когда позвали или когда человек сам попросился;
 * `updated_at` нужен по делу: по нему видно, кто давно висит в `invited`
 * и о ком пора напомнить.
 */
@Entity('trip_participants')
@Check(
  'chk_trip_participants_status',
  `"status" IN (${sqlValues(PARTICIPANT_STATUSES)})`,
)
@Check(
  'chk_trip_participants_deposit_status',
  `"deposit_status" IN (${sqlValues(DEPOSIT_STATUSES)})`,
)
export class TripParticipant {
  @PrimaryColumn({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  /** «Мои походы» — основной запрос к этой таблице. */
  @Index('IDX_trip_participants_user_id')
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => Trip, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'trip_id' })
  trip: Trip;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /**
   * Участие — не роль. `declined` — единый статус «не иду» по любой
   * причине; роли (`trip_participant_roles`) отвечают на другой вопрос:
   * кто завхоз, кто медик, кто руководитель.
   */
  @Column({ type: 'varchar', length: 20, default: 'invited' })
  status: ParticipantStatus;

  /**
   * Отдельное питание: человек не едок — в М/Ж, в вегетарианцах и в мясных
   * количествах не учитывается, пакеты еды ему не назначаются. Ставит сам
   * участник (`meals.md` §5.6); в пищевых долях Бухгалтерии он не участвует.
   */
  @Column({ name: 'eats_separately', type: 'boolean', default: false })
  eatsSeparately: boolean;

  /**
   * Когда личные разделы «Взял» этого человека засеяли шаблонами
   * («Снаряга», «Одежда»), 05.11.2026.
   *
   * Отметка живёт на участии, а не на пользователе: шаблоны относятся
   * к походу, и в другом походе человек начнёт с чистого листа. `NULL` —
   * ещё не сеяли; удалённый шаблон не возвращается.
   */
  @Column({ name: 'gear_sections_seeded_at', type: 'timestamptz', nullable: true })
  gearSectionsSeededAt: Date | null;

  /**
   * Залог участия этого человека (17.11.2026).
   *
   * Смысл имеет только при `trips.deposit_rub IS NOT NULL`; отдельного
   * «залога нет» здесь нет — об этом говорит сам поход. `pending` по
   * умолчанию: как только организатор назначил залог, сдавать его должны
   * все, кто в походе, а не только те, кого он отметил руками.
   *
   * Ставит организатор, **не сам участник**: «сдал» — это факт получения
   * денег, и подтверждать его должен тот, кому их отдали. Кто и когда
   * поставил отметку, хранится рядом — заказчик просил, чтобы было видно
   * авторство («вопрос совести» держится на прозрачности, а не на запретах).
   */
  @Column({
    name: 'deposit_status',
    type: 'varchar',
    length: 20,
    default: 'pending',
  })
  depositStatus: DepositStatus;

  @Column({ name: 'deposit_updated_by', type: 'uuid', nullable: true })
  depositUpdatedBy: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'deposit_updated_by',
    foreignKeyConstraintName: 'FK_trip_participants_deposit_updated_by',
  })
  depositUpdatedByUser: User | null;

  @Column({ name: 'deposit_updated_at', type: 'timestamptz', nullable: true })
  depositUpdatedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
