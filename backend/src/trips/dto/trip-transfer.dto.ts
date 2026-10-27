import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
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
  TRANSFER_COMPENSATIONS,
  TRANSFER_DIRECTIONS,
  TRANSFER_MODES,
  TRANSFER_PASSENGER_STATUSES,
  type TransferCompensation,
  type TransferDirection,
  type TransferMode,
  type TransferPassengerStatus,
} from '../trip-transfer.types';

/**
 * Ответы и тела запросов вкладки «Трансфер».
 *
 * **Все ручки вкладки возвращают её состояние целиком** (`TripTransferDto`):
 * на экране занятые места, заявки и состав карточек — числа от двух таблиц,
 * и собрать их из частичного ответа значит однажды показать неправду.
 *
 * Id — строками, как везде в проекте, где ключ `bigint`.
 */

/** Кого можно посадить: участник, который идёт. */
export class TransferTravelerDto {
  @ApiProperty({ description: 'Id участника', example: '90ca6b06-…' })
  userId: string;

  @ApiProperty({ description: 'Имя для человека', example: 'Пётр' })
  displayName: string;
}

/**
 * Пассажир карточки.
 *
 * `requested` — попросился на чужое ТС и ждёт владельца; `accepted` — едет.
 * На рейсах заявок нет: купил билет — едешь.
 */
export class TransferPassengerDto {
  @ApiProperty({ description: 'Id участника' })
  userId: string;

  @ApiProperty({ description: 'Имя для человека' })
  displayName: string;

  @ApiProperty({
    description: 'Заявка или уже едет',
    enum: TRANSFER_PASSENGER_STATUSES,
    example: 'accepted',
  })
  status: TransferPassengerStatus;
}

/** Карточка перемещения: одна часть группы едет одним способом. */
export class TransferLegDto {
  @ApiProperty({ description: 'Id карточки', example: '7' })
  id: string;

  @ApiProperty({
    description: 'Сторона: туда или обратно',
    enum: TRANSFER_DIRECTIONS,
    example: 'there',
  })
  direction: TransferDirection;

  @ApiProperty({ description: 'Порядок внутри стороны, с 1', example: 1 })
  position: number;

  @ApiProperty({
    description: 'Способ доставки',
    enum: TRANSFER_MODES,
    example: 'car',
  })
  mode: TransferMode;

  @ApiProperty({ description: 'Время отправления (ISO)' })
  departsAt: string;

  @ApiProperty({ description: 'Откуда', example: 'Иркутск, автовокзал' })
  fromPlace: string;

  @ApiProperty({ description: 'Докуда', example: 'Олхинское плато, Витязь' })
  toPlace: string;

  @ApiProperty({
    description: '«Наше ТС»: транспорт группы, а не рейс',
    example: true,
  })
  isOwnVehicle: boolean;

  @ApiProperty({
    description: 'Владелец ТС. null — рейс (автобус, ж/д, корабль, вертолёт)',
    nullable: true,
  })
  ownerUserId: string | null;

  @ApiProperty({ description: 'Имя владельца ТС', nullable: true })
  ownerName: string | null;

  @ApiProperty({
    description: 'Всего мест, включая водителя. null — не указано',
    nullable: true,
    example: 5,
  })
  seats: number | null;

  @ApiProperty({ description: 'Сколько мест занято принятыми пассажирами', example: 3 })
  occupied: number;

  @ApiProperty({
    description: 'Как считается компенсация расходов',
    enum: TRANSFER_COMPENSATIONS,
    example: 'shared',
  })
  compensation: TransferCompensation;

  @ApiProperty({
    description: 'Сумма компенсации, рубли. null — безвозмездно или не указана',
    nullable: true,
    example: 3000,
  })
  compensationAmountRub: number | null;

  @ApiProperty({
    description: '«Туда-обратно»: расход один на две стороны',
    example: false,
  })
  isRoundTrip: boolean;

  @ApiProperty({ description: 'Заметка', nullable: true })
  note: string | null;

  @ApiProperty({
    description: 'Правит ли смотрящий карточку: право вкладки или владелец ТС',
    example: false,
  })
  canEdit: boolean;

  @ApiProperty({
    description:
      'Что будет, если смотрящий присоединится: accepted — сразу едет, requested — заявка владельцу, null — уже в карточке или нельзя',
    enum: TRANSFER_PASSENGER_STATUSES,
    nullable: true,
    example: 'requested',
  })
  joinStatus: TransferPassengerStatus | null;

  @ApiProperty({ description: 'Пассажиры и заявки', type: [TransferPassengerDto] })
  passengers: TransferPassengerDto[];
}

/** Вкладка «Трансфер» целиком. */
export class TripTransferDto {
  @ApiProperty({
    description: 'Может ли смотрящий создавать любые карточки (право на вкладку)',
    example: false,
  })
  canEdit: boolean;

  @ApiProperty({
    description: 'Кого можно посадить: участники, которые идут',
    type: [TransferTravelerDto],
  })
  travelers: TransferTravelerDto[];

  @ApiProperty({ description: 'Карточки перемещений', type: [TransferLegDto] })
  legs: TransferLegDto[];
}

/**
 * Тело `POST /api/trips/:id/transfer/legs`.
 *
 * `direction` и `mode` обязательны; `departsAt`, `fromPlace`, `toPlace` —
 * обязательны (заказчик: «обязательные поля»). Остальное имеет разумные
 * значения по умолчанию: безвозмездно, без мест, без владельца.
 *
 * `isOwnVehicle` ставит только тот, кому роль дала вкладку; участник свой
 * транспорт получает с флагом автоматически. У рейсов флага не бывает.
 */
export class CreateTransferLegDto {
  @ApiProperty({ description: 'Сторона', enum: TRANSFER_DIRECTIONS })
  @IsIn(TRANSFER_DIRECTIONS, { message: 'Сторона — «туда» или «обратно»' })
  direction: TransferDirection;

  @ApiProperty({ description: 'Способ доставки', enum: TRANSFER_MODES })
  @IsIn(TRANSFER_MODES, { message: 'Недопустимый способ доставки' })
  mode: TransferMode;

  @ApiProperty({ description: 'Время отправления (ISO)' })
  @IsDateString({}, { message: 'Время отправления — дата ISO' })
  departsAt: string;

  @ApiProperty({ description: 'Откуда' })
  @IsString({ message: 'Точка отправления должна быть строкой' })
  @Length(1, 200, { message: 'Откуда — от 1 до 200 символов' })
  fromPlace: string;

  @ApiProperty({ description: 'Докуда' })
  @IsString({ message: 'Точка прибытия должна быть строкой' })
  @Length(1, 200, { message: 'Докуда — от 1 до 200 символов' })
  toPlace: string;

  @ApiProperty({
    description: '«Наше ТС»: ставит организатор или тот, кому дали вкладку',
    required: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'Флаг «наше ТС» — да или нет' })
  isOwnVehicle?: boolean;

  @ApiProperty({
    description: 'Владелец ТС — участник похода. Нужен при флаге «наше ТС»',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsUUID('4', { message: 'Владельцу ТС нужен корректный UUID' })
  ownerUserId?: string | null;

  @ApiProperty({ description: 'Всего мест', required: false, nullable: true })
  @IsOptional()
  @IsInt({ message: 'Места — целое число' })
  @Min(1, { message: 'Мест должно быть хотя бы одно' })
  @Max(60, { message: 'Больше 60 мест не бывает' })
  seats?: number | null;

  @ApiProperty({ description: 'Компенсация расходов', enum: TRANSFER_COMPENSATIONS })
  @IsIn(TRANSFER_COMPENSATIONS, { message: 'Недопустимый вид компенсации' })
  compensation: TransferCompensation;

  @ApiProperty({
    description: 'Сумма компенсации, рубли. Нужна для всего, кроме «безвозмездно»',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsInt({ message: 'Сумма — целое число рублей' })
  @Min(0, { message: 'Сумма не бывает отрицательной' })
  @Max(10_000_000, { message: 'Слишком большая сумма' })
  compensationAmountRub?: number | null;

  @ApiProperty({
    description: '«Туда-обратно»: только у общих расходов',
    required: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'Флаг «туда-обратно» — да или нет' })
  isRoundTrip?: boolean;

  @ApiProperty({ description: 'Заметка', required: false, nullable: true })
  @IsOptional()
  @IsString({ message: 'Заметка должна быть строкой' })
  @Length(1, 500, { message: 'Заметка — до 500 символов' })
  note?: string | null;
}

/**
 * Тело `PATCH /api/trips/:id/transfer/legs/:legId` — три состояния поля,
 * как у похода: поля нет — не трогаем, `null` — стереть, значение — записать.
 *
 * Смена способа проверяется **по итогу**, а не по патчу: карточка могла быть
 * «нашим авто» с общим расходом, а пришла только `mode: 'bus'` — тогда
 * и флаг, и компенсация перестают быть законными, и это 400 с текстом.
 */
export class UpdateTransferLegDto {
  @ApiProperty({ description: 'Сторона', enum: TRANSFER_DIRECTIONS, required: false })
  @IsOptional()
  @IsIn(TRANSFER_DIRECTIONS, { message: 'Сторона — «туда» или «обратно»' })
  direction?: TransferDirection;

  @ApiProperty({ description: 'Способ доставки', enum: TRANSFER_MODES, required: false })
  @IsOptional()
  @IsIn(TRANSFER_MODES, { message: 'Недопустимый способ доставки' })
  mode?: TransferMode;

  @ApiProperty({ description: 'Время отправления (ISO)', required: false })
  @IsOptional()
  @IsDateString({}, { message: 'Время отправления — дата ISO' })
  departsAt?: string;

  @ApiProperty({ description: 'Откуда', required: false })
  @IsOptional()
  @IsString({ message: 'Точка отправления должна быть строкой' })
  @Length(1, 200, { message: 'Откуда — от 1 до 200 символов' })
  fromPlace?: string;

  @ApiProperty({ description: 'Докуда', required: false })
  @IsOptional()
  @IsString({ message: 'Точка прибытия должна быть строкой' })
  @Length(1, 200, { message: 'Докуда — до 200 символов' })
  toPlace?: string;

  @ApiProperty({ description: '«Наше ТС»', required: false })
  @IsOptional()
  @IsBoolean({ message: 'Флаг «наше ТС» — да или нет' })
  isOwnVehicle?: boolean;

  @ApiProperty({ description: 'Владелец ТС или null', required: false, nullable: true })
  @IsOptional()
  @IsUUID('4', { message: 'Владельцу ТС нужен корректный UUID' })
  ownerUserId?: string | null;

  @ApiProperty({ description: 'Всего мест или null', required: false, nullable: true })
  @IsOptional()
  @IsInt({ message: 'Места — целое число' })
  @Min(1, { message: 'Мест должно быть хотя бы одно' })
  @Max(60, { message: 'Больше 60 мест не бывает' })
  seats?: number | null;

  @ApiProperty({ description: 'Компенсация', enum: TRANSFER_COMPENSATIONS, required: false })
  @IsOptional()
  @IsIn(TRANSFER_COMPENSATIONS, { message: 'Недопустимый вид компенсации' })
  compensation?: TransferCompensation;

  @ApiProperty({
    description: 'Сумма компенсации, рубли или null',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsInt({ message: 'Сумма — целое число рублей' })
  @Min(0, { message: 'Сумма не бывает отрицательной' })
  @Max(10_000_000, { message: 'Слишком большая сумма' })
  compensationAmountRub?: number | null;

  @ApiProperty({ description: '«Туда-обратно»', required: false })
  @IsOptional()
  @IsBoolean({ message: 'Флаг «туда-обратно» — да или нет' })
  isRoundTrip?: boolean;

  @ApiProperty({ description: 'Заметка или null', required: false, nullable: true })
  @IsOptional()
  @IsString({ message: 'Заметка должна быть строкой' })
  @Length(1, 500, { message: 'Заметка — до 500 символов' })
  note?: string | null;
}

/**
 * Тело `POST …/legs/:legId/passengers` — посадить человека.
 *
 * `status` по умолчанию `accepted` (владелец сажает сразу), но владелец
 * может и не решать за него: `requested` — «попросился, решай».
 */
export class AddTransferPassengerDto {
  @ApiProperty({ description: 'Кого посадить', example: '1f0f5a52-…' })
  @IsUUID('4', { message: 'Нужен корректный UUID участника' })
  userId: string;

  @ApiProperty({
    description: 'Заявка или сразу едет',
    enum: TRANSFER_PASSENGER_STATUSES,
    required: false,
    default: 'accepted',
  })
  @IsOptional()
  @IsIn(TRANSFER_PASSENGER_STATUSES, { message: 'Недопустимый статус пассажира' })
  status?: TransferPassengerStatus;
}
