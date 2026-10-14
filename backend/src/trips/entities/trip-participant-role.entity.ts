import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { Role } from './role.entity';
import { TripParticipant } from './trip-participant.entity';

/**
 * Роли участника в походе — связующая таблица, а не колонки-галочки.
 *
 * Это главное архитектурное решение раздела: у одного человека ролей может
 * быть несколько (организатор + водитель + фотограф), и каждая новая роль —
 * это строка в `roles`, а не миграция с новой колонкой. Двадцать булевых
 * колонок в `trip_participants` пришлось бы расширять на каждую фантазию.
 *
 * Внешний ключ ведёт не на `trips` и не на `users` по отдельности, а на
 * **пару** `(trip_id, user_id)` из `trip_participants`: роль у человека,
 * которого в походе нет, бессмысленна. Отсюда же и `CASCADE`: убрали
 * участника — его роли улетели сами, отдельной уборки не нужно.
 *
 * Роль `organizer` здесь есть, и это осознанная денормализация: источник
 * правды — `trips.organizer_user_id` (NOT NULL, один, не меняется),
 * а строка здесь нужна, чтобы читать все роли одним запросом. Синхронизация
 * проста ровно потому, что организатор не меняется, — она делается один раз
 * при создании похода.
 */
@Entity('trip_participant_roles')
export class TripParticipantRole {
  @PrimaryColumn({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @PrimaryColumn({ name: 'role_id', type: 'bigint' })
  roleId: string;

  @ManyToOne(() => TripParticipant, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'trip_id', referencedColumnName: 'tripId' },
    { name: 'user_id', referencedColumnName: 'userId' },
  ])
  participant: TripParticipant;

  @ManyToOne(() => Role, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'role_id' })
  role: Role;
}
