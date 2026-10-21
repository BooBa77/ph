import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';

import { sqlValues } from '../../users/sport-experience.types';
import { TRIP_TABS, type TripTab } from '../trip-tabs';
import { Role } from './role.entity';

/**
 * Право роли на вкладку похода: «завхоз ведёт питание и снаряжение».
 *
 * **Почему отдельная таблица, а не флаг в коде.** Завхозов в походе может
 * быть несколько, роли назначают организаторы, и матрица «роль → вкладки»
 * правится человеком (сид `seed-role-tabs.mjs`), а не деплоем. Флаг
 * в коде означал бы, что новая роль или новая вкладка — правка приложения.
 *
 * **Право = право на правку.** Видят вкладки все участники (решение
 * заказчика 21.10.2026): роль отвечает на вопрос «кто ведёт», а не «кому
 * видно». Поэтому отдельного «права на чтение» здесь нет — иначе модель
 * пришлось бы расширять на каждый новый уровень доступа.
 *
 * Организатор похода правит **все** вкладки независимо от матрицы: это
 * правило кода (`TripsService`), а не строка в таблице. Роль `organizer`
 * при этом тоже засеяна со всеми вкладками — чтобы матрица не врала, если
 * её читают глазами.
 *
 * Ключ `(role_id, tab)` — роль не может иметь одно право дважды. `CASCADE`
 * на роль: права — часть роли, погашенная роль уносит их с собой.
 */
@Entity('role_tab_permissions')
@Check('chk_role_tab_permissions_tab', `"tab" IN (${sqlValues(TRIP_TABS)})`)
export class RoleTabPermission {
  @PrimaryColumn({ name: 'role_id', type: 'bigint' })
  roleId: string;

  @ManyToOne(() => Role, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'role_id',
    foreignKeyConstraintName: 'FK_role_tab_permissions_role',
  })
  role: Role;

  @PrimaryColumn({ type: 'varchar', length: 20 })
  tab: TripTab;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
