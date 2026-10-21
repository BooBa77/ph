import { Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { CalendarActivityType } from '../../calendar/entities/activity-type.entity';
import { Trip } from './trip.entity';

/**
 * Типы похода: связка похода со справочником активностей.
 *
 * Раньше это был массив id в `trips` («связей одна-две, зачем таблица»).
 * Таблица понадобилась потому, что массив не умел трёх вещей:
 *
 * - **внешний ключ вместо проверки триггером.** Целостность держал триггер,
 *   и держал её только для вставляемой строки похода: удаление типа
 *   из справочника он не замечал, и ссылка переживала удалённый id.
 *   `ON DELETE RESTRICT` отвечает на тот же вопрос средствами базы;
 * - **обычный btree-индекс для фильтра ленты.** «Покажи походы этого типа»
 *   по массиву — seq scan, а `IDX_trip_types_activity` превращает его
 *   в индексный поиск;
 * - **место под свойства пары.** «Главный тип», порядок выбранных, роль
 *   типа (сам поход / заброска) — в массиве рядом с числом для этого места
 *   нет, а в строке появляется, когда понадобится.
 *
 * Составной ключ `(trip_id, activity_type_id)` — это и запрет дубликата,
 * и индекс для чтения «типы похода»: порядок внутри похода не значим,
 * повторы в массиве были допустимы, но смысла в них не было.
 *
 * `CASCADE` на поход (связка — часть похода), `RESTRICT` на тип (справочник
 * не удаляют, пока на него ссылаются: лишний тип гасят `is_active`).
 * `is_active` здесь не проверяется намеренно — архивный тип в старом походе
 * норма, и это правило не изменилось.
 */
@Entity('trip_types')
@Index('IDX_trip_types_activity', ['activityTypeId'])
export class TripType {
  @PrimaryColumn({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  @PrimaryColumn({ name: 'activity_type_id', type: 'int' })
  activityTypeId: number;

  @ManyToOne(() => Trip, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'trip_id',
    foreignKeyConstraintName: 'FK_trip_types_trip',
  })
  trip: Trip;

  @ManyToOne(() => CalendarActivityType, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'activity_type_id',
    foreignKeyConstraintName: 'FK_trip_types_activity_type',
  })
  activityType: CalendarActivityType;
}
