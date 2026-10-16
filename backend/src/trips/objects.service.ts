import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  GeoObjectDto,
  GeoObjectListDto,
  GeoObjectQueryDto,
} from './dto/geo-object.dto';
import { GeoObject } from './entities/geo-object.entity';

/** Сколько объектов отдавать, если клиент не попросил иначе. */
const DEFAULT_LIMIT = 50;

/**
 * Справочник географических объектов — только чтение.
 *
 * Создаёт и правит объекты админ скриптом или своим инструментом, через
 * API пользователь их не заводит. Отсюда единственный метод: найти.
 *
 * Отдельный сервис, а не метод в `TripsService`: тот уже отвечает за походы
 * целиком, и справочник в нём был бы ещё одной причиной его роста. Домен
 * один (поход не существует без цели), поэтому и модуль общий.
 */
@Injectable()
export class ObjectsService {
  constructor(
    @InjectRepository(GeoObject)
    private readonly objectsRepository: Repository<GeoObject>,
  ) {}

  /**
   * Найти объекты по подстроке имени.
   *
   * Родитель подтягивается сразу: без него список выбора состоит из одних
   * имён, а имена в справочнике повторяются.
   *
   * `%` и `_` в поисковой строке экранируются — иначе «%» пользователя
   * превратился бы в «найди всё», а это не поиск, а его отсутствие.
   */
  async list(query: GeoObjectQueryDto): Promise<GeoObjectListDto> {
    // Список id важнее поиска: он приходит, когда объекты уже известны,
    // и подстрока имени тут ни при чём.
    const ids = (query.ids ?? '')
      .split(',')
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isSafeInteger(id) && id > 0);

    // Если `ids` передан — отвечаем **только** по нему, даже если после
    // разбора не осталось ни одного id. Иначе запрос с мусором вместо id
    // вернул бы весь справочник: не ошибка, но сюрприз, на который
    // вызывающий не рассчитывал.
    if (query.ids !== undefined) {
      if (ids.length === 0) return { objects: [] };

      const found = await this.objectsRepository
        .createQueryBuilder('object')
        .leftJoinAndSelect('object.parent', 'parent')
        .where('object.id IN (:...ids)', { ids })
        .orderBy('object.name', 'ASC')
        .getMany();

      return { objects: found.map((object) => GeoObjectDto.from(object)) };
    }

    const qb = this.objectsRepository
      .createQueryBuilder('object')
      .leftJoinAndSelect('object.parent', 'parent')
      // Имя свойства, а не колонки: при `take` TypeORM пересобирает
      // ORDER BY и разыскивает колонку через findColumnWithPropertyPath.
      .orderBy('object.name', 'ASC')
      .take(query.limit ?? DEFAULT_LIMIT);

    const search = query.search?.trim();
    if (search) {
      const escaped = search.replace(/[%_\\]/g, '\\$&');
      qb.andWhere('object.name ILIKE :search', { search: `%${escaped}%` });
    }

    const found = await qb.getMany();

    return { objects: found.map((object) => GeoObjectDto.from(object)) };
  }
}
