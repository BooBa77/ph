import { BadRequestException } from '@nestjs/common';

import type { GearValueKind } from './gear.types';

/**
 * Колонки значения характеристики вещи.
 *
 * Ровно одна из трёх заполнена — это же требует CHECK
 * `num_nonnulls(number_value, text_value, bool_value) = 1` в базе. Число
 * уходит в `number_value`, строка и выбранный вариант списка — в
 * `text_value`, галочка — в `bool_value`.
 */
export interface GearValueColumns {
  numberValue: number | null;
  textValue: string | null;
  boolValue: boolean | null;
}

/** Предел текстового значения: модель палатки или материал тента короче. */
export const GEAR_TEXT_VALUE_MAX = 500;

/**
 * Разбор значения характеристики по её виду.
 *
 * Одно правило на два входа: значение приходит из формы каталога
 * (`POST`/`PATCH /api/gear`) и из замещающего значения админки
 * (`fillMissing`) — и в обоих случаях оно обязано лечь в свою колонку.
 * Второй экземпляр правила разошёлся бы с первым после первой правки.
 *
 * **`null` и пустая строка — «стереть».** Форма присылает пустое поле
 * строкой, и различать «не прислали» и «стёрли» должен не этот разбор,
 * а карта значений: отсутствие ключа — не трогаем, `null` — стираем.
 * Для галочки `false` — значение, а не стирание: «нет, не новый» осмысленно.
 *
 * Число принимается и числом, и числовой строкой: поле ввода на телефоне
 * присылает строку, а `numeric` в базу всё равно уходит числом. `2,5`
 * чинится до `2.5` — заказчик так и писал вес.
 */
export function parseAttributeValue(
  attribute: {
    valueKind: GearValueKind;
    allowCustomValue: boolean;
    name: string;
  },
  raw: unknown,
  optionNames: readonly string[],
): GearValueColumns | null {
  if (attribute.valueKind === 'number') {
    if (raw === null || (typeof raw === 'string' && raw.trim().length === 0)) {
      return null;
    }

    const parsed =
      typeof raw === 'string'
        ? Number(raw.trim().replace(',', '.'))
        : typeof raw === 'number'
          ? raw
          : Number.NaN;

    if (!Number.isFinite(parsed)) {
      throw new BadRequestException(
        `«${attribute.name}» — число: значение не разобрано`,
      );
    }

    return { numberValue: parsed, textValue: null, boolValue: null };
  }

  if (attribute.valueKind === 'bool') {
    if (raw === null) return null;
    if (typeof raw !== 'boolean') {
      throw new BadRequestException(
        `«${attribute.name}» — галочка: значение true или false`,
      );
    }

    return { numberValue: null, textValue: null, boolValue: raw };
  }

  // text и select: оба ложатся в text_value.
  if (raw === null) return null;
  if (typeof raw !== 'string') {
    throw new BadRequestException(
      `«${attribute.name}» — текст: значение должно быть строкой`,
    );
  }

  const value = raw.trim();
  if (value.length === 0) return null;
  if (value.length > GEAR_TEXT_VALUE_MAX) {
    throw new BadRequestException(
      `«${attribute.name}»: значение не должно превышать ${GEAR_TEXT_VALUE_MAX} символов`,
    );
  }

  if (attribute.valueKind === 'select' && !attribute.allowCustomValue) {
    if (!optionNames.includes(value)) {
      const list = optionNames.map((name) => `«${name}»`).join(', ');
      throw new BadRequestException(
        optionNames.length === 0
          ? `«${attribute.name}»: у списка нет вариантов — сначала добавьте вариант в справочнике`
          : `«${attribute.name}»: выберите один из вариантов — ${list}`,
      );
    }
  }

  return { numberValue: null, textValue: value, boolValue: null };
}
