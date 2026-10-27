import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

import {
  TRANSFER_CAR_OWNERSHIPS,
  TRANSFER_MODES,
  type TransferCarOwnership,
  type TransferMode,
} from '../trip-transfer.types';

/**
 * Ответы и тела запросов вкладки «Трансфер».
 *
 * **Все ручки вкладки возвращают её состояние целиком** (`TripTransferDto`).
 * Вкладка — один экран с кучей связанных чисел: места в машине, «без машины»,
 * пассажиры строки. Если отвечать только изменённой строкой, клиент начнёт
 * собирать состояние сам и однажды покажет «3 из 5» там, где уже «4 из 5».
 * Ответ целиком стоит одного лишнего запроса к базе и снимает этот класс
 * ошибок совсем.
 *
 * Id — строками, как везде в проекте, где ключ `bigint`: в JSON число
 * потеряло бы точность на больших значениях, а TypeORM отдаёт `bigint`
 * строкой и внутри приложения.
 */

/** Кого можно посадить в строку: участник, который идёт. */
export class TransferTravelerDto {
  @ApiProperty({ description: 'Id участника', example: '90ca6b06-…' })
  userId: string;

  @ApiProperty({ description: 'Имя для человека', example: 'Пётр' })
  displayName: string;
}

/** Пассажир строки. `carId: null` — едет, но места в машине нет. */
export class TransferPassengerDto {
  @ApiProperty({ description: 'Id участника' })
  userId: string;

  @ApiProperty({ description: 'Имя для человека' })
  displayName: string;

  @ApiProperty({
    description: 'Машина, в которой едет. null — «без машины»',
    nullable: true,
    example: '3',
  })
  carId: string | null;
}

/** Машина строки заброски. */
export class TransferCarDto {
  @ApiProperty({ description: 'Id машины в походе', example: '3' })
  id: string;

  @ApiProperty({
    description: 'Своя или наёмная',
    enum: TRANSFER_CAR_OWNERSHIPS,
    example: 'own',
  })
  ownership: TransferCarOwnership;

  @ApiProperty({
    description: 'Водитель-участник. null — наёмный водитель без аккаунта',
    nullable: true,
  })
  driverUserId: string | null;

  @ApiProperty({
    description: 'Имя водителя: из профиля участника или вписанное для наёмного',
    example: 'Сергей',
  })
  driverName: string;

  @ApiProperty({
    description: 'Телефон водителя — в день выезда ищут его',
    nullable: true,
    example: '+7 902 111-22-33',
  })
  driverPhone: string | null;

  @ApiProperty({
    description: 'Всего мест, включая водителя. null — не указано, потолка нет',
    nullable: true,
    example: 5,
  })
  seats: number | null;

  @ApiProperty({
    description:
      'Сколько мест занято: пассажиры машины плюс водитель, если он наёмный и в составе его нет',
    example: 3,
  })
  occupied: number;

  @ApiProperty({
    description:
      'Правит ли смотрящий эту машину: право вкладки или сам водитель своей машины',
    example: false,
  })
  canEdit: boolean;
}

/** Строка заброски: когда, откуда, куда и на чём. */
export class TransferLegDto {
  @ApiProperty({ description: 'Id строки', example: '7' })
  id: string;

  @ApiProperty({ description: 'Порядок в списке, с 1', example: 1 })
  position: number;

  @ApiProperty({
    description: 'Выезд (ISO). null — время уточняется',
    nullable: true,
  })
  departsAt: string | null;

  @ApiProperty({ description: 'Откуда', example: 'Иркутск, автовокзал' })
  fromPlace: string;

  @ApiProperty({ description: 'Куда', example: 'Олхинское плато, Витязь' })
  toPlace: string;

  @ApiProperty({
    description: 'Вид заброски',
    enum: TRANSFER_MODES,
    example: 'car',
  })
  mode: TransferMode;

  @ApiProperty({ description: 'Заметка', nullable: true })
  note: string | null;

  @ApiProperty({ description: 'Машины строки', type: [TransferCarDto] })
  cars: TransferCarDto[];

  @ApiProperty({ description: 'Кто едет строкой', type: [TransferPassengerDto] })
  passengers: TransferPassengerDto[];
}

/** Вкладка «Трансфер» целиком. */
export class TripTransferDto {
  @ApiProperty({
    description:
      'Место сбора (`trips.meeting_place`): строка похода, а не строка заброски',
    nullable: true,
    example: 'Иркутск, автовокзал, у первой платформы',
  })
  meetingPlace: string | null;

  @ApiProperty({
    description: 'Может ли смотрящий править строки (право на вкладку)',
    example: false,
  })
  canEdit: boolean;

  @ApiProperty({
    description: 'Кого можно посадить: участники, которые идут',
    type: [TransferTravelerDto],
  })
  travelers: TransferTravelerDto[];

  @ApiProperty({ description: 'Строки заброски', type: [TransferLegDto] })
  legs: TransferLegDto[];
}

/** Тело `POST /api/trips/:id/transfer/legs`. */
export class CreateTransferLegDto {
  @ApiProperty({ description: 'Вид заброски', enum: TRANSFER_MODES })
  @IsIn(TRANSFER_MODES, { message: 'Недопустимый вид заброски' })
  mode: TransferMode;

  @ApiProperty({ description: 'Откуда', example: 'Иркутск, автовокзал' })
  @IsString({ message: 'Точка отправления должна быть строкой' })
  @Length(1, 200, { message: 'Откуда — от 1 до 200 символов' })
  fromPlace: string;

  @ApiProperty({ description: 'Куда', example: 'Олхинское плато, Витязь' })
  @IsString({ message: 'Точка прибытия должна быть строкой' })
  @Length(1, 200, { message: 'Куда — от 1 до 200 символов' })
  toPlace: string;

  @ApiProperty({
    description: 'Выезд (ISO). Не указан — «время уточняется»',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsDateString({}, { message: 'Дата выезда должна быть датой ISO' })
  departsAt?: string | null;

  @ApiProperty({ description: 'Заметка', required: false, nullable: true })
  @IsOptional()
  @IsString({ message: 'Заметка должна быть строкой' })
  @Length(1, 500, { message: 'Заметка — до 500 символов' })
  note?: string | null;
}

/**
 * Тело `PATCH /api/trips/:id/transfer/legs/:legId`.
 *
 * Три состояния поля, как у похода: поля нет — не трогаем, `null` — стереть,
 * значение — записать. Смена вида на «не авто» при существующих машинах —
 * 400: сначала уберите машины, иначе они остались бы в данных строки,
 * которая их не предусматривает.
 */
export class UpdateTransferLegDto {
  @ApiProperty({ description: 'Вид заброски', enum: TRANSFER_MODES, required: false })
  @IsOptional()
  @IsIn(TRANSFER_MODES, { message: 'Недопустимый вид заброски' })
  mode?: TransferMode;

  @ApiProperty({ description: 'Откуда', required: false })
  @IsOptional()
  @IsString({ message: 'Точка отправления должна быть строкой' })
  @Length(1, 200, { message: 'Откуда — от 1 до 200 символов' })
  fromPlace?: string;

  @ApiProperty({ description: 'Куда', required: false })
  @IsOptional()
  @IsString({ message: 'Точка прибытия должна быть строкой' })
  @Length(1, 200, { message: 'Куда — до 200 символов' })
  toPlace?: string;

  @ApiProperty({ description: 'Выезд (ISO) или null', required: false, nullable: true })
  @IsOptional()
  @IsDateString({}, { message: 'Дата выезда должна быть датой ISO' })
  departsAt?: string | null;

  @ApiProperty({ description: 'Заметка или null', required: false, nullable: true })
  @IsOptional()
  @IsString({ message: 'Заметка должна быть строкой' })
  @Length(1, 500, { message: 'Заметка — до 500 символов' })
  note?: string | null;
}

/**
 * Тело `POST /api/trips/:id/transfer/legs/:legId/cars`.
 *
 * `own` — машина участника, водителя называем его id. `hired` — наёмная:
 * имя и телефон водителя, аккаунта у него нет. Свою машину участник может
 * добавить сам, наёмную — только тот, кому роль дала вкладку.
 */
export class CreateTransferCarDto {
  @ApiProperty({
    description: 'Своя или наёмная',
    enum: TRANSFER_CAR_OWNERSHIPS,
    example: 'own',
  })
  @IsIn(TRANSFER_CAR_OWNERSHIPS, { message: 'Машина бывает своя или наёмная' })
  ownership: TransferCarOwnership;

  @ApiProperty({
    description: 'Водитель-участник. Обязателен для своей машины',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsUUID('4', { message: 'Водителю нужен корректный UUID пользователя' })
  driverUserId?: string | null;

  @ApiProperty({
    description: 'Имя водителя наёмной машины. Обязательно для наёмной',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: 'Имя водителя должно быть строкой' })
  @Length(1, 100, { message: 'Имя водителя — до 100 символов' })
  driverName?: string | null;

  @ApiProperty({ description: 'Телефон водителя', required: false, nullable: true })
  @IsOptional()
  @IsString({ message: 'Телефон должен быть строкой' })
  @Length(1, 40, { message: 'Телефон — до 40 символов' })
  driverPhone?: string | null;

  @ApiProperty({
    description: 'Всего мест, включая водителя. Не указано — потолка нет',
    required: false,
    nullable: true,
    example: 5,
  })
  @IsOptional()
  @IsInt({ message: 'Места — целое число' })
  @Min(1, { message: 'Мест должно быть хотя бы одно' })
  @Max(60, { message: 'Больше 60 мест не бывает' })
  seats?: number | null;

  @ApiProperty({ description: 'Заметка', required: false, nullable: true })
  @IsOptional()
  @IsString({ message: 'Заметка должна быть строкой' })
  @Length(1, 500, { message: 'Заметка — до 500 символов' })
  note?: string | null;
}

/**
 * Тело `PATCH /api/trips/:id/transfer/cars/:carId`.
 *
 * Те же поля, что при создании, и те же три состояния: своего водителя
 * сменить нельзя через `ownership` (это другая машина) — но имя и телефон
 * наёмного, места и заметку правит и сам водитель.
 */
export class UpdateTransferCarDto {
  @ApiProperty({ description: 'Водитель-участник', required: false, nullable: true })
  @IsOptional()
  @IsUUID('4', { message: 'Водителю нужен корректный UUID пользователя' })
  driverUserId?: string | null;

  @ApiProperty({ description: 'Имя водителя наёмной машины', required: false, nullable: true })
  @IsOptional()
  @IsString({ message: 'Имя водителя должно быть строкой' })
  @Length(1, 100, { message: 'Имя водителя — до 100 символов' })
  driverName?: string | null;

  @ApiProperty({ description: 'Телефон водителя', required: false, nullable: true })
  @IsOptional()
  @IsString({ message: 'Телефон должен быть строкой' })
  @Length(1, 40, { message: 'Телефон — до 40 символов' })
  driverPhone?: string | null;

  @ApiProperty({ description: 'Всего мест или null — «не знаю»', required: false, nullable: true })
  @IsOptional()
  @IsInt({ message: 'Места — целое число' })
  @Min(1, { message: 'Мест должно быть хотя бы одно' })
  @Max(60, { message: 'Больше 60 мест не бывает' })
  seats?: number | null;

  @ApiProperty({ description: 'Заметка или null', required: false, nullable: true })
  @IsOptional()
  @IsString({ message: 'Заметка должна быть строкой' })
  @Length(1, 500, { message: 'Заметка — до 500 символов' })
  note?: string | null;
}

/** Тело `POST …/legs/:legId/passengers` — поставить человека в строку. */
export class AddTransferPassengerDto {
  @ApiProperty({
    description: 'Кого посадить: участник, который идёт',
    example: '1f0f5a52-…',
  })
  @IsUUID('4', { message: 'Нужен корректный UUID участника' })
  userId: string;
}

/**
 * Тело `PUT …/legs/:legId/passengers/:userId` — место в машине.
 *
 * `carId: null` — «едет строкой, но без машины»: это законное состояние,
 * а не снятие со строки (для него есть `DELETE`).
 */
export class SeatTransferPassengerDto {
  @ApiProperty({
    description: 'Машина этой строки. null — оставить без машины',
    nullable: true,
    example: 3,
  })
  @IsOptional()
  @IsInt({ message: 'Машина — целое число' })
  @Min(1, { message: 'Некорректная машина' })
  carId?: number | null;
}
