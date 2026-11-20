import { ApiProperty } from '@nestjs/swagger';

import type { TripDateVariant } from '../entities/trip-date-variant.entity';
import type { Trip } from '../entities/trip.entity';
import type { TripStatus, TripVisibility } from '../trip.types';

/**
 * Цель похода — короткая выжимка из справочника, а не объект целиком.
 *
 * Вкладывается в ответ, чтобы лента не устраивала N+1 запросов за именем
 * цели: карточка похода показывает именно её, когда `announcement` пуст. Ссылка
 * на внешнюю страницу (`url`) отдаётся вместе с именем — фронт показывает
 * её значком у цели, и отдельный запрос за ней был бы тем же N+1.
 */
export class TripGoalDto {
  @ApiProperty({ description: 'Id объекта справочника', example: '10' })
  id: string;

  @ApiProperty({ description: 'Имя объекта', example: 'Витязь' })
  name: string;

  @ApiProperty({ description: 'Тип объекта', example: 'скальник' })
  type: string;

  @ApiProperty({
    description: 'Ссылка на внешнюю страницу объекта',
    example: 'https://nature.baikal.ru/obj.shtml?obj=skala&id=vityaz',
    nullable: true,
  })
  url: string | null;
}

/**
 * Публичное представление похода — то, что уходит наружу по API.
 *
 * Отдаётся в:
 *   - POST /api/trips (создание)
 *   - GET  /api/trips/:id (чтение)
 *
 * Отличается от entity `Trip` тем, что не содержит связей-объектов
 * (`organizer`, `goalObject`): наружу идут их id, а не вложенные сущности.
 * Если завтра в entity появится новое служебное поле — оно **не утечёт
 * в API** само: чтобы поле ушло наружу, его надо явно добавить сюда
 * и в `from()`.
 *
 * **Id здесь строки, и это не ошибка.** `id` и `goalObjectId` объявлены
 * в базе как `bigint`, а `node-postgres` отдаёт `bigint` в JS **строкой** —
 * иначе значения больше 2^53 теряли бы точность. Запрос при этом принимает
 * обычное число (`goalObjectId` в `CreateTripDto`), потому что обратное
 * преобразование безопасно: клиентские id заведомо далеки от предела.
 *
 * Даты — строки ISO 8601, а не `Date`. Так ответ не зависит от того, как
 * именно сериализует `Date` промежуточный слой, и фронт получает ровно то,
 * что покажет.
 */
/**
 * Вариант прогноза дат — одна возможная дата старта и продолжительность.
 *
 * Отдаётся в ответе похода, чтобы форма правки знала, что уже введено.
 * Без этого смена готовности с «Мечты» на «Планирую» показывала пустую
 * продолжительность и отправка стирала бы её (`tabs.md` §7).
 */
export class TripDateVariantDto {
  @ApiProperty({ description: 'Год или null', example: 2027, nullable: true })
  year: number | null;

  @ApiProperty({ description: 'Месяц или null', example: 6, nullable: true })
  month: number | null;

  @ApiProperty({
    description: 'Конкретное число месяца или null',
    example: 5,
    nullable: true,
  })
  day: number | null;

  @ApiProperty({
    description: 'Продолжительность в днях или null',
    example: 5,
    nullable: true,
  })
  durationDays: number | null;

  @ApiProperty({ description: 'Запас вверх: «5–7 дней» — 5 и 2', example: 0 })
  durationDelta: number;

  static from(variant: TripDateVariant): TripDateVariantDto {
    return {
      year: variant.year,
      month: variant.month,
      day: variant.day,
      durationDays: variant.durationDays,
      durationDelta: variant.durationDelta,
    };
  }
}

export class TripResponseDto {
  @ApiProperty({ description: 'Id похода', example: '1' })
  id: string;

  @ApiProperty({
    description: 'Id организатора — автора похода',
    example: '90ca6b06-fb04-4c5e-8c49-36ef5d188c50',
  })
  organizerUserId: string;

  @ApiProperty({
    description: 'Id цели похода из справочника объектов',
    example: '2',
  })
  goalObjectId: string;

  @ApiProperty({
    description:
      'Цель похода: имя, тип и ссылка. null — связь не подгружена (в ответах API не встречается)',
    type: () => TripGoalDto,
    nullable: true,
  })
  goalObject: TripGoalDto | null;

  @ApiProperty({
    description: 'Анонс: короткий текст для ленты. null — анонса нет',
    example: 'Идём на майские, набор шесть человек',
    nullable: true,
  })
  announcement: string | null;

  @ApiProperty({
    description: 'Маршрут: markdown со ссылками [[object:N]]',
    example: 'Заброска на [[object:2]]',
  })
  routeText: string;

  @ApiProperty({
    description: 'Требования к участникам',
    nullable: true,
  })
  requirementsText: string | null;

  @ApiProperty({
    description: 'Будет ли гитара',
    example: false,
  })
  hasGuitar: boolean;

  @ApiProperty({
    description: 'Видимость похода',
    enum: ['public', 'private'],
    example: 'public',
  })
  visibility: TripVisibility;

  @ApiProperty({
    description: 'Набор закрыт: заявки не принимаются',
    example: false,
  })
  isRecruitmentClosed: boolean;

  @ApiProperty({
    description: 'Активности из справочника календаря',
    type: [Number],
    example: [1],
  })
  activityTypeIds: number[];

  @ApiProperty({
    description: 'Стадия подготовки',
    enum: ['idea', 'planning', 'decided'],
    example: 'planning',
  })
  status: TripStatus;

  @ApiProperty({
    description: 'Начало похода по решению организатора',
    example: '2027-05-05T01:00:00.000Z',
    nullable: true,
  })
  startsAt: string | null;

  @ApiProperty({
    description: 'Конец похода по решению организатора',
    example: '2027-05-09T10:00:00.000Z',
    nullable: true,
  })
  endsAt: string | null;

  @ApiProperty({
    description:
      'Прогноз дат: варианты старта и продолжительность. Форме правки нужны, иначе смена готовности теряла бы введённое',
    type: () => [TripDateVariantDto],
  })
  dateVariants: TripDateVariantDto[];

  @ApiProperty({
    description: 'Коммерческий поход: организатор зарабатывает',
    example: false,
  })
  isCommercial: boolean;

  @ApiProperty({
    description:
      'Официальный поход: зачётный выход по правилам. Детали — в отдельных таблицах',
    example: false,
  })
  isOfficial: boolean;

  @ApiProperty({
    description:
      'Открытое участие: участники приглашают своих. Выключено — секции «Пригласить» и «Люди без аккаунта» видит только организатор',
    example: true,
  })
  openParticipation: boolean;

  @ApiProperty({
    description: 'Цена участия в рублях. Только у коммерческого похода',
    example: 25000,
    nullable: true,
  })
  priceRub: number | null;

  @ApiProperty({
    description: 'Что входит в стоимость',
    nullable: true,
  })
  priceNote: string | null;

  @ApiProperty({
    description:
      'Залог участия, рублей с человека. null — залога нет. В балансы и «Движение денег» не входит',
    example: 2000,
    nullable: true,
  })
  depositRub: number | null;

  @ApiProperty({
    description:
      'Когда поход завершён решением автора. null — не завершён. Отменить нельзя',
    nullable: true,
  })
  completedAt: string | null;

  /**
   * Пора спросить автора «поход состоялся?» — и можно его завершить.
   *
   * Считается сервером на текущего зрителя: только автор, только после
   * `ends_at`, только когда все идущие отметили «вернулся» и поход ещё
   * не завершён. Фронт по этому флагу показывает и вопрос при входе,
   * и кнопку «Завершить поход»; правило в двух местах не живёт.
   */
  @ApiProperty({
    description: 'Можно ли завершить поход (условия выполнены, смотрит автор)',
    example: false,
  })
  canComplete: boolean;

  @ApiProperty({
    description: 'Когда поход отменён. null — не отменён',
    nullable: true,
  })
  cancelledAt: string | null;

  @ApiProperty({ description: 'Создан', example: '2026-10-14T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({
    description: 'Последнее изменение: лента «что нового» и ревалидация',
    example: '2026-10-14T10:00:00.000Z',
  })
  updatedAt: string;

  static from(
    trip: Trip,
    dateVariants: TripDateVariant[] = [],
  ): TripResponseDto {
    return {
      id: trip.id,
      organizerUserId: trip.organizerUserId,
      goalObjectId: trip.goalObjectId,
      goalObject: trip.goalObject
        ? {
            id: trip.goalObject.id,
            name: trip.goalObject.name,
            type: trip.goalObject.type,
            url: trip.goalObject.url,
          }
        : null,
      announcement: trip.announcement,
      routeText: trip.routeText,
      requirementsText: trip.requirementsText,
      hasGuitar: trip.hasGuitar,
      visibility: trip.visibility,
      isRecruitmentClosed: trip.isRecruitmentClosed,
      activityTypeIds: trip.activityTypeIds,
      status: trip.status,
      startsAt: trip.startsAt?.toISOString() ?? null,
      endsAt: trip.endsAt?.toISOString() ?? null,
      dateVariants: dateVariants.map((variant) =>
        TripDateVariantDto.from(variant),
      ),
      isCommercial: trip.isCommercial,
      isOfficial: trip.isOfficial,
      openParticipation: trip.openParticipation,
      priceRub: trip.priceRub,
      priceNote: trip.priceNote,
      depositRub: trip.depositRub,
      completedAt: trip.completedAt?.toISOString() ?? null,
      // Правило «пора завершать» знает сервис (ему нужен состав), поэтому
      // в чистом преобразовании флаг всегда false, а `findOne` его доставит.
      canComplete: false,
      cancelledAt: trip.cancelledAt?.toISOString() ?? null,
      createdAt: trip.createdAt.toISOString(),
      updatedAt: trip.updatedAt.toISOString(),
    };
  }
}
