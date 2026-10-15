import { Check, Column, Entity, PrimaryColumn } from 'typeorm';

import type { CalendarDayType } from '../calendar.types';

/**
 * Шаблон государственного производственного календаря: 365 строк на год.
 *
 * Это данные государства, а не пользователя: заполняется из постановлений
 * Правительства РФ (см. `backend/scripts/build-state-calendar.mjs`), по одной
 * строке на каждый день. Персональный календарь копирует строки шаблона при
 * заполнении года, поэтому правки пользователя сюда попадать не должны —
 * иначе «ДР Любы» появится у всех.
 *
 * Ключ — сама дата: страна у нас одна, шестидневка не наш случай.
 */
@Entity('calendar_state_production')
@Check(
  'chk_state_day_type',
  `"day_type" IN ('workday', 'weekend', 'short_workday')`,
)
export class CalendarStateDay {
  @PrimaryColumn({ type: 'date' })
  date: string;

  @Column({ name: 'day_type', type: 'varchar', length: 20 })
  dayType: CalendarDayType;

  /**
   * Метка-образец: «Новый год», «перенос за 8 марта», «рабочая суббота».
   * У обычных дней её нет — имя дня недели подставляет заполнение
   * персонального календаря, держать 365 одинаковых подписей незачем.
   */
  @Column({ type: 'varchar', length: 100, nullable: true })
  label: string | null;
}
