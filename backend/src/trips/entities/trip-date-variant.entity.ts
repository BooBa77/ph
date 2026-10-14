import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Trip } from './trip.entity';

/**
 * Вариант дат похода — прогноз.
 *
 * Даты похода почти никогда не известны точно на старте подготовки:
 * от «идём 5–9 мая» до «когда-нибудь летом на неделю». Поэтому не одно
 * поле, а дочерняя таблица: каждая строка — один возможный старт, и фронт
 * рендерит их как «вариант 1 / вариант 2 / …».
 *
 * **Неизвестное пишется `NULL`, а не нулём.** Иначе `WHERE year = 2027`
 * пришлось бы писать с оговоркой, а `0` в месяце читался бы как «январь»
 * или как «не знаю» — в зависимости от того, кто читает.
 *
 * `day` без месяца бессмысленен, а `month` без года — норма: «когда-нибудь
 * летом» это ровно он. Полностью пустая строка запрещена: вечная идея без
 * даты и без продолжительности просто не создаёт записи.
 *
 * Продолжительность задаётся минимумом и дельтой вверх: «2–3 дня» —
 * это `duration_days = 2`, `duration_delta = 1`. Дельта без минимума
 * запрещена, потому что «сколько-то дней сверху» не значит ничего.
 *
 * Дельта навешивается на строку целиком, а не на конкретный старт:
 * комбинаторный взрыв «много стартов × много продолжительностей» мы
 * принимаем как цену за простоту — к моменту решения дата всё равно
 * становится определённой и переезжает в `trips.starts_at`.
 */
@Entity('trip_date_variants')
@Check(
  'chk_trip_date_variants_year',
  `"year" IS NULL OR "year" BETWEEN 1960 AND 2100`,
)
@Check(
  'chk_trip_date_variants_month',
  `"month" IS NULL OR "month" BETWEEN 1 AND 12`,
)
@Check('chk_trip_date_variants_day', `"day" IS NULL OR "day" BETWEEN 1 AND 31`)
@Check(
  'chk_trip_date_variants_day_needs_month',
  `"day" IS NULL OR "month" IS NOT NULL`,
)
@Check(
  'chk_trip_date_variants_duration_positive',
  `"duration_days" IS NULL OR "duration_days" > 0`,
)
@Check('chk_trip_date_variants_delta_nonneg', `"duration_delta" >= 0`)
@Check(
  'chk_trip_date_variants_delta_needs_duration',
  `"duration_delta" = 0 OR "duration_days" IS NOT NULL`,
)
@Check(
  'chk_trip_date_variants_not_empty',
  `"year" IS NOT NULL OR "month" IS NOT NULL OR "day" IS NOT NULL OR "duration_days" IS NOT NULL`,
)
export class TripDateVariant {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  /**
   * Индекс нужен и для чтения вариантов похода, и для каскада: без него
   * удаление похода сканирует таблицу целиком.
   */
  @Index('IDX_trip_date_variants_trip_id')
  @Column({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  @ManyToOne(() => Trip, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'trip_id' })
  trip: Trip;

  @Column({ type: 'smallint', nullable: true })
  year: number | null;

  @Column({ type: 'smallint', nullable: true })
  month: number | null;

  @Column({ type: 'smallint', nullable: true })
  day: number | null;

  /** Минимум продолжительности в днях. */
  @Column({ name: 'duration_days', type: 'smallint', nullable: true })
  durationDays: number | null;

  /** Сколько дней сверху: «2–3 дня» — это 2 и 1. */
  @Column({ name: 'duration_delta', type: 'smallint', default: 0 })
  durationDelta: number;
}
