import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';

import {
  CreateVehicleDto,
  UpdateVehicleDto,
  VehicleDto,
  VehicleListDto,
} from './dto/vehicle.dto';
import { TripTransferLeg } from './entities/trip-transfer-leg.entity';
import { Trip } from './entities/trip.entity';
import { Vehicle } from './entities/vehicle.entity';

/**
 * Каталог транспорта участника.
 *
 * Как личный каталог снаряжения: человек заводит «Ниву» один раз, а на
 * вкладке «Трансфер» выбирает её из списка. Работает «от токена»: владельца
 * в теле нет, чужой транспорт не находится (404 — перебирать id чужих
 * каталогов нечего).
 *
 * **Транспорт, который едет в незакрытом походе, не удаляется** — 409:
 * иначе карточка потеряла бы то, на чём люди договорились ехать. Когда
 * поход закрыт (записан факт возвращения или он отменён), техника
 * освобождается: ссылка в карточке снимается, каталог чистится.
 */
@Injectable()
export class VehiclesService {
  constructor(private readonly dataSource: DataSource) {}

  async list(userId: string): Promise<VehicleListDto> {
    const vehicles = await this.dataSource.manager.find(Vehicle, {
      where: { ownerUserId: userId },
      order: { id: 'ASC' },
    });

    return { vehicles: vehicles.map(VehicleDto.from) };
  }

  async create(userId: string, dto: CreateVehicleDto): Promise<VehicleDto> {
    const manager = this.dataSource.manager;

    const brand = this.brand(dto.brand);
    const plate = this.optional(dto.plate, 10, 'Госномер');
    await this.assertNotDuplicated(manager, userId, brand, plate);

    const saved = await manager.save(
      manager.create(Vehicle, {
        ownerUserId: userId,
        kind: dto.kind,
        brand,
        plate,
        seats: dto.seats ?? null,
      }),
    );

    return VehicleDto.from(saved);
  }

  async update(
    userId: string,
    id: number,
    dto: UpdateVehicleDto,
  ): Promise<VehicleDto> {
    const manager = this.dataSource.manager;
    const vehicle = await this.findMine(userId, id);

    if (dto.kind !== undefined) vehicle.kind = dto.kind;
    if (dto.brand !== undefined) vehicle.brand = this.brand(dto.brand);
    if (dto.seats !== undefined) vehicle.seats = dto.seats;
    if (dto.plate !== undefined) {
      vehicle.plate = this.optional(dto.plate, 10, 'Госномер');
    }

    await this.assertNotDuplicated(
      manager,
      userId,
      vehicle.brand,
      vehicle.plate,
      vehicle.id,
    );

    return VehicleDto.from(await manager.save(vehicle));
  }

  /**
   * Две одинаковые машины в каталоге не нужны.
   *
   * Заказчик 28.10.2026: «добавь проверку по „владелец + марка + номер“».
   * Сравниваем без учёта регистра и лишних пробелов: «Нива» и «нива»,
   * «222» и «222 » — одна машина. Без номера сравнивать нечего: две «Нивы»
   * без номеров — законная ситуация, различать их нечем.
   */
  private async assertNotDuplicated(
    manager: EntityManager,
    ownerUserId: string,
    brand: string,
    plate: string | null,
    exceptId?: string,
  ): Promise<void> {
    if (plate === null) return;

    const query = manager
      .createQueryBuilder(Vehicle, 'vehicle')
      .where('vehicle.owner_user_id = :ownerUserId', { ownerUserId })
      .andWhere('LOWER(TRIM(vehicle.brand)) = LOWER(:brand)', { brand })
      .andWhere('LOWER(TRIM(vehicle.plate)) = LOWER(:plate)', { plate });

    if (exceptId !== undefined) {
      query.andWhere('vehicle.id <> :exceptId', { exceptId });
    }

    if ((await query.getOne()) !== null) {
      throw new ConflictException(
        'Такая машина уже есть в вашем снаряжении — выберите её из списка',
      );
    }
  }

  /**
   * Убрать транспорт из каталога.
   *
   * **409 — только пока поход не закрыт** (28.10.2026). Закрытый поход
   * технику отпускает: вернулись (или поход отменён) — машина больше
   * не в работе, и держать её в каталоге занятой незачем. Ссылка в карточке
   * закрытого похода снимается, а сама карточка остаётся: поездка была,
   * и стирать её из истории из-за уборки каталога неправильно.
   *
   * «Закрыт» здесь — тот же признак, что и везде: записан факт возвращения
   * (`actual_finished_at`) или поход отменён (`cancelled_at`). Отдельного
   * статуса «завершён» у похода нет.
   */
  async remove(userId: string, id: number): Promise<void> {
    const manager = this.dataSource.manager;
    const vehicle = await this.findMine(userId, id);

    const legs = await manager.find(TripTransferLeg, {
      where: { vehicleId: vehicle.id },
    });

    if (legs.length > 0) {
      const tripIds = [...new Set(legs.map((leg) => leg.tripId))];

      /**
       * Походы спрашиваем отдельным запросом, а не join-ом от карточки:
       * у карточки `trip_id` занят ещё и составным ключом владельца, и
       * TypeORM на такой связке строит запрос с чужим алиасом (`schema:log`
       * его не показывает — он о схеме, а не о запросах).
       */
      const openTrips = await manager.count(Trip, {
        where: {
          id: In(tripIds),
          actualFinishedAt: IsNull(),
          cancelledAt: IsNull(),
        },
      });

      if (openTrips > 0) {
        throw new ConflictException(
          'Этот транспорт задействован в походе, освободите его сперва',
        );
      }

      // Походы закрыты — техника свободна: снимаем ссылку, потом удаляем.
      await manager.update(
        TripTransferLeg,
        { vehicleId: vehicle.id },
        { vehicleId: null },
      );
    }

    await manager.delete(Vehicle, { id: vehicle.id });
  }

  /** Свой транспорт или 404: чужих в каталоге нет. */
  private async findMine(userId: string, id: number): Promise<Vehicle> {
    const vehicle = await this.dataSource.manager.findOne(Vehicle, {
      where: { id: String(id), ownerUserId: userId },
    });

    if (!vehicle) throw new NotFoundException('Транспорт не найден');

    return vehicle;
  }

  private brand(value: string): string {
    const brand = value.trim();

    if (brand.length === 0) {
      throw new BadRequestException('Марка не может быть пустой');
    }

    return brand;
  }

  private optional(
    value: string | null | undefined,
    limit: number,
    field: string,
  ): string | null {
    if (value === null || value === undefined) return null;

    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    if (trimmed.length > limit) {
      throw new ConflictException(`${field} — до ${limit} символов`);
    }

    return trimmed;
  }
}
