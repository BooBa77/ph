import { Check, Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Группа активностей: Спорт, Дом, Работа, Город.
 *
 * Нужна для закладок в модалке дня и для цвета: `color` — единственное
 * место, где задаётся цвет, иконки рисуются линиями через `currentColor`.
 * Одну и ту же иконку можно повесить в разные группы, цвет придёт от группы.
 *
 * Порядок закладок = порядок вставки (id): сидим справочник мы, сортировка
 * по алфавиту сломала бы осмысленный порядок, а отдельная колонка ради
 * этого — лишняя.
 */
@Entity('calendar_activity_groups')
@Check('chk_activity_groups_scope', `"scope" IN ('calendar', 'trips', 'both')`)
export class CalendarActivityGroup {
  @PrimaryGeneratedColumn()
  id: number;

  /** Машинный код: 'sport', 'home', 'work', 'city'. */
  @Column({ type: 'varchar', length: 50, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 100 })
  label: string;

  /** Цвет группы в hex: '#2c5f8d'. Заливок в иконках нет, только обводка. */
  @Column({ type: 'varchar', length: 7 })
  color: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /**
   * Где эта группа нужна.
   *
   * Справочник один на проект, но мест два: календарь и типы похода.
   * «Город», «Спорт», «Дом», «Работа» — календарные; «Туризм» — только
   * походный. Назначение в **данных**, а не списком в коде: иначе новую
   * группу однажды забудут спрятать, и она появится в календаре молча.
   */
  @Column({ type: 'varchar', length: 20, default: 'calendar' })
  scope: 'calendar' | 'trips' | 'both';
}
