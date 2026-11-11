import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from './user.entity';
import { FamilyUnionMember } from './family-union-member.entity';
import { FAMILY_UNION_STATUSES, type FamilyUnionStatus } from '../family.types';
import { sqlValues } from '../sport-experience.types';

/**
 * Заявка на объединение двух семей (11.11.2026).
 *
 * Заказчик: «строгие пары, без сущности „семья“… семья — это компонента
 * связей. Новый родственник тянет всю свою компоненту: заявка на
 * объединение собирает обе стороны, и семья создаётся только после
 * согласия всех». Поэтому здесь не пара «кто кого добавил», а **состав**:
 * сама заявка и строка согласия на каждого участника
 * (`family_union_members`).
 *
 * ## Почему отдельная таблица, а не статус пары
 *
 * До 11.11.2026 «ждём ответа» хранилось статусом `pending` в `family_links`.
 * Для объединения семей этого мало: участников не два, а все родные обеих
 * сторон, и у каждого свой ответ. Пара нужна только когда родство уже
 * действует, поэтому `family_links` потеряла статусы
 * (`users/family.types.ts`).
 *
 * ## Инициатор
 *
 * `initiator_user_id` — тот, кто нажал «Добавить родного» и увидел список
 * обеих семей. Его согласие записано сразу `accepted`: он и есть автор
 * заявки. Остальные — включая **его собственную семью** — отвечают
 * в «Контактах»: у них тоже появляется доступ к чужому снаряжению.
 *
 * ## Закрытие
 *
 * `pending` — висит; `accepted` — все согласились, связи и клоны созданы;
 * `declined` — кто-то отказал; `cancelled` — инициатор передумал или
 * участник вышел из семьи. `closed_at` заполняется ровно тогда, когда
 * заявка перестала быть `pending` (`chk_family_unions_closed`): висящая
 * заявка без даты закрытия и закрытая без причины — обе одинаково
 * подозрительны, а восстанавливать по `created_at` нечего.
 *
 * ## Каскады
 *
 * `ON DELETE CASCADE` от `users`: заявка без инициатора не значит ничего.
 * Обычный пользователь удаляется мягко, поэтому на практике заявка просто
 * перестаёт показываться.
 */
@Entity('family_unions')
@Check(
  'chk_family_unions_status',
  `"status" IN (${sqlValues(FAMILY_UNION_STATUSES)})`,
)
@Check(
  'chk_family_unions_closed',
  `("status" = 'pending') = ("closed_at" IS NULL)`,
)
@Index('IDX_family_unions_initiator', ['initiatorUserId'])
export class FamilyUnion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Кто завёл заявку: его согласие уже `accepted`. */
  @Column({ name: 'initiator_user_id', type: 'uuid' })
  initiatorUserId: string;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status: FamilyUnionStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /** Когда заявка перестала быть `pending`. */
  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'initiator_user_id',
    foreignKeyConstraintName: 'FK_family_unions_initiator',
  })
  initiator: User;

  @OneToMany(() => FamilyUnionMember, (member) => member.union)
  members: FamilyUnionMember[];
}
