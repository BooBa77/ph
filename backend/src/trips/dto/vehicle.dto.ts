import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

import { VEHICLE_KINDS, type VehicleKind } from '../trip-transfer.types';
import type { Vehicle } from '../entities/vehicle.entity';

/**
 * Личная техника участника — раздел «Моя техника» в «Снаряжении».
 *
 * Поля ровно те, что заказчик назвал нужными для учёта: тип, марка,
 * госномер и вместимость (необязательная). Ничего «на будущее» здесь нет:
 * цвет, год и страховка не просятся и не хранятся.
 */
export class VehicleDto {
  @ApiProperty({ description: 'Id транспорта', example: '3' })
  id: string;

  @ApiProperty({
    description: 'Тип техники',
    enum: VEHICLE_KINDS,
    example: 'car',
  })
  kind: VehicleKind;

  @ApiProperty({ description: 'Марка', example: 'Нива' })
  brand: string;

  @ApiProperty({
    description: 'Госномер',
    nullable: true,
    example: 'А123ВС38',
  })
  plate: string | null;

  @ApiProperty({
    description: 'Вместимость, включая водителя. null — не указана',
    nullable: true,
    example: 4,
  })
  seats: number | null;

  @ApiProperty({ description: 'Когда завели' })
  createdAt: string;

  static from(vehicle: Vehicle): VehicleDto {
    return {
      id: vehicle.id,
      kind: vehicle.kind,
      brand: vehicle.brand,
      plate: vehicle.plate,
      seats: vehicle.seats,
      createdAt: vehicle.createdAt.toISOString(),
    };
  }
}

export class VehicleListDto {
  @ApiProperty({ description: 'Моя техника', type: [VehicleDto] })
  vehicles: VehicleDto[];
}

/** Тело `POST /api/vehicles`. */
export class CreateVehicleDto {
  @ApiProperty({
    description: 'Тип техники',
    enum: VEHICLE_KINDS,
    example: 'car',
  })
  @IsIn(VEHICLE_KINDS, { message: 'Недопустимый тип техники' })
  kind: VehicleKind;

  @ApiProperty({ description: 'Марка', example: 'Нива' })
  @IsString({ message: 'Марка должна быть строкой' })
  @Length(1, 100, { message: 'Марка — от 1 до 100 символов' })
  brand: string;

  @ApiProperty({ description: 'Госномер', required: false, nullable: true })
  @IsOptional()
  @IsString({ message: 'Госномер должен быть строкой' })
  @Length(1, 20, { message: 'Госномер — до 20 символов' })
  plate?: string | null;

  @ApiProperty({
    description: 'Вместимость, включая водителя. Не указана — потолка нет',
    required: false,
    nullable: true,
    example: 4,
  })
  @IsOptional()
  @IsInt({ message: 'Вместимость — целое число' })
  @Min(1, { message: 'Вместимость — хотя бы одно место' })
  @Max(60, { message: 'Больше 60 мест не бывает' })
  seats?: number | null;
}

/** Тело `PATCH /api/vehicles/:id` — три состояния поля, как у похода. */
export class UpdateVehicleDto {
  @ApiProperty({
    description: 'Тип техники',
    enum: VEHICLE_KINDS,
    required: false,
  })
  @IsOptional()
  @IsIn(VEHICLE_KINDS, { message: 'Недопустимый тип техники' })
  kind?: VehicleKind;

  @ApiProperty({ description: 'Марка', required: false })
  @IsOptional()
  @IsString({ message: 'Марка должна быть строкой' })
  @Length(1, 100, { message: 'Марка — от 1 до 100 символов' })
  brand?: string;

  @ApiProperty({ description: 'Госномер или null', required: false, nullable: true })
  @IsOptional()
  @IsString({ message: 'Госномер должен быть строкой' })
  @Length(1, 20, { message: 'Госномер — до 20 символов' })
  plate?: string | null;

  @ApiProperty({
    description: 'Вместимость или null',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsInt({ message: 'Вместимость — целое число' })
  @Min(1, { message: 'Вместимость — хотя бы одно место' })
  @Max(60, { message: 'Больше 60 мест не бывает' })
  seats?: number | null;
}
