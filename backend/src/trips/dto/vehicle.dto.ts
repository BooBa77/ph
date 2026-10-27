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

import {
  TRANSFER_PERSONAL_MODES,
  type TransferMode,
} from '../trip-transfer.types';
import type { Vehicle } from '../entities/vehicle.entity';

/**
 * Транспорт участника — каталог, из которого выбирают на «Трансфере».
 *
 * Только личные способы: автобус, поезд, корабль и вертолёт — рейсы,
 * владельца у них в группе нет (сервер отбивает их 400-м, CHECK — в базе).
 */
export class VehicleDto {
  @ApiProperty({ description: 'Id транспорта', example: '3' })
  id: string;

  @ApiProperty({
    description: 'Способ доставки',
    enum: TRANSFER_PERSONAL_MODES,
    example: 'car',
  })
  mode: TransferMode;

  @ApiProperty({ description: 'Название', example: 'Нива' })
  title: string;

  @ApiProperty({
    description: 'Всего мест, включая водителя. null — не указано',
    nullable: true,
    example: 4,
  })
  seats: number | null;

  @ApiProperty({
    description: 'Номер — чтобы найти машину на парковке',
    nullable: true,
    example: 'А123ВС38',
  })
  plate: string | null;

  @ApiProperty({ description: 'Заметка', nullable: true })
  note: string | null;

  @ApiProperty({ description: 'Когда завели' })
  createdAt: string;

  static from(vehicle: Vehicle): VehicleDto {
    return {
      id: vehicle.id,
      mode: vehicle.mode,
      title: vehicle.title,
      seats: vehicle.seats,
      plate: vehicle.plate,
      note: vehicle.note,
      createdAt: vehicle.createdAt.toISOString(),
    };
  }
}

export class VehicleListDto {
  @ApiProperty({ description: 'Мой транспорт', type: [VehicleDto] })
  vehicles: VehicleDto[];
}

/** Тело `POST /api/vehicles`. */
export class CreateVehicleDto {
  @ApiProperty({
    description: 'Способ доставки — только личный',
    enum: TRANSFER_PERSONAL_MODES,
    example: 'car',
  })
  @IsIn(TRANSFER_PERSONAL_MODES, {
    message:
      'В каталог попадает только личный транспорт: автобус, ж/д, корабль и вертолёт — рейсы',
  })
  mode: TransferMode;

  @ApiProperty({ description: 'Название', example: 'Нива' })
  @IsString({ message: 'Название должно быть строкой' })
  @Length(1, 100, { message: 'Название — от 1 до 100 символов' })
  title: string;

  @ApiProperty({ description: 'Всего мест', required: false, nullable: true })
  @IsOptional()
  @IsInt({ message: 'Места — целое число' })
  @Min(1, { message: 'Мест должно быть хотя бы одно' })
  @Max(60, { message: 'Больше 60 мест не бывает' })
  seats?: number | null;

  @ApiProperty({ description: 'Номер', required: false, nullable: true })
  @IsOptional()
  @IsString({ message: 'Номер должен быть строкой' })
  @Length(1, 20, { message: 'Номер — до 20 символов' })
  plate?: string | null;

  @ApiProperty({ description: 'Заметка', required: false, nullable: true })
  @IsOptional()
  @IsString({ message: 'Заметка должна быть строкой' })
  @Length(1, 500, { message: 'Заметка — до 500 символов' })
  note?: string | null;
}

/** Тело `PATCH /api/vehicles/:id` — три состояния поля, как у похода. */
export class UpdateVehicleDto {
  @ApiProperty({
    description: 'Способ доставки — только личный',
    enum: TRANSFER_PERSONAL_MODES,
    required: false,
  })
  @IsOptional()
  @IsIn(TRANSFER_PERSONAL_MODES, {
    message:
      'В каталоге только личный транспорт: автобус, ж/д, корабль и вертолёт — рейсы',
  })
  mode?: TransferMode;

  @ApiProperty({ description: 'Название', required: false })
  @IsOptional()
  @IsString({ message: 'Название должно быть строкой' })
  @Length(1, 100, { message: 'Название — от 1 до 100 символов' })
  title?: string;

  @ApiProperty({ description: 'Всего мест или null', required: false, nullable: true })
  @IsOptional()
  @IsInt({ message: 'Места — целое число' })
  @Min(1, { message: 'Мест должно быть хотя бы одно' })
  @Max(60, { message: 'Больше 60 мест не бывает' })
  seats?: number | null;

  @ApiProperty({ description: 'Номер или null', required: false, nullable: true })
  @IsOptional()
  @IsString({ message: 'Номер должен быть строкой' })
  @Length(1, 20, { message: 'Номер — до 20 символов' })
  plate?: string | null;

  @ApiProperty({ description: 'Заметка или null', required: false, nullable: true })
  @IsOptional()
  @IsString({ message: 'Заметка должна быть строкой' })
  @Length(1, 500, { message: 'Заметка — до 500 символов' })
  note?: string | null;
}
