import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Географический объект — справочник целей и точек маршрута.
 *
 * Плоский список с иерархией через `parent_id`: «горная система → хребет →
 * вершина». Отдельной таблицы типов нет, `type` — свободный текст:
 * типы (вершина, перевал, озеро, скальник) растут быстрее, чем мы успевали
 * бы править справочник, а заполняет его админ.
 *
 * `name` **не уникально** намеренно: «семь рек Осиновка» — норма, и
 * различаются они родителем и уточнением в имени («Осиновка (левая)»).
 * Глобальный UNIQUE здесь только мешал бы.
 *
 * Удалить объект, у которого есть дети, не даст `ON DELETE RESTRICT`:
 * админ сначала разбирается с потомками. Прочие ссылки (цель похода,
 * упоминание в тексте маршрута) защищены отдельно — см. миграцию
 * `TripsDomain`: там триггер, который ловит ссылки `[[object:N]]`
 * в `trips.route_text`, недоступные для внешнего ключа.
 */
@Entity('objects')
@Check(
  'chk_objects_no_self_parent',
  `"parent_id" IS NULL OR "parent_id" <> "id"`,
)
export class GeoObject {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  /** Тип объекта: 'вершина', 'перевал', 'озеро', 'горная система'. */
  @Column({ type: 'varchar', length: 50 })
  type: string;

  /**
   * Ссылка на внешнюю страницу объекта — сейчас это «Природа Байкала»
   * (nature.baikal.ru), откуда справочник и наполняется.
   *
   * Необязательна: объект без описания — норма, а не недоделка. Ссылку
   * **не угадывают**: у сайта свои слаги (`?obj=skala&id=vityaz`),
   * и выдуманный адрес хуже пустого — по нему уйдёт человек и ничего
   * не найдёт. Пустое поле заполняет сид или админ.
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  url: string | null;

  /**
   * Родитель в иерархии. Индекс нужен не для красоты: без него проверка
   * `RESTRICT` при удалении родителя и выборка детей идут по всему
   * справочнику.
   */
  @Index('IDX_objects_parent_id')
  @Column({ name: 'parent_id', type: 'bigint', nullable: true })
  parentId: string | null;

  @ManyToOne(() => GeoObject, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'parent_id' })
  parent: GeoObject | null;
}
