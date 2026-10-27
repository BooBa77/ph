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
import { VEHICLE_KINDS, type VehicleKind } from '../trip-transfer.types';
import { User } from '../../users/entities/user.entity';

/**
 * Личный транспорт участника — раздел «Моя техника» в «Снаряжении».
 *
 * Это **не** способ доставки и не карточка перемещения: здесь то, что
 * человек держит сам — автомобиль, снегоход, квадроцикл, мотоцикл,
 * велосипед, лодка. На вкладке «Трансфер» техника выбирается из списка,
 * и карточка сама понимает, каким способом она едет
 * (`VEHICLE_KIND_TO_MODE`).
 *
 * Заводится один раз: «Нива, А123ВС38, 4 места». Дальше это выбор из списка,
 * а не заполнение полей в каждой поездке.
 *
 * `RESTRICT` со стороны карточки: транспорт, который уже едет в походе,
 * из каталога не удаляется молча (409).
 */
@Entity('vehicles')
@Index('IDX_vehicles_owner', ['ownerUserId', 'id'])
@Check('chk_vehicles_kind', `"kind" IN (${sqlValues(VEHICLE_KINDS)})`)
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

  /** `car` | `snowmobile` | `atv` | `motorcycle` | `bicycle` | `boat`. */
  @Column({ type: 'varchar', length: 20 })
  kind: VehicleKind;

  /** Марка: «Нива», «Буран», «Прогресс». */
  @Column({ type: 'varchar', length: 100 })
  brand: string;

  /** Госномер — чтобы найти машину на парковке. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  plate: string | null;

  /** Вместимость, включая водителя. `NULL` — не знаю. */
  @Column({ type: 'int', nullable: true })
  seats: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
