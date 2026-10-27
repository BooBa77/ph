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

import { sqlValues } from '../../users/sport-experience.types';
import {
  TRANSFER_PERSONAL_MODES,
  type TransferMode,
} from '../trip-transfer.types';
import { User } from '../../users/entities/user.entity';

/**
 * Транспорт участника — каталог, как снаряжение.
 *
 * Владелец один раз заводит «Нива, 4 места, А123ВС» и дальше **выбирает
 * из списка** на вкладке «Трансфер», а не заполняет каждый раз способ,
 * места и номер. Это прямое продолжение решения по снаряжению: каталог
 * отвечает «что у меня есть», карточка похода — «что из этого едет».
 *
 * **Только личный транспорт.** У автобуса, поезда, корабля и вертолёта
 * владельца в группе нет — это рейсы, и в каталоге они не живут (CHECK
 * по списку личных способов).
 *
 * Удаление — `RESTRICT` со стороны карточки: транспорт, который уже едет
 * в походе, нельзя выдернуть из каталога молча (каталог отвечает 409).
 */
@Entity('vehicles')
@Index('IDX_vehicles_owner', ['ownerUserId', 'id'])
@Check(
  'chk_vehicles_mode',
  `"mode" IN (${sqlValues(TRANSFER_PERSONAL_MODES)})`,
)
@Check('chk_vehicles_seats', '"seats" IS NULL OR "seats" > 0')
export class Vehicle {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'owner_user_id',
    foreignKeyConstraintName: 'FK_vehicles_owner',
  })
  owner: User;

  /** Способ доставки: `car`, `horses`, `atv`, `boat`, `airboat`, `other`. */
  @Column({ type: 'varchar', length: 20 })
  mode: TransferMode;

  /** «Нива», «Лодка ПВХ», «Квадроцикл». */
  @Column({ type: 'varchar', length: 100 })
  title: string;

  /** Всего мест, включая водителя. `NULL` — не знаю. */
  @Column({ type: 'int', nullable: true })
  seats: number | null;

  /** Номер — чтобы найти машину на парковке. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  plate: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
