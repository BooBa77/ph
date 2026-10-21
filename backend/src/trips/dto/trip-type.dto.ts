import { ApiProperty } from '@nestjs/swagger';

import type { CalendarActivityType } from '../../calendar/entities/activity-type.entity';

/**
 * Тип похода в том виде, в каком его выбирает человек.
 *
 * Это не отдельный справочник: тип похода — строка общего справочника
 * активностей из группы «Туризм» (`docs/ph/trip-tabs.md`, решение
 * 20.10.2026). Отдаём только те поля, которые нужны чипсам в форме
 * и подписи на странице похода: `id` для выбора, `label` для человека,
 * `icon` для значка. `code` — машинный код: по нему фронт узнаёт тип
 * по умолчанию (`trip_hiking`), не полагаясь на порядок строк.
 */
export class TripTypeOptionDto {
  @ApiProperty({ description: 'Id типа в справочнике активностей', example: 19 })
  id: number;

  @ApiProperty({ description: 'Машинный код типа', example: 'trip_hiking' })
  code: string;

  @ApiProperty({ description: 'Подпись для человека', example: 'Пеший поход' })
  label: string;

  @ApiProperty({
    description: 'Ключ иконки из набора фронтенда',
    example: 'hike',
  })
  icon: string;

  static from(type: CalendarActivityType): TripTypeOptionDto {
    return {
      id: type.id,
      code: type.code,
      label: type.label,
      icon: type.icon,
    };
  }
}

/**
 * Ответ `GET /api/trips/types` — типы, которые можно выбрать в форме.
 *
 * `defaultTypeId` считает бэкенд, а не фронт. Причина простая: «пеший поход
 * по умолчанию» — это правило домена, и жить оно должно рядом с кодом `trip_hiking`,
 * а не в разметке чипсов. Если справочник залит без этого типа, поле будет
 * `null` — и фронт честно ничего не подставит вместо того, чтобы гадать
 * по порядку строк.
 *
 * Приходят только активные типы: погашенный тип — это «иконка
 * на рассмотрении» (см. модерацию активностей), предлагать его в форме
 * нечего. Старые походы при этом вправе ссылаться на погашенный тип, и
 * `activityTypeIds` в ответе похода остаются как есть.
 */
export class TripTypeListDto {
  @ApiProperty({ description: 'Типы похода', type: [TripTypeOptionDto] })
  types: TripTypeOptionDto[];

  @ApiProperty({
    description: 'Тип по умолчанию для неофициального похода',
    example: 19,
    nullable: true,
  })
  defaultTypeId: number | null;
}
