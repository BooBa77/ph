import { describe, expect, it } from 'vitest'

import type { GearItem, GearItemAttribute } from '@/types/gear'
import type { GearTypeAttribute } from '@/types/gearTypes'
import {
  buildGearAttributes,
  gearAttributeDrafts,
  gearAttributesSummary,
  gearAttributeValueWords,
  isBlankDraft,
} from '@/utils/gearAttributes'

/**
 * Тесты характеристик каталога.
 *
 * Правила здесь не видны глазом, а ошибка в них тихая: пустое значение,
 * отправленное «не трогать» вместо «стереть», вернётся после перезагрузки;
 * пропущенная проверка обязательных превратит экран в «сохрани и узнай
 * про 400». Поэтому проверяем именно эти тонкости, а не разметку.
 */

function attribute(
  overrides: Partial<GearTypeAttribute> & Pick<GearTypeAttribute, 'id' | 'code' | 'name' | 'valueKind'>,
): GearTypeAttribute {
  return {
    unit: null,
    allowCustomValue: false,
    isRequired: false,
    sortOrder: 0,
    options: [],
    ...overrides,
  }
}

const SEATS = attribute({
  id: 1,
  code: 'seats',
  name: 'Вместимость',
  valueKind: 'number',
  unit: 'мест',
  isRequired: true,
})
const MODEL = attribute({ id: 2, code: 'model', name: 'Модель', valueKind: 'text' })
const IS_NEW = attribute({ id: 3, code: 'is_new', name: 'Новый', valueKind: 'bool' })
const CONNECTION = attribute({
  id: 4,
  code: 'connection',
  name: 'Соединение',
  valueKind: 'select',
  options: [
    { id: 1, code: 'thread', name: 'резьбовой', sortOrder: 10 },
    { id: 2, code: 'collet', name: 'цанговый', sortOrder: 20 },
  ],
})

function saved(
  overrides: Partial<GearItemAttribute> & Pick<GearItemAttribute, 'code' | 'name' | 'valueKind' | 'value'>,
): GearItemAttribute {
  return {
    attributeId: 1,
    unit: null,
    ...overrides,
  }
}

describe('buildGearAttributes', () => {
  it('число уходит числом, пустое — null', () => {
    const built = buildGearAttributes([SEATS, MODEL], { seats: '3', model: '' })

    expect(built.error).toBeNull()
    expect(built.attributes).toEqual({ seats: 3, model: null })
  })

  it('запятая в числе — не ошибка', () => {
    const built = buildGearAttributes([SEATS], { seats: '2,5' })

    expect(built.error).toBeNull()
    expect(built.attributes.seats).toBe(2.5)
  })

  it('мусор в числе — ошибка с названием характеристики', () => {
    const built = buildGearAttributes([SEATS], { seats: 'много' })

    expect(built.attributes).toEqual({})
    expect(built.error).toBe('«Вместимость» — число: «много» не разобрано.')
  })

  it('пустое обязательное не отправляется, текст — как у сервера', () => {
    const built = buildGearAttributes([SEATS], { seats: '   ' })

    expect(built.error).toBe('Заполните обязательные характеристики: «Вместимость»')
  })

  it('галочка всегда true или false и никогда не блокирует отправку', () => {
    const required = attribute({
      id: 5,
      code: 'is_new',
      name: 'Новый',
      valueKind: 'bool',
      isRequired: true,
    })

    expect(buildGearAttributes([required], {}).attributes).toEqual({ is_new: false })
    expect(buildGearAttributes([required], { is_new: true }).attributes).toEqual({ is_new: true })
    expect(buildGearAttributes([required], {}).error).toBeNull()
  })

  it('вариант списка уходит своим именем', () => {
    const built = buildGearAttributes([CONNECTION], { connection: 'цанговый' })

    expect(built.error).toBeNull()
    expect(built.attributes).toEqual({ connection: 'цанговый' })
  })

  it('незаполненные необязательные — null, а не пропуск ключа', () => {
    const built = buildGearAttributes([SEATS, MODEL, CONNECTION], { seats: '2' })

    expect(built.error).toBeNull()
    expect(built.attributes).toEqual({ seats: 2, model: null, connection: null })
  })
})

describe('gearAttributeDrafts', () => {
  it('сохранённые значения раскладываются по полям формы', () => {
    const drafts = gearAttributeDrafts([
      saved({ code: 'seats', name: 'Вместимость', valueKind: 'number', value: 3 }),
      saved({ code: 'model', name: 'Модель', valueKind: 'text', value: 'MSR' }),
      saved({ code: 'is_new', name: 'Новый', valueKind: 'bool', value: true }),
    ])

    expect(drafts).toEqual({ seats: '3', model: 'MSR', is_new: true })
  })
})

describe('isBlankDraft', () => {
  it('пустая строка и пробелы — пусто, галочка — нет', () => {
    expect(isBlankDraft('')).toBe(true)
    expect(isBlankDraft('   ')).toBe(true)
    expect(isBlankDraft(undefined)).toBe(true)
    expect(isBlankDraft(false)).toBe(false)
    expect(isBlankDraft('2')).toBe(false)
  })
})

describe('подпись значений', () => {
  it('значение с единицей, галочка словами', () => {
    expect(
      gearAttributeValueWords(
        saved({ code: 'seats', name: 'Вместимость', valueKind: 'number', unit: 'мест', value: 3 }),
      ),
    ).toBe('3 мест')
    expect(
      gearAttributeValueWords(saved({ code: 'is_new', name: 'Новый', valueKind: 'bool', value: false })),
    ).toBe('нет')
  })

  it('строка под предметом перечисляет непустые значения', () => {
    const item: GearItem = {
      id: 'gear-1',
      typeId: 1,
      typeCode: 'tent',
      typeName: 'Палатка',
      kind: 'tent',
      title: 'Палатка на четверых',
      weightGrams: 2400,
      note: null,
      attributes: [
        saved({ code: 'seats', name: 'Вместимость', valueKind: 'number', unit: 'мест', value: 3 }),
        saved({ code: 'model', name: 'Модель', valueKind: 'text', value: '' }),
      ],
      createdAt: '2026-10-21T08:00:00.000Z',
    }

    expect(gearAttributesSummary(item)).toBe('Вместимость: 3 мест')
  })

  it('незаполненные значения не дают пустых подписей', () => {
    const item: GearItem = {
      id: 'gear-2',
      typeId: 1,
      typeCode: 'tent',
      typeName: 'Палатка',
      kind: 'tent',
      title: 'Палатка',
      weightGrams: null,
      note: null,
      attributes: [],
      createdAt: '2026-10-21T08:00:00.000Z',
    }

    expect(gearAttributesSummary(item)).toBe('')
  })
})
