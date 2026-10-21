import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import {
  CreateGearItemDto,
  GearItemDto,
  GearListDto,
  UpdateGearItemDto,
} from './dto/gear.dto';
import { GearItem } from './entities/gear-item.entity';
import { TripGear } from './entities/trip-gear.entity';

/**
 * Личное снаряжение человека.
 *
 * Всё простое и потому опасное: «мой список» — это единственное правило
 * доступа, и оно записано одним методом (`findOwned`). Чужой предмет
 * отвечает 404, а не 403: перебирать id чужого снаряжения нечего.
 *
 * Вес необязателен. `NULL` значит «не знаю», и такой предмет не попадает
 * в итог: считать его нулём — врать в сумме рюкзака, а отказываться
 * добавлять вещь без веса — заставлять человека взвешивать палатку,
 * чтобы записать её в список.
 *
 * **В поход предмет попадает через `TripGearService`** (вкладка
 * «Снаряжение», Ф7): участник выбирает предмет из этого списка, и в походе
 * появляется строка со ссылкой на каталог. Обратная связь — один запрет:
 * предмет, который уже едет в походе, отсюда не удалить (409), иначе он
 * исчез бы из подготовки молча.
 */
@Injectable()
export class GearService {
  constructor(private readonly dataSource: DataSource) {}

  /** Мой список и итог по весу. */
  async list(userId: string): Promise<GearListDto> {
    const items = await this.dataSource.manager.find(GearItem, {
      where: { ownerUserId: userId },
      order: { kind: 'ASC', id: 'ASC' },
    });

    return this.toList(items);
  }

  /** Новый предмет. */
  async create(userId: string, dto: CreateGearItemDto): Promise<GearItemDto> {
    const title = dto.title.trim();
    if (title.length === 0) {
      throw new BadRequestException('У предмета должно быть название');
    }

    const manager = this.dataSource.manager;
    const saved = await manager.save(
      manager.create(GearItem, {
        ownerUserId: userId,
        kind: dto.kind,
        title,
        weightGrams: dto.weightGrams ?? null,
        note: dto.note?.trim() || null,
      }),
    );

    return GearItemDto.from(saved);
  }

  /**
   * Правка предмета.
   *
   * Присваиваем только присланное: `PATCH` без поля не меняет его,
   * а `weightGrams: null` — осознанное «стереть вес». Три состояния поля
   * различать обязательно, иначе «не прислали» и «стереть» склеятся.
   */
  async update(
    userId: string,
    id: number,
    dto: UpdateGearItemDto,
  ): Promise<GearItemDto> {
    const manager = this.dataSource.manager;
    const item = await this.findOwned(manager, userId, id);

    if (dto.kind !== undefined) item.kind = dto.kind;

    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (title.length === 0) {
        throw new BadRequestException('У предмета должно быть название');
      }
      item.title = title;
    }

    if (dto.weightGrams !== undefined) item.weightGrams = dto.weightGrams;
    if (dto.note !== undefined) item.note = dto.note?.trim() || null;

    return GearItemDto.from(await manager.save(item));
  }

  /**
   * Удалить предмет.
   *
   * Вещь, которая уже предложена в поход, удалить нельзя: в походе она
   * ссылается на каталог (`trip_gear`), и «удалить молча» значило бы
   * выдернуть палатку из подготовки, о которой договорились. Отвечаем
   * 409 и говорим, что делать: сначала убрать её из похода.
   */
  async remove(userId: string, id: number): Promise<void> {
    const manager = this.dataSource.manager;
    const item = await this.findOwned(manager, userId, id);

    const usedInTrips = await manager.count(TripGear, {
      where: { gearItemId: item.id },
    });
    if (usedInTrips > 0) {
      throw new ConflictException(
        'Предмет уже едет в походе — сначала уберите его из снаряжения похода',
      );
    }

    await manager.delete(GearItem, { id: item.id });
  }

  /** Мой предмет или 404: чужой не существует. */
  private async findOwned(
    manager: EntityManager,
    userId: string,
    id: number,
  ): Promise<GearItem> {
    const item = await manager.findOne(GearItem, {
      where: { id: String(id), ownerUserId: userId },
    });
    if (!item) throw new NotFoundException('Предмет не найден');

    return item;
  }

  /** Список с итогом: сумма известных весов и сколько осталось без веса. */
  private toList(items: GearItem[]): GearListDto {
    let totalWeightGrams = 0;
    let itemsWithoutWeight = 0;

    for (const item of items) {
      if (item.weightGrams === null) itemsWithoutWeight += 1;
      else totalWeightGrams += item.weightGrams;
    }

    return {
      items: items.map((item) => GearItemDto.from(item)),
      totalWeightGrams,
      itemsWithoutWeight,
    };
  }
}
