import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import type { TripCompensation } from '../entities/trip-compensation.entity';
import type { TripExpense } from '../entities/trip-expense.entity';
import { USER_GENDERS, type UserGender } from '../../users/gender.types';
import {
  EXPENSE_SPLITS,
  type CompensationOption,
  type ExpenseSplit,
} from '../finance';

/** Потолок суммы — чтобы опечатка в лишний ноль не ломала арифметику. */
const MAX_AMOUNT_RUB = 10_000_000;

/**
 * Тело `POST/PATCH /api/trips/:id/finance/expenses`.
 *
 * Одна форма на создание и правку: модалка всегда отправляет все поля
 * целиком, а частичная правка суммы без долей оставила бы расход
 * с долями от прежней суммы. `participantIds` нужен только для
 * `split = 'group'`; для «на всех» и «на питающихся с общего» состав
 * считает сервер, а не клиент, — иначе группу можно было бы подменить.
 */
export class SaveTripExpenseDto {
  @ApiProperty({
    description: 'Сумма расхода в рублях, целая',
    example: 12000,
    minimum: 1,
    maximum: MAX_AMOUNT_RUB,
  })
  @IsInt({ message: 'Сумма — целое число рублей' })
  @Min(1, { message: 'Сумма должна быть больше нуля' })
  @Max(MAX_AMOUNT_RUB, {
    message: `Сумма не должна превышать ${MAX_AMOUNT_RUB} ₽`,
  })
  amountRub: number;

  @ApiProperty({
    description:
      'За что расход. Для «Чека» можно не передавать — запишется «на продукты».',
    example: 'Продукты на всё время похода',
    maxLength: 200,
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'Описание не должно превышать 200 символов' })
  description?: string;

  @ApiProperty({
    description:
      'all — на всех идущих, group — на выбранных участников, commonEaters — на питающихся с общего',
    enum: EXPENSE_SPLITS,
    example: 'all',
  })
  @IsIn(EXPENSE_SPLITS, {
    message: 'Деление: all, group или commonEaters',
  })
  split: ExpenseSplit;

  @ApiProperty({
    description: 'Кого включать в доли — только для split = group',
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique({ message: 'Участник в расходах повторяется' })
  @ArrayMaxSize(50, { message: 'Слишком много участников в одном расходе' })
  @IsUUID('all', { each: true, message: 'Участник должен быть человеком' })
  participantIds?: string[];

  @ApiProperty({
    description:
      'Дата траты ГГГГ-ММ-ДД. Не передана — сегодня',
    example: '2026-11-11',
    required: false,
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Дата — в виде ГГГГ-ММ-ДД' })
  spentAt?: string;

  @ApiProperty({
    description:
      'Кто заплатил. Не передано — я. Можно человека без аккаунта, которого веду: за него платёж записывает участник похода',
    example: '90ca6b06-fb04-4c5e-8c49-36ef5d188c50',
    required: false,
  })
  @IsOptional()
  @IsUUID('all', { message: 'Плательщик должен быть человеком' })
  payerUserId?: string;
}

/** Тело `POST /api/trips/:id/finance/compensations`. */
export class CreateTripCompensationDto {
  @ApiProperty({
    description:
      'Любой человек семьи получателя: деньги идут в общую кассу семьи, сервер создаёт один перевод',
    example: '90ca6b06-fb04-4c5e-8c49-36ef5d188c50',
  })
  @IsUUID('all', { message: 'Получатель должен быть человеком' })
  toUserId: string;

  @ApiProperty({
    description: 'Сумма перевода в рублях, целая',
    example: 1000,
    minimum: 1,
    maximum: MAX_AMOUNT_RUB,
  })
  @IsInt({ message: 'Сумма — целое число рублей' })
  @Min(1, { message: 'Сумма должна быть больше нуля' })
  @Max(MAX_AMOUNT_RUB, {
    message: `Сумма не должна превышать ${MAX_AMOUNT_RUB} ₽`,
  })
  amountRub: number;

  @ApiProperty({
    description:
      'Кто переводит. Не передано — я. Можно человека без аккаунта, которого веду',
    example: '90ca6b06-fb04-4c5e-8c49-36ef5d188c50',
    required: false,
  })
  @IsOptional()
  @IsUUID('all', { message: 'Отправитель должен быть человеком' })
  fromUserId?: string;
}

/** Доля в ответе: имя рядом с суммой, чтобы таблица не собирала его сама. */
export class TripExpenseShareDto {
  @ApiProperty()
  userId: string;

  @ApiProperty()
  displayName: string;

  @ApiProperty()
  amountRub: number;
}

/** Строка расхода в таблице движения денег. */
export class TripExpenseDto {
  @ApiProperty({ example: '12' })
  id: string;

  @ApiProperty({ description: 'Дата траты', example: '2026-11-11' })
  spentAt: string;

  @ApiProperty()
  authorUserId: string;

  @ApiProperty({ example: 'Григорий' })
  authorName: string;

  @ApiProperty({ nullable: true })
  authorAvatarUrl: string | null;

  @ApiProperty({ example: 12000 })
  amountRub: number;

  @ApiProperty({ example: 'Продукты' })
  description: string;

  @ApiProperty({ enum: EXPENSE_SPLITS })
  split: ExpenseSplit;

  @ApiProperty({ type: [TripExpenseShareDto] })
  shares: TripExpenseShareDto[];

  @ApiProperty({ description: 'Может ли текущий человек править запись' })
  canEdit: boolean;

  static from(expense: TripExpense, viewerId: string): TripExpenseDto {
    return {
      id: expense.id,
      spentAt: expense.spentAt,
      authorUserId: expense.authorUserId,
      authorName: expense.author?.displayName ?? '',
      authorAvatarUrl: expense.author?.avatarUrl ?? null,
      amountRub: expense.amountRub,
      description: expense.description,
      split: expense.split,
      shares: (expense.shares ?? []).map((share) => ({
        userId: share.userId,
        displayName: share.user?.displayName ?? '',
        amountRub: share.amountRub,
      })),
      canEdit: expense.authorUserId === viewerId,
    };
  }
}

/** Строка компенсации в таблице движения денег. */
export class TripCompensationDto {
  @ApiProperty({ example: '3' })
  id: string;

  @ApiProperty({ description: 'Когда создана' })
  createdAt: string;

  @ApiProperty()
  fromUserId: string;

  @ApiProperty({ example: 'Анна' })
  fromName: string;

  @ApiProperty()
  toUserId: string;

  @ApiProperty({ example: 'Григорий' })
  toName: string;

  @ApiProperty({ example: 1000 })
  amountRub: number;

  @ApiProperty({ enum: ['pending', 'confirmed'] })
  status: 'pending' | 'confirmed';

  @ApiProperty({ nullable: true })
  confirmedAt: string | null;

  @ApiProperty({ description: 'Может ли текущий человек подтвердить' })
  canConfirm: boolean;

  @ApiProperty({ description: 'Может ли текущий человек отменить запись' })
  canCancel: boolean;

  static from(compensation: TripCompensation, viewerId: string): TripCompensationDto {
    return {
      id: compensation.id,
      createdAt: compensation.createdAt.toISOString(),
      fromUserId: compensation.fromUserId,
      fromName: compensation.fromUser?.displayName ?? '',
      toUserId: compensation.toUserId,
      toName: compensation.toUser?.displayName ?? '',
      amountRub: compensation.amountRub,
      status: compensation.status,
      confirmedAt: compensation.confirmedAt?.toISOString() ?? null,
      canConfirm:
        compensation.toUserId === viewerId && compensation.status === 'pending',
      canCancel:
        compensation.fromUserId === viewerId &&
        compensation.status === 'pending',
    };
  }
}

/**
 * Участник с балансом и реквизитами.
 *
 * Реквизиты отдаются только здесь — в ответе «Бухгалтерии», куда имеет
 * доступ лишь состав похода. В публичный профиль и список участников
 * они не попадают.
 */
export class FinanceMemberDto {
  @ApiProperty()
  userId: string;

  @ApiProperty()
  displayName: string;

  @ApiProperty({ nullable: true })
  avatarUrl: string | null;

  @ApiProperty({ description: 'Положительный — должны ему' })
  balanceRub: number;

  @ApiProperty({ description: 'Баланс с учётом ожидающих компенсаций' })
  remainingRub: number;

  @ApiProperty({
    description: 'Человек без аккаунта: за него платит и переводит ведущий',
  })
  isVirtual: boolean;

  @ApiProperty({
    description:
      'Этого человека без аккаунта ведёт смотрящий: ему можно записать платёж и перевод',
  })
  managedByMe: boolean;

  @ApiProperty({ nullable: true })
  paymentDetails: string | null;

  @ApiProperty({ nullable: true })
  paymentBank: string | null;
}

/** Получатель внутри варианта компенсации: реквизиты и пол для подписи. */
export class CompensationPersonDto {
  @ApiProperty()
  userId: string;

  @ApiProperty()
  displayName: string;

  @ApiProperty({
    description: 'Пол: m — мужской, f — женский. Нужен подписи об отсутствии реквизитов',
    enum: USER_GENDERS,
    example: 'f',
  })
  gender: UserGender;

  @ApiProperty({ nullable: true })
  paymentDetails: string | null;

  @ApiProperty({ nullable: true })
  paymentBank: string | null;
}

/**
 * Вариант «кому перевести» в модалке компенсации.
 *
 * С 12.11.2026 вариант — **семья целиком**: «Вася и Аня» одной строкой,
 * а сумма — `min(долг моей семьи, кредит этой семьи)` по общей кассе
 * (12.11.2026). Поэтому здесь `userIds` и `members`, а не один человек:
 * реквизиты показываются у всех, у кого они есть.
 */
export class CompensationOptionDto implements CompensationOption {
  @ApiProperty({ type: [String] })
  userIds: string[];

  @ApiProperty({ example: 'Вася и Аня' })
  displayName: string;

  @ApiProperty({ description: 'Сколько можно перевести этой семье' })
  amountRub: number;

  @ApiProperty({ type: [CompensationPersonDto] })
  members: CompensationPersonDto[];
}

/**
 * Общая касса семьи на экране (12.11.2026).
 *
 * Одна строка вместо балансов участников: внутри семьи деньги не считаются
 * по людям, и минус одного гасится плюсом другого. Семья из одного человека
 * — это просто его личный баланс, поэтому отдельного случая нет.
 */
export class FinanceFamilyDto {
  @ApiProperty({ type: [String], description: 'Идущие участники семьи' })
  memberIds: string[];

  @ApiProperty({ example: 'Вася и Аня' })
  displayName: string;

  @ApiProperty({
    description: 'Касса семьи: сумма балансов её участников',
    example: -1000,
  })
  balanceRub: number;

  @ApiProperty({
    description: 'Та же касса с учётом ожидающих компенсаций',
    example: 0,
  })
  remainingRub: number;

  @ApiProperty({ description: 'Семья смотрящего' })
  isMine: boolean;
}

/** Мой баланс и подсказки — то, что видит человек в шапке вкладки. */
export class MyFinanceDto {
  @ApiProperty({ description: 'Личный баланс — внутренняя арифметика семьи' })
  balanceRub: number;

  @ApiProperty({ description: 'Личный остаток с учётом ожидающих переводов' })
  remainingRub: number;

  @ApiProperty({
    description: 'Общая касса моей семьи — её и показывает экран',
    example: -1000,
  })
  familyBalanceRub: number;

  @ApiProperty({
    description: 'Касса семьи с учётом ожидающих компенсаций',
    example: 0,
  })
  familyRemainingRub: number;

  @ApiProperty({
    description: 'Долг всей моей семьи — по нему считается сумма компенсации',
  })
  familyDebtRub: number;

  @ApiProperty({
    description: 'Кредит всей моей семьи — по нему объясняется отказ кнопки',
  })
  familyCreditRub: number;

  @ApiProperty({
    description:
      'Может ли текущий человек менять деньги: расход и компенсацию добавляет только идущий участник',
  })
  canSpend: boolean;

  @ApiProperty({ type: [CompensationOptionDto] })
  suggestions: CompensationOptionDto[];
}

/**
 * Отправитель перевода, за которого может действовать смотрящий.
 *
 * С 12.11.2026 это человек без аккаунта: у него нет входа, поэтому платёж
 * и компенсацию за него записывает тот, кто его ведёт. У семьи такого
 * отдельного списка нет — «на пользователя всё вешаем».
 */
export class CompensationSenderDto {
  @ApiProperty()
  userId: string;

  @ApiProperty({ example: 'Дядя Витя' })
  displayName: string;

  @ApiProperty({ description: 'Долг этого человека — по нему считается сумма' })
  familyDebtRub: number;

  @ApiProperty({ description: 'Кредит этого человека' })
  familyCreditRub: number;

  @ApiProperty({ type: [CompensationOptionDto] })
  suggestions: CompensationOptionDto[];
}

/** Ответ `GET /api/trips/:id/finance` — вся вкладка одним запросом. */
export class TripFinanceDto {
  @ApiProperty({ type: [TripExpenseDto] })
  expenses: TripExpenseDto[];

  @ApiProperty({ type: [TripCompensationDto] })
  compensations: TripCompensationDto[];

  @ApiProperty({ type: [FinanceMemberDto] })
  members: FinanceMemberDto[];

  @ApiProperty({
    type: [FinanceFamilyDto],
    description:
      'Общие кассы семей: одна строка на семью, минус одного участника уже погашен плюсом другого',
  })
  families: FinanceFamilyDto[];

  @ApiProperty({ type: MyFinanceDto })
  me: MyFinanceDto;

  @ApiProperty({
    description:
      'Люди без аккаунта, которых ведёт смотрящий: за них можно записать платёж и перевод',
    type: [CompensationSenderDto],
  })
  managedSenders: CompensationSenderDto[];
}
