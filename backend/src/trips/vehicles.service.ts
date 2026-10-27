import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  CreateVehicleDto,
  UpdateVehicleDto,
  VehicleDto,
  VehicleListDto,
} from './dto/vehicle.dto';
import { TripTransferLeg } from './entities/trip-transfer-leg.entity';
import { Vehicle } from './entities/vehicle.entity';

/**
 * Каталог транспорта участника.
 *
 * Как личный каталог снаряжения: человек заводит «Ниву» один раз, а на
 * вкладке «Трансфер» выбирает её из списка. Работает «от токена»: владельца
 * в теле нет, чужой транспорт не находится (404 — перебирать id чужих
 * каталогов нечего).
 *
 * **Транспорт, который уже едет в походе, не удаляется** — 409: иначе
 * карточка потеряла бы то, на чём люди договорились ехать. Сначала
 * карточку убирают из похода, потом транспорт из каталога.
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

    const saved = await manager.save(
      manager.create(Vehicle, {
        ownerUserId: userId,
        mode: dto.mode,
        title: this.title(dto.title),
        seats: dto.seats ?? null,
        plate: this.optional(dto.plate, 20, 'Номер'),
        note: this.optional(dto.note, 500, 'Заметка'),
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

    if (dto.mode !== undefined) vehicle.mode = dto.mode;
    if (dto.title !== undefined) vehicle.title = this.title(dto.title);
    if (dto.seats !== undefined) vehicle.seats = dto.seats;
    if (dto.plate !== undefined) {
      vehicle.plate = this.optional(dto.plate, 20, 'Номер');
    }
    if (dto.note !== undefined) {
      vehicle.note = this.optional(dto.note, 500, 'Заметка');
    }

    return VehicleDto.from(await manager.save(vehicle));
  }

  async remove(userId: string, id: number): Promise<void> {
    const manager = this.dataSource.manager;
    const vehicle = await this.findMine(userId, id);

    const used = await manager.count(TripTransferLeg, {
      where: { vehicleId: vehicle.id },
    });

    if (used > 0) {
      throw new ConflictException(
        'Этот транспорт уже едет в походе — сначала уберите карточку из «Трансфера»',
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

  private title(value: string): string {
    const title = value.trim();

    if (title.length === 0) {
      throw new BadRequestException('Название не может быть пустым');
    }

    return title;
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
