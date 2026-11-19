import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  ValidateNested,
} from 'class-validator';

import type { TripCompensation } from '../entities/trip-compensation.entity';
import type { CompensationKind } from '../entities/trip-compensation.entity';
import type { TripExpense } from '../entities/trip-expense.entity';
import { USER_GENDERS, type UserGender } from '../../users/gender.types';
import {
  DEPOSIT_DECISIONS,
  DEPOSIT_STATUSES,
  type DepositDecision,
  type DepositStatus,
} from '../trip.types';
import {
  EXPENSE_SPLITS,
  type CompensationOption,
  type ExpenseSplit,
} from '../finance';

/** Потолок суммы — чтобы опечатка в лишний ноль не ломала арифметику. */
const MAX_AMOUNT_RUB = 10_000_000;

/** Сколько офлайн-чеков принимает сервер за одну синхронизацию. */
export const MAX_EXPENSE_SYNC_ENTRIES = 50;

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

  /**
   * Ключ идемпотентности офлайн-чека (19.11.2026).
   *
   * UUID с устройства: чек, созданный без связи, повторно отправляется
   * после обрыва, и сервер не должен завести его дважды. Онлайн-форма тоже
   * присылает ключ: тогда повторная отправка после таймаута безопасна.
   */
  @ApiProperty({
    description:
      'UUID чека с устройства. Повторная отправка с тем же ключом не создаёт дубль',
    example: '3f1c3f56-0d1e-4c4f-8b6a-4a7f1f0f2b11',
    required: false,
  })
  @IsOptional()
  @IsUUID('all', { message: 'Ключ чека должен быть UUID' })
  clientId?: string;
}

/**
 * Один чек из очереди устройства (19.11.2026).
 *
 * То же тело, что у обычного создания расхода, но `clientId` **обязателен**:
 * без ключа синхронизация не смогла бы отличить «ещё не отправляли» от
 * «отправили, но ответ не дошёл». Доли считает сервер по актуальному
 * составу — локальный экран показывает их приблизительно.
 *
 * Обязательность проверяет сервис, а не декоратор: `@IsOptional` у поля
 * в родителе гасит любой `@IsDefined` у наследника (class-validator считает
 * условную проверку родителя первой).
 */
export class SyncTripExpenseDto extends SaveTripExpenseDto {
  @ApiProperty({
    description: 'UUID чека с устройства — ключ идемпотентности',
    example: '3f1c3f56-0d1e-4c4f-8b6a-4a7f1f0f2b11',
  })
  @IsUUID('all', { message: 'Ключ чека должен быть UUID' })
  declare clientId: string;
}

/** Тело `POST /api/trips/:id/finance/expenses/sync`. */
export class SyncTripExpensesDto {
  @ApiProperty({
    description: 'Чеки, созданные на устройстве без связи',
    type: () => [SyncTripExpenseDto],
  })
  @IsArray({ message: 'Пришли список чеков' })
  @ArrayMinSize(1, { message: 'Список чеков пуст' })
  @ArrayMaxSize(MAX_EXPENSE_SYNC_ENTRIES, {
    message: `За один раз можно отправить не больше ${MAX_EXPENSE_SYNC_ENTRIES} чеков`,
  })
  @ValidateNested({ each: true })
  @Type(() => SyncTripExpenseDto)
  entries: SyncTripExpenseDto[];
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

  @ApiProperty({
    description:
      'UUID чека с устройства — по нему экран узнаёт, что офлайн-чек уже доехал. null у чека, созданного онлайн без очереди',
    nullable: true,
    required: false,
  })
  clientId: string | null;

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
      clientId: expense.clientId ?? null,
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

  @ApiProperty({
    description:
      'compensation — обычный перевод долга, deposit — залог за участие (18.11.2026)',
    enum: ['compensation', 'deposit'],
    example: 'compensation',
  })
  kind: CompensationKind;

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
      kind: compensation.kind,
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
 * Общая касса семьи — расчёт для компенсации (12.11.2026).
 *
 * Одна цифра вместо балансов участников: внутри семьи деньги не считаются
 * по людям, и минус одного гасится плюсом другого. С 13.11.2026 экран её
 * **не показывает** — балансы там личные; касса нужна подсказкам перевода.
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
  @ApiProperty({ description: 'Личный баланс — его и показывает шапка вкладки' })
  balanceRub: number;

  @ApiProperty({ description: 'Личный остаток с учётом ожидающих переводов' })
  remainingRub: number;

  @ApiProperty({
    description: 'Общая касса моей семьи — расчёт компенсации, не для экрана',
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
    description: 'Кредит всей моей семьи — по нему видно, есть ли кому переводить',
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

/**
 * Состояние залога одного участника (17.11.2026, переписано 18.11.2026).
 *
 * Рядом с состоянием — кто и когда его поставил: залог держится
 * на прозрачности, а не на запретах. `updatedByName` пустой у состояния
 * по умолчанию: его никто не ставил, оно появилось вместе с суммой залога.
 *
 * **`hasPendingTransfer`** — человек уже нажал «Я передал», но организатор
 * ещё не подтвердил. Это не `held`: балансы не двинулись, и в списке риска
 * строка должна говорить «ждём подтверждения», а не «не сдал».
 */
export class DepositParticipantDto {
  @ApiProperty()
  userId: string;

  @ApiProperty()
  displayName: string;

  @ApiProperty({ nullable: true })
  avatarUrl: string | null;

  @ApiProperty({ enum: DEPOSIT_STATUSES, example: 'pending' })
  status: DepositStatus;

  @ApiProperty({
    description: 'Кто поставил отметку. null — её ещё не ставили',
    nullable: true,
  })
  updatedByName: string | null;

  @ApiProperty({ description: 'Когда поставили отметку', nullable: true })
  updatedAt: string | null;

  @ApiProperty({ description: 'Отметка стоит на смотрящем' })
  isMe: boolean;

  @ApiProperty({
    description:
      'Сколько человек уже вложил в поход: сумма расходов, которые он оплатил',
    example: 1000,
  })
  investedRub: number;

  @ApiProperty({
    description: 'Сумма подтверждённых переводов залога (18.11.2026)',
    example: 100,
  })
  transferredRub: number;

  @ApiProperty({
    description:
      'Сумма переводов, которые ждут подтверждения получателем. Они бронируют недостачу, но в покрытие не входят',
    example: 0,
  })
  pendingRub: number;

  @ApiProperty({
    description: 'Какая часть залога покрыта: min(D, вложено + переведено)',
    example: 200,
  })
  coveredRub: number;

  @ApiProperty({
    description: 'Сколько ещё не покрыто: max(0, D − покрыто)',
    example: 0,
  })
  missingRub: number;

  @ApiProperty({
    description: 'Сколько осталось перевести: недостача минус уже отправленное',
    example: 0,
  })
  dueRub: number;

  @ApiProperty({
    description: 'У кого залог на руках. null — ещё не передан',
    nullable: true,
  })
  holderName: string | null;

  @ApiProperty({ description: 'Человек отказался от похода' })
  declined: boolean;

  @ApiProperty({
    description:
      'Перевод залога отправлен и ждёт подтверждения получателем (18.11.2026)',
  })
  hasPendingTransfer: boolean;

  @ApiProperty({
    description:
      'Есть что решать: у отказавшегося хоть что-то покрыто (covered > 0). С 18.11.2026 это не зависит от deposit_status: залог мог покрыться расходами',
  })
  canDecide: boolean;
}

/**
 * Мой залог: из этого экран решает, показывать ли «Перевести залог».
 *
 * С 18.11.2026 (v3) залог покрывается расходами человека, поэтому кроме
 * состояния здесь лежит сам расчёт: `investedRub` (оплатил расходов),
 * `transferredRub` (подтверждённые переводы), `pendingRub` (переводы
 * в пути), `coveredRub`/`missingRub` — покрытие, `dueRub` — сколько
 * осталось перевести (недостача минус уже отправленное).
 *
 * `canTransfer` — `dueRub > 0`, нет перевода в пути и есть кому перевести:
 * пока перевод ждёт «Получено», кнопка скрыта, чтобы не отправить ту же
 * сумму дважды. `selfHeld` — организатор держит свой залог сам, переводить
 * его не нужно.
 */
export class MyDepositDto {
  @ApiProperty({ enum: DEPOSIT_STATUSES, example: 'pending' })
  status: DepositStatus;

  @ApiProperty({ description: 'Сумма моего залога', example: 2000 })
  amountRub: number;

  @ApiProperty({ description: 'Сколько я оплатил расходов похода', example: 50 })
  investedRub: number;

  @ApiProperty({ description: 'Сколько подтверждённых переводов залога я сделал', example: 100 })
  transferredRub: number;

  @ApiProperty({ description: 'Сколько я перевёл, но получатель ещё не подтвердил', example: 0 })
  pendingRub: number;

  @ApiProperty({ description: 'Какая часть залога покрыта', example: 150 })
  coveredRub: number;

  @ApiProperty({ description: 'Сколько ещё не покрыто', example: 50 })
  missingRub: number;

  @ApiProperty({
    description: 'Сколько осталось перевести: недостача минус уже отправленное',
    example: 50,
  })
  dueRub: number;

  @ApiProperty({ description: 'Могу ли я перевести залог организатору' })
  canTransfer: boolean;

  @ApiProperty({
    description: 'Организатор держит свой залог сам — переводить не нужно',
  })
  selfHeld: boolean;

  @ApiProperty({
    description: 'Кому залог уже передан. null — ещё никому',
    nullable: true,
  })
  holderName: string | null;

  @ApiProperty({ description: 'Мой перевод ждёт подтверждения' })
  hasPendingTransfer: boolean;
}

/**
 * Кто может нажать «Я передал» в модалке (18.11.2026).
 *
 * Залог платит сам участник, а за человека без аккаунта — тот, кто его
 * ведёт. Поэтому в модалке есть выбор отправителя, как у компенсации:
 * иначе организатор с виртуальными друзьями не увидел бы кнопку вовсе.
 *
 * `recipients` — **свои для каждого отправителя**. Виртуальный человек
 * платит организатору, который его ведёт; сам участник себе не переводит.
 * Поэтому общий список получателей здесь не годится.
 */
export class DepositSenderDto {
  @ApiProperty()
  userId: string;

  @ApiProperty({ example: 'Дядя Витя' })
  displayName: string;

  @ApiProperty({ description: 'Это сам смотрящий' })
  isMe: boolean;

  @ApiProperty({
    description:
      'Сколько осталось перевести этому человеку: его недостача минус уже отправленное. Подставляется в модалку',
    example: 150,
  })
  dueRub: number;

  @ApiProperty({
    description: 'Кому может перевести залог именно этот отправитель',
    type: () => [DepositRecipientDto],
  })
  recipients: DepositRecipientDto[];
}

/** Кому можно перевести залог: организатор и соорганизаторы. */
export class DepositRecipientDto {
  @ApiProperty()
  userId: string;

  @ApiProperty()
  displayName: string;

  @ApiProperty({
    description:
      'organizer — автор похода, coOrganizer — назначенный второй организатор',
    enum: ['organizer', 'coOrganizer'],
    example: 'organizer',
  })
  role: 'organizer' | 'coOrganizer';

  @ApiProperty({
    description: 'Пол: m — мужской, f — женский. Нужен подписи об отсутствии реквизитов',
    enum: USER_GENDERS,
    example: 'm',
  })
  gender: UserGender;

  @ApiProperty({ nullable: true })
  paymentDetails: string | null;

  @ApiProperty({ nullable: true })
  paymentBank: string | null;
}

/**
 * Залог участия — блок над «Движением денег» (`finance.md` §2.5).
 *
 * `null` в ответе вкладки значит «залога нет», и блок на экране не
 * рисуется вовсе.
 *
 * **Список — не все участники, а только риск (18.11.2026).** Заказчик:
 * «в секции нужны именно те, кто отказался… тех, кто вложился в поход
 * свыше залога, не нужны». Поэтому `participants` — отказавшиеся
 * и не вложившие сумму залога; сдавших, потратившихся и остальных в списке
 * нет.
 *
 * `canManage` — автор похода или соорганизатор: секция риска только для
 * них. Рядовой участник видит свой залог в `me` — строкой «В походе
 * установлен залог — 200 ₽» в «Твоём балансе» (v3, 18.11.2026), сумма
 * залога есть и в шапке похода.
 */
export class TripDepositDto {
  @ApiProperty({ description: 'Сумма с человека, целые рубли', example: 2000 })
  amountRub: number;

  @ApiProperty({
    description:
      'Может ли смотрящий решать судьбу залога: организатор или соорганизатор',
  })
  canManage: boolean;

  @ApiProperty({
    description: 'Мой залог. null — я не в походе (например, уже отказался)',
    type: MyDepositDto,
    nullable: true,
  })
  me: MyDepositDto | null;

  @ApiProperty({ type: [DepositParticipantDto] })
  participants: DepositParticipantDto[];

  @ApiProperty({
    description:
      'За кого смотрящий может нажать «Я передал»: себя и людей без аккаунта, которых ведёт',
    type: [DepositSenderDto],
  })
  senders: DepositSenderDto[];
}

/**
 * Одно удержание залога в ленте «Движения денег» (18.11.2026).
 *
 * Удержание не двигает личные балансы: отказавшийся теряет свой перевод
 * залога, а доля расходов остаётся за ним — залог её и покрывает. Зато
 * в фонде группы появляются деньги, и лента объясняет, откуда плюс:
 * «Залог удержан · в фонд группы».
 */
export class TripDepositForfeitDto {
  @ApiProperty({ example: 'f1' })
  id: string;

  @ApiProperty({ description: 'Когда залог удержали' })
  at: string;

  @ApiProperty()
  sourceUserId: string;

  @ApiProperty({ example: 'Борис' })
  sourceName: string;

  @ApiProperty({ description: 'Сумма удержанного залога', example: 200 })
  amountRub: number;
}

/**
 * Возврат залога в ленте «Движения денег» (18.11.2026).
 *
 * Заказчик: «если организатор решил вернуть залог, то удалить эту запись
 * в Движении средств» — запись **удержания** удаляется. Но балансы от
 * возврата меняются: доля ушедшего расходится на идущих, и молчать об этом
 * нельзя. Поэтому в ленте появляется отдельная строка возврата — она
 * объясняет, почему у идущих стало на 50 ₽ больше долга, а у ушедшего
 * на 200 ₽ больше кредита.
 */
export class TripDepositReturnDto {
  @ApiProperty({ example: 'r1' })
  id: string;

  @ApiProperty({ description: 'Когда залог вернули' })
  at: string;

  @ApiProperty()
  sourceUserId: string;

  @ApiProperty({ example: 'Борис' })
  sourceName: string;

  @ApiProperty({ description: 'Доля ушедшего, разошедшаяся на идущих', example: 200 })
  amountRub: number;

  @ApiProperty({ type: [TripExpenseShareDto] })
  shares: TripExpenseShareDto[];
}

/** Тело `PUT /api/trips/:id/finance/deposit/:userId`. */
export class SaveTripDepositDto {
  @ApiProperty({
    description:
      'Решение по залогу отказавшегося: вернуть, удержать или снять решение',
    enum: DEPOSIT_DECISIONS,
    example: 'forfeited',
  })
  @IsIn(DEPOSIT_DECISIONS, {
    message: 'Решение по залогу: pending, returned или forfeited',
  })
  status: DepositDecision;
}

/**
 * Тело `POST /api/trips/:id/finance/deposit/transfer` (18.11.2026, v3).
 *
 * Участник переводит залог организатору: прямых переводов между
 * участниками в приложении нет, поэтому кнопка отдельная, а получатель
 * выбирается из организаторов похода. `fromUserId` — за человека
 * без аккаунта, которого ведёт смотрящий.
 *
 * **Сумма произвольная (v3).** В модалке подставлена недостача `dueRub`,
 * но её можно изменить, в том числе в бо́льшую сторону — заказчик разрешил
 * перевести «с запасом». Несколько переводов до покрытия разрешены:
 * залог можно докладывать частями.
 */
export class TransferTripDepositDto {
  @ApiProperty({
    description: 'Кому переводится залог: автор похода или соорганизатор',
    example: '90ca6b06-fb04-4c5e-8c49-36ef5d188c50',
  })
  @IsUUID('all', { message: 'Получатель залога должен быть человеком' })
  recipientUserId: string;

  @ApiProperty({
    description: 'Сумма перевода в рублях, целая',
    example: 150,
    minimum: 1,
    maximum: MAX_AMOUNT_RUB,
  })
  @IsInt({ message: 'Сумма перевода — целое число рублей' })
  @Min(1, { message: 'Сумма перевода должна быть больше нуля' })
  @Max(MAX_AMOUNT_RUB, {
    message: `Сумма перевода не должна превышать ${MAX_AMOUNT_RUB} ₽`,
  })
  amountRub: number;

  @ApiProperty({
    description:
      'Кто переводит: я или мой человек без аккаунта. Не передано — я',
    example: '90ca6b06-fb04-4c5e-8c49-36ef5d188c50',
    required: false,
  })
  @IsOptional()
  @IsUUID('all', { message: 'Отправитель залога должен быть человеком' })
  fromUserId?: string;
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
      'Залог участия. null — залога нет, блок над «Движением денег» не рисуется',
    type: TripDepositDto,
    nullable: true,
  })
  deposit: TripDepositDto | null;

  @ApiProperty({
    description:
      'Удержанные залоги: они пополняют фонд группы, поэтому стоят в ленте движения денег',
    type: [TripDepositForfeitDto],
  })
  depositForfeits: TripDepositForfeitDto[];

  @ApiProperty({
    description:
      'Возвраты залогов: доля ушедшего разошлась на идущих, и это видно в ленте',
    type: [TripDepositReturnDto],
  })
  depositReturns: TripDepositReturnDto[];

  @ApiProperty({
    description:
      'Люди без аккаунта, которых ведёт смотрящий: за них можно записать платёж и перевод',
    type: [CompensationSenderDto],
  })
  managedSenders: CompensationSenderDto[];
}

/**
 * Итог одного офлайн-чека в ответе синхронизации (19.11.2026).
 *
 * Пачка не бывает «всё или ничего»: один чек мог быть заведён на человека,
 * который уже вышел из похода, — его надо оставить в очереди с объяснением,
 * а остальные принять. Поэтому на каждый ключ свой итог.
 *
 * `accepted` — чек создан **или уже был** (повторная отправка).
 * `rejected` — сервер отказал: `message` объясняет причину словами,
 * и запись остаётся на устройстве, пока человек сам её не уберёт.
 */
export class TripExpenseSyncResultDto {
  @ApiProperty({ description: 'Ключ чека с устройства' })
  clientId: string;

  @ApiProperty({ enum: ['accepted', 'rejected'] })
  status: 'accepted' | 'rejected';

  @ApiProperty({
    description: 'Почему чек не принят — только у rejected',
    required: false,
  })
  message?: string;
}

/** Ответ `POST …/finance/expenses/sync`: вкладка целиком плюс итоги по чекам. */
export class TripFinanceSyncDto extends TripFinanceDto {
  @ApiProperty({
    description: 'Итог по каждому присланному чеку, в порядке отправки',
    type: [TripExpenseSyncResultDto],
  })
  results: TripExpenseSyncResultDto[];
}
