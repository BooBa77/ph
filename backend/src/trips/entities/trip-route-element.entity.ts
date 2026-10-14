import { Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { GeoObject } from './geo-object.entity';
import { Trip } from './trip.entity';

/**
 * Упомянутые в маршруте объекты справочника — индекс, производный от текста.
 *
 * Маршрут живёт текстом (`trips.route_text`), а искать по нему надо
 * структурно: «покажи все походы, где упомянут Грандиозный». Парсить
 * markdown на каждый запрос нельзя, поэтому при сохранении похода фронт
 * извлекает все `[[object:N]]`, бэк проверяет существование id и
 * перезаписывает таблицу целиком (delete + insert) в одной транзакции.
 *
 * Составной ключ `(trip_id, object_id)` — это и запрет дубликатов, и
 * индекс для выборки «что упомянуто в походе». Порядок в маршруте не
 * важен: «прошли перевал туда и обратно» — одна запись, а не две.
 *
 * **Индекс по `object_id` обязателен.** Обратный запрос — «походы с этим
 * объектом» — и есть смысл таблицы, а по префиксу составного ключа он
 * не выполняется: без отдельного индекса это seq scan.
 *
 * `RESTRICT` на объект согласован с триггером на `objects`: пока объект
 * где-то упомянут, удалить его нельзя.
 */
@Entity('trip_route_elements')
export class TripRouteElement {
  @PrimaryColumn({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  @Index('IDX_trip_route_elements_object_id')
  @PrimaryColumn({ name: 'object_id', type: 'bigint' })
  objectId: string;

  @ManyToOne(() => Trip, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'trip_id' })
  trip: Trip;

  @ManyToOne(() => GeoObject, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'object_id' })
  object: GeoObject;
}
