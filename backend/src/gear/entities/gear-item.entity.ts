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
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../../users/entities/user.entity';
import { GearItemAttribute } from './gear-item-attribute.entity';
import { GearType } from './gear-type.entity';

/**
 * Личное снаряжение человека: «палатка, 2.4 кг», «спальник, 900 г».
 *
 * **Каталог пользователя, а не похода.** Один и тот же спальник ездит
 * во все походы, и заводить его заново к каждому — это ровно та работа,
 * от которой каталог и спасает. В походе (вкладка «Снаряжение», Ф7)
 * человек будет **выбирать** из этого списка, а не писать заново.
 *
 * **Тип вместо вида (Stage B, 30.10.2026).** Раньше вещь знала только вид
 * (`kind`) — полку, а не сущность. Теперь у неё обязательная ссылка
 * на `gear_types`: «Палатка», «Топор», «Тент». Тип задаёт набор
 * характеристик, а значения живут в `gear_item_attributes`. Вид убран
 * целиком: `RESTRICT` на типе не даёт удалить тип, под которым есть вещи
 * (архив — можно).
 *
 * **Название (`title`) остаётся обязательным** — решение заказчика
 * 30.10.2026: это название вещи **в личном каталоге**, человек пишет там
 * что угодно, и ограничивать его незачем. В снаряжении похода `title`
 * не участвует: строка собирается из типа, характеристик, веса и хозяина.
 *
 * **Вес необязателен, но если указан — то в граммах.** Граммы, а не
 * килограммы с дробью: `numeric` в Node приезжает строкой и утёк бы
 * в JSON строкой, а дробные килограммы в снаряжении всё равно округляют.
 * `NULL` — «вес не знаю»; такой предмет не попадает в сумму рюкзака,
 * и это честнее нуля: ноль означал бы «невесомый».
 *
 * **Зачем вес вообще.** Раскладка и «вес рюкзака» (Ф7) считаются из этих
 * чисел: без них вкладка «Снаряжение» — список слов, а не подготовка.
 *
 * У одного человека может быть два спальника и три палатки: поэтому это
 * не «одна вещь на тип», а обычный список предметов.
 */
@Entity('gear_items')
@Index('IDX_gear_items_owner_type', ['ownerUserId', 'gearTypeId', 'id'])
@Index('IDX_gear_items_owner_trip_only', ['ownerUserId', 'isTripOnly'])
@Check(
  'chk_gear_items_weight',
  `"weight_grams" IS NULL OR "weight_grams" > 0`,
)
@Check('chk_gear_items_title', `char_length(btrim("title")) > 0`)
export class GearItem {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'owner_user_id',
    foreignKeyConstraintName: 'FK_gear_items_owner',
  })
  owner: User;

  /** Тип вещи: «Палатка», «Топор». Архивный тип у вещи остаётся допустимым. */
  @Column({ name: 'gear_type_id', type: 'integer' })
  gearTypeId: number;

  @ManyToOne(() => GearType, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'gear_type_id',
    foreignKeyConstraintName: 'FK_gear_items_type',
  })
  gearType: GearType;

  /** Название словами: «Палатка на четверых», «Спальник зимний». */
  @Column({ type: 'varchar', length: 120 })
  title: string;

  /** Вес в граммах. `NULL` — не указан (и не считается). */
  @Column({ name: 'weight_grams', type: 'int', nullable: true })
  weightGrams: number | null;

  /**
   * Вещь заведена **в походе и вручную** (30.10.2026) — «бутылка бензина
   * на розжиг», «кусок целлофана на тент». Живёт только в том походе, где
   * её завели, и **личному каталогу не принадлежит**: `GET /api/gear` такие
   * вещи не отдаёт ни владельцу, ни организатору, а в снаряжении похода
   * они видны как обычная строка.
   *
   * Ссылки на поход здесь нет намеренно: вещь и так попадает в поход
   * строкой `trip_gear`, и вторая ссылка на тот же поход разошлась бы
   * с первой после любого переноса. Флаг говорит ровно одно — «каталогу
   * не принадлежит».
   *
   * У виртуального участника каталога нет вовсе, поэтому его вещи
   * **всегда** `true`, и флага «Регулярное» в форме для них нет.
   *
   * Одноразовую вещь убирает код: строка удаляется вместе со строкой
   * `trip_gear` (каскад от участника или ручка удаления вещи из похода),
   * иначе в базе копились бы невидимые никому вещи.
   */
  @Column({ name: 'is_trip_only', type: 'boolean', default: false })
  isTripOnly: boolean;

  /** Комментарий: «проклеена, течёт по шву». */
  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  /** Значения характеристик типа: вместимость, модель, объём. */
  @OneToMany(() => GearItemAttribute, (value) => value.gearItem)
  attributes: GearItemAttribute[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
